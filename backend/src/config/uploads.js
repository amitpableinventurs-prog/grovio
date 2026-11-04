const path = require('path');

// Where uploaded files are stored. Defaults to backend/uploads. Hosts that publish each deploy into
// a fresh folder (Hostinger's hbuilds/<version>) set UPLOADS_DIR to a folder outside it, so images
// and documents survive redeploys.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

module.exports = { UPLOADS_DIR };
