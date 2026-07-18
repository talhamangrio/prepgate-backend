const mongoose = require('mongoose');

/**
 * A Contact Us form submission from a (typically anonymous) website visitor.
 *
 * Created via POST /api/contact (public — no auth). The admin (and any
 * moderator with the `messages` permission) can read / mark-read / delete
 * these from the admin panel's "Messages" tab.
 */
const MessageSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  email:   { type: String, trim: true, lowercase: true, default: '' },
  age:     { type: Number, min: 0, max: 120, default: null },
  subject: { type: String, trim: true, default: '' },
  message: { type: String, required: true, trim: true },
  read:    { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
