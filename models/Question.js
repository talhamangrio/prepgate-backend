const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  university: { type: String, default: 'SIBA' },
  level: { type: Number, required: true },
  section: { type: String, enum: ['English', 'Maths', 'IQ'], required: true },
  passage: { type: String, default: null },
  question: { type: String, required: true },
  options: {
    A: { type: String, required: true },
    B: { type: String, required: true },
    C: { type: String, required: true },
    D: { type: String, required: true }
  },
  correct: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
  order: { type: Number, default: 0 }
});

module.exports = mongoose.model('Question', QuestionSchema);