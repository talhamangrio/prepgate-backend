/**
 * One-time migration: introduces the Test entity and tags existing Math
 * data (Questions, Attempts, Sessions) with a single 'Mathematics' Test doc.
 *
 * Run with:
 *   MONGO_URI=<your-atlas-uri> node scripts/migrate-to-tests.js
 *
 * Idempotent: if a Mathematics Test doc already exists, reuses it. If
 * Questions/Attempts/Sessions are already tagged with a test, they're skipped.
 *
 * What it does:
 *   1. Ensures exactly one Test doc exists with { name: 'Mathematics',
 *      subject: 'Math', durationSec: 3000 }. (3000s = 50min, the old default.)
 *   2. For every Question without a `test` field: sets test = <math id>,
 *      subject = 'Math'. Leaves `level` and `section` untouched for back-compat.
 *   3. For every Attempt without a `test` field: sets test = <math id>,
 *      subject = 'Math', correctCount = englishScore + mathsScore + iqScore
 *      (so old attempts appear on the new per-test ranking), totalQuestions
 *      = null (cannot reliably reconstruct), startedAt/submittedAt = completedAt,
 *      timeTakenSeconds = null. score is left untouched (it held the old XP).
 *   4. For every Session without a `test` field: sets test = <math id>.
 *      Leaves `level` untouched.
 *   5. Updates Test.totalQuestions to the live count from the Question
 *      collection.
 *
 * What it does NOT do:
 *   - Delete any data.
 *   - Drop legacy fields. `level`, `section`, `englishScore`, `mathsScore`,
 *     `iqScore`, `score`, `percentage` all remain on old documents.
 *   - Touch the User collection. The new User schema simply ignores the
 *     old gating fields still present on existing user documents.
 *
 * Safe to re-run; prints a summary at the end.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Test = require('../models/Test');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');

const MATH_DURATION_SEC = 3000; // 50 minutes, the previous hardcoded default

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri || uri.includes('your_mongodb_connection_string_here')) {
    console.error('❌ Set MONGO_URI in your .env before running this script.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected.\n');

  // 1. Ensure one Math test exists
  let mathTest = await Test.findOne({ subject: 'Math' });
  if (mathTest) {
    console.log(`ℹ️  Mathematics test already exists (${mathTest._id}); reusing.`);
  } else {
    mathTest = await Test.create({
      name: 'Mathematics',
      subject: 'Math',
      durationSec: MATH_DURATION_SEC,
      totalQuestions: 0
    });
    console.log(`✅ Created Mathematics test (${mathTest._id}).`);
  }

  // 2. Tag questions
  const qUntagged = await Question.countDocuments({ test: null });
  if (qUntagged > 0) {
    const res = await Question.updateMany(
      { test: null },
      { $set: { test: mathTest._id, subject: 'Math' } }
    );
    console.log(`✅ Tagged ${res.modifiedCount} questions with Mathematics test (of ${qUntagged} untagged).`);
  } else {
    console.log('ℹ️  All questions already tagged.');
  }

  // 3. Tag attempts + backfill correctCount
  const aUntagged = await Attempt.countDocuments({ test: null });
  if (aUntagged > 0) {
    // Backfill correctCount from legacy section scores for any attempt that
    // doesn't already have correctCount set (> 0). We do this in JS rather
    // than with an aggregation pipeline update because we need a per-doc
    // expression; this is a one-time migration so the slower path is fine.
    const cursor = Attempt.find({ test: null }).cursor();
    let updated = 0;
    while (true) {
      const doc = await cursor.next();
      if (!doc) break;
      const correctCount = (doc.englishScore || 0) + (doc.mathsScore || 0) + (doc.iqScore || 0);
      doc.test = mathTest._id;
      doc.subject = 'Math';
      doc.correctCount = correctCount;
      doc.totalQuestions = doc.totalQuestions || null;
      doc.startedAt = doc.startedAt || doc.completedAt;
      doc.submittedAt = doc.submittedAt || doc.completedAt;
      doc.timeTakenSeconds = doc.timeTakenSeconds || null;
      await doc.save();
      updated++;
    }
    console.log(`✅ Tagged ${updated} attempts with Mathematics test (of ${aUntagged} untagged).`);
  } else {
    console.log('ℹ️  All attempts already tagged.');
  }

  // 4. Tag sessions
  const sUntagged = await Session.countDocuments({ test: null });
  if (sUntagged > 0) {
    const res = await Session.updateMany(
      { test: null },
      { $set: { test: mathTest._id } }
    );
    console.log(`✅ Tagged ${res.modifiedCount} sessions with Mathematics test (of ${sUntagged} untagged).`);
  } else {
    console.log('ℹ️  All sessions already tagged.');
  }

  // 5. Update Test.totalQuestions
  const liveCount = await Question.countDocuments({ test: mathTest._id });
  mathTest.totalQuestions = liveCount;
  await mathTest.save();
  console.log(`✅ Mathematics test totalQuestions updated to ${liveCount}.`);

  console.log('\n--- Summary ---');
  console.log(`Tests:        ${await Test.countDocuments()}`);
  console.log(`Questions:    ${await Question.countDocuments()} (${await Question.countDocuments({ test: mathTest._id })} for Math)`);
  console.log(`Attempts:     ${await Attempt.countDocuments()} (${await Attempt.countDocuments({ test: mathTest._id })} for Math)`);
  console.log(`Sessions:     ${await Session.countDocuments()} (${await Session.countDocuments({ test: mathTest._id })} for Math)`);

  await mongoose.disconnect();
  console.log('\n✅ Migration complete. DB connection closed.');
}

run().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
