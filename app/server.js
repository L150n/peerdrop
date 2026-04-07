require('dotenv').config();

const path = require('path');
const fastify = require('fastify')({
  logger: true,
  // Fix Nginx double-slash proxy: location /peerdrop + proxy_pass http://…:6000/
  // causes requests to arrive as //config, //paste, //ws. Rewrite before routing.
  rewriteUrl: (req) => req.url.replace(/^\/{2,}/, '/'),
});
const cron = require('node-cron');

function getPublicHost(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const hostHeader = forwardedHost || req.headers.host || '';
  const rawHost = hostHeader.split(',')[0].trim();
  if (!rawHost) return '';

  const ipv6Match = rawHost.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (ipv6Match) return ipv6Match[1];

  return rawHost.replace(/:\d+$/, '');
}

function parseIceServers(req) {
  const rawIceServers = process.env.WEBRTC_ICE_SERVERS;
  if (rawIceServers) {
    try {
      const parsed = JSON.parse(rawIceServers);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (err) {
      fastify.log.warn('Invalid WEBRTC_ICE_SERVERS JSON, falling back to STUN/TURN env vars');
    }
  }

  const stunServers = (process.env.STUN_SERVERS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  const iceServers = stunServers.map((url) => ({ urls: url }));

  let turnUrls = (process.env.TURN_URLS || process.env.TURN_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  if (!turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
    const publicHost = getPublicHost(req);
    const turnPort = parseInt(process.env.TURN_PORT, 10) || 3478;
    if (publicHost) turnUrls = [`turn:${publicHost}:${turnPort}`];
  }

  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || '',
    });
  }

  return iceServers;
}

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

// ─── Share view routes (browser-friendly UI) ────────────────────

const fs = require('fs');
const SHARE_HTML = fs.readFileSync(
  path.join(__dirname, 'views', 'share.html'), 'utf8'
);

fastify.get('/view/paste/:id', async (req, reply) => {
  reply.type('text/html').send(SHARE_HTML);
});

fastify.get('/view/file/:id', async (req, reply) => {
  reply.type('text/html').send(SHARE_HTML);
});

// ─── Health check ────────────────────────────────────────────────

fastify.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

// ─── Favicon (prevent 404) ──────────────────────────────────────

fastify.get('/favicon.ico', async (req, reply) => {
  return reply.sendFile('peerdrop_logo.png');
});

// ─── Expiry config endpoint ─────────────────────────────────────

fastify.get('/config', async (req) => {
  const { getAllowedDays, getDefaultDays } = require('./utils/expiry');
  return {
    allowed_expiry_days: getAllowedDays(),
    default_expiry_days: getDefaultDays(),
    max_file_size: parseInt(process.env.MAX_FILE_SIZE, 10) || 31457280,
    ice_servers: parseIceServers(req),
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
