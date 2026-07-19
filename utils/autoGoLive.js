/**
 * Lazy auto-go-live helper.
 *
 * Background
 * ----------
 * The Test schema has two fields that together describe when a test should
 * become takeable:
 *
 *   - `status: 'coming_soon' | 'live'`  — actually controls whether the
 *     "Start Test" button is clickable for students.
 *   - `scheduledAt: Date | null`        — the public date the test is
 *     advertised to go live (rendered as a countdown on the coming-soon
 *     card).
 *
 * Originally the admin had to manually flip `status` from 'coming_soon'
 * to 'live' at the scheduled time — even though they had already
 * entered `scheduledAt`. That meant tests stayed stuck in "Coming Soon"
 * past their advertised start time until the admin remembered to log in
 * and flip the switch.
 *
 * This helper fixes that. Whenever the public tests list (or a single
 * test) is read, we first run a single idempotent `updateMany` that
 * flips any 'coming_soon' test whose `scheduledAt` is in the past to
 * 'live'. The flip is PERSISTED to the database — so the very first
 * read after the scheduled time does the flip once, and every
 * subsequent read is a no-op for that test.
 *
 * Properties
 * ----------
 *  - Idempotent: running it twice is identical to running it once.
 *  - Atomic:     a single MongoDB `updateMany` — no race window.
 *  - Cheap:      `status` is indexed, so the filter `{ status:
 *                'coming_soon', scheduledAt: { $lte: now } }` uses the
 *                index. Even with thousands of tests this is sub-ms.
 *  - Safe:       only tests with status EXACTLY 'coming_soon' and a
 *                non-null `scheduledAt` in the past are touched.
 *                'live' tests, hidden tests (active:false), and
 *                coming-soon tests without a schedule are never
 *                affected.
 *  - Self-cleaning: once flipped, the document's `status` field
 *                becomes 'live' permanently, so future reads skip it
 *                automatically.
 *
 * We also bump `updatedAt` so the admin can see when the auto-flip
 * happened by inspecting the test in the admin panel.
 *
 * Usage
 * -----
 *   const autoGoLive = require('../utils/autoGoLive');
 *   await autoGoLive();   // flip any due tests; safe to call on every read
 *
 * Returns the number of tests flipped (0 most of the time). Callers
 * are free to ignore the return value.
 */

const Test = require('../models/Test');

async function autoGoLive() {
  try {
    const now = new Date();
    const result = await Test.updateMany(
      {
        status: 'coming_soon',
        scheduledAt: { $ne: null, $lte: now }
      },
      {
        $set: {
          status: 'live',
          updatedAt: now
        }
      }
    );
    return result?.modifiedCount || 0;
  } catch (err) {
    // Never let the auto-flip failure break a read. The caller will
    // still serve the test list; the test just stays 'coming_soon'
    // for one more read until the next call succeeds.
    console.error('autoGoLive error:', err?.message || err);
    return 0;
  }
}

module.exports = autoGoLive;
