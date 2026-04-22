require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected to MongoDB...');

  const User = require('./models/User');
  const Attempt = require('./models/Attempt');

  // Update all users - multiply totalScore by 100
  const users = await User.find({});
  for (const user of users) {
    user.totalScore = user.totalScore * 100;
    await user.save();
  }
  console.log(`✅ Updated ${users.length} users`);

  // Update all attempts - multiply score by 100
  const attempts = await Attempt.find({});
  for (const attempt of attempts) {
    attempt.score = attempt.score * 100;
    await attempt.save();
  }
  console.log(`✅ Updated ${attempts.length} attempts`);

  console.log('Migration complete!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});