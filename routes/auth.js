const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Unified login endpoint — accepts BOTH admin and student credentials.
 *
 * The frontend has a single login form. The user types their email +
 * password here; if the email matches the ADMIN_EMAIL env var AND the
 * password matches ADMIN_PASSWORD, we issue an admin JWT (with
 * `isAdmin: true`) and the frontend routes them to the admin panel.
 * Otherwise we look the user up in the User collection and issue a
 * student JWT.
 *
 * The response always includes `user.isAdmin: boolean` so the client
 * can decide which view to mount without a second round-trip.
 */

// Register (students only — admin email is reserved)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Block registration with the reserved admin email
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@prepgate.com').toLowerCase();
    if (email && email.toLowerCase() === adminEmail) {
      return res.status(400).json({ message: 'This email is reserved.' });
    }

    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({ name, email, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, isAdmin: false }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login (admin OR student — single endpoint, role-based)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1) Admin check first
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@prepgate.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    if (email === adminEmail && password === adminPassword) {
      const token = jwt.sign(
        { isAdmin: true, email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { name: 'Admin', email, isAdmin: true }
      });
    }

    // 2) Otherwise, student login
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, isAdmin: false }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
