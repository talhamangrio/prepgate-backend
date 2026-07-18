const mongoose = require('mongoose');

/**
 * A Test is a single takeable exam — e.g. "MDCAT Mock 1", "ECAT Physics Set 2",
 * "USAT English Diagnostic". The `subject` field is kept for backward
 * compatibility with the v2 schema but is no longer surfaced in the admin UI —
 * it defaults to 'General' and admins only set the test `name`. (The student-
 * facing subject filter pills still work; they just show 'General' for every
 * test unless an admin sets a different subject via the API directly.)
 *
 * Lifecycle / visibility:
 *
 *   - `active` (boolean) — controls whether the test appears in the public
 *     `/api/exam/tests` list at all. `active:false` hides a test from students
 *     completely (e.g. while you're preparing it).
 *
 *   - `status` (enum: 'coming_soon' | 'live') — only meaningful when active:true.
 *       * 'coming_soon' → students see a purple animated card with the
 *         scheduled date + a live countdown. They cannot start the test.
 *       * 'live'        → students see a gold animated card with a "Live"
 *         badge and "Start Test" / "View Ranking" buttons.
 *
 *   - `scheduledAt` (Date) — the public date the test is scheduled to go live.
 *     Used to render the countdown on coming-soon cards. Purely cosmetic —
 *     the admin still has to manually flip `status` to 'live' when ready;
 *     we never auto-flip.
 *
 * Questions, Attempts, and Sessions all reference a Test by `_id`.
 *
 * `durationSec` is set by the admin and is the source of truth for the
 * exam countdown.
 *
 * `totalQuestions` is denormalised for display convenience. It is updated
 * by the admin bulk-upload endpoint whenever questions change. If it ever
 * drifts from the actual Question.countDocuments({test}), the ranking CSV
 * still computes correct counts from the live query — this field is purely
 * a UI hint.
 */
const TestSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  subject: { type: String, required: true, default: 'General', trim: true, index: true },
  durationSec: { type: Number, required: true, default: 3000, min: 60 },
  totalQuestions: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true, index: true },
  status: {
    type: String,
    enum: ['coming_soon', 'live'],
    default: 'live',
    index: true
  },
  scheduledAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

TestSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Test', TestSchema);
