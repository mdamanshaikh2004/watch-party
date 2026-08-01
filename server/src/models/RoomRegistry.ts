import type { Server } from 'socket.io';
import { Room } from './Room';

/** No 0/O/1/I — room codes get read aloud and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
/** How long a room may sit empty before it is considered abandoned. */
const ABANDONED_AFTER_MS = 10 * 60 * 1000;

/** Owns every live room. In-memory only: restarting the server clears all rooms. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly io: Server) {}

  createRoom(): Room {
    this.sweepAbandoned();

    let code = this.generateCode();
    while (this.rooms.has(code)) code = this.generateCode();

    const room = new Room(code, this.io);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Called after every leave, so a room disappears as soon as the last person goes. */
  deleteIfEmpty(code: string): boolean {
    const key = code.toUpperCase();
    const room = this.rooms.get(key);
    if (!room || !room.isEmpty()) return false;
    this.rooms.delete(key);
    return true;
  }

  /**
   * deleteIfEmpty only fires when someone leaves, so a room that was created and never
   * joined would live forever. Sweeping on create needs no timer and keeps the Map's
   * growth tied to actual usage.
   */
  private sweepAbandoned(): void {
    const cutoff = Date.now() - ABANDONED_AFTER_MS;
    for (const [code, room] of this.rooms) {
      if (room.isEmpty() && room.createdAt < cutoff) {
        this.rooms.delete(code);
        console.log(`[room ${code}] abandoned, removed`);
      }
    }
  }

  get size(): number {
    return this.rooms.size;
  }

  private generateCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
  }
}
