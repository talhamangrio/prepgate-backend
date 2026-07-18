// Quick verification: connect to Atlas, count docs in each collection.
const mongoose = require('mongoose');
const URI = process.env.MONGO_URI;

(async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const cols = ['users', 'tests', 'questions', 'attempts', 'sessions'];
  console.log('📊 Production DB state after migration:');
  for (const c of cols) {
    try {
      const count = await db.collection(c).countDocuments();
      console.log(`   ${c.padEnd(12)} ${count} doc(s)`);
    } catch (e) {
      console.log(`   ${c.padEnd(12)} (collection not found)`);
    }
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
