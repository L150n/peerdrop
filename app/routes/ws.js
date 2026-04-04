// WebRTC signaling via WebSocket
// Room-based: peers join a room, exchange offer/answer/ICE candidates

const rooms = new Map(); // roomId -> Set of WebSocket connections

async function wsRoutes(fastify) {
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    let currentRoom = null;
    let peerId = null;

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      switch (msg.type) {
        case 'join': {
          const roomId = msg.room;
          if (!roomId) {
            socket.send(JSON.stringify({ type: 'error', message: 'Room ID required' }));
            return;
          }

          peerId = msg.peerId || Math.random().toString(36).slice(2, 10);
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
          }

          const room = rooms.get(roomId);

          // Notify existing peers
          for (const [existingPeerId, existingSocket] of room) {
            existingSocket.send(JSON.stringify({
              type: 'peer-joined',
              peerId,
            }));
          }

          // Send list of existing peers to the new joiner
          const existingPeers = Array.from(room.keys());
          socket.send(JSON.stringify({
            type: 'joined',
            room: roomId,
            peerId,
            peers: existingPeers,
          }));

          room.set(peerId, socket);
          break;
        }

        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          if (!currentRoom || !rooms.has(currentRoom)) return;

          const room = rooms.get(currentRoom);
          const targetSocket = room.get(msg.target);
          if (targetSocket && targetSocket.readyState === 1) {
            targetSocket.send(JSON.stringify({
              type: msg.type,
              from: peerId,
              data: msg.data,
            }));
          }
          break;
        }

        case 'leave': {
          cleanupPeer();
          break;
        }

        default:
          socket.send(JSON.stringify({ type: 'error', message: `Unknown type: ${msg.type}` }));
      }
    });

    socket.on('close', () => {
      cleanupPeer();
    });

    function cleanupPeer() {
      if (currentRoom && rooms.has(currentRoom)) {
        const room = rooms.get(currentRoom);
        room.delete(peerId);

        // Notify remaining peers
        for (const [, s] of room) {
          if (s.readyState === 1) {
            s.send(JSON.stringify({ type: 'peer-left', peerId }));
          }
        }

        // Cleanup empty rooms
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
