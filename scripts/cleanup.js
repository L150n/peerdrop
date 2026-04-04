#!/usr/bin/env node

/**
 * Standalone cleanup script.
 * Run via cron: 0 * * * * node /path/to/peerdrop/scripts/cleanup.js
 *
 * Reads all files in /uploads and deletes any that no longer have
 * a corresponding reverse-lookup key in Redis.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { listFiles, deleteFile } = require('../app/services/storage');
const { hasReverseLookup, redis } = require('../app/services/redis');

async function cleanup() {
  console.log('[cleanup] Starting...');

  const files = listFiles();
  let cleaned = 0;

  for (const file of files) {
    const exists = await hasReverseLookup(file);
    if (!exists) {
      deleteFile(file);
      cleaned++;
      console.log(`[cleanup] Deleted orphan: ${file}`);
    }
  }

  console.log(`[cleanup] Done. Removed ${cleaned} file(s).`);
  redis.disconnect();
}

cleanup().catch((err) => {
  console.error('[cleanup] Error:', err);
  redis.disconnect();
  process.exit(1);
});
