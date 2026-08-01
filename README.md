# Watch Party

Watch YouTube together, in sync. Rooms have roles (Host / Moderator / Participant)
and the **server** decides who is allowed to control playback.

## Running it

Two terminals:

```bash
cd server && npm install && npm run dev   # http://localhost:3001
cd client && npm install && npm run dev   # http://localhost:5173
```

Open http://localhost:5173, create a room, then open the invite link in a second
window (use incognito so it is a different session).

## Layout

```
/shared/types.ts   event names + payload types, imported by BOTH sides
/server            Express + Socket.IO
  models/          Participant, Room, RoomRegistry, VideoTimeline — state lives here
  sockets/         RoomHandler (membership), RoleHandler (host-only admin),
                   PlaybackHandler, guard.ts (the shared permission check),
                   payloads.ts (validation), events.ts (wiring)
/client            React + TypeScript + Vite
  hooks/           useSocket — the single socket connection per tab
  pages/           Home, Room
  components/      RoomShell, ParticipantList
```

## Two things that look odd but are deliberate

**The client talks to a single origin.** Vite proxies `/api` and `/socket.io` to
port 3001 (see `client/vite.config.ts`), so the browser never makes a cross-origin
request. That matches production, where Express will serve the built client itself.

**The server's build output is `dist/server/src/index.js`.** `shared/types.ts`
exports runtime constants (the event names), not just types, so it compiles to real
JS. That forces the server's `rootDir` up to the repo root, and `tsc` mirrors the
folder structure into `dist/`. That is why `npm start` points where it does.

## Rules the code is built around

1. **The server owns roles.** Every action goes through `room.can(participantId, action)`,
   which reads the `PERMISSIONS` table in `shared/types.ts`. Roles are never read off a
   client payload. Disabled buttons in the UI are cosmetic.
2. **Only the first person in a room is Host.** If the Host leaves, the
   longest-present remaining participant is promoted, so a room is never left without
   someone who can control it.
3. **Position is an anchor, not a timestamp.** The room stores `anchorTime` (where the
   video was) and `anchorTimestamp` (when that was true). Position at any later moment
   is derived: `anchorTime + (now - anchorTimestamp) / 1000` while playing, and just
   `anchorTime` while paused. Every play, pause, seek and change_video re-anchors, so
   the server needs no timers and a late joiner lands in the right place.
   `sync_state` also carries `serverTimestamp`, but only so send latency and clock
   skew are measurable — the anchor is the authority.
4. **The client never patches its own player state from a boolean.** Applying a remote
   change makes the player emit its own `onStateChange`; the guard holds *what we are
   driving toward* and swallows matching events, because a redundant call emits nothing
   at all and would wedge a boolean flag on forever.
5. **`ENDED` is local only.** Clients never emit on it and the server has no `ended`
   state — every client reaches the end at a slightly different moment, so emitting
   would be a race that ends up looking like a pause. The client clamps its computed
   target to the video's duration instead.
6. **A dropped connection is not a departure.** Identity is a token, not a socket id.
   Losing wifi holds your place for 45 seconds; presenting the token on reconnect
   rebinds you with your role intact. If you were host, a connected stand-in takes
   over immediately so the room is never uncontrollable, and hands it back when you
   return. An explicit *Leave* is permanent — you meant it.
7. **Host is single-occupancy.** `assign_role` cannot set `host`; `transfer_host`
   demotes and promotes in one mutation, so there is no instant where a room has two
   hosts or none.

## Testing

`cd server && npm run smoke` — starts its own server on port 3999 and drives real
socket clients through joining, host promotion, playback sync, a late joiner and
permission refusal. Exits non-zero on failure, so it is safe to wire into CI.

`/player-lab` in the client is a manual harness for the YouTube player on its own:
raw `onStateChange` codes, timings and error codes, with no sockets involved.

## Status

Phases 1–3 are done: rooms, the class model, join/leave, the YouTube player, playback
sync over the anchor model, role management, and reconnection identity. Deployment —
Express serving the built client from a single service — is phase 5.
