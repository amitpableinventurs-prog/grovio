const multer = require('multer');

// Separate from upload.middleware.js (which is disk-storage, image-only) — a CSV import is
// parsed in-memory and discarded, never saved to /uploads like product images are.
const csvUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are allowed'));
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

module.exports = csvUpload;
