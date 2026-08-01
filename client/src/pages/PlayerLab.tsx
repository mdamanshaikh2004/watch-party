import { useEffect, useRef, useState } from 'react'
import { PlayerEventLog, type LogEntry } from '../components/PlayerEventLog'
import { YouTubePlayer, type YouTubePlayerHandle } from '../components/YouTubePlayer'
import { describePlayerError } from '../lib/youtubeApi'

// Google's own IFrame API sample video, plus a longer one to test loadVideo().
const VIDEO_ID = 'M7lc1UVf-VE'
const OTHER_VIDEO_ID = 'aqz-KE-bpKQ'
// Deliberately broken ids, so the onError path can be triggered by hand.
const MALFORMED_VIDEO_ID = 'nope'
const MISSING_VIDEO_ID = 'aaaaaaaaaaa'

/**
 * Written as a plain lookup rather than YT.PlayerState because the YT global does not
 * exist until the API script has loaded, and this table is read at module scope.
 */
const STATE_NAMES: Record<number, string> = {
  [-1]: 'UNSTARTED',
  0: 'ENDED',
  1: 'PLAYING',
  2: 'PAUSED',
  3: 'BUFFERING',
  5: 'CUED',
}

const stateName = (code: number) => STATE_NAMES[code] ?? `UNKNOWN(${code})`

const MAX_LOG = 50
const POLL_MS = 200

/**
 * Phase 2a harness: no sockets, no sync. It exists to watch what the player actually
 * emits — especially around seeks, which fire no event of their own.
 */
export function PlayerLab() {
  const playerRef = useRef<YouTubePlayerHandle>(null)
  const lastEventAtRef = useRef<number | null>(null)
  const seqRef = useRef(0)

  const [ready, setReady] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [polledState, setPolledState] = useState(-1)
  const [videoError, setVideoError] = useState<{ code: number; message: string } | null>(null)

  // Polling is not decoration: seeking emits no event, so a jump in this number is the
  // only way to notice one. Phase 3's seek detection is built on exactly this loop.
  useEffect(() => {
    const id = window.setInterval(() => {
      const player = playerRef.current
      if (!player) return
      setCurrentTime(player.getCurrentTime())
      setPolledState(player.getPlayerState())
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [])

  const appendLog = (kind: LogEntry['kind'], code: number, label: string) => {
    const now = Date.now()
    const entry: LogEntry = {
      seq: ++seqRef.current,
      sincePreviousMs: lastEventAtRef.current === null ? 0 : now - lastEventAtRef.current,
      kind,
      code,
      label,
      timeAtEvent: playerRef.current?.getCurrentTime() ?? 0,
    }
    lastEventAtRef.current = now
    setLog((entries) => [entry, ...entries].slice(0, MAX_LOG))
  }

  const handleStateChange = (code: number) => {
    // A video that starts playing has clearly recovered from whatever went wrong.
    if (code === 1) setVideoError(null)
    appendLog('state', code, stateName(code))
  }

  const handleError = (code: number) => {
    setVideoError({ code, message: describePlayerError(code) })
    appendLog('error', code, describePlayerError(code))
  }

  const seekBy = (delta: number) => {
    const player = playerRef.current
    if (player) player.seekTo(Math.max(0, player.getCurrentTime() + delta))
  }

  const loadVideo = (videoId: string) => {
    setVideoError(null)
    playerRef.current?.loadVideo(videoId)
  }

  return (
    <div className="lab">
      <header className="lab-header">
        <h1>Player lab</h1>
        <span className="label">phase 2a — no sockets, local controls only</span>
      </header>

      <div className="lab-body">
        <div>
          <YouTubePlayer
            ref={playerRef}
            initialVideoId={VIDEO_ID}
            onReady={() => setReady(true)}
            onStateChange={handleStateChange}
            onError={handleError}
          />

          {videoError && (
            <p className="video-error">
              <strong>Error {videoError.code}</strong> — {videoError.message}
            </p>
          )}

          <div className="lab-controls">
            <button disabled={!ready} onClick={() => playerRef.current?.play()}>
              Play
            </button>
            <button disabled={!ready} onClick={() => playerRef.current?.pause()}>
              Pause
            </button>
            <button className="secondary" disabled={!ready} onClick={() => seekBy(-10)}>
              Seek −10s
            </button>
            <button className="secondary" disabled={!ready} onClick={() => seekBy(10)}>
              Seek +10s
            </button>
            <button className="secondary" disabled={!ready} onClick={() => playerRef.current?.seekTo(60)}>
              Seek to 1:00
            </button>
            <button className="secondary" disabled={!ready} onClick={() => loadVideo(OTHER_VIDEO_ID)}>
              Load other video
            </button>
            <button className="secondary" disabled={!ready} onClick={() => loadVideo(MALFORMED_VIDEO_ID)}>
              Load malformed id
            </button>
            <button className="secondary" disabled={!ready} onClick={() => loadVideo(MISSING_VIDEO_ID)}>
              Load missing video
            </button>
          </div>

          <p className="hint">
            Pause first, then seek — that is the sequence worth watching. Scrubbing the
            YouTube bar directly emits the same events as our buttons.
          </p>
        </div>

        <aside className="lab-readout">
          <dl>
            <dt>Ready</dt>
            <dd>{ready ? 'yes' : 'waiting…'}</dd>
            <dt>Current time</dt>
            <dd className="mono">{currentTime.toFixed(2)}s</dd>
            <dt>Polled state</dt>
            <dd className="mono">
              {polledState} {stateName(polledState)}
            </dd>
            <dt>Events seen</dt>
            <dd className="mono">{seqRef.current}</dd>
          </dl>

          <h2>Player event log</h2>
          <PlayerEventLog entries={log} />
        </aside>
      </div>
    </div>
  )
}
