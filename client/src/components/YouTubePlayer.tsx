import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { loadYouTubeApi } from '../lib/youtubeApi'

/** The imperative surface the sync layer will drive in phase 3. */
export interface YouTubePlayerHandle {
  play(): void
  pause(): void
  seekTo(seconds: number): void
  /** Loads and autoplays. Needs a prior user gesture or the browser will block it. */
  loadVideo(videoId: string): void
  /**
   * Loads without playing — how a change_video lands, since nobody has gestured yet.
   * startSeconds matters for a late joiner: cueing at 0 and seeking afterwards races
   * the load, so the position has to go in with the cue.
   */
  cueVideo(videoId: string, startSeconds?: number): void
  getCurrentTime(): number
  /** 0 until metadata has loaded, which is why callers must treat 0 as "unknown". */
  getDuration(): number
  getPlayerState(): number
}

/** If the player has not reported ready by now, something is wrong with it. */
const READY_TIMEOUT_MS = 10_000

interface Props {
  /** Only the video the player starts with — later changes go through loadVideo(). */
  initialVideoId: string
  ref?: Ref<YouTubePlayerHandle>
  onReady?: () => void
  onStateChange?: (state: number) => void
  /** Raw YouTube onError code — the parent decides how to word it. */
  onError?: (code: number) => void
}

export function YouTubePlayer({
  initialVideoId,
  ref,
  onReady,
  onStateChange,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  // Problems with the player itself, as opposed to problems with a video, which are
  // the parent's to report through onError.
  const [problem, setProblem] = useState<string | null>(null)

  // Callbacks and the starting video live in refs so that a parent re-render never
  // tears down and rebuilds the iframe — rebuilding it would restart playback.
  const onReadyRef = useRef(onReady)
  const onStateChangeRef = useRef(onStateChange)
  const onErrorRef = useRef(onError)
  const initialVideoIdRef = useRef(initialVideoId)
  onReadyRef.current = onReady
  onStateChangeRef.current = onStateChange
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    let player: YT.Player | null = null
    let readyFired = false
    let readyTimer: number | undefined

    loadYouTubeApi()
      .then((YTApi) => {
        if (cancelled || !containerRef.current) return

        // YT replaces the element it is given with an <iframe>. Handing it a div we
        // created ourselves keeps it from mutating a node React owns.
        const mount = document.createElement('div')
        containerRef.current.appendChild(mount)

        player = new YTApi.Player(mount, {
          videoId: initialVideoIdRef.current,
          playerVars: {
            playsinline: 1,
            rel: 0,
            controls: 1,
            // Keyboard control is disabled for everyone: pointer-events blocks a
            // non-controller's mouse, but they could still tab into the iframe and
            // drive playback with the space bar. Controllers use our own buttons.
            disablekb: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              readyFired = true
              window.clearTimeout(readyTimer)
              onReadyRef.current?.()
            },
            onStateChange: (event) => onStateChangeRef.current?.(event.data),
            onError: (event) => onErrorRef.current?.(event.data),
          },
        })
        playerRef.current = player

        // A blocked or unreachable player can simply never call onReady, which would
        // otherwise leave the UI waiting with nothing to explain it.
        readyTimer = window.setTimeout(() => {
          if (!cancelled && !readyFired) {
            setProblem('The player failed to initialise. Try reloading the page.')
          }
        }, READY_TIMEOUT_MS)
      })
      .catch((loadError: Error) => {
        if (!cancelled) setProblem(loadError.message)
      })

    return () => {
      // Set before anything else: the API may still be loading, and this is what
      // stops a StrictMode-discarded mount from creating a second iframe.
      cancelled = true
      window.clearTimeout(readyTimer)
      player?.destroy()
      playerRef.current = null
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      // allowSeekAhead: true asks the server for an unbuffered position. Passing false
      // is only for scrub previews, where the user has not settled on a target yet.
      seekTo: (seconds) => playerRef.current?.seekTo(seconds, true),
      loadVideo: (videoId) => playerRef.current?.loadVideoById(videoId),
      cueVideo: (videoId, startSeconds) =>
        playerRef.current?.cueVideoById(videoId, startSeconds),
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      getDuration: () => playerRef.current?.getDuration() ?? 0,
      // -1 (UNSTARTED) is the honest answer before the player exists.
      getPlayerState: () => playerRef.current?.getPlayerState() ?? -1,
    }),
    [],
  )

  // The frame is always rendered: unmounting it on a problem would destroy an iframe
  // that may still be playing, so the message sits above it instead of replacing it.
  return (
    <div>
      {problem && <p className="player-problem">{problem}</p>}
      <div className="player-frame" ref={containerRef} />
    </div>
  )
}
