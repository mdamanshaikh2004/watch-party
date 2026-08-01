import { randomUUID } from 'crypto';
import type { ParticipantDTO, Role } from '../../../shared/types';

/** One person in one room. */
export class Participant {
  /** Stable identity. Clients reference people by this, so it must never change. */
  readonly id: string;
  readonly username: string;
  /**
   * Mutable, unlike id: a reconnect gives the same person a new socket, and rebinding
   * that here is what lets them keep their role instead of returning as a stranger.
   */
  socketId: string;
  /** Never leaves the server. Presenting it on join proves you are this participant. */
  readonly token: string;
  /** Used to answer "who has been here longest" when the host leaves. */
  readonly joinedAt: number;
  role: Role;

  connected = true;
  /** When they dropped, so the reclaim window can be measured from it. */
  disconnectedAt: number | null = null;
  /**
   * Who took over as host when this participant dropped, and what role they held
   * before. Remembered here so a reclaim can hand host back and put them right.
   */
  standIn: { participantId: string; previousRole: Role } | null = null;

  constructor(socketId: string, username: string, role: Role) {
    this.id = randomUUID();
    this.token = randomUUID();
    this.socketId = socketId;
    this.username = username;
    this.role = role;
    this.joinedAt = Date.now();
  }

  /** Clients reference people by id; socketId and token must never leave the server. */
  toDTO(): ParticipantDTO {
    return {
      id: this.id,
      username: this.username,
      role: this.role,
      connected: this.connected,
    };
  }
}
