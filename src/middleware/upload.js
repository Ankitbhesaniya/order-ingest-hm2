const multer = require('multer');
const path = require('path');
const os = require('os');

// Files are written to a temp dir on disk (NOT held in memory), then
// streamed from disk for both the GCS upload and the CSV parsing.
// This keeps memory flat regardless of file size.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `orders-upload-${unique}${path.extname(file.originalname)}`);
  },
});

function fileFilter(req, file, cb) {
  const allowed = ['.csv', '.xlsx', '.xls'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.includes(ext)) {
    return cb(new Error(`Unsupported file type "${ext}". Only CSV or Excel files are accepted.`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB safety cap
});

module.exports = upload;
