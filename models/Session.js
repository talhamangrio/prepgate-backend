const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  level: { type: Number, required: true },
  currentIndex: { type: Number, default: 0 },
  answers: { type: Map, of: String, default: {} },
  remainingTime: { type: Number, default: 5400 },
  section: { type: String, default: 'English' },
  completed: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Session', SessionSchema);