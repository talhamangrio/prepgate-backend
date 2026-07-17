const mongoose = require('mongoose');
const { SUBJECTS } = require('../constants/subjects');

/**
 * A Test is a single takeable exam — e.g. "Mathematics", "MDCAT Mock 1",
 * "ECAT Physics Set 2". Each test belongs to exactly one subject.
 *
 * Questions, Attempts, and Sessions all reference a Test by `_id`.
 *
 * `durationSec` is set by the admin and is the source of truth for the
 * exam countdown (the frontend reads this when starting a test, instead
 * of hardcoding 3000s).
 *
 * `totalQuestions` is denormalised for display convenience. It is updated
 * by the admin bulk-upload endpoint whenever questions change. If it ever
 * drifts from the actual Question.countDocuments({test}), the ranking CSV
 * still computes correct counts from the live query — this field is purely
 * a UI hint.
 */
const TestSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  subject: { type: String, enum: SUBJECTS, required: true, index: true },
  durationSec: { type: Number, required: true, default: 3000, min: 60 },
  totalQuestions: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

TestSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Test', TestSchema);
