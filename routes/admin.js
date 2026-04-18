const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attempt = require('../models/Attempt');
const Question = require('../models/Question');
const Announcement = require('../models/Announcement');
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

// Admin Login
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

// Stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAttempts = await Attempt.countDocuments();
    const totalQuestions = await Question.countDocuments();
    const passed = await Attempt.countDocuments({ percentage: { $gte: 60 } });
    const passRate = totalAttempts > 0 ? Math.round((passed / totalAttempts) * 100) : 0;
    res.json({ totalUsers, totalAttempts, totalQuestions, passRate });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await Attempt.deleteMany({ user: req.params.id });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all questions
router.get('/questions', adminAuth, async (req, res) => {
  try {
    const questions = await Question.find().sort({ level: 1, order: 1 });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete all questions for a level
router.delete('/questions/level/:level', adminAuth, async (req, res) => {
  try {
    await Question.deleteMany({ level: parseInt(req.params.level) });
    res.json({ message: `Level ${req.params.level} questions deleted` });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete single question
router.delete('/questions/:id', adminAuth, async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Batch upload questions (parse from text)
router.post('/questions/batch', adminAuth, async (req, res) => {
  try {
    const { level, rawText } = req.body;
    if (!level || !rawText) return res.status(400).json({ message: 'Level and rawText required' });

    const questions = parseQuestions(rawText, parseInt(level));
    if (!questions.length) return res.status(400).json({ message: 'No questions parsed. Check format.' });

    // Delete existing questions for this level
    await Question.deleteMany({ level: parseInt(level) });

    // Insert new questions
    await Question.insertMany(questions);

    res.json({ message: 'Questions uploaded!', count: questions.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during upload' });
  }
});

// Parse questions from raw text format
function parseQuestions(rawText, level) {
  const questions = [];
  
  // Split by question patterns: Q1:, Q2:, 1., 2., etc.
  const blocks = rawText.split(/\n(?=Q\d+:|^\d+\.|^\d+\))/m).filter(b => b.trim());

  blocks.forEach((block, idx) => {
    try {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length < 6) return;

      // Extract question text (first line, remove Q1: or 1. prefix)
      let questionText = lines[0].replace(/^Q\d+:\s*|^\d+[\.\)]\s*/i, '').trim();
      
      // Find options
      let optA = '', optB = '', optC = '', optD = '', correct = '';
      
      lines.forEach(line => {
        const aMatch = line.match(/^A[\.\)]\s*(.+)/i);
        const bMatch = line.match(/^B[\.\)]\s*(.+)/i);
        const cMatch = line.match(/^C[\.\)]\s*(.+)/i);
        const dMatch = line.match(/^D[\.\)]\s*(.+)/i);
        const ansMatch = line.match(/^Answer:\s*([ABCD])/i);
        
        if (aMatch) optA = aMatch[1].trim();
        if (bMatch) optB = bMatch[1].trim();
        if (cMatch) optC = cMatch[1].trim();
        if (dMatch) optD = dMatch[1].trim();
        if (ansMatch) correct = ansMatch[1].toUpperCase();
      });

      if (questionText && optA && optB && optC && optD && correct) {
        questions.push({
          university: 'SIBA',
          level,
          section: 'Maths',
          question: questionText,
          options: { A: optA, B: optB, C: optC, D: optD },
          correct,
          order: idx
        });
      }
    } catch (e) {
      console.warn('Skipped block:', e.message);
    }
  });

  return questions;
}

// Announcements
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
