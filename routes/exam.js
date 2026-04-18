const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attempt = require('../models/Attempt');
const jwt = require('jsonwebtoken');

// Middleware to verify token
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

// Submit exam result
router.post('/submit', auth, async (req, res) => {
  try {
    const { level, score, percentage, englishScore, mathsScore, iqScore } = req.body;
    const user = await User.findById(req.user.id);

    // Check attempt limit
    const attemptField = `level${level}Attempts`;
    if (user[attemptField] >= 3) {
      return res.status(400).json({ message: 'Maximum attempts reached' });
    }

    // Save attempt
    const attempt = new Attempt({
      user: user._id, level, score, percentage, englishScore, mathsScore, iqScore
    });
    await attempt.save();

    // Update user
    user[attemptField] += 1;
    if (percentage >= 60 && level === 1) user.level2Unlocked = true;
    if (percentage >= 70 && level === 2) user.level3Unlocked = true;
    if (score > user.totalScore) user.totalScore = score;
    await user.save();

    res.json({ message: 'Result saved!', user });
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
    const users = await User.find().select('name totalScore').sort({ totalScore: -1 }).limit(20);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;