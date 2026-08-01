import { useCallback, useEffect, useRef, useState } from 'react'
import { effectiveTime, type PlayState, type SyncStatePayload } from '@shared/types'
import type { YouTubePlayerHandle } from '../components/YouTubePlayer'
import { describeSeek } from '../lib/detectSeek'

/** YouTube's onStateChange codes, named so the comparisons below read as English. */
const PLAYING = 1
const PAUSED = 2

const POLL_MS = 250
/**
 * How long an intent may live before it is abandoned. A redundant imperative call
 * (pausing an already-paused player) fires no event at all, so without this the guard
 * would stay closed forever and the client would go deaf to its own user.
 */
const INTENT_TIMEOUT_MS = 1500
/** Below this the player is close enough; re-seeking would only make it stutter. */
const SEEK_THRESHOLD_S = 0.5

/**
 * What we are currently driving the player toward. This replaces the boolean
 * "am I applying a remote change" flag, which cannot work: onStateChange arrives
 * asynchronously after the imperative call, so there is no safe moment to clear a
 * flag — too early and real events leak, too late and they are swallowed.
 */
interface Intent {
  playState: PlayState
  setAt: number
}

export interface PlayerSyncActions {
  play(): void
  pause(): void
  seek(time: number): void
  changeVideo(videoId: string): void
}

interface Options {
  /** Null until onReady has fired. Nothing is applied to the player before then. */
  player: YouTubePlayerHandle | null
  /** Latest state from the server; null until the first sync_state or join ack. */
  remote: SyncStatePayload | null
  canControl: boolean
  /** True once the viewer has gestured, so the browser will allow playback. */
  unlocked: boolean
  actions: PlayerSyncActions
}

/**
 * Keeps the local player and the room's anchor in agreement, in both directions:
 * inbound state is applied to the player, and genuine local actions are emitted.
 */
export function usePlayerSync({ player, remote, canControl, unlocked, actions }: Options) {
  const intentRef = useRef<Intent | null>(null)
  const pendingRef = useRef<SyncStatePayload | null>(null)
  const appliedRef = useRef<SyncStatePayload | null>(null)
  const lastVideoIdRef = useRef<string | null>(null)
  // Kept in a ref as well as state: applyRemote needs to read it without listing it
  // as a dependency, or setting it would recreate applyRemote and re-apply the whole
  // remote state a second time.
  const endedRef = useRef(false)
  const [endedLocally, setEndedLocally] = useState(false)

  const clearIntent = () => {
    intentRef.current = null
  }

  const markEnded = (value: boolean) => {
    if (endedRef.current === value) return
    endedRef.current = value
    setEndedLocally(value)
  }

  /** Drives the player to match `state`. Every imperative call happens behind an intent. */
  const applyRemote = useCallback(
    (state: SyncStatePayload) => {
      if (!player) return

      // Nothing to drive until a controller picks something. Not a trap: with no
      // videoId the room renders an empty stage and there is no player at all.
      if (!state.videoId) return

      // A new video is cued, never loaded: cueing does not autoplay, so it cannot be
      // blocked by a browser that has not seen a gesture yet. The position goes in
      // with the cue rather than as a seek afterwards — a late joiner arriving into a
      // room that is already 60s in would otherwise land at 0, because a seek issued
      // before the new video has loaded is discarded.
      if (state.videoId !== lastVideoIdRef.current) {
        lastVideoIdRef.current = state.videoId
        intentRef.current = { playState: state.playState, setAt: Date.now() }
        markEnded(false)
        player.cueVideo(state.videoId, effectiveTime(state, Date.now()))
        if (state.playState === 'playing' && unlocked) player.play()
        appliedRef.current = state
        return
      }

      let target = effectiveTime(state, Date.now())

      // The server keeps advancing the anchor past the end of the video, because it
      // has no idea how long the video is. Clamping here is what stops a late joiner
      // asking to seek somewhere that does not exist.
      const duration = player.getDuration()
      if (duration > 0 && target >= duration) {
        target = duration
        markEnded(true)
      } else {
        markEnded(false)
      }

      intentRef.current = { playState: state.playState, setAt: Date.now() }

      if (Math.abs(player.getCurrentTime() - target) > SEEK_THRESHOLD_S) {
        player.seekTo(target)
      }

      // Playback is only started once the viewer has gestured; until then the overlay
      // is showing and a play() call would be rejected by the browser anyway.
      if (state.playState === 'playing' && unlocked && !endedRef.current) player.play()
      else if (state.playState === 'paused') player.pause()

      appliedRef.current = state
    },
    [player, unlocked],
  )

  // Inbound state. Nothing may be applied before onReady, so the newest payload is
  // held — only the newest, since an older one is never worth applying afterwards.
  useEffect(() => {
    if (!remote) return
    if (!player) {
      pendingRef.current = remote
      return
    }
    applyRemote(remote)
  }, [remote, player, applyRemote])

  useEffect(() => {
    if (!player || !pendingRef.current) return
    const queued = pendingRef.current
    pendingRef.current = null
    applyRemote(queued)
  }, [player, applyRemote])

  /**
   * Called for every onStateChange. Returns nothing — its whole job is deciding
   * whether this event was our own echo or something the user did.
   */
  const handleStateChange = useCallback(
    (code: number) => {
      const intent = intentRef.current

      if (intent) {
        // Settled: the player reached what we asked for, so the guard can open again.
        if (
          (code === PLAYING && intent.playState === 'playing') ||
          (code === PAUSED && intent.playState === 'paused')
        ) {
          clearIntent()
        }
        return
      }

      // Only two codes mean a person did something. BUFFERING is a stall, ENDED is
      // reached independently by every client, and UNSTARTED/CUED are load steps —
      // emitting on any of them would put noise on the wire or start an echo loop.
      if (!canControl) return
      if (code === PLAYING) actions.play()
      else if (code === PAUSED) actions.pause()
    },
    [actions, canControl],
  )

  // The seek detector. There is no seek event, so a jump in currentTime larger than
  // the wall time that passed is the only evidence a seek happened.
  useEffect(() => {
    if (!player) return

    let lastTime = player.getCurrentTime()
    let lastAt = Date.now()

    const id = window.setInterval(() => {
      const now = Date.now()
      const current = player.getCurrentTime()
      const intent = intentRef.current

      // Defensive release: a no-op imperative call never produces the event that
      // would have cleared the intent, so time it out instead of wedging.
      if (intent && now - intent.setAt > INTENT_TIMEOUT_MS) clearIntent()

      const isPlaying = player.getPlayerState() === PLAYING
      const jumped = describeSeek({
        previousTime: lastTime,
        currentTime: current,
        elapsedMs: now - lastAt,
        isPlaying,
      })

      lastTime = current
      lastAt = now

      // Never while an intent is live: applying a remote seek looks exactly like a
      // local one from here, and mistaking it for one would echo it straight back.
      if (jumped && !intent && canControl) actions.seek(current)
    }, POLL_MS)

    return () => window.clearInterval(id)
  }, [player, canControl, actions])

  return { handleStateChange, endedLocally, lastApplied: appliedRef.current }
}
