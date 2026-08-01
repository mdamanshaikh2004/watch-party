import express from 'express';
import { existsSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { ReclaimTimers } from './models/ReclaimTimers';
import { RoomRegistry } from './models/RoomRegistry';
import { registerSocketHandlers } from './sockets/events';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// Set by the root start script, not by a Render environment variable: NODE_ENV=production
// during install makes npm skip devDependencies, and both builds need them (typescript,
// vite). Setting it at start time keeps the build honest and still flags production here.
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json());

const httpServer = createServer(app);
// In dev the client is served by Vite on another port, so it needs an explicit origin.
// In production Express serves the bundle itself, so every request is same-origin and
// a CORS allowlist naming localhost:5173 would be both useless and wrong.
const io = new Server(httpServer, isProduction ? {} : { cors: { origin: CLIENT_ORIGIN } });

const registry = new RoomRegistry(io);
const reclaimTimers = new ReclaimTimers();
registerSocketHandlers(io, registry, reclaimTimers);

app.get('/health', (_req, res) => {
  // reclaims is the count of pending reconnection deadlines. It is exposed because a
  // leaked timer is otherwise invisible: it fires against a participant who is already
  // gone, returns without broadcasting, and leaves no trace in any client's traffic.
  res.json({ ok: true, rooms: registry.size, reclaims: reclaimTimers.pending });
});

// Creating a room needs no live connection, so it stays a plain HTTP call.
app.post('/api/rooms', (_req, res) => {
  const room = registry.createRoom();
  console.log(`[room ${room.code}] created`);
  res.json({ code: room.code });
});

/**
 * Locates the built client. __dirname is not a fixed distance from the repo root:
 * under tsx this file is server/src/index.ts (root is two levels up), after tsc it is
 * server/dist/server/src/index.js (root is four levels up, because rootDir is ".." so
 * the compiler recreates the server/src path inside dist). Rather than hard-code either
 * depth — and silently serve nothing if the layout shifts — walk up from wherever this
 * file actually is until the directory that owns client/dist comes into view. The anchor
 * is client/dist/index.html itself, so an empty or half-built directory is not mistaken
 * for a real build.
 */
function findClientDist(): string | null {
  let dir = __dirname;
  // Six hops covers both layouts with room to spare; the loop also stops at the
  // filesystem root, so this cannot spin.
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'client', 'dist');
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Registered after the API routes above and last of all, so the fallback below can only
// ever see requests nothing else claimed.
if (isProduction) {
  const clientDist = findClientDist();

  if (!clientDist) {
    // Loud, but not fatal: the socket API still works, and a dead static mount is far
    // harder to diagnose from a blank page than from this line in the Render log.
    console.error('client/dist not found — run `npm run build` before `npm start`.');
  } else {
    console.log(`Serving client from ${clientDist}`);
    app.use(express.static(clientDist));

    // SPA fallback. Deep links like /room/ABC123 are client-side routes with no file on
    // disk, so anything unclaimed gets index.html and lets App.tsx read the path. It is
    // scoped deliberately: /api/* and /health must keep returning JSON (and a real 404
    // for a typo'd endpoint) instead of 200 + HTML, which would turn every client-side
    // fetch into a confusing JSON parse error. /socket.io/* is listed for the same
    // reason even though Socket.IO intercepts it on the HTTP server before Express sees
    // it — the guard should not depend on that ordering staying true.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/socket.io/') ||
        req.path === '/health'
      ) {
        return next();
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
}

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Render sends SIGTERM on redeploy. Rooms are in memory and do not survive a restart,
// so pending reclaim deadlines are meaningless to the next process — drop them rather
// than letting the shutdown wait on people who can no longer reconnect to this one.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    reclaimTimers.cancelAll();
    io.close();
    httpServer.close(() => process.exit(0));
  });
}
