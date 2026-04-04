const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => console.log('✓ Redis connected'));
redis.on('error', (err) => console.error('✗ Redis error:', err.message));

// ─── Paste helpers ───────────────────────────────────────────────

async function setPaste(id, data, ttlSeconds) {
  await redis.set(`paste:${id}`, JSON.stringify(data), 'EX', ttlSeconds);
}

async function getPaste(id) {
  const raw = await redis.get(`paste:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function incrementPasteViews(id) {
  const paste = await getPaste(id);
  if (!paste) return null;
  paste.views = (paste.views || 0) + 1;
  const ttl = await redis.ttl(`paste:${id}`);
  if (ttl > 0) {
    await redis.set(`paste:${id}`, JSON.stringify(paste), 'EX', ttl);
  }
  return paste;
}

// ─── File helpers ────────────────────────────────────────────────

async function setFile(id, data, ttlSeconds) {
  await redis.set(`file:${id}`, JSON.stringify(data), 'EX', ttlSeconds);
  // Reverse lookup for cleanup
  await redis.set(`file_path:${data.stored_name}`, id, 'EX', ttlSeconds);
}

async function getFile(id) {
  const raw = await redis.get(`file:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function hasReverseLookup(storedName) {
  const exists = await redis.exists(`file_path:${storedName}`);
  return exists === 1;
}

module.exports = {
  redis,
  setPaste,
  getPaste,
  incrementPasteViews,
  setFile,
  getFile,
  hasReverseLookup,
};
