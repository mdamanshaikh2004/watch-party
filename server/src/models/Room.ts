import type { Server } from 'socket.io';
import {
  PERMISSIONS,
  type Action,
  type AssignableRole,
  type ParticipantDTO,
  type RoomStateDTO,
} from '../../../shared/types';
import { Participant } from './Participant';
import { VideoTimeline } from './VideoTimeline';

/** What removeParticipant reports back, so the caller can broadcast one event. */
export interface RemovalResult {
  removed: Participant | null;
  newHost: Participant | null;
}

/**
 * A single watch party. All room state is mutated here and nowhere else — handlers
 * ask the Room to do things, they never reach into the participants Map themselves.
 */
export class Room {
  readonly code: string;
  /** Lets the registry spot rooms that were created but never joined. */
  readonly createdAt = Date.now();
  /** Keyed by socket id because every incoming event arrives with one. */
  private readonly participants = new Map<string, Participant>();
  /** What is playing and where it has got to. Room decides who may drive it. */
  readonly video = new VideoTimeline();

  // The Socket.IO server is injected so the Room can broadcast to its own channel.
  constructor(code: string, private readonly io: Server) {
    this.code = code;
  }

  /** First person into an empty room is the host; everyone after is a participant. */
  addParticipant(socketId: string, username: string): Participant {
    const role = this.hasHost() ? 'participant' : 'host';
    const participant = new Participant(socketId, username, role);
    this.participants.set(socketId, participant);
    return participant;
  }

  /**
   * Removing the host promotes the longest-present survivor, otherwise the room would
   * be left with nobody able to control playback.
   */
  removeParticipant(socketId: string): RemovalResult {
    const removed = this.participants.get(socketId) ?? null;
    if (!removed) return { removed: null, newHost: null };

    this.participants.delete(socketId);
    if (removed.role !== 'host') return { removed, newHost: null };

    const newHost = this.oldestConnected();
    if (newHost) newHost.role = 'host';
    return { removed, newHost };
  }

  // ---- reconnection identity ----

  /**
   * A drop is not a departure. The participant stays in the roster so their identity
   * and role survive, but if they were host someone connected takes over at once —
   * a room nobody can control is worse than a moment of role churn.
   */
  markDisconnected(socketId: string): RemovalResult {
    const participant = this.participants.get(socketId);
    if (!participant) return { removed: null, newHost: null };

    participant.connected = false;
    participant.disconnectedAt = Date.now();
    if (participant.role !== 'host') return { removed: participant, newHost: null };

    const standIn = this.oldestConnected();
    if (!standIn) return { removed: participant, newHost: null };

    // Remembered so a reclaim can hand host back and put the stand-in where it was.
    participant.standIn = { participantId: standIn.id, previousRole: standIn.role };
    participant.role = 'participant';
    standIn.role = 'host';
    return { removed: participant, newHost: standIn };
  }

  findByToken(token: string): Participant | undefined {
    for (const participant of this.participants.values()) {
      if (participant.token === token) return participant;
    }
    return undefined;
  }

  /**
   * Rebinds a returning participant to their new socket. The Map is keyed by socket
   * id, so this is a re-key: dropping the old entry matters, or the roster keeps a
   * ghost that nothing can remove.
   */
  reclaim(participant: Participant, socketId: string): void {
    this.participants.delete(participant.socketId);
    participant.socketId = socketId;
    participant.connected = true;
    participant.disconnectedAt = null;
    this.participants.set(socketId, participant);

    const standIn = participant.standIn;
    participant.standIn = null;
    if (!standIn) return;

    // Only take host back if the stand-in still holds it — someone may have
    // transferred it away in the meantime, and that decision outranks this one.
    const holder = this.getById(standIn.participantId);
    if (holder?.role !== 'host') return;
    holder.role = standIn.previousRole;
    participant.role = 'host';
  }

  // ---- roles ----

  /** Never sets host: transfer_host owns that, so double-host cannot be reached. */
  assignRole(participantId: string, role: AssignableRole): boolean {
    const participant = this.getById(participantId);
    if (!participant || participant.role === 'host') return false;
    participant.role = role;
    return true;
  }

  /**
   * Demote and promote in one step. There is deliberately no moment in between where
   * the room has two hosts or none.
   */
  transferHost(fromId: string, toId: string): boolean {
    const current = this.getById(fromId);
    const target = this.getById(toId);
    if (!current || !target || current.role !== 'host' || current.id === target.id) return false;

    current.role = 'moderator';
    target.role = 'host';
    return true;
  }

  hasHost(): boolean {
    return [...this.participants.values()].some((p) => p.role === 'host');
  }

  /** The single permission gate. Every playback handler must call this first. */
  can(participantId: string, action: Action): boolean {
    const participant = this.getById(participantId);
    if (!participant) return false;
    return PERMISSIONS[action].includes(participant.role);
  }

  getBySocketId(socketId: string): Participant | undefined {
    return this.participants.get(socketId);
  }

  /** Linear scan — a room holds a handful of people, a second index earns nothing. */
  getById(id: string): Participant | undefined {
    for (const participant of this.participants.values()) {
      if (participant.id === id) return participant;
    }
    return undefined;
  }

  broadcast(event: string, payload: unknown): void {
    this.io.to(this.code).emit(event, payload);
  }

  /** For news the sender already knows — e.g. a joiner who got the full state in their ack. */
  broadcastExcept(socketId: string, event: string, payload: unknown): void {
    this.io.to(this.code).except(socketId).emit(event, payload);
  }

  isEmpty(): boolean {
    return this.participants.size === 0;
  }

  /** The authoritative roster every roster event sends in full. */
  participantDTOs(): ParticipantDTO[] {
    return [...this.participants.values()].map((p) => p.toDTO());
  }

  toDTO(): RoomStateDTO {
    return {
      code: this.code,
      participants: this.participantDTOs(),
      video: this.video.state,
    };
  }

  /**
   * Connected only: promoting someone who is not there would recreate exactly the
   * uncontrollable room that promotion exists to prevent.
   */
  private oldestConnected(): Participant | null {
    let oldest: Participant | null = null;
    for (const participant of this.participants.values()) {
      if (!participant.connected) continue;
      if (!oldest || participant.joinedAt < oldest.joinedAt) oldest = participant;
    }
    return oldest;
  }
}
