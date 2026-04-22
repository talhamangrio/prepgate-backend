const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attempt = require('../models/Attempt');
const Question = require('../models/Question');
const Session = require('../models/Session');
const Announcement = require('../models/Announcement');
const jwt = require('jsonwebtoken');

// Auth middleware
const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Get questions for a level
router.get('/questions/:level', auth, async (req, res) => {
  try {
    const questions = await Question.find({ level: req.params.level })
  .sort({ section: 1, order: 1 });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Save exam session (auto-save)
router.post('/session/save', auth, async (req, res) => {
  try {
    const { level, currentIndex, answers, remainingTime, section } = req.body;
    let session = await Session.findOne({ user: req.user.id, level, completed: false });
    if (session) {
      session.currentIndex = currentIndex;
      session.answers = answers;
      session.remainingTime = remainingTime;
      session.section = section;
      session.updatedAt = Date.now();
    } else {
      session = new Session({ user: req.user.id, level, currentIndex, answers, remainingTime, section });
    }
    await session.save();
    res.json({ message: 'Session saved' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get resume session
router.get('/session/:level', auth, async (req, res) => {
  try {
    const session = await Session.findOne({ user: req.user.id, level: req.params.level, completed: false });
    res.json(session || null);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete session (restart)
router.delete('/session/:level', auth, async (req, res) => {
  try {
    await Session.deleteOne({ user: req.user.id, level: req.params.level, completed: false });
    res.json({ message: 'Session cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit exam
router.post('/submit', auth, async (req, res) => {
  try {
    const { level, answers } = req.body;
    const user = await User.findById(req.user.id);
    const attemptField = `level${level}Attempts`;

    if (user[attemptField] >= 3) {
      return res.status(400).json({ message: 'Maximum attempts reached' });
    }

    // Get all questions with correct answers
    const questions = await Question.find({ level }).sort({ section: 1, order: 1 });

    let englishScore = 0, mathsScore = 0, iqScore = 0;
    questions.forEach(q => {
      const userAnswer = answers[q._id.toString()];
      if (userAnswer === q.correct) {
        if (q.section === 'English') englishScore++;
        else if (q.section === 'Maths') mathsScore++;
        else if (q.section === 'IQ') iqScore++;
      }
    });

    const totalCorrect = englishScore + mathsScore + iqScore;
    const totalQuestions = questions.length || 100;
    const percentage = Math.round((totalCorrect / totalQuestions) * 100);

    // Save attempt
    const attempt = new Attempt({
      user: user._id, level,
      score: totalCorrect,
      percentage,
      englishScore, mathsScore, iqScore
    });
    await attempt.save();

    // Update user
    user[attemptField] += 1;
    if (percentage >= 60 && level === 1) user.level2Unlocked = true;
    if (percentage >= 70 && level === 2) user.level3Unlocked = true;
    if (totalCorrect > user.totalScore) user.totalScore = totalCorrect;
    await user.save();

    // Mark session complete
    await Session.updateOne(
      { user: req.user.id, level, completed: false },
      { completed: true }
    );

    res.json({ totalCorrect, percentage, englishScore, mathsScore, iqScore, user });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    const attempts = await Attempt.find({ user: req.user.id }).sort({ completedAt: -1 });
    res.json({ user, attempts });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const users = await User.find()
      .select('name totalScore')
      .sort({ totalScore: -1 })
      .limit(30);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get announcements
router.get('/announcements', async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;