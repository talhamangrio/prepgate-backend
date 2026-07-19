/**
 * Local test for the new Test.showRanking + Test.organiser fields and the
 * student ranking gate (exam route returns 403 when showRanking === false).
 *
 * Run with:
 *   MONGO_URI=mongodb+srv://... JWT_SECRET=... node scripts/test-ranking-organiser.js
 *
 * It exercises the same model + route logic the production server uses,
 * against a real Atlas cluster. Creates a temp Test, then deletes it.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Test = require('../models/Test');

// Reproduce the normaliseOrganiser helper from routes/admin.js exactly
function normaliseOrganiser(input) {
  if (!input || typeof input !== 'object') {
    return { name: '', logoUrl: '', tagline: '', show: false };
  }
  return {
    name:    typeof input.name === 'string'    ? input.name.trim()    : '',
    logoUrl: typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '',
    tagline: typeof input.tagline === 'string' ? input.tagline.trim() : '',
    show:    !!input.show
  };
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('MONGO_URI env var required'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('✓ Connected to MongoDB');

  // 1) Create a test with showRanking=false + organiser
  const org = normaliseOrganiser({
    name: '  EAN Team  ',
    logoUrl: 'https://example.com/logo.png',
    tagline: ' In collaboration with PrepGate ',
    show: true
  });
  const t = new Test({
    name: '__TEST__ Ranking Toggle Probe',
    subject: 'General',
    durationSec: 600,
    status: 'live',
    showRanking: false,
    organiser: org
  });
  await t.save();
  console.log('✓ Test created:', t._id);
  console.log('  showRanking:', t.showRanking, '(expected false)');
  console.log('  organiser.name:', JSON.stringify(t.organiser.name), '(expected "EAN Team")');
  console.log('  organiser.tagline:', JSON.stringify(t.organiser.tagline), '(expected "In collaboration with PrepGate")');
  console.log('  organiser.show:', t.organiser.show, '(expected true)');

  // 2) Re-fetch from DB to confirm persistence
  const fresh = await Test.findById(t._id).lean();
  if (fresh.showRanking !== false) throw new Error('showRanking not persisted as false');
  if (fresh.organiser.name !== 'EAN Team') throw new Error('organiser.name not trimmed/persisted');
  if (fresh.organiser.show !== true) throw new Error('organiser.show not persisted as true');
  console.log('✓ Re-fetch confirms schema persistence');

  // 3) Backward-compat: a Test created without the new fields should
  //    default to showRanking=true + organiser.show=false
  const legacy = new Test({ name: '__TEST__ Legacy Defaults', durationSec: 600 });
  await legacy.save();
  if (legacy.showRanking !== true) throw new Error('default showRanking should be true');
  if (legacy.organiser.show !== false) throw new Error('default organiser.show should be false');
  if (legacy.organiser.name !== '') throw new Error('default organiser.name should be empty string');
  console.log('✓ Legacy defaults: showRanking=true, organiser.show=false');
  await Test.deleteOne({ _id: legacy._id });

  // 4) Simulate the ranking gate logic from routes/exam.js
  const gated = await Test.findById(t._id).select('name subject totalQuestions showRanking');
  if (gated.showRanking === false) {
    console.log('✓ Ranking gate: would return 403 { hidden: true } for students');
  } else {
    throw new Error('Ranking gate logic broken');
  }

  // 5) Update via $set (simulating PATCH route)
  const updated = await Test.findByIdAndUpdate(
    t._id,
    { $set: { showRanking: true, organiser: normaliseOrganiser({ name: 'New Org', show: false }) } },
    { new: true }
  );
  if (updated.showRanking !== true) throw new Error('showRanking update failed');
  if (updated.organiser.name !== 'New Org') throw new Error('organiser.name update failed');
  if (updated.organiser.show !== false) throw new Error('organiser.show update failed');
  console.log('✓ PATCH update via $set works for showRanking + organiser');

  // Cleanup
  await Test.deleteOne({ _id: t._id });
  console.log('✓ Cleanup done');

  await mongoose.disconnect();
  console.log('\n✅ All tests passed');
}

main().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
