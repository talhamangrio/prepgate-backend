/**
 * Migration v2 — cleanup legacy Math data + add status to remaining tests.
 *
 * Run with:
 *   MONGO_URI=<your-atlas-uri> node scripts/migrate-v2-cleanup.js
 *
 * Idempotent: safe to re-run.
 *
 * What it does:
 *   1. Finds all Test docs whose subject is 'Math' (or whose name is
 *      'Mathematics' — that's what migrate-to-tests.js created).
 *   2. Deletes every Session, Attempt, and Question tied to those Tests.
 *   3. Deletes the Math Test docs themselves.
 *   4. Also cleans up any orphaned legacy docs that have no `test` ref
 *      but DO have `subject:'Math'` or `level` set.
 *   5. For every Test doc that survives: ensures `status` is set
 *      (defaults to 'live') and `scheduledAt` is set or null.
 *
 * What it does NOT do:
 *   - Touch the User collection.
 *   - Touch any non-Math Test or its questions/attempts/sessions.
 *   - Drop legacy fields. `level`, `section`, `englishScore`, etc. all
 *     remain on surviving docs (they're just unused).
 *
 * Safe to re-run; prints a summary at the end.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Test = require('../models/Test');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri || uri.includes('your_mongodb_connection_string_here')) {
    console.error('❌ Set MONGO_URI in your .env before running this script.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected.\n');

  // -----------------------------------------------------------------
  // 1. Find all Math tests (by subject or by the legacy 'Mathematics' name)
  // -----------------------------------------------------------------
  const mathTests = await Test.find({
    $or: [
      { subject: 'Math' },
      { subject: 'math' },
      { name: 'Mathematics' }
    ]
  }).select('_id name subject');
  const mathTestIds = mathTests.map(t => t._id);
  console.log(`ℹ️  Found ${mathTestIds.length} Math test(s) to remove:`);
  mathTests.forEach(t => console.log(`     - ${t.name} (subject=${t.subject}, _id=${t._id})`));

  // -----------------------------------------------------------------
  // 2. Delete Sessions, Attempts, Questions tied to those tests
  // -----------------------------------------------------------------
  if (mathTestIds.length) {
    const s = await Session.deleteMany({ test: { $in: mathTestIds } });
    console.log(`✅ Deleted ${s.deletedCount} session(s) tied to Math tests.`);

    const a = await Attempt.deleteMany({ test: { $in: mathTestIds } });
    console.log(`✅ Deleted ${a.deletedCount} attempt(s) tied to Math tests.`);

    const q = await Question.deleteMany({ test: { $in: mathTestIds } });
    console.log(`✅ Deleted ${q.deletedCount} question(s) tied to Math tests.`);
  } else {
    console.log('ℹ️  No Math tests found — skipping test-tied cleanup.');
  }

  // -----------------------------------------------------------------
  // 3. Also clean up any orphaned legacy docs (no test ref but Math-related)
  // -----------------------------------------------------------------
  const orphanAttempts = await Attempt.deleteMany({
    test: null,
    $or: [{ subject: 'Math' }, { subject: 'math' }, { level: { $ne: null } }]
  });
  console.log(`✅ Deleted ${orphanAttempts.deletedCount} orphaned legacy attempt(s).`);

  const orphanQuestions = await Question.deleteMany({
    test: null,
    $or: [{ subject: 'Math' }, { subject: 'math' }, { level: { $ne: null } }]
  });
  console.log(`✅ Deleted ${orphanQuestions.deletedCount} orphaned legacy question(s).`);

  const orphanSessions = await Session.deleteMany({
    test: null,
    level: { $ne: null }
  });
  console.log(`✅ Deleted ${orphanSessions.deletedCount} orphaned legacy session(s).`);

  // -----------------------------------------------------------------
  // 4. Delete the Math Test docs themselves
  // -----------------------------------------------------------------
  if (mathTestIds.length) {
    const t = await Test.deleteMany({ _id: { $in: mathTestIds } });
    console.log(`✅ Deleted ${t.deletedCount} Math test doc(s).`);
  }

  // -----------------------------------------------------------------
  // 5. Ensure all remaining Tests have a `status` field
  // -----------------------------------------------------------------
  const noStatus = await Test.countDocuments({ status: null });
  if (noStatus > 0) {
    const r = await Test.updateMany(
      { status: null },
      { $set: { status: 'live' } }
    );
    console.log(`✅ Set status='live' on ${r.modifiedCount} test(s) that were missing it.`);
  } else {
    console.log('ℹ️  All remaining tests already have a status.');
  }

  // -----------------------------------------------------------------
  // 6. Summary
  // -----------------------------------------------------------------
  const remaining = await Test.countDocuments();
  const remainingSubjects = await Test.distinct('subject');
  console.log('\n📊 Final state:');
  console.log(`     - ${remaining} test(s) remaining`);
  console.log(`     - Subjects in use: ${remainingSubjects.filter(Boolean).sort().join(', ') || '(none)'}`);

  await mongoose.disconnect();
  console.log('\n✅ Migration complete.');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
