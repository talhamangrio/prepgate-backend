const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Moderator = require('../models/Moderator');

/**
 * Unified login endpoint — accepts admin, moderator, and student credentials.
 *
 * 1) Admin check first — matches ADMIN_EMAIL / ADMIN_PASSWORD env vars.
 *    Issues an admin JWT with `{ isAdmin: true }`.
 * 2) Moderator check — looks up the Moderator collection by email. If found
 *    and the account is active and the password matches, issues a moderator
 *    JWT with `{ isModerator: true, permissions }`. The response includes
 *    `user.isModerator: true` and `user.permissions` so the frontend can
 *    route to the admin panel and filter which tabs the moderator sees.
 * 3) Student check — falls back to the User collection.
 *
 * The response always includes a `user.isAdmin` / `user.isModerator` /
 * `user.permissions` shape so the client knows where to route.
 */

// Register (students only — admin email is reserved, moderators are admin-created)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Block registration with the reserved admin email
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@prepgate.com').toLowerCase();
    if (email && email.toLowerCase() === adminEmail) {
      return res.status(400).json({ message: 'This email is reserved.' });
    }

    // Block registration if a moderator already uses this email
    const existingMod = await Moderator.findOne({ email: String(email).toLowerCase() });
    if (existingMod) {
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
      user: { id: user._id, name: user.name, email: user.email, isAdmin: false, isModerator: false }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login (admin OR moderator OR student — single endpoint, role-based)
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
        user: { name: 'Admin', email, isAdmin: true, isModerator: false, permissions: null }
      });
    }

    // 2) Moderator check
    const mod = await Moderator.findOne({ email: String(email).toLowerCase() });
    if (mod) {
      if (!mod.active) {
        return res.status(403).json({ message: 'This moderator account is disabled. Contact the admin.' });
      }
      const isMatch = await bcrypt.compare(password, mod.password);
      if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

      const permissions = {
        dashboard:     !!mod.permissions?.dashboard,
        tests:         !!mod.permissions?.tests,
        users:         !!mod.permissions?.users,
        announcements: !!mod.permissions?.announcements,
        messages:      !!mod.permissions?.messages
      };
      const token = jwt.sign(
        { isModerator: true, moderatorId: String(mod._id), email: mod.email, permissions },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: {
          id: String(mod._id),
          name: mod.name,
          email: mod.email,
          isAdmin: false,
          isModerator: true,
          permissions
        }
      });
    }

    // 3) Student login
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, isAdmin: false, isModerator: false, permissions: null }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
