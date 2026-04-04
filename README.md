# PeerDrop

Lightweight, self-hosted text & file sharing with optional P2P transfer. No sign-up required.

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify)
![Redis](https://img.shields.io/badge/Redis-Alpine-DC382D?logo=redis&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## Features

- **Text Sharing** — Paste text/code with syntax-friendly display
- **File Sharing** — Upload files up to 30MB with streaming download
- **Password Protection** — Optional bcrypt-secured links
- **Auto Expiry** — Configurable TTL (2, 4, or 7 days via env)
- **P2P Transfer** — WebRTC data channels for direct browser-to-browser file transfer
- **Rate Limiting** — 100 req/min general, 10 uploads/hour per IP
- **Auto Cleanup** — Cron-based orphaned file removal
- **Modern UI** — Dark glassmorphism design, drag & drop, mobile responsive

---

## Tech Stack

| Layer    | Tech                          |
|----------|-------------------------------|
| Backend  | Node.js + Fastify             |
| Realtime | WebSocket (`@fastify/websocket`) |
| P2P      | WebRTC (STUN only)            |
| Storage  | Redis (metadata + TTL) + Disk (files) |
| Frontend | Vanilla HTML + CSS + JS       |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Redis running (local or Docker)

### 1. Clone & Install

```bash
git clone <your-repo-url> peerdrop
cd peerdrop
npm install
```

### 2. Configure

Copy and edit the environment file:

```bash
cp .env.example .env
```

| Variable              | Default              | Description                    |
|-----------------------|----------------------|--------------------------------|
| `PORT`                | `6000`               | Server port                    |
| `REDIS_URL`           | `redis://localhost:6379` | Redis connection string     |
| `UPLOAD_DIR`          | `./uploads`          | File storage directory         |
| `MAX_FILE_SIZE`       | `31457280`           | Max upload size in bytes (30MB)|
| `ALLOWED_EXPIRY_DAYS` | `2,4,7`              | Comma-separated allowed TTLs   |
| `DEFAULT_EXPIRY_DAYS` | `2`                  | Fallback expiry                |

### 3. Run

```bash
# Start Redis (if not running)
docker run -d --name redis -p 6379:6379 redis:alpine

# Start the server
npm start
```

Open [http://localhost:6000](http://localhost:6000)

---

## Docker Deployment

```bash
docker compose up -d --build
```

This starts both the app and Redis. The app is available on port `6000`.

To rebuild after changes:

```bash
docker compose up -d --build
```

---

## API Reference

### Paste

#### Create a paste

```
POST /paste
Content-Type: application/json

{
  "content": "Hello, world!",
  "password": "optional-secret",
  "expiry_days": 2
}
```

**Response** `201`:
```json
{
  "id": "abc123",
  "url": "/paste/abc123",
  "expires_in_days": 2,
  "has_password": false
}
```

#### Retrieve a paste

```
GET /paste/:id?password=optional-secret
```

---

### File

#### Upload a file

```
POST /upload
Content-Type: multipart/form-data

Fields: file, password (optional), expiry_days
```

**Response** `201`:
```json
{
  "id": "xyz789",
  "url": "/file/xyz789",
  "original_name": "doc.pdf",
  "size": 102400,
  "expires_in_days": 2,
  "has_password": false
}
```

#### Download a file

```
GET /file/:id?password=optional-secret
```

#### File metadata

```
GET /file/:id/info
```

---

### WebSocket (P2P Signaling)

```
WS /ws
```

Messages: `join`, `offer`, `answer`, `ice-candidate`, `leave`

---

### Other

```
GET /health     → { "status": "ok", "uptime": 123.45 }
GET /config     → { "allowed_expiry_days": [2,4,7], ... }
```

---

## Cleanup

Orphaned files (whose Redis keys have expired) are cleaned up automatically:

- **In-process**: `node-cron` runs every hour inside the server
- **Standalone**: Run manually or via system cron

```bash
# Manual
npm run cleanup

# System cron (every hour)
0 * * * * cd /path/to/peerdrop && node scripts/cleanup.js
```

---

## Project Structure

```
peerdrop/
├── app/
│   ├── server.js           # Entry point
│   ├── routes/
│   │   ├── paste.js        # Paste API
│   │   ├── file.js         # File upload/download API
│   │   └── ws.js           # WebSocket signaling
│   ├── services/
│   │   ├── redis.js        # Redis client & helpers
│   │   └── storage.js      # File system operations
│   ├── utils/
│   │   ├── expiry.js       # Expiry validation
│   │   ├── password.js     # bcrypt helpers
│   │   └── ids.js          # nanoid generation
│   └── public/
│       ├── index.html       # SPA shell
│       ├── style.css        # Design system
│       └── app.js           # Frontend logic
├── scripts/
│   └── cleanup.js          # Standalone cleanup
├── uploads/                # File storage (gitignored)
├── docker-compose.yml
├── Dockerfile
├── .env
└── package.json
```

---

## Security

- Passwords hashed with **bcrypt** (10 salt rounds)
- File IDs generated with **nanoid** (no guessable paths)
- Input validation on all endpoints
- Rate limiting per IP
- File size enforcement
- Streaming downloads (no full file buffering)

---

## Future Roadmap

- [ ] TURN server for NAT traversal
- [ ] Burn-after-read mode
- [ ] QR code sharing
- [ ] S3/MinIO storage backend
- [ ] CDN integration
- [ ] Syntax highlighting for code pastes

---

## License

ISC
