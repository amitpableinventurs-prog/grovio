const crypto = require('crypto');

// A compact, printable code — not a real-world UPC/EAN, just a unique token this system
// generates, prints as a QR/label, and later verifies a Picker's scan against.
function generateProductQrToken() {
  return `PRD-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

module.exports = { generateProductQrToken };
