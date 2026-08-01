import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AssignableRole,
  type ErrorPayload,
  type JoinAck,
  type ParticipantDTO,
  type ParticipantRemovedPayload,
  type RoleAssignedPayload,
  type SyncStatePayload,
  type UserJoinedPayload,
  type UserLeftPayload,
} from '@shared/types'

export type ConnectionState = 'idle' | 'connecting' | 'joined' | 'failed'

export interface RoomActions {
  play(): void
  pause(): void
  seek(time: number): void
  changeVideo(videoId: string): void
  assignRole(participantId: string, role: AssignableRole): void
  transferHost(participantId: string): void
  removeParticipant(participantId: string): void
}

/**
 * sessionStorage, not localStorage: it is per-tab, so two tabs in one browser stay two
 * people rather than fighting over one identity, and it still survives a reload.
 */
const tokenKey = (roomCode: string) => `watch-party-token-${roomCode}`

function readToken(roomCode: string): string | undefined {
  try {
    return window.sessionStorage.getItem(tokenKey(roomCode)) ?? undefined
  } catch {
    // Private-mode browsers can throw on storage access; a lost token only costs
    // the ability to reclaim, so degrade quietly rather than failing the join.
    return undefined
  }
}

function writeToken(roomCode: string, token: string): void {
  try {
    window.sessionStorage.setItem(tokenKey(roomCode), token)
  } catch {
    // See readToken.
  }
}

export interface UseSocketResult {
  socket: Socket | null
  participants: ParticipantDTO[]
  me: ParticipantDTO | null
  connectionState: ConnectionState
  error: ErrorPayload | null
  /** Latest authoritative video state, from the join ack or a sync_state. */
  video: SyncStatePayload | null
  /** Set when the host removed you; the room should stop rendering and bounce Home. */
  removedReason: string | null
  /** Live Socket.IO transport — 'websocket' or 'polling'; null while disconnected. */
  transport: string | null
  actions: RoomActions
}

/**
 * Owns the single Socket.IO connection for a room and mirrors the server's participant
 * list into React state. Later phases reuse the returned socket for playback events —
 * there must only ever be one connection per tab.
 */
export function useSocket(roomCode: string, username: string): UseSocketResult {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [participants, setParticipants] = useState<ParticipantDTO[]>([])
  const [myId, setMyId] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [error, setError] = useState<ErrorPayload | null>(null)
  const [video, setVideo] = useState<SyncStatePayload | null>(null)
  const [removedReason, setRemovedReason] = useState<string | null>(null)
  const [transport, setTransport] = useState<string | null>(null)
  // Socket listeners are registered once, so they would close over a stale myId.
  const myIdRef = useRef<string | null>(null)
  // Emit helpers read the socket from a ref so their identity never changes; they are
  // dependencies of usePlayerSync's effects, which must not re-run on every render.
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!roomCode || !username) return

    setConnectionState('connecting')
    setError(null)
    // Same origin: Vite proxies /socket.io to the backend in dev, and in production
    // Express serves this bundle itself.
    const activeSocket = io()
    socketRef.current = activeSocket
    setSocket(activeSocket)

    // Joining on 'connect' rather than once at setup means a reconnect re-joins too.
    activeSocket.on('connect', () => {
      // Socket.IO always opens on HTTP long-polling and upgrades to a WebSocket a moment
      // later — and if the upgrade fails (a proxy that will not pass Upgrade headers) it
      // stays on polling silently, everything still working but slower. Reading the
      // engine here and again on 'upgrade' is what makes that visible instead of assumed.
      // The engine is rebuilt per connection, so this re-registers on every reconnect.
      const engine = activeSocket.io.engine
      setTransport(engine.transport.name)
      engine.on('upgrade', (upgraded) => setTransport(upgraded.name))

      // The token is what turns a reconnect into a reclaim instead of a new stranger.
      const payload = { roomCode, username, token: readToken(roomCode) }
      activeSocket.emit(CLIENT_EVENTS.JOIN_ROOM, payload, (ack: JoinAck) => {
        if (!ack.ok) {
          setError(ack.error)
          setConnectionState('failed')
          return
        }
        writeToken(roomCode, ack.result.token)
        setParticipants(ack.result.room.participants)
        myIdRef.current = ack.result.you.id
        setMyId(ack.result.you.id)
        // The ack carries the same anchor a sync_state would, so a late joiner has
        // everything it needs to land at the right position without waiting.
        setVideo({ ...ack.result.room.video, serverTimestamp: Date.now() })
        setConnectionState('joined')
      })
    })

    // Clearing on disconnect keeps the badge from claiming a live WebSocket while the
    // client is actually mid-reconnect.
    activeSocket.on('disconnect', () => setTransport(null))

    activeSocket.on('connect_error', () => {
      setError({ code: 'CONNECTION_FAILED', message: 'Cannot reach the server.' })
      setConnectionState('failed')
    })

    // Both roster events replace the list outright rather than patching it. Patching
    // would let one dropped message desync this tab from the server permanently.
    activeSocket.on(SERVER_EVENTS.USER_JOINED, ({ participants }: UserJoinedPayload) => {
      setParticipants(participants)
    })

    activeSocket.on(SERVER_EVENTS.USER_LEFT, ({ participants }: UserLeftPayload) => {
      setParticipants(participants)
    })

    activeSocket.on(SERVER_EVENTS.ROLE_ASSIGNED, ({ participants }: RoleAssignedPayload) => {
      setParticipants(participants)
    })

    activeSocket.on(
      SERVER_EVENTS.PARTICIPANT_REMOVED,
      ({ participantId, participants, reason }: ParticipantRemovedPayload) => {
        setParticipants(participants)
        // The removal is broadcast to the whole room; you recognise yourself by id.
        if (participantId === myIdRef.current) setRemovedReason(reason)
      },
    )

    activeSocket.on(SERVER_EVENTS.SYNC_STATE, (payload: SyncStatePayload) => setVideo(payload))

    activeSocket.on(SERVER_EVENTS.ERROR, (payload: ErrorPayload) => setError(payload))

    // Disconnecting on cleanup is what makes React StrictMode's double-mount harmless.
    return () => {
      activeSocket.disconnect()
      socketRef.current = null
      setSocket(null)
    }
  }, [roomCode, username])

  // Stable identity for the lifetime of the hook — see the socketRef note above.
  const actions = useMemo<RoomActions>(
    () => ({
      play: () => socketRef.current?.emit(CLIENT_EVENTS.PLAY),
      pause: () => socketRef.current?.emit(CLIENT_EVENTS.PAUSE),
      seek: (time) => socketRef.current?.emit(CLIENT_EVENTS.SEEK, { time }),
      changeVideo: (videoId) => socketRef.current?.emit(CLIENT_EVENTS.CHANGE_VIDEO, { videoId }),
      assignRole: (participantId, role) =>
        socketRef.current?.emit(CLIENT_EVENTS.ASSIGN_ROLE, { participantId, role }),
      transferHost: (participantId) =>
        socketRef.current?.emit(CLIENT_EVENTS.TRANSFER_HOST, { participantId }),
      removeParticipant: (participantId) =>
        socketRef.current?.emit(CLIENT_EVENTS.REMOVE_PARTICIPANT, { participantId }),
    }),
    [],
  )

  // Derived rather than stored, so a promotion to host updates "me" for free.
  const me = participants.find((p) => p.id === myId) ?? null

  return {
    socket,
    participants,
    me,
    connectionState,
    error,
    video,
    removedReason,
    transport,
    actions,
  }
}
