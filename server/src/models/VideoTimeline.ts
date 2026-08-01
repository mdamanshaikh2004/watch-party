import {
  effectiveTime,
  type SyncStatePayload,
  type VideoState,
} from '../../../shared/types';

/**
 * What is playing, and where it has got to. Knows nothing about participants or
 * permissions — a Room composes one of these and decides who may drive it.
 *
 * Position is an anchor rather than a running clock, so this needs no timer: any
 * caller can derive the current position from the anchor whenever it asks.
 */
export class VideoTimeline {
  state: VideoState = {
    videoId: null,
    playState: 'paused',
    anchorTime: 0,
    anchorTimestamp: Date.now(),
  };

  play(): void {
    this.reanchor({ playState: 'playing' });
  }

  pause(): void {
    this.reanchor({ playState: 'paused' });
  }

  seek(time: number): void {
    this.reanchor({ anchorTime: Math.max(0, time) });
  }

  /** A new video always lands cued at the start, so no client has to autoplay it. */
  changeVideo(videoId: string): void {
    this.reanchor({ videoId, playState: 'paused', anchorTime: 0 });
  }

  syncPayload(): SyncStatePayload {
    return { ...this.state, serverTimestamp: Date.now() };
  }

  /**
   * Reading the effective time *before* writing is what makes the anchor correct:
   * pausing after 30s of playback must store 30s, not the position play started from.
   */
  private reanchor(changes: Partial<VideoState> = {}): void {
    // One `now` for both fields, so the stored position and its timestamp agree.
    const now = Date.now();
    this.state = {
      ...this.state,
      anchorTime: effectiveTime(this.state, now),
      anchorTimestamp: now,
      ...changes,
    };
  }
}
