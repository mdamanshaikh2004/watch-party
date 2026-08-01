import type { Socket } from 'socket.io';
import { ERROR_CODES, type Action, type ErrorPayload } from '../../../shared/types';
import type { Participant } from '../models/Participant';
import type { Room } from '../models/Room';
import type { RoomRegistry } from '../models/RoomRegistry';

export type Authorisation =
  | { ok: true; room: Room; participant: Participant }
  | { ok: false; error: ErrorPayload };

/**
 * The single permission gate, shared by both handlers. Roles are read from the room's
 * own Participant — never from anything the client sent.
 *
 * It deliberately does not answer the socket itself: a refused playback action has to
 * re-send sync_state to snap the client back, while a refused role change must not,
 * and a shared responder would force one of those to be wrong.
 */
export function authorise(
  socket: Socket,
  registry: RoomRegistry,
  action: Action,
): Authorisation {
  const code: string | undefined = socket.data.roomCode;
  const room = code ? registry.getRoom(code) : undefined;
  if (!room) {
    return {
      ok: false,
      error: { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'You are not in a room.' },
    };
  }

  const participant = room.getBySocketId(socket.id);
  if (!participant || !room.can(participant.id, action)) {
    return {
      ok: false,
      error: { code: ERROR_CODES.NOT_ALLOWED, message: `Your role cannot ${action}.` },
    };
  }

  return { ok: true, room, participant };
}
