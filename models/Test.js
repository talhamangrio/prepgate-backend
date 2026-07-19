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
 *
 * Ranking visibility:
 *   - `showRanking` (boolean, default true) — when false, students cannot
 *     open the per-test ranking page (the API returns 403 with
 *     `{ message, hidden:true }`). The admin rankings.csv download is
 *     NOT affected — admins always see rankings. This lets the admin
 *     selectively show off rankings for some tests (e.g. sponsored mocks)
 *     while keeping others private (e.g. internal diagnostic tests).
 *
 * Organiser info (per-test branding):
 *   - `organiser` (object) — optional branding shown on the test-detail
 *     page only. Useful when a partner institution (e.g. "EAN Team" for
 *     MDCAT 2026) conducts a test on PrepGate and wants their name/logo
 *     displayed to students. Completely optional — when `organiser.show`
 *     is false (the default), no organiser info is rendered anywhere.
 *       * `organiser.name`    — e.g. "EAN Team"
 *       * `organiser.logoUrl` — optional logo image URL (rendered round)
 *       * `organiser.tagline` — optional short line, e.g.
 *                                "In collaboration with PrepGate"
 *       * `organiser.show`    — master on/off switch
 *   The organiser block is rendered as a banner on the test-detail page
 *   (view-3) PLUS a one-time confirmation modal when the student clicks
 *   "Start Test", so they acknowledge who is conducting the test before
 *   the timer starts. The modal is per-session (not shown again until
 *   the page is reloaded).
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
  // Ranking visibility — when false, students get 403 on /api/exam/tests/:id/ranking
  showRanking: { type: Boolean, default: true },
  // Optional per-test organiser branding
  organiser: {
    name:    { type: String, default: '', trim: true },
    logoUrl: { type: String, default: '', trim: true },
    tagline: { type: String, default: '', trim: true },
    show:    { type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// NOTE: Mongoose 9.x removed the callback-style `next` parameter from
// middleware — pre hooks must be sync (no return) or async (return a Promise).
// Using sync here since we only mutate `this.updatedAt`.
TestSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Test', TestSchema);
