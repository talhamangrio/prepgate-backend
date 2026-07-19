const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attempt = require('../models/Attempt');
const Question = require('../models/Question');
const Test = require('../models/Test');
const Announcement = require('../models/Announcement');
const Moderator = require('../models/Moderator');
const Message = require('../models/Message');
const { parseCsvWithHeaders } = require('../utils/csv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ---------------------------------------------------------------
// Auth: shared middleware — admin OR moderator.
//
// The previous `adminAuth` only allowed admin JWTs. We now also
// accept moderator JWTs (issued by /api/auth/login when a moderator
// signs in). The `actor` ({ type: 'admin' | 'moderator', decoded,
// permissions }) is attached to `req` so subsequent middleware can
// decide whether the actor is allowed for this specific route.
// ---------------------------------------------------------------
function authenticate(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.isAdmin) {
      req.actor = { type: 'admin', decoded, permissions: null };
      req.admin = decoded;
      return next();
    }
    if (decoded.isModerator) {
      req.actor = {
        type: 'moderator',
        decoded,
        permissions: decoded.permissions || {}
      };
      req.moderator = decoded;
      return next();
    }
    return res.status(403).json({ message: 'Not authorized' });
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// Back-compat alias — existing route definitions use `adminAuth`.
const adminAuth = authenticate;

// Per-route permission gate. Admins always pass. Moderators must have
// the named boolean flag set to `true` on their JWT's `permissions`.
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.actor) return res.status(401).json({ message: 'No token' });
    if (req.actor.type === 'admin') return next();
    if (req.actor.type === 'moderator' && req.actor.permissions && req.actor.permissions[perm]) {
      return next();
    }
    return res.status(403).json({ message: `Missing permission: ${perm}` });
  };
}

// Admin-only gate (moderators NEVER allowed) — used for moderator CRUD.
function adminOnly(req, res, next) {
  if (!req.actor) return res.status(401).json({ message: 'No token' });
  if (req.actor.type === 'admin') return next();
  return res.status(403).json({ message: 'Admin only' });
}

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
router.get('/stats', adminAuth, requirePermission('dashboard'), async (req, res) => {
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
router.get('/subjects', adminAuth, requirePermission('tests'), async (req, res) => {
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
router.get('/tests', adminAuth, requirePermission('tests'), async (req, res) => {
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
// Body: { name, durationSec, status, scheduledAt, showRanking, organiser }
//   - subject is no longer required from the client (defaults to 'General');
//     it's still accepted for backward-compat with older admin UIs
//   - status: 'coming_soon' | 'live' (default 'live')
//   - scheduledAt: ISO date string — when the test goes live (cosmetic;
//     admin still has to manually flip status to 'live')
//   - showRanking: boolean (default true) — when false, students get 403
//     on /api/exam/tests/:id/ranking
//   - organiser: { name, logoUrl, tagline, show } — optional per-test
//     branding shown on the test-detail page. show defaults to false.
router.post('/tests', adminAuth, requirePermission('tests'), async (req, res) => {
  try {
    const { name, subject, durationSec, status, scheduledAt, showRanking, organiser } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'name is required' });
    }
    if (status && !['coming_soon', 'live'].includes(status)) {
      return res.status(400).json({ message: `status must be 'coming_soon' or 'live'` });
    }
    const org = normaliseOrganiser(organiser);
    const test = new Test({
      name: String(name).trim(),
      subject: String(subject || 'General').trim(),
      durationSec: Number.isFinite(durationSec) && durationSec >= 60 ? Number(durationSec) : 3000,
      totalQuestions: 0,
      status: status || 'live',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      showRanking: showRanking === undefined ? true : !!showRanking,
      organiser: org
    });
    await test.save();
    res.json(test);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper: coerce an arbitrary `organiser` payload from the client into the
// shape defined on the Test schema. Tolerates missing/empty/partial input.
function normaliseOrganiser(input) {
  if (!input || typeof input !== 'object') {
    return { name: '', logoUrl: '', tagline: '', show: false };
  }
  return {
    name:    typeof input.name === 'string'    ? input.name.trim()    : '',
    logoUrl: typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '',
    tagline: typeof input.tagline === 'string' ? input.tagline.trim() : '',
    show:    !!input.show
  };
}

// Update test metadata (name, duration, active, subject, status, scheduledAt,
// showRanking, organiser)
router.patch('/tests/:id', adminAuth, requirePermission('tests'), async (req, res) => {
  try {
    const update = {};
    const allowed = ['name', 'subject', 'durationSec', 'active', 'status', 'scheduledAt', 'showRanking'];
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
    if (update.showRanking !== undefined) update.showRanking = !!update.showRanking;
    if (req.body.organiser !== undefined) {
      update.organiser = normaliseOrganiser(req.body.organiser);
    }
    const test = await Test.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!test) return res.status(404).json({ message: 'Test not found' });
    res.json(test);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete test AND its questions + attempts + sessions
router.delete('/tests/:id', adminAuth, requirePermission('tests'), async (req, res) => {
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
router.get('/tests/:testId/questions', adminAuth, requirePermission('tests'), async (req, res) => {
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
router.post('/tests/:testId/questions/bulk', adminAuth, requirePermission('tests'), async (req, res) => {
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
router.delete('/questions/:id', adminAuth, requirePermission('tests'), async (req, res) => {
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
router.get('/tests/:testId/rankings.csv', adminAuth, requirePermission('tests'), async (req, res) => {
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
router.get('/users', adminAuth, requirePermission('users'), async (req, res) => {
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

router.delete('/users/:id', adminAuth, requirePermission('users'), async (req, res) => {
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
router.get('/questions', adminAuth, requirePermission('tests'), async (req, res) => {
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
router.get('/announcements', adminAuth, requirePermission('announcements'), async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/announcements', adminAuth, requirePermission('announcements'), async (req, res) => {
  try {
    const { title, description, emoji } = req.body;
    const ann = new Announcement({ title, description, emoji: emoji || '📢' });
    await ann.save();
    res.json(ann);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/announcements/:id', adminAuth, requirePermission('announcements'), async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// MODERATORS — admin-only CRUD.
//
// Moderators cannot manage other moderators; only the admin can create,
// edit, or delete moderator accounts. Each moderator gets a granular
// `permissions` object deciding which admin-panel sections they can
// touch: dashboard / tests / users / announcements / messages.
// ---------------------------------------------------------------

// List all moderators (admin only)
router.get('/moderators', adminAuth, adminOnly, async (req, res) => {
  try {
    const mods = await Moderator.find()
      .select('-password -__v')
      .sort({ createdAt: -1 });
    res.json(mods);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create moderator (admin only)
// Body: { name, email, password, permissions: { dashboard, tests, users, announcements, messages } }
router.post('/moderators', adminAuth, adminOnly, async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email, password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    // Reject if email is already a moderator OR matches the admin email
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@prepgate.com').toLowerCase();
    if (String(email).toLowerCase() === adminEmail) {
      return res.status(400).json({ message: 'This email is reserved for the admin.' });
    }
    const existing = await Moderator.findOne({ email: String(email).toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'A moderator with this email already exists' });
    }
    // Also block if a student already uses this email — otherwise the
    // unified /login endpoint would have an ambiguous precedence.
    const existingUser = await User.findOne({ email: String(email).toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'This email is already used by a student account' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    const mod = new Moderator({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      password: hashed,
      permissions: {
        dashboard:     !!(permissions && permissions.dashboard),
        tests:         !!(permissions && permissions.tests),
        users:         !!(permissions && permissions.users),
        announcements: !!(permissions && permissions.announcements),
        messages:      !!(permissions && permissions.messages)
      },
      active: true
    });
    await mod.save();
    res.json({
      _id: mod._id,
      name: mod.name,
      email: mod.email,
      permissions: mod.permissions,
      active: mod.active,
      createdAt: mod.createdAt
    });
  } catch (err) {
    console.error('Create moderator error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update moderator (admin only)
// Body: any of { name, permissions, active, password }
router.patch('/moderators/:id', adminAuth, adminOnly, async (req, res) => {
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim();
    if (req.body.active !== undefined) update.active = !!req.body.active;
    if (req.body.permissions !== undefined) {
      const p = req.body.permissions || {};
      update.permissions = {
        dashboard:     !!p.dashboard,
        tests:         !!p.tests,
        users:         !!p.users,
        announcements: !!p.announcements,
        messages:      !!p.messages
      };
    }
    if (typeof req.body.password === 'string' && req.body.password.trim()) {
      if (req.body.password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }
      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(req.body.password, salt);
    }

    const mod = await Moderator.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    ).select('-password -__v');
    if (!mod) return res.status(404).json({ message: 'Moderator not found' });
    res.json(mod);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete moderator (admin only)
router.delete('/moderators/:id', adminAuth, adminOnly, async (req, res) => {
  try {
    const mod = await Moderator.findByIdAndDelete(req.params.id);
    if (!mod) return res.status(404).json({ message: 'Moderator not found' });
    res.json({ message: 'Moderator deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// MESSAGES — Contact Us submissions.
//
// Public POST (no auth) creates a message. Admin OR moderator with
// `messages` permission can list / mark-read / delete.
// ---------------------------------------------------------------
router.get('/messages', adminAuth, requirePermission('messages'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.unread === 'true') filter.read = false;
    const msgs = await Message.find(filter).sort({ createdAt: -1 }).select('-__v');
    const unreadCount = await Message.countDocuments({ read: false });
    res.json({ messages: msgs, unreadCount });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark message as read/unread
router.patch('/messages/:id', adminAuth, requirePermission('messages'), async (req, res) => {
  try {
    const update = {};
    if (req.body.read !== undefined) update.read = !!req.body.read;
    const msg = await Message.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    ).select('-__v');
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete message
router.delete('/messages/:id', adminAuth, requirePermission('messages'), async (req, res) => {
  try {
    const msg = await Message.findByIdAndDelete(req.params.id);
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    res.json({ message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
