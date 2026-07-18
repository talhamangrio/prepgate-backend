const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attempt = require('../models/Attempt');
const Question = require('../models/Question');
const Test = require('../models/Test');
const Announcement = require('../models/Announcement');
const { parseCsvWithHeaders } = require('../utils/csv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Admin auth middleware
const adminAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ message: 'Not admin' });
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// ---------------------------------------------------------------
// Admin Login
// ---------------------------------------------------------------
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@prepgate.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (email !== adminEmail || password !== adminPassword) {
    return res.status(401).json({ message: 'Invalid admin credentials' });
  }
  const token = jwt.sign({ isAdmin: true, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// ---------------------------------------------------------------
// Stats (kept for the dashboard overview tab)
// ---------------------------------------------------------------
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAttempts = await Attempt.countDocuments();
    const totalQuestions = await Question.countDocuments();
    const totalTests = await Test.countDocuments();
    res.json({ totalUsers, totalAttempts, totalQuestions, totalTests });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Subjects (dynamic — derived from the Test collection so admins can
// invent new subjects freely without a code change)
// ---------------------------------------------------------------
router.get('/subjects', adminAuth, async (req, res) => {
  try {
    const subjects = await Test.distinct('subject');
    res.json({ subjects: subjects.filter(Boolean).sort() });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Test CRUD
// ---------------------------------------------------------------

// List all tests
router.get('/tests', adminAuth, async (req, res) => {
  try {
    const tests = await Test.find()
      .select('-__v')
      .sort({ subject: 1, createdAt: 1 });
    res.json(tests);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create test
//
// Body: { name, durationSec, status, scheduledAt }
//   - subject is no longer required from the client (defaults to 'General');
//     it's still accepted for backward-compat with older admin UIs
//   - status: 'coming_soon' | 'live' (default 'live')
//   - scheduledAt: ISO date string — when the test goes live (cosmetic;
//     admin still has to manually flip status to 'live')
router.post('/tests', adminAuth, async (req, res) => {
  try {
    const { name, subject, durationSec, status, scheduledAt } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'name is required' });
    }
    if (status && !['coming_soon', 'live'].includes(status)) {
      return res.status(400).json({ message: `status must be 'coming_soon' or 'live'` });
    }
    const test = new Test({
      name: String(name).trim(),
      subject: String(subject || 'General').trim(),
      durationSec: Number.isFinite(durationSec) && durationSec >= 60 ? Number(durationSec) : 3000,
      totalQuestions: 0,
      status: status || 'live',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null
    });
    await test.save();
    res.json(test);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update test metadata (name, duration, active, subject, status, scheduledAt)
router.patch('/tests/:id', adminAuth, async (req, res) => {
  try {
    const update = {};
    const allowed = ['name', 'subject', 'durationSec', 'active', 'status', 'scheduledAt'];
    allowed.forEach(f => {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    });
    if (update.status && !['coming_soon', 'live'].includes(update.status)) {
      return res.status(400).json({ message: `status must be 'coming_soon' or 'live'` });
    }
    if (update.durationSec !== undefined && (update.durationSec < 60)) {
      return res.status(400).json({ message: 'durationSec must be >= 60' });
    }
    if (update.scheduledAt !== undefined) {
      update.scheduledAt = update.scheduledAt ? new Date(update.scheduledAt) : null;
    }
    if (update.subject) update.subject = String(update.subject).trim();
    if (update.name) update.name = String(update.name).trim();
    const test = await Test.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!test) return res.status(404).json({ message: 'Test not found' });
    res.json(test);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete test AND its questions + attempts + sessions
router.delete('/tests/:id', adminAuth, async (req, res) => {
  try {
    const test = await Test.findByIdAndDelete(req.params.id);
    if (!test) return res.status(404).json({ message: 'Test not found' });
    await Question.deleteMany({ test: test._id });
    await Attempt.deleteMany({ test: test._id });
    const Session = require('../models/Session');
    await Session.deleteMany({ test: test._id });
    res.json({ message: `Test '${test.name}' and all its questions, attempts, sessions deleted.` });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// List questions for a test (paginated; admin can see correct answers)
router.get('/tests/:testId/questions', adminAuth, async (req, res) => {
  try {
    const questions = await Question.find({ test: req.params.testId })
      .sort({ order: 1, _id: 1 })
      .select('-__v');
    res.json(questions);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Bulk question upload (CSV)
// ---------------------------------------------------------------
//
// Expected CSV format (header row required):
//   question,A,B,C,D,correct,passage,explanation
//
// - `correct` must be one of A/B/C/D (case-insensitive, normalised to upper)
// - `passage` and `explanation` are optional (leave empty)
// - Fields may be quoted with " for embedded commas, quotes (doubled), or
//   newlines (RFC 4180 standard).
// - LaTeX is supported in any text field, delimited by $...$ or $$...$$,
//   rendered by KaTeX on the frontend (unchanged from before).
//
// Upload REPLACES the test's existing questions.
router.post('/tests/:testId/questions/bulk', adminAuth, async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    const { csv } = req.body;
    if (!csv || !csv.trim()) {
      return res.status(400).json({ message: 'csv (string) required in body' });
    }

    const { rows, errors } = parseCsvWithHeaders(csv,
      ['question', 'A', 'B', 'C', 'D', 'correct']);
    if (errors.length) {
      return res.status(400).json({ message: errors[0].message });
    }
    if (!rows.length) {
      return res.status(400).json({ message: 'No question rows found in CSV.' });
    }

    // Validate each row
    const validationErrors = [];
    const docs = [];
    rows.forEach((r, i) => {
      const correct = (r.correct || '').toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(correct)) {
        validationErrors.push({ row: r._rowNum, message: `correct must be A/B/C/D, got '${r.correct}'` });
        return;
      }
      if (!r.question || !r.A || !r.B || !r.C || !r.D) {
        validationErrors.push({ row: r._rowNum, message: 'question and all 4 options (A,B,C,D) are required' });
        return;
      }
      docs.push({
        test: test._id,
        subject: test.subject,
        question: r.question,
        options: { A: r.A, B: r.B, C: r.C, D: r.D },
        correct,
        passage: r.passage || null,
        explanation: r.explanation || null,
        order: i
      });
    });

    if (validationErrors.length) {
      return res.status(400).json({
        message: `Validation failed for ${validationErrors.length} row(s).`,
        errors: validationErrors.slice(0, 20)  // cap to first 20 for response size
      });
    }

    // Replace existing questions for this test
    await Question.deleteMany({ test: test._id });
    await Question.insertMany(docs);

    // Update denormalised count on the test
    test.totalQuestions = docs.length;
    test.updatedAt = Date.now();
    await test.save();

    res.json({
      message: `Uploaded ${docs.length} questions for '${test.name}'.`,
      count: docs.length
    });
  } catch (err) {
    console.error('Bulk upload error:', err);
    res.status(500).json({ message: 'Server error during upload' });
  }
});

// Delete a single question
router.delete('/questions/:id', adminAuth, async (req, res) => {
  try {
    const q = await Question.findByIdAndDelete(req.params.id);
    if (!q) return res.status(404).json({ message: 'Question not found' });
    // Keep Test.totalQuestions roughly in sync
    if (q.test) {
      await Test.updateOne(
        { _id: q.test },
        { $set: { totalQuestions: await Question.countDocuments({ test: q.test }) } }
      );
    }
    res.json({ message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Rankings CSV download (per test)
// ---------------------------------------------------------------
//
// Returns text/csv with columns:
//   rank, name, correctCount, totalQuestions, timeTakenSeconds, submittedAt
// Sorted the same way as the ranking view: correctCount desc,
// timeTakenSeconds asc, submittedAt asc.
router.get('/tests/:testId/rankings.csv', adminAuth, async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId).select('name subject totalQuestions');
    if (!test) return res.status(404).json({ message: 'Test not found' });

    const attempts = await Attempt.find({ test: test._id })
      .populate('user', 'name')
      .sort({ correctCount: -1, timeTakenSeconds: 1, submittedAt: 1 });

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };

    const header = ['rank', 'name', 'correctCount', 'totalQuestions', 'timeTakenSeconds', 'submittedAt'];
    const lines = [header.join(',')];
    attempts.forEach((a, idx) => {
      const total = a.totalQuestions || test.totalQuestions || 0;
      const time = a.timeTakenSeconds === null || a.timeTakenSeconds === undefined
        ? '' : a.timeTakenSeconds;
      const submittedAt = a.submittedAt || a.completedAt;
      const iso = submittedAt ? new Date(submittedAt).toISOString() : '';
      lines.push([
        idx + 1,
        escape(a.user?.name || 'Unknown'),
        a.correctCount,
        total,
        time,
        iso
      ].join(','));
    });

    const filename = `rankings-${test.name.replace(/\s+/g, '_')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('CSV download error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Users (unchanged from before, minus level-attempt counts in response)
// ---------------------------------------------------------------
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    // Attach total attempt count via a separate query — cheap and avoids
    // the old per-user level-counter fields that no longer exist.
    const counts = await Attempt.aggregate([
      { $group: { _id: '$user', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map(c => [String(c._id), c.count]));
    const enriched = users.map(u => ({
      ...u.toObject(),
      totalAttempts: countMap.get(String(u._id)) || 0
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await Attempt.deleteMany({ user: req.params.id });
    const Session = require('../models/Session');
    await Session.deleteMany({ user: req.params.id });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Legacy: all-questions endpoint (admin question-sets tab used this).
// Kept for back-compat; returns questions grouped by test now.
// ---------------------------------------------------------------
router.get('/questions', adminAuth, async (req, res) => {
  try {
    const questions = await Question.find()
      .populate('test', 'name subject')
      .sort({ test: 1, order: 1, _id: 1 })
      .select('-__v');
    res.json(questions);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Announcements (unchanged)
// ---------------------------------------------------------------
router.get('/announcements', adminAuth, async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/announcements', adminAuth, async (req, res) => {
  try {
    const { title, description, emoji } = req.body;
    const ann = new Announcement({ title, description, emoji: emoji || '📢' });
    await ann.save();
    res.json(ann);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/announcements/:id', adminAuth, async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
