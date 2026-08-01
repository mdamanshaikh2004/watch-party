import type { Server } from 'socket.io';
import { CLIENT_EVENTS } from '../../../shared/types';
import type { ReclaimTimers } from '../models/ReclaimTimers';
import type { RoomRegistry } from '../models/RoomRegistry';
import { PlaybackHandler } from './PlaybackHandler';
import { RoleHandler } from './RoleHandler';
import { RoomHandler } from './RoomHandler';

/**
 * Pure wiring: binds socket events to handler methods so the handlers stay free of
 * Socket.IO boilerplate. Membership is RoomHandler's, host-only administration is
 * RoleHandler's, playback is PlaybackHandler's; all three gate on the same guard.
 */
export function registerSocketHandlers(
  io: Server,
  registry: RoomRegistry,
  timers: ReclaimTimers,
): void {
  // Both membership and role administration can end a participant's reclaim window,
  // so the deadlines are a shared dependency rather than either handler's private state.
  const rooms = new RoomHandler(registry, timers);
  const roles = new RoleHandler(io, registry, timers);
  const playback = new PlaybackHandler(registry);

  io.on('connection', (socket) => {
    console.log(`[socket] connected ${socket.id}`);

    socket.on(CLIENT_EVENTS.JOIN_ROOM, (payload, ack) =>
      rooms.handleJoinRoom(socket, payload, ack),
    );
    socket.on(CLIENT_EVENTS.LEAVE_ROOM, () => rooms.handleLeaveRoom(socket));

    socket.on(CLIENT_EVENTS.PLAY, () => playback.handlePlay(socket));
    socket.on(CLIENT_EVENTS.PAUSE, () => playback.handlePause(socket));
    socket.on(CLIENT_EVENTS.SEEK, (payload) => playback.handleSeek(socket, payload));
    socket.on(CLIENT_EVENTS.CHANGE_VIDEO, (payload) =>
      playback.handleChangeVideo(socket, payload),
    );

    socket.on(CLIENT_EVENTS.ASSIGN_ROLE, (payload) => roles.handleAssignRole(socket, payload));
    socket.on(CLIENT_EVENTS.TRANSFER_HOST, (payload) =>
      roles.handleTransferHost(socket, payload),
    );
    socket.on(CLIENT_EVENTS.REMOVE_PARTICIPANT, (payload) =>
      roles.handleRemoveParticipant(socket, payload),
    );

    socket.on('disconnect', () => rooms.handleDisconnect(socket));
  });
}
