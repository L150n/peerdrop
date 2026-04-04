const { generateId } = require('../utils/ids');
const { validateExpiry } = require('../utils/expiry');
const { hashPassword, verifyPassword } = require('../utils/password');
const { setPaste, getPaste, incrementPasteViews } = require('../services/redis');

async function pasteRoutes(fastify) {
  // ─── Create paste ──────────────────────────────────────────────
  fastify.post('/paste', {
    schema: {
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 500000 },
          password: { type: 'string' },
          expiry_days: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { content, password, expiry_days } = request.body;

    const id = generateId();
    const { days, seconds } = validateExpiry(expiry_days);

    const data = {
      content,
      password_hash: password ? await hashPassword(password) : null,
      expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
      views: 0,
      created_at: new Date().toISOString(),
    };

    await setPaste(id, data, seconds);

    return reply.code(201).send({
      id,
      url: `/paste/${id}`,
      expires_in_days: days,
      has_password: !!password,
    });
  });

  // ─── Get paste ─────────────────────────────────────────────────
  fastify.get('/paste/:id', async (request, reply) => {
    const { id } = request.params;
    const { password } = request.query;

    const paste = await getPaste(id);
    if (!paste) {
      return reply.code(404).send({ error: 'Paste not found or expired' });
    }

    // Password check
    if (paste.password_hash) {
      if (!password) {
        return reply.code(401).send({
          error: 'Password required',
          password_protected: true,
        });
      }
      const valid = await verifyPassword(password, paste.password_hash);
      if (!valid) {
        return reply.code(403).send({ error: 'Invalid password' });
      }
    }

    // Increment views
    const updated = await incrementPasteViews(id);

    return {
      id,
      content: updated.content,
      views: updated.views,
      expires_at: updated.expires_at,
      created_at: updated.created_at,
      password_protected: !!updated.password_hash,
    };
  });
}

module.exports = pasteRoutes;
