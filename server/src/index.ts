import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ReclaimTimers } from './models/ReclaimTimers';
import { RoomRegistry } from './models/RoomRegistry';
import { registerSocketHandlers } from './sockets/events';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(express.json());

const httpServer = createServer(app);
// In dev the client is served by Vite on another port, so it needs an explicit origin.
const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN } });

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

// Phase 5: serve client/dist here and add an SPA fallback for production.

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
