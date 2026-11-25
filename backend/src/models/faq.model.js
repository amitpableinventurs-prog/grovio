const { Schema, model } = require('mongoose');

// One question on the apps' Support > FAQs screen. Admin-editable (/admin/faqs); the apps read
// them through GET /common/support/faqs. `app` is which app shows it ('all' = every app) and
// `topic` one of that app's FAQ_TOPICS keys (services/support.service.js).
const faqSchema = new Schema({
  app: { type: String, enum: ['all', 'delivery', 'picker', 'customer'], default: 'all' },
  topic: { type: String, required: true },
  question: { type: String, required: true, trim: true, maxlength: 300 },
  answer: { type: String, required: true, trim: true, maxlength: 5000 },
  // Lower first; ties by creation time.
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

faqSchema.index({ app: 1, topic: 1, sortOrder: 1 });

module.exports = model('Faq', faqSchema);
