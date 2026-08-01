/**
 * The wire contract between client and server.
 *
 * Both sides import this file, so an event name or payload shape can only ever be
 * defined once. If you need a new event, add it here first.
 */

export type Role = 'host' | 'moderator' | 'participant';

/** Everything a participant might try to do that the server has to approve. */
export type Action =
  | 'play'
  | 'pause'
  | 'seek'
  | 'change_video'
  | 'assign_role'
  | 'remove_participant'
  | 'transfer_host';

/** The roles assign_role may set. Host is excluded on purpose — see AssignRolePayload. */
export type AssignableRole = Exclude<Role, 'host'>;

/** Events the client emits to the server. */
export const CLIENT_EVENTS = {
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  PLAY: 'play',
  PAUSE: 'pause',
  SEEK: 'seek',
  CHANGE_VIDEO: 'change_video',
  ASSIGN_ROLE: 'assign_role',
  REMOVE_PARTICIPANT: 'remove_participant',
  TRANSFER_HOST: 'transfer_host',
} as const;

/** Events the server emits to clients. */
export const SERVER_EVENTS = {
  SYNC_STATE: 'sync_state',
  USER_JOINED: 'user_joined',
  USER_LEFT: 'user_left',
  ROLE_ASSIGNED: 'role_assigned',
  PARTICIPANT_REMOVED: 'participant_removed',
  ERROR: 'error',
} as const;

/**
 * Which roles may perform which action. Room.can() is the only real gate; the client
 * reads this table too, but only to grey out buttons. Never trust the client's check.
 */
export const PERMISSIONS: Record<Action, Role[]> = {
  play: ['host', 'moderator'],
  pause: ['host', 'moderator'],
  seek: ['host', 'moderator'],
  change_video: ['host', 'moderator'],
  assign_role: ['host'],
  remove_participant: ['host'],
  transfer_host: ['host'],
};

/** A participant as clients see them — no socket id and no token, those stay server-side. */
export interface ParticipantDTO {
  id: string;
  username: string;
  role: Role;
  /** False while they are inside the reclaim window; the roster greys them out. */
  connected: boolean;
}

export type PlayState = 'playing' | 'paused';

/**
 * Position is stored as an anchor — where the video was, and when that was true —
 * rather than as a currentTime that would be stale the instant it was written.
 * Anyone can derive the position at any later moment with effectiveTime() below,
 * which is why the server needs no timers.
 */
export interface VideoState {
  videoId: string | null;
  playState: PlayState;
  anchorTime: number;
  anchorTimestamp: number;
}

/** The one definition of "where is the video now", used on both sides. */
export function effectiveTime(video: VideoState, now: number): number {
  if (video.playState !== 'playing') return video.anchorTime;
  return video.anchorTime + (now - video.anchorTimestamp) / 1000;
}

export interface RoomStateDTO {
  code: string;
  participants: ParticipantDTO[];
  video: VideoState;
}

// ---- client -> server payloads ----

export interface JoinRoomPayload {
  roomCode: string;
  username: string;
  /**
   * Issued on a previous join and kept in sessionStorage. Presenting it rebinds the
   * existing participant — with its role — to the new socket, so a dropped connection
   * does not cost someone their place in the room.
   */
  token?: string;
}

export interface AssignRolePayload {
  participantId: string;
  /**
   * Cannot be 'host'. Host is single-occupancy, so moving it is transfer_host's job;
   * rejecting it here means the double-host case cannot be reached at all.
   */
  role: AssignableRole;
}

export interface RemoveParticipantPayload {
  participantId: string;
}

export interface TransferHostPayload {
  participantId: string;
}

/** play and pause carry no time: the server re-anchors from its own state, so a
 * client's clock is never trusted for anything except an explicit seek target. */
export interface SeekPayload {
  time: number;
}

export interface ChangeVideoPayload {
  videoId: string;
}

// ---- server -> client payloads ----

/** Sent only to the joiner, as the reply to their join_room. */
export interface JoinResultPayload {
  room: RoomStateDTO;
  you: ParticipantDTO;
  /** Store this and present it on reconnect to keep your identity and role. */
  token: string;
  /** True when this join rebound an existing participant rather than adding one. */
  reclaimed: boolean;
}

/**
 * join_room answers through a Socket.IO acknowledgement rather than a new event, so
 * the joiner's own state and a join failure arrive on the same channel as the request.
 */
export type JoinAck =
  | { ok: true; result: JoinResultPayload }
  | { ok: false; error: ErrorPayload };

/**
 * Clients derive position from anchorTimestamp, not from serverTimestamp — the anchor
 * is the authority, and it stays correct even if this message is re-sent later.
 * serverTimestamp is kept so send latency and client/server clock skew are measurable.
 */
export interface SyncStatePayload extends VideoState {
  serverTimestamp: number;
}

/**
 * Roster events carry the whole list, never a delta. A client that patches its own
 * copy drifts permanently the moment one message is missed or arrives out of order;
 * rebuilding from each message cannot drift. `participant` only names who joined,
 * for messaging — the list is the truth.
 */
export interface UserJoinedPayload {
  participant: ParticipantDTO;
  participants: ParticipantDTO[];
}

/** The leaver is already gone from `participants`, so their id is named separately. */
export interface UserLeftPayload {
  participantId: string;
  participants: ParticipantDTO[];
}

/** Sent after any role change — assign_role, transfer_host, or a stand-in promotion. */
export interface RoleAssignedPayload {
  participants: ParticipantDTO[];
}

/**
 * Broadcast to the whole room, including the person being removed — they recognise
 * themselves by comparing participantId to their own id, so no extra event is needed
 * and the server-to-client event list stays as the contract defined it.
 */
export interface ParticipantRemovedPayload {
  participantId: string;
  participants: ParticipantDTO[];
  reason: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  NOT_ALLOWED: 'NOT_ALLOWED',
} as const;
