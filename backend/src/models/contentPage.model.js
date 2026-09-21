const { Schema, model } = require('mongoose');

// Admin-editable static pages (About Us, Privacy Policy, Terms & Conditions) — content is
// author-controlled HTML, served publicly via GET /common/content/:slug and rendered as-is by
// the customer app, so an admin can update legal/marketing copy without a code deploy.
const contentPageSchema = new Schema({
  slug: { type: String, required: true, unique: true, enum: ['about-us', 'privacy-policy', 'terms-and-conditions'] },
  title: { type: String, required: true },
  content: { type: String, required: true },
}, { timestamps: true });

module.exports = model('ContentPage', contentPageSchema);
