const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error('Please define the MONGO_URI environment variable');
}

// Reuse the connection across serverless invocations (Vercel keeps this
// global object alive between calls on a warm instance).
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    // Already connected on this instance — reuse it.
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // fail fast instead of buffering when disconnected
      maxPoolSize: 10,       // cap connections per function instance
      serverSelectionTimeoutMS: 10000,
    };

    cached.promise = mongoose.connect(MONGO_URI, opts).then((mongooseInstance) => {
      console.log('✅ MongoDB Connected!');
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // reset so next request can retry
    throw err;
  }

  return cached.conn;
}

module.exports = connectDB;
