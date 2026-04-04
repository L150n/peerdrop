const path = require('path');
const { generateId } = require('../utils/ids');
const { validateExpiry } = require('../utils/expiry');
const { hashPassword, verifyPassword } = require('../utils/password');
const { setFile, getFile } = require('../services/redis');
const { saveFile, getFileStream, getFileSize } = require('../services/storage');

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 31457280; // 30MB

async function fileRoutes(fastify) {
  // ─── Upload file ───────────────────────────────────────────────
  fastify.post('/upload', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 hour',
      },
    },
  }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    // Extract fields from multipart
    const fields = {};
    for (const [key, field] of Object.entries(data.fields)) {
      if (field.value !== undefined) {
        fields[key] = field.value;
      }
    }

    const password = fields.password || null;
    const expiryDays = fields.expiry_days ? parseInt(fields.expiry_days, 10) : undefined;

    const id = generateId();
    const ext = path.extname(data.filename) || '';
    const storedName = generateId(20) + ext;

    // Save file to disk
    const filePath = await saveFile(data.file, storedName);

    // Check file size after save
    const size = getFileSize(storedName);
    if (size > MAX_FILE_SIZE) {
      // Delete oversized file
      const { deleteFile } = require('../services/storage');
      deleteFile(storedName);
      return reply.code(413).send({ error: 'File too large', max: `${Math.round(MAX_FILE_SIZE / 1048576)}MB` });
    }

    const { days, seconds } = validateExpiry(expiryDays);

    const meta = {
      original_name: data.filename,
      stored_name: storedName,
      path: filePath,
      mimetype: data.mimetype,
      size,
      password_hash: password ? await hashPassword(password) : null,
      expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
      created_at: new Date().toISOString(),
    };

    await setFile(id, meta, seconds);

    return reply.code(201).send({
      id,
      url: `/file/${id}`,
      original_name: data.filename,
      size,
      expires_in_days: days,
      has_password: !!password,
    });
  });

  // ─── File info (metadata only) ────────────────────────────────
  fastify.get('/file/:id/info', async (request, reply) => {
    const { id } = request.params;
    const meta = await getFile(id);
    if (!meta) {
      return reply.code(404).send({ error: 'File not found or expired' });
    }

    return {
      id,
      original_name: meta.original_name,
      size: meta.size,
      mimetype: meta.mimetype,
      expires_at: meta.expires_at,
      created_at: meta.created_at,
      password_protected: !!meta.password_hash,
    };
  });

  // ─── Download file ─────────────────────────────────────────────
  fastify.get('/file/:id', async (request, reply) => {
    const { id } = request.params;
    const { password } = request.query;

    const meta = await getFile(id);
    if (!meta) {
      return reply.code(404).send({ error: 'File not found or expired' });
    }

    // Password check
    if (meta.password_hash) {
      if (!password) {
        return reply.code(401).send({
          error: 'Password required',
          password_protected: true,
        });
      }
      const valid = await verifyPassword(password, meta.password_hash);
      if (!valid) {
        return reply.code(403).send({ error: 'Invalid password' });
      }
    }

    const stream = getFileStream(meta.stored_name);
    if (!stream) {
      return reply.code(404).send({ error: 'File data missing' });
    }

    reply.header('Content-Type', meta.mimetype || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${meta.original_name}"`);
    reply.header('Content-Length', meta.size);

    return reply.send(stream);
  });
}

module.exports = fileRoutes;
