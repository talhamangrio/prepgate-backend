const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attempt = require('../models/Attempt');
const Question = require('../models/Question');
const Session = require('../models/Session');
const Test = require('../models/Test');
const Announcement = require('../models/Announcement');
const autoGoLive = require('../utils/autoGoLive');
const jwt = require('jsonwebtoken');

// Auth middleware
const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// ---------------------------------------------------------------
// Tests (public — students need to see the list to pick one)
// ---------------------------------------------------------------

// List all active tests. Optional ?subject=Math filter.
//
// First, lazily auto-flip any 'coming_soon' test whose scheduledAt is
// in the past to 'live'. The flip is persisted (see utils/autoGoLive.js)
// so it only runs once per test, and is safe to call on every read.
router.get('/tests', async (req, res) => {
  try {
    await autoGoLive();
    const filter = { active: true };
    if (req.query.subject) filter.subject = req.query.subject;
    const tests = await Test.find(filter)
      .select('-__v')
      .sort({ subject: 1, createdAt: 1 });
    res.json(tests);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get one test (for the test-detail page)
//
// Auto-flip first so a student who opens the test-detail page exactly
// at the scheduled time sees the test as 'live' without a page reload.
router.get('/tests/:testId', async (req, res) => {
  try {
    await autoGoLive();
    const test = await Test.findById(req.params.testId).select('-__v');
    if (!test) return res.status(404).json({ message: 'Test not found' });
    res.json(test);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get questions for a test (auth required — students only)
router.get('/tests/:testId/questions', auth, async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    // Strip the `correct` field before sending to the client.
    const questions = await Question.find({ test: test._id })
      .sort({ order: 1, _id: 1 })
      .select('-correct');
    res.json({ test, questions });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Per-test ranking (public)
// ---------------------------------------------------------------

// Get ranking for a specific test.
// Sort: correctCount desc, timeTakenSeconds asc (nulls last), submittedAt asc.
//
// If the test has `showRanking: false`, students get 403 with
// `{ message, hidden: true }`. The admin rankings.csv download in
// routes/admin.js is NOT affected — admins always see rankings.
router.get('/tests/:testId/ranking', async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId).select('name subject totalQuestions showRanking');
    if (!test) return res.status(404).json({ message: 'Test not found' });
    if (test.showRanking === false) {
      return res.status(403).json({
        message: 'Ranking is hidden for this test.',
        hidden: true
      });
    }

    const attempts = await Attempt.find({ test: test._id })
      .populate('user', 'name')
      .sort({ correctCount: -1, timeTakenSeconds: 1, submittedAt: 1 });

    const ranking = attempts.map((a, idx) => ({
      rank: idx + 1,
      userId: a.user?._id,
      name: a.user?.name || 'Unknown',
      correctCount: a.correctCount,
      totalQuestions: a.totalQuestions || test.totalQuestions || 0,
      timeTakenSeconds: a.timeTakenSeconds,
      submittedAt: a.submittedAt || a.completedAt
    }));

    res.json({ test, ranking });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Exam session (auto-save / resume)
// ---------------------------------------------------------------

// Save exam session (auto-save)
router.post('/session/save', auth, async (req, res) => {
  try {
    const { testId, currentIndex, answers, remainingTime, startedAt } = req.body;
    if (!testId) return res.status(400).json({ message: 'testId required' });

    let session = await Session.findOne({ user: req.user.id, test: testId, completed: false });
    if (session) {
      session.currentIndex = currentIndex;
      session.answers = answers;
      session.remainingTime = remainingTime;
      if (startedAt) session.startedAt = startedAt;
      session.updatedAt = Date.now();
    } else {
      session = new Session({
        user: req.user.id,
        test: testId,
        currentIndex,
        answers,
        remainingTime,
        startedAt: startedAt || Date.now()
      });
    }
    await session.save();
    res.json({ message: 'Session saved' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get resume session
router.get('/session/:testId', auth, async (req, res) => {
  try {
    const session = await Session.findOne({
      user: req.user.id,
      test: req.params.testId,
      completed: false
    });
    res.json(session || null);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete session (restart)
router.delete('/session/:testId', auth, async (req, res) => {
  try {
    await Session.deleteOne({
      user: req.user.id,
      test: req.params.testId,
      completed: false
    });
    res.json({ message: 'Session cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Submit exam
// ---------------------------------------------------------------

router.post('/submit', auth, async (req, res) => {
  try {
    const { testId, answers, startedAt } = req.body;
    if (!testId) return res.status(400).json({ message: 'testId required' });
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ message: 'answers object required' });
    }

    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    const user = await User.findById(req.user.id);

    // Pull all questions for this test (need the correct answers)
    const questions = await Question.find({ test: test._id }).sort({ order: 1, _id: 1 });

    // Score: 1 mark per correct answer. No negative marking, no speed bonus.
    let correctCount = 0;
    questions.forEach(q => {
      const userAnswer = answers[q._id.toString()];
      if (userAnswer && userAnswer === q.correct) correctCount++;
    });

    const totalQuestions = questions.length;
    const percentage = totalQuestions > 0
      ? Math.round((correctCount / totalQuestions) * 100)
      : 0;

    // Time tracking
    const submittedAt = new Date();
    let timeTakenSeconds = null;
    if (startedAt) {
      const start = new Date(startedAt);
      if (!isNaN(start.getTime())) {
        timeTakenSeconds = Math.max(0, Math.round((submittedAt - start) / 1000));
      }
    }

    // -----------------------------------------------------------------
    // Best-score-only policy (one Attempt per user+test):
    //
    // The user's intent: "if a student gives the test twice and gets
    // better marks than the first attempt, remove the old record and
    // show the top score. If they attempt thrice, show only the highest
    // score."
    //
    // Rule: keep ONLY the best attempt per (user, test). Replace the
    // stored attempt only when the new submission is strictly better.
    // Tie-breaker: equal score but faster time also wins (so the
    // ranking's secondary sort by timeTakenSeconds asc stays honest).
    // Otherwise discard the new submission and return the existing best.
    // -----------------------------------------------------------------

    const existing = await Attempt.find({ user: user._id, test: test._id })
      .sort({ correctCount: -1, timeTakenSeconds: 1, submittedAt: 1 });

    const best = existing[0];
    let attempt;          // the Attempt doc we treat as "the" attempt for this user+test
    let isNewBest = true; // did this submission become the stored best?

    if (best) {
      const newIsHigher = correctCount > best.correctCount;
      const newEqualFaster =
        correctCount === best.correctCount &&
        (best.timeTakenSeconds == null ||
          (timeTakenSeconds != null && timeTakenSeconds < best.timeTakenSeconds));

      if (newIsHigher || newEqualFaster) {
        // New submission wins — delete ALL previous attempts for this
        // (user, test), then save the new one as the sole record.
        await Attempt.deleteMany({ user: user._id, test: test._id });
        attempt = new Attempt({
          user: user._id,
          test: test._id,
          subject: test.subject,
          correctCount,
          totalQuestions,
          startedAt: startedAt || null,
          submittedAt,
          timeTakenSeconds,
          score: correctCount,        // back-compat
          percentage,
          completedAt: submittedAt    // back-compat
        });
        await attempt.save();
        isNewBest = true;
      } else {
        // New submission is not better — discard it, keep the existing best.
        // We still return the result of THIS submission to the candidate
        // (so they see what they just got), but flag it so the client can
        // show a "your previous best was higher" hint if it wants to.
        attempt = best;
        isNewBest = false;
      }
    } else {
      // First attempt for this (user, test) — just save it.
      attempt = new Attempt({
        user: user._id,
        test: test._id,
        subject: test.subject,
        correctCount,
        totalQuestions,
        startedAt: startedAt || null,
        submittedAt,
        timeTakenSeconds,
        score: correctCount,        // back-compat
        percentage,
        completedAt: submittedAt    // back-compat
      });
      await attempt.save();
      isNewBest = true;
    }

    // Mark any in-progress session complete
    await Session.updateOne(
      { user: req.user.id, test: test._id, completed: false },
      { completed: true }
    );

    res.json({
      test: { _id: test._id, name: test.name, subject: test.subject },
      correctCount,
      totalQuestions,
      percentage,
      timeTakenSeconds,
      attemptId: attempt._id,
      // isNewBest=true  → this submission was saved as the user's best
      // isNewBest=false → this submission was discarded; the user's stored
      //                   best is the previous one (returned for display)
      isNewBest,
      // Always return the user's stored best so the client can show both
      // "what you got this attempt" and "your best so far"
      bestCorrectCount: attempt.correctCount,
      bestTimeTakenSeconds: attempt.timeTakenSeconds,
      bestSubmittedAt: attempt.submittedAt
    });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Profile
// ---------------------------------------------------------------

router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    const attempts = await Attempt.find({ user: req.user.id })
      .populate('test', 'name subject')
      .sort({ submittedAt: -1, completedAt: -1 });
    res.json({ user, attempts });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------------------------------------------------------------
// Announcements (unchanged from before)
// ---------------------------------------------------------------

router.get('/announcements', async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 });
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
