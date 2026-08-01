import type { AssignableRole, JoinRoomPayload } from '../../../shared/types';

const MAX_USERNAME_LENGTH = 20;
const MAX_VIDEO_ID_LENGTH = 64;

/**
 * Every parser returns null rather than throwing — a bad payload is a client bug, not
 * a reason to take the server down. Handlers turn a null into an INVALID_PAYLOAD.
 */

export function parseJoinPayload(payload: unknown): JoinRoomPayload | null {
  if (!isRecord(payload)) return null;
  const { roomCode, username, token } = payload;
  if (typeof roomCode !== 'string' || typeof username !== 'string') return null;

  const cleanCode = roomCode.trim().toUpperCase();
  const cleanName = username.trim().slice(0, MAX_USERNAME_LENGTH);
  if (!cleanCode || !cleanName) return null;

  return {
    roomCode: cleanCode,
    username: cleanName,
    token: typeof token === 'string' && token ? token : undefined,
  };
}

export function parseParticipantId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const { participantId } = payload;
  return typeof participantId === 'string' && participantId ? participantId : null;
}

export function parseAssignRole(
  payload: unknown,
): { participantId: string; role: AssignableRole } | null {
  const participantId = parseParticipantId(payload);
  if (!participantId || !isRecord(payload)) return null;
  // 'host' is absent on purpose: transfer_host is the only way to move it, so the
  // double-host case cannot be reached even by a malformed client.
  const { role } = payload;
  if (role !== 'moderator' && role !== 'participant') return null;
  return { participantId, role };
}

export function parseSeek(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const { time } = payload;
  // Number.isFinite rejects NaN and Infinity, which would poison the anchor.
  return typeof time === 'number' && Number.isFinite(time) ? time : null;
}

export function parseVideoId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const { videoId } = payload;
  if (typeof videoId !== 'string') return null;
  const trimmed = videoId.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_VIDEO_ID_LENGTH ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
