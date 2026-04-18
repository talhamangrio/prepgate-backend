const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  totalScore: { type: Number, default: 0 },
  level1Attempts: { type: Number, default: 0 },
  level2Attempts: { type: Number, default: 0 },
  level3Attempts: { type: Number, default: 0 },
  level2Unlocked: { type: Boolean, default: false },
  level3Unlocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);