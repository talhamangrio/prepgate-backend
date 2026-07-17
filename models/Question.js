const mongoose = require('mongoose');

/**
 * A single multiple-choice question.
 *
 * - `test` is the canonical reference to the Test this question belongs to.
 * - `subject` is denormalised onto the question (free-form string copied
 *   from the parent Test at write time) so the admin can filter the
 *   questions collection by subject without a join.
 *
 * Legacy fields kept for back-compat with pre-refactor data:
 * - `level` (Number) — was the only test identifier before the v1 refactor.
 * - `section` (English/Maths/IQ) — was used for per-section scoring inside
 *   one multi-subject test.
 * - `university` — legacy source field.
 *
 * None of these legacy fields are read by any current code path; they're
 * preserved so old data remains inspectable in MongoDB Compass.
 */
const QuestionSchema = new mongoose.Schema({
  test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', index: true, default: null },
  subject: { type: String, default: null, index: true },

  // Legacy fields (kept for back-compat with pre-refactor data)
  university: { type: String, default: 'SIBA' },
  level: { type: Number, default: null },
  section: { type: String, enum: ['English', 'Maths', 'IQ'], default: null },

  passage: { type: String, default: null },
  question: { type: String, required: true },
  options: {
    A: { type: String, required: true },
    B: { type: String, required: true },
    C: { type: String, required: true },
    D: { type: String, required: true }
  },
  correct: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
  explanation: { type: String, default: null },
  order: { type: Number, default: 0 }
});

QuestionSchema.index({ test: 1, order: 1 });

module.exports = mongoose.model('Question', QuestionSchema);
