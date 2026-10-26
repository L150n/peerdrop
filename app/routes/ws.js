// WebRTC signaling via WebSocket
// Room-based: peers join a room, exchange offer/answer/ICE candidates.
//
// A peer keeps the same peerId when its socket reconnects (proxy timeout, phone
// asleep, tab in the background). The WebRTC link between browsers doesn't need
// this socket once it's up, so a reconnect must not look like the peer leaving.

const rooms = new Map(); // roomId -> Map(peerId -> socket)

// Must stay under nginx's default 60 s proxy_read_timeout, which otherwise
// closes a quiet signaling socket a minute after peers connect.
const HEARTBEAT_MS = 25000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RELAYED = new Set(['offer', 'answer', 'ice-candidate', 'reconnect']);

function send(socket, msg) {
  if (socket.readyState === 1) socket.send(JSON.stringify(msg));
}

async function wsRoutes(fastify) {
  // Ping every client and drop the ones that stopped answering
  const heartbeat = setInterval(() => {
    for (const client of fastify.websocketServer.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  fastify.addHook('onClose', (instance, done) => {
    clearInterval(heartbeat);
    done();
  });

  fastify.get('/ws', { websocket: true }, (socket, request) => {
    let currentRoom = null;
    let peerId = null;

    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', (raw) => {
      socket.isAlive = true;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      switch (msg.type) {
        case 'join': {
          const roomId = typeof msg.room === 'string' ? msg.room.trim().toUpperCase() : '';
          if (!ID_RE.test(roomId)) {
            send(socket, { type: 'error', message: 'Invalid room code' });
            return;
          }
          if (currentRoom) cleanupPeer('leave');

          peerId = typeof msg.peerId === 'string' && ID_RE.test(msg.peerId)
            ? msg.peerId
            : Math.random().toString(36).slice(2, 10);
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
          }
          const room = rooms.get(roomId);

          // Same peer coming back on a new socket: retire the old one quietly
          const previous = room.get(peerId);
          room.set(peerId, socket);
          if (previous && previous !== socket) previous.terminate();

          const others = [];
          for (const [otherId, otherSocket] of room) {
            if (otherId === peerId) continue;
            others.push(otherId);
            send(otherSocket, { type: 'peer-joined', peerId });
          }

          send(socket, { type: 'joined', room: roomId, peerId, peers: others });
          break;
        }

        case 'ping':
          send(socket, { type: 'pong' });
          break;

        case 'leave':
          cleanupPeer('leave');
          break;

        default: {
          if (!RELAYED.has(msg.type)) {
            send(socket, { type: 'error', message: `Unknown type: ${msg.type}` });
            return;
          }
          if (!currentRoom || !rooms.has(currentRoom)) return;

          const targetSocket = rooms.get(currentRoom).get(msg.target);
          if (targetSocket) {
            send(targetSocket, { type: msg.type, from: peerId, data: msg.data });
          }
          break;
        }
      }
    });

    socket.on('close', () => {
      cleanupPeer('disconnect');
    });

    // reason: 'leave' when the peer left on purpose, 'disconnect' when only its
    // signaling socket went away (its WebRTC link may still be working)
    function cleanupPeer(reason) {
      const room = currentRoom && rooms.get(currentRoom);
      // After a reconnect the room points at the newer socket; leave it alone
      if (room && room.get(peerId) === socket) {
        room.delete(peerId);

        for (const s of room.values()) {
          send(s, { type: 'peer-left', peerId, reason });
        }

        if (room.size === 0) {
          rooms.delete(currentRoom);
        }
      }
      currentRoom = null;
      peerId = null;
    }
  });
}

module.exports = wsRoutes;
