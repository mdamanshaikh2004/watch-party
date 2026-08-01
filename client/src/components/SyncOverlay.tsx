interface Props {
  onUnlock: () => void
}

/**
 * Browsers refuse to start playback that no user gesture asked for, so a joiner's
 * player would silently stay paused while the room played on. This turns the first
 * required click into something deliberate instead of a mystery.
 */
export function SyncOverlay({ onUnlock }: Props) {
  return (
    <button className="sync-overlay" onClick={onUnlock}>
      <span className="sync-overlay-title">Click to sync</span>
      <span className="sync-overlay-hint">
        Your browser needs one click before it will let the video play.
      </span>
    </button>
  )
}
