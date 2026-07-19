/**
 * Local test for auto-go-live.
 *
 * Connects to the same Atlas cluster the production backend uses, then:
 *   1. Creates a temp test with status='coming_soon' and scheduledAt in the
 *      past (10 seconds ago) — this should trigger an auto-flip on the
 *      next read.
 *   2. Calls autoGoLive() once.
 *   3. Re-fetches the temp test and asserts its status is now 'live'.
 *   4. Calls autoGoLive() AGAIN — confirms it's idempotent (no extra
 *      modification, modifiedCount:0).
 *   5. Also creates a control test with status='coming_soon' but
 *      scheduledAt 1 hour in the future, and asserts autoGoLive() leaves
 *      it alone.
 *   6. Cleans up both temp tests.
 *
 * Run from the backend repo root:
 *   node scripts/test-auto-go-live.js
 */

const mongoose = require('mongoose');
const Test = require('../models/Test');
const autoGoLive = require('../utils/autoGoLive');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://exbussinessman_db_user:jsfWWwTmX0ia4WMa@prepgate-cluster.s6webt3.mongodb.net/?appName=prepgate-cluster';

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Connecting to Atlas...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  const PAST = new Date(Date.now() - 10_000);     // 10s ago — should flip
  const FUTURE = new Date(Date.now() + 3600_000); // 1h from now — should NOT flip

  console.log('Creating temp tests...');
  const pastTest = await Test.create({
    name: 'AUTO-FLIP-PAST (test)',
    subject: 'General',
    durationSec: 3000,
    status: 'coming_soon',
    scheduledAt: PAST
  });
  const futureTest = await Test.create({
    name: 'AUTO-FLIP-FUTURE (test)',
    subject: 'General',
    durationSec: 3000,
    status: 'coming_soon',
    scheduledAt: FUTURE
  });
  console.log(`  pastTest   _id=${pastTest._id}  scheduledAt=${PAST.toISOString()}`);
  console.log(`  futureTest _id=${futureTest._id}  scheduledAt=${FUTURE.toISOString()}`);

  console.log('\n--- Pass 1: autoGoLive() ---');
  const flipped1 = await autoGoLive();
  console.log(`  flipped count: ${flipped1}`);

  const pastAfter1 = await Test.findById(pastTest._id).select('status scheduledAt updatedAt');
  const futureAfter1 = await Test.findById(futureTest._id).select('status scheduledAt updatedAt');
  console.log(`  pastTest   status now: ${pastAfter1.status}`);
  console.log(`  futureTest status now: ${futureAfter1.status}`);

  const pass1Pass =
    pastAfter1.status === 'live' &&
    futureAfter1.status === 'coming_soon';
  console.log(`  PASS: ${pass1Pass}`);

  console.log('\n--- Pass 2: autoGoLive() again (idempotency check) ---');
  const flipped2 = await autoGoLive();
  console.log(`  flipped count: ${flipped2} (expect 0 — pastTest already live, futureTest still future)`);
  const pass2Pass = flipped2 === 0;
  console.log(`  PASS: ${pass2Pass}`);

  console.log('\n--- Pass 3: NULL scheduledAt should NOT flip ---');
  const nullTest = await Test.create({
    name: 'AUTO-FLIP-NULL (test)',
    subject: 'General',
    durationSec: 3000,
    status: 'coming_soon',
    scheduledAt: null
  });
  await autoGoLive();
  const nullAfter = await Test.findById(nullTest._id).select('status');
  const pass3Pass = nullAfter.status === 'coming_soon';
  console.log(`  nullTest status now: ${nullAfter.status} (expect coming_soon)`);
  console.log(`  PASS: ${pass3Pass}`);

  console.log('\nCleaning up temp tests...');
  await Test.deleteMany({ _id: { $in: [pastTest._id, futureTest._id, nullTest._id] } });
  console.log('Cleaned up.');

  const allPass = pass1Pass && pass2Pass && pass3Pass;
  console.log(`\n=== OVERALL: ${allPass ? 'ALL PASS ✅' : 'FAILURES ❌'} ===`);
  await mongoose.disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
