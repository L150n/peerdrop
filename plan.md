# PeerDrop – MVP Plan (Updated)

---

## 1. Goal

Build a lightweight web app for:

* Text sharing (configurable expiry)
* File sharing (temporary + optional P2P later)
* Password-protected links

---

## 2. Tech Stack

### Backend

* Node.js + Fastify
* WebSocket (ws)
* Redis (alpine via Docker)

### Frontend

* Vanilla HTML + CSS + JS

### Storage

* Redis → metadata + text (TTL)
* Local disk → files ("/uploads")

---

## 3. Core Features (MVP order)

### Phase 1 – Text Sharing

* POST "/paste"
* GET "/paste/:id"
* Expiry options via ENV
* Redis TTL based on selection
* Optional password protection (bcrypt)

---

### Phase 2 – File Upload (Server-based)

* POST "/upload"
* Save file → "/uploads"
* Store metadata in Redis
* Expiry options via ENV
* Stream file on download (no memory load)

---

### Phase 3 – Auto Cleanup (Optimized)

* Redis handles key expiry
* Cron job deletes expired/orphan files
* Reverse lookup used for efficiency

---

### Phase 4 – WebRTC (P2P)

* WebSocket signaling ("/ws")
* Use simple-peer
* STUN only initially

---

## 4. API Design

### Paste

POST /paste
body: { content, password?, expiry_days }

GET /paste/:id?password=xxx

---

### File

POST /upload (multipart/form-data)
fields:

* file
* password (optional)
* expiry_days

GET /file/:id?password=xxx

---

### WebSocket

/ws

---

## 5. Expiry Handling (ENV-based)

### Environment Variable

ALLOWED_EXPIRY_DAYS=2,4,7
DEFAULT_EXPIRY_DAYS=2

---

### Logic

const allowed = process.env.ALLOWED_EXPIRY_DAYS.split(',').map(Number)

const daysToSeconds = (d) => d * 86400

Validate:

* expiry_days must be in allowed
* fallback to default

---

## 6. Password Verification Flow

### Storage

* Passwords hashed using bcrypt

### Flow

1. On create:

   * Hash password → store as password_hash

2. On access:

   * If password_hash exists:

     * Require password input
     * Compare using bcrypt.compare()
     * Reject if invalid (403)

---

## 7. File Naming Safety

### Problem

* Filename collisions
* Path guessing

### Solution

* Generate secure ID (nanoid)
* Store file with unique name

Example:

const stored_name = nanoid() + ext

Store:

{
original_name,
stored_name
}

---

## 8. Redis Schema (Improved)

### Paste

key: paste:<id>

{
content,
password_hash,
expires_at,
views
}

TTL: based on expiry_days

---

### File

key: file:<id>

{
original_name,
stored_name,
path,
password_hash,
expires_at
}

TTL: based on expiry_days

---

### Reverse Lookup (for cleanup)

key: file_path:<stored_name> → <id>

---

## 9. Cleanup System (Efficient)

### Cron Job

0 * * * * node scripts/cleanup.js

### Logic

* Read all files in /uploads
* For each file:

  * GET file_path:<stored_name>
  * If not exists → delete file

---

## 10. Rate Limiting

### Implementation

Use Fastify rate limit plugin

### Rules

* General: 100 requests/min/IP
* Upload: 10 uploads/hour/IP

---

## 11. Folder Structure

peerdrop/
├── app/
│   ├── server.js
│   ├── routes/
│   ├── services/
│   ├── utils/
│   └── public/
│       ├── index.html
│       ├── app.js
│       └── style.css
├── uploads/
├── scripts/
│   └── cleanup.js
├── docker-compose.yml
├── Dockerfile
└── .env

---

## 12. Docker Setup

### docker-compose.yml

services:
app:
build: .
ports:
- "8000:8000"
volumes:
- ./uploads:/app/uploads
restart: always

redis:
image: redis:7-alpine
restart: always

---

## 13. Dockerfile (Fullstack Build)

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/uploads

ENV NODE_ENV=production

EXPOSE 8000

CMD ["node", "app/server.js"]

---

## 14. Environment Variables

PORT=8000
REDIS_URL=redis://redis:6379
UPLOAD_DIR=/app/uploads
MAX_FILE_SIZE=30MB
ALLOWED_EXPIRY_DAYS=2,4,7
DEFAULT_EXPIRY_DAYS=2

---

## 15. Security

* bcrypt password hashing
* Validate expiry_days
* Rate limiting
* File size validation
* nanoid for IDs

---

## 16. Limits (VPS-safe)

* File size: 20–30MB
* Max uploads per IP/day
* Monitor disk usage

---

## 17. Deployment Flow

git push → VPS
cd peerdrop
git pull
docker compose up -d --build

---

## 18. Future Improvements

* TURN server
* Burn-after-read
* QR sharing
* S3/MinIO storage
* CDN

---

## 19. MVP Checklist

* [ ] Redis running
* [ ] Fastify server running
* [ ] Paste API working
* [ ] File upload working
* [ ] Cleanup working
* [ ] Password verification working
* [ ] Rate limiting working
* [ ] Secure file naming
* [ ] Deploy working

---

## 20. Key Rules

* Keep lightweight
* Stream files
* Validate all inputs
* Do not rely only on Redis for cleanup

---

## 21. Notes

* No MongoDB
* No heavy frontend frameworks
* No TURN initially
* Focus on working MVP first
