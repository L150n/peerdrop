require('dotenv').config();

const path = require('path');
const fastify = require('fastify')({
  logger: true,
  // Fix Nginx double-slash proxy: location /peerdrop + proxy_pass http://…:6000/
  // causes requests to arrive as //config, //paste, //ws. Rewrite before routing.
  rewriteUrl: (req) => req.url.replace(/^\/{2,}/, '/'),
});
const cron = require('node-cron');

// ─── Plugins ─────────────────────────────────────────────────────

// Static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

// Multipart
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 31457280,
  },
});

// Rate limiting
fastify.register(require('@fastify/rate-limit'), {
  max: 100,
  timeWindow: '1 minute',
});

// WebSocket
fastify.register(require('@fastify/websocket'));

// ─── Routes ──────────────────────────────────────────────────────

fastify.register(require('./routes/paste'));
fastify.register(require('./routes/file'));
fastify.register(require('./routes/ws'));

// ─── Health check ────────────────────────────────────────────────

fastify.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

// ─── Favicon (prevent 404) ──────────────────────────────────────

fastify.get('/favicon.ico', async (req, reply) => {
  reply.code(204).send();
});

// ─── Expiry config endpoint ─────────────────────────────────────

fastify.get('/config', async () => {
  const { getAllowedDays, getDefaultDays } = require('./utils/expiry');
  return {
    allowed_expiry_days: getAllowedDays(),
    default_expiry_days: getDefaultDays(),
    max_file_size: parseInt(process.env.MAX_FILE_SIZE, 10) || 31457280,
  };
});

// ─── Scheduled cleanup ──────────────────────────────────────────

cron.schedule('0 * * * *', async () => {
  try {
    const { listFiles } = require('./services/storage');
    const { deleteFile } = require('./services/storage');
    const { hasReverseLookup } = require('./services/redis');

    const files = listFiles();
    let cleaned = 0;

    for (const file of files) {
      const exists = await hasReverseLookup(file);
      if (!exists) {
        deleteFile(file);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      fastify.log.info(`Cleanup: removed ${cleaned} orphaned file(s)`);
    }
  } catch (err) {
    fastify.log.error('Cleanup error:', err);
  }
});

// ─── Start ───────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 6000;

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   PeerDrop running on port ${PORT}      ║
  ║   http://localhost:${PORT}              ║
  ╚═══════════════════════════════════════╝
  `);
});
