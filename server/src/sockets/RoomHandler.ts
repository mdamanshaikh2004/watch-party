import type { Socket } from 'socket.io';
import {
  ERROR_CODES,
  SERVER_EVENTS,
  type JoinAck,
  type UserJoinedPayload,
  type UserLeftPayload,
} from '../../../shared/types';
import type { Participant } from '../models/Participant';
import type { ReclaimTimers } from '../models/ReclaimTimers';
import type { Room } from '../models/Room';
import type { RoomRegistry } from '../models/RoomRegistry';
import { parseJoinPayload } from './payloads';

/** Membership: joining, leaving, dropping, and coming back. Roles live in RoleHandler. */
export class RoomHandler {
  constructor(
    private readonly registry: RoomRegistry,
    private readonly timers: ReclaimTimers,
  ) {}

  handleJoinRoom(socket: Socket, payload: unknown, ack?: (response: JoinAck) => void): void {
    const parsed = parseJoinPayload(payload);
    if (!parsed) {
      this.replyOrEmit(socket, ack, ERROR_CODES.INVALID_PAYLOAD, 'Room code and username are required.');
      return;
    }

    const room = this.registry.getRoom(parsed.roomCode);
    if (!room) {
      this.replyOrEmit(socket, ack, ERROR_CODES.ROOM_NOT_FOUND, `No room with code ${parsed.roomCode}.`);
      return;
    }

    socket.join(room.code);
    // Remembered on the socket so leaving/disconnecting knows which room to clean up.
    socket.data.roomCode = room.code;

    const returning = parsed.token ? room.findByToken(parsed.token) : undefined;
    const participant = returning ?? room.addParticipant(socket.id, parsed.username);

    if (returning) {
      this.timers.cancel(returning.id);
      room.reclaim(returning, socket.id);
    }

    ack?.({
      ok: true,
      result: {
        room: room.toDTO(),
        you: participant.toDTO(),
        token: participant.token,
        reclaimed: Boolean(returning),
      },
    });

    if (returning) {
      // A reclaim can hand host back, so everyone needs the new roster — not just the
      // news that somebody arrived.
      room.broadcast(SERVER_EVENTS.ROLE_ASSIGNED, { participants: room.participantDTOs() });
      console.log(`[room ${room.code}] ${participant.username} reconnected as ${participant.role}`);
      return;
    }

    const joined: UserJoinedPayload = {
      participant: participant.toDTO(),
      participants: room.participantDTOs(),
    };
    room.broadcastExcept(socket.id, SERVER_EVENTS.USER_JOINED, joined);
    console.log(`[room ${room.code}] ${participant.username} joined as ${participant.role}`);
  }

  /** An explicit leave is permanent — no reclaim window, they meant it. */
  handleLeaveRoom(socket: Socket): void {
    const code: string | undefined = socket.data.roomCode;
    if (!code) return;

    const room = this.registry.getRoom(code);
    socket.leave(code);
    socket.data.roomCode = undefined;
    if (!room) return;

    const { removed, newHost } = room.removeParticipant(socket.id);
    if (!removed) return;
    this.timers.cancel(removed.id);
    this.announceDeparture(room, removed, newHost, 'left');
  }

  /**
   * A dropped connection is not a departure. The participant is held for the reclaim
   * window so identity and role survive a blip, but if they were host a connected
   * stand-in takes over at once — an uncontrollable room is worse than role churn.
   */
  handleDisconnect(socket: Socket): void {
    const code: string | undefined = socket.data.roomCode;
    socket.data.roomCode = undefined;
    if (!code) return;

    const room = this.registry.getRoom(code);
    if (!room) return;

    const { removed, newHost } = room.markDisconnected(socket.id);
    if (!removed) return;

    room.broadcast(SERVER_EVENTS.ROLE_ASSIGNED, { participants: room.participantDTOs() });
    console.log(
      `[room ${code}] ${removed.username} dropped` +
        (newHost ? `, ${newHost.username} standing in as host` : ''),
    );

    // If they never come back, this is what finally removes them. Anyone who ends
    // their window early — a reclaim, a leave, a removal by the host — cancels it
    // through the same shared ReclaimTimers.
    this.timers.schedule(removed.id, () => {
      const { removed: expired, newHost: promoted } = room.removeParticipant(removed.socketId);
      if (!expired) return;
      this.announceDeparture(room, expired, promoted, 'did not return');
    });
  }

  /**
   * Shared by leaving and by expiry. The cleanup matters most on the expiry path:
   * isEmpty() stays false while someone is inside the reclaim window, so the leave
   * path never fired for them, and without this the room would leak forever.
   */
  private announceDeparture(
    room: Room,
    removed: Participant,
    newHost: Participant | null,
    reason: string,
  ): void {
    const left: UserLeftPayload = {
      participantId: removed.id,
      participants: room.participantDTOs(),
    };
    room.broadcast(SERVER_EVENTS.USER_LEFT, left);
    console.log(
      `[room ${room.code}] ${removed.username} ${reason}` +
        (newHost ? `, ${newHost.username} promoted to host` : ''),
    );
    if (this.registry.deleteIfEmpty(room.code)) console.log(`[room ${room.code}] empty, removed`);
  }

  /** Failures answer on the ack when there is one, so the caller always hears back. */
  private replyOrEmit(
    socket: Socket,
    ack: ((response: JoinAck) => void) | undefined,
    code: string,
    message: string,
  ): void {
    if (ack) ack({ ok: false, error: { code, message } });
    else socket.emit(SERVER_EVENTS.ERROR, { code, message });
  }
}
