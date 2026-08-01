import type { Socket } from 'socket.io';
import { ERROR_CODES, SERVER_EVENTS, type Action } from '../../../shared/types';
import type { Room } from '../models/Room';
import type { RoomRegistry } from '../models/RoomRegistry';
import { authorise } from './guard';
import { parseSeek, parseVideoId } from './payloads';

/**
 * play / pause / seek / change_video. One method per event; the mutation itself lives
 * on the model, and permission is always checked before anything changes.
 */
export class PlaybackHandler {
  constructor(private readonly registry: RoomRegistry) {}

  handlePlay(socket: Socket): void {
    this.withPermission(socket, 'play', (room) => room.video.play());
  }

  handlePause(socket: Socket): void {
    this.withPermission(socket, 'pause', (room) => room.video.pause());
  }

  handleSeek(socket: Socket, payload: unknown): void {
    const time = parseSeek(payload);
    if (time === null) {
      socket.emit(SERVER_EVENTS.ERROR, {
        code: ERROR_CODES.INVALID_PAYLOAD,
        message: 'seek needs a numeric time.',
      });
      return;
    }
    this.withPermission(socket, 'seek', (room) => room.video.seek(time));
  }

  handleChangeVideo(socket: Socket, payload: unknown): void {
    const videoId = parseVideoId(payload);
    if (!videoId) {
      socket.emit(SERVER_EVENTS.ERROR, {
        code: ERROR_CODES.INVALID_PAYLOAD,
        message: 'change_video needs a video id.',
      });
      return;
    }
    this.withPermission(socket, 'change_video', (room) => room.video.changeVideo(videoId));
  }

  private withPermission(socket: Socket, action: Action, mutate: (room: Room) => void): void {
    const auth = authorise(socket, this.registry, action);

    if (!auth.ok) {
      // A refused client is re-synced so it cannot sit on a state it applied locally
      // before the server said no. Only possible when the room resolved.
      const code: string | undefined = socket.data.roomCode;
      const room = code ? this.registry.getRoom(code) : undefined;
      if (room) socket.emit(SERVER_EVENTS.SYNC_STATE, room.video.syncPayload());
      socket.emit(SERVER_EVENTS.ERROR, auth.error);
      return;
    }

    mutate(auth.room);
    auth.room.broadcast(SERVER_EVENTS.SYNC_STATE, auth.room.video.syncPayload());
  }
}

