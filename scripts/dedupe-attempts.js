/**
 * One-off migration: dedupe existing attempts per (user, test) — keep only
 * the best per the same rule as POST /api/exam/submit:
 *   sort by correctCount desc, then timeTakenSeconds asc, then submittedAt asc,
 *   keep the first, delete the rest.
 *
 * Idempotent: safe to run multiple times. If there are no duplicates, it
 * does nothing.
 *
 * Run: MONGO_URI=<atlas-uri> node scripts/dedupe-attempts.js
 */
const mongoose = require('mongoose');
const Attempt = require('../models/Attempt');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://exbussinessman_db_user:jsfWWwTmX0ia4WMa@prepgate-cluster.s6webt3.mongodb.net/?appName=prepgate-cluster';

(async () => {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  const total = await Attempt.countDocuments();
  console.log(`Total attempts: ${total}`);

  // Group by (user, test) and find duplicates
  const dups = await Attempt.aggregate([
    { $group: {
        _id: { user: '$user', test: '$test' },
        count: { $sum: 1 },
        ids:   { $push: '$_id' }
    }},
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]);
  console.log(`Duplicate (user, test) groups: ${dups.length}`);

  if (!dups.length) {
    console.log('Nothing to dedupe. Exiting.');
    await mongoose.disconnect();
    return;
  }

  let totalDeleted = 0;
  let totalKept = 0;
  for (const d of dups) {
    // Fetch all attempts in this group, sorted best-first
    const attempts = await Attempt.find({ _id: { $in: d.ids } })
      .sort({ correctCount: -1, timeTakenSeconds: 1, submittedAt: 1 });
    const keep = attempts[0];
    const remove = attempts.slice(1);
    console.log(`\n  user=${d._id.user} test=${d._id.test} count=${d.count}`);
    console.log(`    KEEP:   _id=${keep._id} correct=${keep.correctCount} time=${keep.timeTakenSeconds}s at=${keep.submittedAt?.toISOString?.() || keep.submittedAt}`);
    remove.forEach(a => {
      console.log(`    DELETE: _id=${a._id} correct=${a.correctCount} time=${a.timeTakenSeconds}s at=${a.submittedAt?.toISOString?.() || a.submittedAt}`);
    });
    const idsToRemove = remove.map(a => a._id);
    const result = await Attempt.deleteMany({ _id: { $in: idsToRemove } });
    totalDeleted += result.deletedCount;
    totalKept += 1;
  }

  console.log(`\nDone. Deleted ${totalDeleted} duplicate attempts across ${dups.length} groups. Kept 1 per group (${totalKept} total).`);
  const afterTotal = await Attempt.countDocuments();
  console.log(`Attempts before: ${total} | after: ${afterTotal} | delta: ${total - afterTotal}`);

  await mongoose.disconnect();
  console.log('Disconnected.');
})().catch(e => { console.error(e); process.exit(1); });
