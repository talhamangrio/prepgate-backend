const mongoose = require('mongoose');

/**
 * Auto-saved in-progress exam state, used for the resume-after-refresh flow.
 *
 * - `test` is the canonical reference (replaces `level`).
 * - `level` is kept for back-compat with pre-refactor sessions still in the
 *   DB; new sessions set it to null.
 * - `remainingTime` is the seconds-left countdown, persisted every 30s by
 *   the frontend so a page refresh can resume mid-exam.
 */
const SessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', index: true, default: null },
  level: { type: Number, default: null },     // legacy
  currentIndex: { type: Number, default: 0 },
  answers: { type: Map, of: String, default: {} },
  remainingTime: { type: Number, default: 3000 },
  section: { type: String, default: null },   // legacy
  startedAt: { type: Date, default: Date.now }, // server-set when session first created
  completed: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});

SessionSchema.index({ user: 1, test: 1, completed: 1 });

module.exports = mongoose.model('Session', SessionSchema);
