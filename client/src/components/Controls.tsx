import { useState } from 'react'
import type { PlayState } from '@shared/types'

interface Props {
  playState: PlayState
  canControl: boolean
  /** False until the player reports ready, or when there is no video to play at all. */
  ready: boolean
  onPlay: () => void
  onPause: () => void
  onSeekBy: (delta: number) => void
  onChangeVideo: (videoId: string) => void
}

/**
 * Pulls a YouTube id out of whatever the user pasted — a full watch URL, a share
 * link, or the bare id. Anything else is left alone and rejected by the server.
 */
function parseVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const patterns = [/[?&]v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /\/embed\/([\w-]{11})/]
  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match) return match[1]
  }

  return /^[\w-]{11}$/.test(trimmed) ? trimmed : null
}

/** Buttons are disabled for non-controllers as a courtesy — the server is the gate. */
export function Controls({
  playState,
  canControl,
  ready,
  onPlay,
  onPause,
  onSeekBy,
  onChangeVideo,
}: Props) {
  const [videoInput, setVideoInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const submitVideo = () => {
    const videoId = parseVideoId(videoInput)
    if (!videoId) {
      setInputError('That does not look like a YouTube link or video id.')
      return
    }
    setInputError(null)
    setVideoInput('')
    onChangeVideo(videoId)
  }

  // Seeking before the player is ready would measure from 0 rather than the real
  // position, so playback controls wait for it. Choosing a video does not.
  const canPlay = canControl && ready

  return (
    <div className="controls">
      <div className="controls-row">
        <button disabled={!canPlay} onClick={playState === 'playing' ? onPause : onPlay}>
          {playState === 'playing' ? 'Pause' : 'Play'}
        </button>
        <button className="secondary" disabled={!canPlay} onClick={() => onSeekBy(-10)}>
          −10s
        </button>
        <button className="secondary" disabled={!canPlay} onClick={() => onSeekBy(10)}>
          +10s
        </button>
        {!canControl && <span className="hint">The host controls playback.</span>}
      </div>

      {canControl && (
        <div className="controls-row">
          <input
            value={videoInput}
            onChange={(event) => setVideoInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submitVideo()}
            placeholder="Paste a YouTube link to change the video"
          />
          <button className="secondary" onClick={submitVideo}>
            Change
          </button>
        </div>
      )}

      {inputError && <p className="error">{inputError}</p>}
    </div>
  )
}
