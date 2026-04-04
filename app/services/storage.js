const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

// Ensure upload directory exists
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

// Save an uploaded file stream to disk
async function saveFile(fileStream, storedName) {
  ensureUploadDir();
  const dest = path.join(UPLOAD_DIR, storedName);
  const writeStream = fs.createWriteStream(dest);
  await pipeline(fileStream, writeStream);
  return dest;
}

// Get a readable stream for a stored file
function getFileStream(storedName) {
  const filePath = path.join(UPLOAD_DIR, storedName);
  if (!fs.existsSync(filePath)) return null;
  return fs.createReadStream(filePath);
}

// Get file size
function getFileSize(storedName) {
  const filePath = path.join(UPLOAD_DIR, storedName);
  if (!fs.existsSync(filePath)) return 0;
  return fs.statSync(filePath).size;
}

// Delete a file
function deleteFile(storedName) {
  const filePath = path.join(UPLOAD_DIR, storedName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

// List all files in uploads
function listFiles() {
  ensureUploadDir();
  return fs.readdirSync(UPLOAD_DIR);
}

module.exports = {
  UPLOAD_DIR,
  ensureUploadDir,
  saveFile,
  getFileStream,
  getFileSize,
  deleteFile,
  listFiles,
};
