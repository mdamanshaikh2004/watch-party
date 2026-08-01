/**
 * End-to-end smoke test for the room lifecycle. Starts its own server on a spare port
 * so `npm run smoke` needs nothing running first, then drives real socket clients.
 *
 * Run: npm run smoke
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const PORT = 3999
// Not named URL: that would shadow the global URL constructor used below.
const BASE_URL = `http://localhost:${PORT}`
// Long enough to absorb a slow first compile, short enough to fail fast if broken.
const BOOT_TIMEOUT_MS = 30_000
const SETTLE_MS = 200
/** Passed to the server so the reclaim window can be waited out in a test. */
const RECLAIM_WINDOW_MS = 1500

let failures = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function equal(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/** Roster comparison ignores order — the server makes no ordering promise. */
function rosterOf(participants) {
  return participants
    .map((p) => `${p.username}:${p.role}`)
    .sort()
    .join(', ')
}

function connect() {
  const socket = io(BASE_URL)
  socket.received = []
  const events = ['user_joined', 'user_left', 'error', 'sync_state', 'role_assigned', 'participant_removed']
  for (const event of events) {
    socket.on(event, (payload) => socket.received.push({ event, payload }))
  }
  return socket
}

/** The roster as the room currently sees it, from whichever event arrived last. */
function rosterFrom(socket) {
  const entry = [...socket.received]
    .reverse()
    .find((e) => Array.isArray(e.payload?.participants))
  return entry ? entry.payload.participants : []
}

function roleOf(participants, username) {
  return participants.find((p) => p.username === username)?.role
}

function near(label, actual, expected, tolerance) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance
  check(label, ok, `expected ${expected} ±${tolerance}, got ${actual}`)
}

/** The client-side half of the anchor contract, duplicated here on purpose: if the
 *  server's shape changes, this test should fail rather than quietly follow it. */
function positionAt(video, now) {
  return video.playState === 'playing'
    ? video.anchorTime + (now - video.anchorTimestamp) / 1000
    : video.anchorTime
}

function join(socket, roomCode, username, token) {
  return new Promise((resolve) => {
    const emit = () => socket.emit('join_room', { roomCode, username, token }, resolve)
    if (socket.connected) emit()
    else socket.once('connect', emit)
  })
}

function last(socket, event) {
  return [...socket.received].reverse().find((entry) => entry.event === event)?.payload
}

const health = async () => (await fetch(`${BASE_URL}/health`)).json()

async function waitForServer() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (response.ok) return
    } catch {
      // Server not listening yet — keep waiting.
    }
    await sleep(250)
  }
  throw new Error(`Server did not start within ${BOOT_TIMEOUT_MS}ms`)
}

/**
 * Spawned without shell:true and with tsx's CLI addressed directly, because a shell
 * wrapper on Windows means kill() reaches the wrapper and leaves the real server
 * running on the port. stderr is piped rather than inherited for the same reason: an
 * inherited handle held by a survivor keeps the parent's output stream open forever.
 */
const serverStderr = []
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), 'src/index.ts'],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      PORT: String(PORT),
      RECLAIM_WINDOW_MS: String(RECLAIM_WINDOW_MS),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  },
)
server.stderr.on('data', (chunk) => serverStderr.push(chunk.toString()))

const sockets = []

try {
  await waitForServer()
  console.log(`server up on ${PORT}\n`)

  console.log('room creation')
  const { code } = await (await fetch(`${BASE_URL}/api/rooms`, { method: 'POST' })).json()
  check('POST /api/rooms returns a 6-character code', /^[A-Z0-9]{6}$/.test(code), code)

  console.log('\njoining')
  const alice = connect(); sockets.push(alice)
  const aliceAck = await join(alice, code, 'alice')
  check('first joiner is accepted', aliceAck.ok === true, JSON.stringify(aliceAck))
  equal('first joiner is host', aliceAck.result.you.role, 'host')
  equal('join ack carries the full roster', rosterOf(aliceAck.result.room.participants), 'alice:host')

  const bob = connect(); sockets.push(bob)
  const bobAck = await join(bob, code, 'bob')
  await sleep(SETTLE_MS)
  equal('second joiner is a participant', bobAck.result.you.role, 'participant')
  equal('their ack lists everyone', rosterOf(bobAck.result.room.participants), 'alice:host, bob:participant')
  equal('user_joined names who joined', last(alice, 'user_joined')?.participant.username, 'bob')
  equal(
    'user_joined carries the full roster, not a delta',
    rosterOf(last(alice, 'user_joined')?.participants ?? []),
    'alice:host, bob:participant',
  )
  check('a joiner does not receive its own user_joined', last(bob, 'user_joined') === undefined)

  const carol = connect(); sockets.push(carol)
  const carolAck = await join(carol, code, 'carol')
  await sleep(SETTLE_MS)

  console.log('\nhost drop and stand-in')
  // A drop is not a departure: the host is held so a blip cannot cost them the room,
  // but a connected stand-in takes over at once so nobody is left unable to play.
  alice.disconnect()
  await sleep(SETTLE_MS * 2)
  const afterDrop = rosterFrom(bob)
  equal('the longest-present connected participant stands in', roleOf(afterDrop, 'bob'), 'host')
  equal('the dropped host is held, not removed', afterDrop.length, 3)
  check('the dropped host shows as disconnected',
    afterDrop.find((p) => p.username === 'alice')?.connected === false)
  equal('the dropped host is not still holding the role', roleOf(afterDrop, 'alice'), 'participant')
  equal('the stand-in reaches every remaining client', roleOf(rosterFrom(carol), 'bob'), 'host')

  // Let alice's window expire so the rest of the test runs against a clean roster.
  await sleep(RECLAIM_WINDOW_MS + 400)
  equal('an unreclaimed participant is dropped when the window expires',
    last(bob, 'user_left')?.participantId, aliceAck.result.you.id)
  equal('and is gone from the roster', rosterFrom(bob).length, 2)

  console.log('\nplayback sync')
  // bob was promoted to host above, so bob is the controller from here on.
  bob.emit('change_video', { videoId: 'M7lc1UVf-VE' })
  await sleep(SETTLE_MS)
  const cued = last(carol, 'sync_state')
  equal('change_video reaches other clients', cued?.videoId, 'M7lc1UVf-VE')
  equal('a new video lands paused', cued?.playState, 'paused')
  equal('a new video lands at the start', cued?.anchorTime, 0)

  bob.emit('play')
  await sleep(SETTLE_MS)
  const playing = last(carol, 'sync_state')
  equal('play is broadcast', playing?.playState, 'playing')
  near('play anchors at the current position', playing?.anchorTime, 0, 0.2)
  check('the anchor is stamped', typeof playing?.anchorTimestamp === 'number')

  // Let real time pass, then confirm the anchor still derives the right position.
  await sleep(1200)
  near('position derives from the anchor as time passes', positionAt(playing, Date.now()), 1.2, 0.4)

  console.log('\nlate joiner')
  const erin = connect(); sockets.push(erin)
  const erinAck = await join(erin, code, 'erin')
  const erinPosition = positionAt(erinAck.result.room.video, Date.now())
  check('the join ack carries a stamped anchor',
    typeof erinAck.result.room.video.anchorTimestamp === 'number',
    JSON.stringify(erinAck.result.room.video))
  near('a late joiner derives the live position, not 0', erinPosition, 1.3, 0.5)

  console.log('\nseek re-anchors')
  const beforeSeek = last(carol, 'sync_state').anchorTimestamp
  await sleep(50)
  bob.emit('seek', { time: 120 })
  await sleep(SETTLE_MS)
  const seeked = last(carol, 'sync_state')
  near('seek sets the anchor to the target', seeked?.anchorTime, 120, 0.05)
  check('seek re-stamps the anchor', seeked.anchorTimestamp > beforeSeek,
    `${seeked.anchorTimestamp} should exceed ${beforeSeek}`)

  bob.emit('pause')
  await sleep(SETTLE_MS)
  const paused = last(carol, 'sync_state')
  equal('pause is broadcast', paused?.playState, 'paused')
  near('pause anchors where playback actually reached', paused?.anchorTime, 120, 0.5)
  await sleep(400)
  // Compared against its own anchor, not the seek target: the point is that a paused
  // position is frozen, whatever value it froze at.
  near('a paused anchor does not advance', positionAt(paused, Date.now()), paused.anchorTime, 0.001)

  console.log('\npermissions')
  // carol is a plain participant and must not be able to move anyone's playback.
  const stateBefore = JSON.stringify(last(carol, 'sync_state'))
  carol.received.length = 0
  carol.emit('play')
  await sleep(SETTLE_MS)
  equal('a participant is refused', last(carol, 'error')?.code, 'NOT_ALLOWED')
  equal('the refused client is re-synced', last(carol, 'sync_state')?.playState, 'paused')
  const afterReject = { ...last(carol, 'sync_state') }
  delete afterReject.serverTimestamp
  const before = JSON.parse(stateBefore)
  delete before.serverTimestamp
  equal('the room state is unchanged by a refused action', JSON.stringify(afterReject), JSON.stringify(before))
  check('the refusal did not reach other clients', last(erin, 'error') === undefined)

  console.log('\nvalidation')
  const ghost = connect(); sockets.push(ghost)
  equal('unknown room code is rejected', (await join(ghost, 'ZZZZZZ', 'ghost')).error?.code, 'ROOM_NOT_FOUND')
  const blank = connect(); sockets.push(blank)
  equal('blank username is rejected', (await join(blank, code, '   ')).error?.code, 'INVALID_PAYLOAD')
  const dave = connect(); sockets.push(dave)
  const daveAck = await join(dave, code.toLowerCase(), 'dave')
  check('a lowercase room code still resolves', daveAck.ok === true)
  check('a join ack issues a reconnect token', typeof daveAck.result.token === 'string')
  equal('a first join is not a reclaim', daveAck.result.reclaimed, false)

  console.log('\nrole management')
  // bob is host. carol, dave and erin are plain participants.
  carol.received.length = 0
  bob.emit('assign_role', { participantId: carolAck.result.you.id, role: 'moderator' })
  await sleep(SETTLE_MS)
  equal('the host can promote a participant to moderator',
    roleOf(rosterFrom(carol), 'carol'), 'moderator')

  carol.received.length = 0
  carol.emit('play')
  await sleep(SETTLE_MS)
  equal('a moderator can control playback', last(carol, 'sync_state')?.playState, 'playing')
  check('a moderator is not refused playback', last(carol, 'error') === undefined)

  carol.received.length = 0
  carol.emit('assign_role', { participantId: daveAck.result.you.id, role: 'moderator' })
  await sleep(SETTLE_MS)
  equal('a moderator cannot assign roles', last(carol, 'error')?.code, 'NOT_ALLOWED')
  equal('a refused assign_role changes nothing', roleOf(rosterFrom(bob), 'dave'), 'participant')

  // The gate must read live room state, not anything cached when dave joined.
  dave.received.length = 0
  dave.emit('pause')
  await sleep(SETTLE_MS)
  equal('a participant cannot control playback', last(dave, 'error')?.code, 'NOT_ALLOWED')
  bob.emit('assign_role', { participantId: daveAck.result.you.id, role: 'moderator' })
  await sleep(SETTLE_MS)
  dave.received.length = 0
  dave.emit('pause')
  await sleep(SETTLE_MS)
  equal('the same socket can control playback once promoted',
    last(dave, 'sync_state')?.playState, 'paused')
  check('the promoted socket is not refused', last(dave, 'error') === undefined)

  bob.emit('assign_role', { participantId: carolAck.result.you.id, role: 'participant' })
  await sleep(SETTLE_MS)
  carol.received.length = 0
  carol.emit('play')
  await sleep(SETTLE_MS)
  equal('a demoted moderator is refused again', last(carol, 'error')?.code, 'NOT_ALLOWED')

  bob.received.length = 0
  bob.emit('assign_role', { participantId: daveAck.result.you.id, role: 'host' })
  await sleep(SETTLE_MS)
  equal('assign_role cannot create a second host', last(bob, 'error')?.code, 'INVALID_PAYLOAD')

  bob.received.length = 0
  bob.emit('assign_role', { participantId: bobAck.result.you.id, role: 'participant' })
  bob.emit('transfer_host', { participantId: bobAck.result.you.id })
  bob.emit('remove_participant', { participantId: bobAck.result.you.id })
  await sleep(SETTLE_MS)
  const selfErrors = bob.received.filter((e) => e.event === 'error')
  equal('all three role actions refuse to target yourself', selfErrors.length, 3)
  check('self-targeting is a payload error, not a permission one',
    selfErrors.every((e) => e.payload.code === 'INVALID_PAYLOAD'),
    JSON.stringify(selfErrors.map((e) => e.payload.code)))

  console.log('\nremoval')
  erin.received.length = 0
  bob.emit('remove_participant', { participantId: erinAck.result.you.id })
  await sleep(SETTLE_MS)
  const removal = last(erin, 'participant_removed')
  equal('the removed participant is told', removal?.participantId, erinAck.result.you.id)
  check('the removal carries a reason', typeof removal?.reason === 'string' && removal.reason.length > 0)
  check('the removed participant is gone from the roster',
    !rosterFrom(bob).some((p) => p.username === 'erin'))

  erin.received.length = 0
  erin.emit('play')
  await sleep(SETTLE_MS)
  equal('a removed socket cannot act in the room', last(erin, 'error')?.code, 'ROOM_NOT_FOUND')
  const erinRejoin = await join(erin, code, 'erin')
  check('a removed participant may join again from scratch', erinRejoin.ok === true)
  equal('the rejoin is a fresh join, not a reclaim', erinRejoin.result.reclaimed, false)
  erin.disconnect()
  await sleep(SETTLE_MS)

  console.log('\nhost transfer')
  bob.received.length = 0
  bob.emit('transfer_host', { participantId: daveAck.result.you.id })
  await sleep(SETTLE_MS)
  const afterTransfer = rosterFrom(bob)
  equal('exactly one host after a transfer',
    afterTransfer.filter((p) => p.role === 'host').length, 1)
  equal('the target holds it', roleOf(afterTransfer, 'dave'), 'host')
  equal('the previous host becomes a moderator', roleOf(afterTransfer, 'bob'), 'moderator')

  console.log('\nreconnection')
  // dave is host. bob joined first, so bob is the oldest connected stand-in.
  bob.received.length = 0
  dave.disconnect()
  await sleep(SETTLE_MS)
  const standIn = rosterFrom(bob)
  equal('a dropped host is replaced at once', roleOf(standIn, 'bob'), 'host')
  // Counting is brittle here — erin rejoined and dropped too, and is also being held.
  check('the dropped host is still listed', standIn.some((p) => p.username === 'dave'))
  check('the dropped participant shows as disconnected',
    standIn.find((p) => p.username === 'dave')?.connected === false)

  const daveBack = connect(); sockets.push(daveBack)
  const reclaimAck = await join(daveBack, code, 'dave', daveAck.result.token)
  await sleep(SETTLE_MS)
  equal('presenting the token is a reclaim', reclaimAck.result.reclaimed, true)
  equal('the returning host takes host back', reclaimAck.result.you.role, 'host')
  equal('the stand-in reverts to the role it held', roleOf(rosterFrom(bob), 'bob'), 'moderator')
  equal('still exactly one host',
    rosterFrom(bob).filter((p) => p.role === 'host').length, 1)

  console.log('\nreclaim expiry')
  carol.received.length = 0
  const carolToken = carolAck.result.token
  carol.disconnect()
  await sleep(RECLAIM_WINDOW_MS + 600)
  const carolBack = connect(); sockets.push(carolBack)
  const staleAck = await join(carolBack, code, 'carol', carolToken)
  equal('a token past its window is not a reclaim', staleAck.result.reclaimed, false)
  equal('the returner rejoins as a stranger', staleAck.result.you.role, 'participant')
  carolBack.disconnect()

  console.log('\ncleanup')
  for (const socket of [bob, dave, daveBack]) socket.disconnect()
  await sleep(SETTLE_MS * 2)
  const during = await (await fetch(`${BASE_URL}/health`)).json()
  equal('the room survives while people may still reclaim', during.rooms, 1)

  // The leak this catches is real: isEmpty() stays false through the window, so the
  // leave path's cleanup never runs for a dropped participant. Only the expiry timer
  // can delete this room, and the check above would pass even if it never did.
  await sleep(RECLAIM_WINDOW_MS + 600)
  const after = await (await fetch(`${BASE_URL}/health`)).json()
  equal('the room is dropped once the last window expires', after.rooms, 0)

  const zombie = connect(); sockets.push(zombie)
  equal('rejoining a dropped room fails cleanly', (await join(zombie, code, 'zombie')).error?.code, 'ROOM_NOT_FOUND')

  // Regression guard. Splitting the handlers once moved remove_participant into a
  // class that had no way to cancel a reclaim deadline, so removing someone who was
  // mid-window left a timer holding a Room the registry had already dropped. It fired
  // against nothing and broke no assertion — this is the check that would have caught it.
  console.log('\nremoval while a reclaim window is pending')
  const { code: code2 } = await (await fetch(`${BASE_URL}/api/rooms`, { method: 'POST' })).json()
  const holly = connect(); sockets.push(holly)
  const gus = connect(); sockets.push(gus)
  await join(holly, code2, 'holly')
  const gusAck = await join(gus, code2, 'gus')
  await sleep(SETTLE_MS)

  gus.disconnect()
  await sleep(SETTLE_MS)
  check('the dropped participant is held, window running',
    rosterFrom(holly).some((p) => p.username === 'gus' && p.connected === false))
  equal('a pending deadline is counted', (await health()).reclaims, 1)

  holly.emit('remove_participant', { participantId: gusAck.result.you.id })
  await sleep(SETTLE_MS)
  check('the host can remove someone mid-window',
    !rosterFrom(holly).some((p) => p.username === 'gus'))

  // The load-bearing assertion. Checking for a phantom broadcast would NOT catch the
  // leak: an uncancelled deadline fires, finds the participant already removed, and
  // returns silently. Only the pending count shows the timer outliving its participant.
  equal('removing someone mid-window cancels their deadline', (await health()).reclaims, 0)

  holly.received.length = 0
  await sleep(RECLAIM_WINDOW_MS + 600)
  equal('and nothing fires afterwards', holly.received.length, 0)

  holly.disconnect()
  await sleep(RECLAIM_WINDOW_MS + 600)
  const finalHealth = await (await fetch(`${BASE_URL}/health`)).json()
  equal('and the room is gone from the registry', finalHealth.rooms, 0)
} catch (error) {
  failures++
  console.error(`\nunexpected failure: ${error.message}`)
  if (serverStderr.length) console.error(`server said:\n${serverStderr.join('')}`)
} finally {
  for (const socket of sockets) socket.disconnect()
  server.kill()
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
