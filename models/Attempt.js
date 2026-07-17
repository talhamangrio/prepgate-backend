const mongoose = require('mongoose');
const { SUBJECTS } = require('../constants/subjects');

/**
 * A single completed test attempt ("submission") by a user.
 *
 * Scoring (post-refactor):
 * - Each correct answer = 1 mark. No negative marking, no speed bonus.
 * - `correctCount` is the canonical score field.
 * - `score` is kept (set equal to correctCount) for back-compat with any
 *   code that still reads it; do not write to it directly in new code.
 *
 * Time tracking:
 * - `startedAt` — ISO timestamp sent by the client when the test was started.
 * - `submittedAt` — server-set timestamp when /submit was called.
 * - `timeTakenSeconds` — derived: (submittedAt - startedAt) / 1000.
 *   For legacy attempts that predate these fields, this is null.
 *
 * Legacy fields kept for back-compat:
 * - `level` (Number) — was the test identifier. Optional now.
 * - `englishScore`, `mathsScore`, `iqScore` — per-section correct counts.
 *   Only populated for legacy attempts; new attempts leave them at 0 and
 *   use only `correctCount`.
 * - `percentage` — kept for the admin stats endpoint (pass-rate), still
 *   computed as round(correctCount / totalQuestions * 100).
 */
const AttemptSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', index: true, default: null },
  subject: { type: String, enum: SUBJECTS, default: null, index: true },

  // Canonical scoring (post-refactor)
  correctCount: { type: Number, default: 0, min: 0 },
  totalQuestions: { type: Number, default: 0, min: 0 },

  // Time tracking
  startedAt: { type: Date, default: null },
  submittedAt: { type: Date, default: Date.now },
  timeTakenSeconds: { type: Number, default: null, min: 0 },

  // Legacy / back-compat fields
  level: { type: Number, default: null },
  score: { type: Number, default: 0 },           // == correctCount; kept for old consumers
  percentage: { type: Number, default: 0 },       // round(correctCount / totalQuestions * 100)
  englishScore: { type: Number, default: 0 },
  mathsScore: { type: Number, default: 0 },
  iqScore: { type: Number, default: 0 },

  completedAt: { type: Date, default: Date.now }  // alias of submittedAt (kept for old code)
});

AttemptSchema.index({ test: 1, correctCount: -1, timeTakenSeconds: 1 });

module.exports = mongoose.model('Attempt', AttemptSchema);
