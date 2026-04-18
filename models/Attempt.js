const mongoose = require('mongoose');

const AttemptSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  level: { type: Number, required: true },
  score: { type: Number, required: true },
  percentage: { type: Number, required: true },
  englishScore: { type: Number, default: 0 },
  mathsScore: { type: Number, default: 0 },
  iqScore: { type: Number, default: 0 },
  completedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Attempt', AttemptSchema);