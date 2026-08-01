import type { Server, Socket } from 'socket.io';
import {
  ERROR_CODES,
  SERVER_EVENTS,
  type ParticipantRemovedPayload,
  type RoleAssignedPayload,
} from '../../../shared/types';
import type { Participant } from '../models/Participant';
import type { ReclaimTimers } from '../models/ReclaimTimers';
import type { Room } from '../models/Room';
import type { RoomRegistry } from '../models/RoomRegistry';
import { authorise } from './guard';
import { parseAssignRole, parseParticipantId } from './payloads';

/**
 * Host-only administration of people: who is a moderator, who holds the room, and who
 * is asked to leave. All three refuse to target the caller.
 */
export class RoleHandler {
  // io is needed to eject a removed participant's socket, which is not the Room's
  // business — a Room broadcasts to its channel, it does not hand out sockets.
  constructor(
    private readonly io: Server,
    private readonly registry: RoomRegistry,
    private readonly timers: ReclaimTimers,
  ) {}

  handleAssignRole(socket: Socket, payload: unknown): void {
    const parsed = parseAssignRole(payload);
    if (!parsed) {
      this.emitError(
        socket,
        ERROR_CODES.INVALID_PAYLOAD,
        'assign_role needs a participant and a role of moderator or participant.',
      );
      return;
    }

    this.withRolePermission(socket, 'assign_role', parsed.participantId, (room) => {
      if (room.assignRole(parsed.participantId, parsed.role)) return true;
      this.emitError(socket, ERROR_CODES.INVALID_PAYLOAD, 'That participant cannot be given that role.');
      return false;
    });
  }

  handleTransferHost(socket: Socket, payload: unknown): void {
    const participantId = parseParticipantId(payload);
    if (!participantId) {
      this.emitError(socket, ERROR_CODES.INVALID_PAYLOAD, 'transfer_host needs a participant id.');
      return;
    }

    this.withRolePermission(socket, 'transfer_host', participantId, (room, actor) => {
      if (room.transferHost(actor.id, participantId)) return true;
      this.emitError(socket, ERROR_CODES.INVALID_PAYLOAD, 'That participant cannot be made host.');
      return false;
    });
  }

  handleRemoveParticipant(socket: Socket, payload: unknown): void {
    const participantId = parseParticipantId(payload);
    if (!participantId) {
      this.emitError(socket, ERROR_CODES.INVALID_PAYLOAD, 'remove_participant needs a participant id.');
      return;
    }

    const auth = authorise(socket, this.registry, 'remove_participant');
    if (!auth.ok) {
      this.emitError(socket, auth.error.code, auth.error.message);
      return;
    }
    if (auth.participant.id === participantId) {
      this.emitError(socket, ERROR_CODES.INVALID_PAYLOAD, 'You cannot remove yourself.');
      return;
    }

    const { room } = auth;
    const target = room.getById(participantId);
    if (!target) {
      this.emitError(socket, ERROR_CODES.INVALID_PAYLOAD, 'That participant is not in this room.');
      return;
    }

    const targetSocketId = target.socketId;
    const { newHost } = room.removeParticipant(targetSocketId);
    // They may have been mid-reclaim-window when the host removed them. Without this
    // the deadline survives its own participant, holding a Room the registry has
    // already dropped until it fires against nothing.
    this.timers.cancel(target.id);

    const removed: ParticipantRemovedPayload = {
      participantId: target.id,
      participants: room.participantDTOs(),
      reason: 'The host removed you from the room.',
    };
    // Broadcast before ejecting, so the person being removed is still in the channel
    // to hear why. They recognise themselves by comparing the id to their own.
    room.broadcast(SERVER_EVENTS.PARTICIPANT_REMOVED, removed);

    const targetSocket = this.io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.leave(room.code);
      // Cleared so every later event from that socket fails the room lookup. They are
      // not banned — a fresh join_room works, they just cannot act as a member.
      targetSocket.data.roomCode = undefined;
    }

    console.log(
      `[room ${room.code}] ${target.username} removed` +
        (newHost ? `, ${newHost.username} promoted to host` : ''),
    );
    if (this.registry.deleteIfEmpty(room.code)) console.log(`[room ${room.code}] empty, removed`);
  }

  /** Shared shape for assign_role and transfer_host: host only, never yourself. */
  private withRolePermission(
    socket: Socket,
    action: 'assign_role' | 'transfer_host',
    targetId: string,
    mutate: (room: Room, actor: Participant) => boolean,
  ): void {
    const auth = authorise(socket, this.registry, action);
    if (!auth.ok) {
      // No sync_state here: a refused role change says nothing about the video.
      this.emitError(socket, auth.error.code, auth.error.message);
      return;
    }
    if (auth.participant.id === targetId) {
      this.emitError(socket, ERROR_CODES.INVALID_PAYLOAD, 'You cannot target yourself.');
      return;
    }

    if (!mutate(auth.room, auth.participant)) return;

    const assigned: RoleAssignedPayload = { participants: auth.room.participantDTOs() };
    auth.room.broadcast(SERVER_EVENTS.ROLE_ASSIGNED, assigned);
  }

  private emitError(socket: Socket, code: string, message: string): void {
    socket.emit(SERVER_EVENTS.ERROR, { code, message });
  }
}
