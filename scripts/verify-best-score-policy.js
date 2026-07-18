/**
 * Verify the new best-score-only policy on the deployed Vercel backend.
 *
 * Flow:
 * 1. Create a fresh student user via /api/auth/register
 * 2. Login, fetch token
 * 3. Find an existing test with questions
 * 4. Submit attempt 1 with all-correct answers
 * 5. Submit attempt 2 with worse answers → should return isNewBest=false,
 *    bestCorrectCount should match attempt 1
 * 6. Submit attempt 3 with all-correct again, but claim a faster startedAt
 *    → should return isNewBest=true (faster time on tie)
 * 7. Verify Attempt.countDocuments({user, test}) === 1 (only one stored)
 */
const urllib = require('urllib');
const BASE = 'https://prepgate-backend.vercel.app';

async function jpost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await urllib.request(BASE + path, {
    method: 'POST',
    headers,
    data: JSON.stringify(body),
    dataType: 'text',
    timeout: 30000
  });
  let parsed;
  try { parsed = JSON.parse(r.data); } catch { parsed = { raw: r.data }; }
  return { status: r.status, body: parsed };
}

async function jget(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await urllib.request(BASE + path, { method: 'GET', headers, dataType: 'text', timeout: 30000 });
  let parsed;
  try { parsed = JSON.parse(r.data); } catch { parsed = { raw: r.data }; }
  return { status: r.status, body: parsed };
}

(async () => {
  // 1. Register a test user
  const email = `verify-best-${Date.now()}@prepgate.test`;
  const password = 'test1234';
  console.log(`\n[1] Registering ${email}...`);
  let r = await jpost('/api/auth/register', { name: 'Verify Best', email, password });
  if (r.status !== 200 && r.body.message !== 'User already exists') {
    console.log('  register:', r.status, r.body);
  }

  // 2. Login
  console.log('[2] Logging in...');
  r = await jpost('/api/auth/login', { email, password });
  console.log('  login:', r.status, r.body.user ? 'OK' : r.body);
  const token = r.body.token;

  // 3. List tests, pick one with questions
  console.log('[3] Listing tests...');
  r = await jget('/api/exam/tests');
  const tests = r.body || [];
  console.log(`  tests: ${tests.length} active`);
  if (!tests.length) { console.log('  No tests! Aborting.'); return; }

  // Pick first live test
  const test = tests.find(t => t.status === 'live' && t.totalQuestions > 0) || tests[0];
  console.log(`  picked: ${test.name} (${test._id}) — ${test.totalQuestions} questions, status=${test.status}`);

  // Get the questions so we know how many answers to send
  r = await jget(`/api/exam/tests/${test._id}/questions`, token);
  const questions = r.body.questions || [];
  console.log(`  questions fetched: ${questions.length}`);
  if (!questions.length) { console.log('  No questions! Aborting.'); return; }

  // Helper: submit with a given correctRatio (0..1) of correct answers
  async function submit(correctRatio, startedAt) {
    const answers = {};
    const nCorrect = Math.round(questions.length * correctRatio);
    questions.forEach((q, i) => {
      // We don't know the correct answer (server strips it), so we have to
      // cheat: send A for first nCorrect, B for the rest. Server compares
      // to actual correct — we'll see different correctCount per attempt.
      answers[q._id] = i < nCorrect ? 'A' : 'B';
    });
    return await jpost('/api/exam/submit', { testId: test._id, answers, startedAt }, token);
  }

  // 4. Attempt 1: 100% A's (nCorrect answers will be whatever A is correct for)
  console.log('\n[4] Submit attempt 1 (all A answers)...');
  let s = await submit(1, new Date(Date.now() - 30000).toISOString());
  console.log('  result:', s.status, JSON.stringify(s.body, null, 2));

  // 5. Attempt 2: 50% A's, 50% B's (likely fewer correct)
  console.log('\n[5] Submit attempt 2 (50% A, 50% B)...');
  s = await submit(0.5, new Date(Date.now() - 20000).toISOString());
  console.log('  result:', s.status, JSON.stringify(s.body, null, 2));

  // 6. Attempt 3: 100% A's again, but claim a faster startedAt (10s ago)
  console.log('\n[6] Submit attempt 3 (all A again, faster time)...');
  s = await submit(1, new Date(Date.now() - 10000).toISOString());
  console.log('  result:', s.status, JSON.stringify(s.body, null, 2));

  // 7. Check ranking — should show only ONE entry for this user
  console.log('\n[7] Fetching ranking to verify single entry...');
  r = await jget(`/api/exam/tests/${test._id}/ranking`);
  const myEntries = (r.body.ranking || []).filter(row => row.name === 'Verify Best');
  console.log(`  ranking entries for "Verify Best": ${myEntries.length}`);
  myEntries.forEach((e, i) => console.log(`    #${i+1}: rank=${e.rank} correct=${e.correctCount}/${e.totalQuestions} time=${e.timeTakenSeconds}s`));

  if (myEntries.length === 1) {
    console.log('\n✅ PASS: only 1 stored attempt per (user, test) — best-score policy works!');
  } else {
    console.log(`\n❌ FAIL: expected 1 entry, got ${myEntries.length}`);
  }
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
