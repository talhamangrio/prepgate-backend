const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

/**
 * Public Contact Us form endpoint.
 *
 * No auth required. Validates required fields and stores the submission
 * in the Message collection, which the admin (or any moderator with the
 * `messages` permission) can read / mark-read / delete from the admin
 * panel's "Messages" tab.
 *
 * Body: { name, email, age, subject, message }
 *   - name:     required, 1..100 chars
 *   - email:    optional, basic shape validation
 *   - age:      optional, integer 5..120
 *   - subject:  optional, 1..150 chars
 *   - message:  required, 1..5000 chars
 */
router.post('/', async (req, res) => {
  try {
    const { name, email, age, subject, message } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }
    if (name.length > 100) return res.status(400).json({ message: 'Name is too long (max 100 chars)' });
    if (message.length > 5000) return res.status(400).json({ message: 'Message is too long (max 5000 chars)' });

    // Optional email shape check
    let cleanEmail = '';
    if (email && typeof email === 'string' && email.trim()) {
      cleanEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ message: 'Email address looks invalid' });
      }
    }

    let cleanAge = null;
    if (age !== undefined && age !== null && age !== '') {
      const n = Number(age);
      if (!Number.isFinite(n) || n < 5 || n > 120 || !Number.isInteger(n)) {
        return res.status(400).json({ message: 'Age must be a whole number between 5 and 120' });
      }
      cleanAge = n;
    }

    let cleanSubject = '';
    if (subject && typeof subject === 'string') {
      cleanSubject = subject.trim().slice(0, 150);
    }

    const msg = new Message({
      name: name.trim().slice(0, 100),
      email: cleanEmail,
      age: cleanAge,
      subject: cleanSubject,
      message: message.trim().slice(0, 5000),
      read: false
    });
    await msg.save();
    res.json({ message: 'Thanks for reaching out! We will get back to you soon.', id: msg._id });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ message: 'Server error — please try again later.' });
  }
});

module.exports = router;
