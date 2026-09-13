const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// Make sure every request waits for a ready DB connection before proceeding.
// This is the key fix: it stops requests from racing ahead of the connection
// on a fresh/cold serverless instance under concurrent load.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('❌ DB connection error:', err);
    res.status(503).json({ message: 'Database unavailable, please try again shortly.' });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/exam', require('./routes/exam'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/contact', require('./routes/contact'));

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'PrepGate API is running!' });
});

module.exports = app;
