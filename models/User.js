const mongoose = require('mongoose');

/**
 * A registered student.
 *
 * Post-refactor: level-gating fields (level1Attempts/level2Unlocked/etc.)
 * have been removed. Any logged-in user can attempt any test, any number of
 * times. Per-test attempt history lives on the Attempt collection.
 *
 * `totalScore` was a denormalised "best XP" used by the old site-wide
 * leaderboard; it has been removed along with that leaderboard.
 */
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
