const mongoose = require('mongoose');
const URI = process.env.MONGO_URI;
(async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const total = await db.collection('users').countDocuments();
  const sample = await db.collection('users').find({}, { projection: { _id: 0, name: 1, email: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(5).toArray();
  console.log(`👥 Total users in production: ${total}`);
  console.log('📋 5 most recently created accounts:');
  sample.forEach((u, i) => {
    const date = u.createdAt ? new Date(u.createdAt).toISOString().slice(0,10) : '(no date)';
    console.log(`   ${i+1}. ${u.name || '(no name)'} — ${u.email} — joined ${date}`);
  });
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
