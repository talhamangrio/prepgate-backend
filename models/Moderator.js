const mongoose = require('mongoose');

/**
 * A moderator — a non-admin staff account with granular permissions.
 *
 * Created by the admin via the admin panel. Each moderator has an email +
 * password (bcrypt-hashed) and a `permissions` object whose boolean flags
 * determine which admin-panel sections they can access:
 *
 *   - dashboard      → view stats overview
 *   - tests          → create / edit / delete tests + upload questions + CSV
 *   - users          → list / delete users
 *   - announcements  → create / delete announcements
 *   - messages       → read / mark-read / delete Contact Us submissions
 *
 * Moderators CANNOT manage other moderators — that power belongs to the
 * admin alone.
 *
 * On login, the auth route issues a JWT carrying `{ isModerator: true,
 * permissions }`; the `requirePermission(perm)` middleware on each admin
 * route enforces the gate.
 */
const ModeratorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  permissions: {
    dashboard:     { type: Boolean, default: false },
    tests:         { type: Boolean, default: false },
    users:         { type: Boolean, default: false },
    announcements: { type: Boolean, default: false },
    messages:      { type: Boolean, default: false }
  },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ModeratorSchema.pre('save', function () {
  // Mongoose 9.x removed callback-style `next` from middleware hooks — sync form only.
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Moderator', ModeratorSchema);
