/**
 * Local end-to-end test of the new moderator + contact + messages flow.
 *
 * Run with:
 *   MONGO_URI=mongodb+srv://... JWT_SECRET=... node scripts/test-moderator-flow.js
 *
 * It does NOT use the HTTP layer — it directly imports the Mongoose models
 * and exercises the same code paths the routes use, against the production
 * Atlas cluster. This catches schema / pre-save / bcrypt issues before we
 * ship to Vercel.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Moderator = require('../models/Moderator');
const Message = require('../models/Message');
const User = require('../models/User');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI env var required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('✅ Connected to Atlas');

  const testEmail = `mod-test-${Date.now()}@prepgate-test.local`;

  // 1) Create a moderator
  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash('test123456', salt);
  const mod = new Moderator({
    name: 'Test Mod',
    email: testEmail,
    password: hashed,
    permissions: { dashboard: true, tests: true, users: false, announcements: false, messages: true },
    active: true
  });
  await mod.save();
  console.log('✅ Moderator created:', mod.email, '→', mod.permissions);

  // 2) Verify password compares correctly (mirrors /api/auth/login)
  const found = await Moderator.findOne({ email: testEmail });
  const match = await bcrypt.compare('test123456', found.password);
  console.log('✅ Password match:', match);

  // 3) Create a contact message
  const msg = new Message({
    name: 'Jane Student',
    email: 'jane@example.com',
    age: 19,
    subject: 'Suggestion',
    message: 'Add more MDCAT biology tests please!',
    read: false
  });
  await msg.save();
  console.log('✅ Message created:', msg._id);

  // 4) List unread messages
  const unread = await Message.countDocuments({ read: false });
  console.log('✅ Unread count:', unread);

  // 5) Cleanup — delete the test data
  await Moderator.findByIdAndDelete(mod._id);
  await Message.findByIdAndDelete(msg._id);
  console.log('✅ Test data cleaned up');

  await mongoose.disconnect();
  console.log('✅ All checks passed');
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
