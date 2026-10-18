# Aviator

Fullstack crash-betting game (demo credits).

## Structure

- `backend/` — Express + Socket.IO + MariaDB/MySQL + Redis
- `frontend/` — Vanilla HTML/CSS/JS

## Quick start

### 1. Backend
```bash
cd backend
cp .env.example .env
# edit .env — set SESSION_SECRET to a 64-char hex
npm install
npm run migrate   # (Step 2)
npm run dev