import { useRef, useState } from 'react'
import { PERMISSIONS, type ParticipantDTO, type SyncStatePayload } from '@shared/types'
import type { RoomActions } from '../hooks/useSocket'
import { usePlayerSync } from '../hooks/usePlayerSync'
import { Controls } from './Controls'
import { ParticipantList } from './ParticipantList'
import { SyncOverlay } from './SyncOverlay'
import { YouTubePlayer, type YouTubePlayerHandle } from './YouTubePlayer'

interface Props {
  code: string
  participants: ParticipantDTO[]
  me: ParticipantDTO | null
  video: SyncStatePayload | null
  actions: RoomActions
  onLeave: () => void
}

export function RoomShell({ code, participants, me, video, actions, onLeave }: Props) {
  const playerRef = useRef<YouTubePlayerHandle>(null)
  const [copied, setCopied] = useState(false)
  // Promoted to state on ready rather than read from the ref during render, so the
  // hook re-runs the moment the player becomes usable instead of on the next render.
  const [player, setPlayer] = useState<YouTubePlayerHandle | null>(null)
  const [unlocked, setUnlocked] = useState(false)

  // Cosmetic only. The server checks the same table before it changes anything.
  const canControl = me !== null && PERMISSIONS.play.includes(me.role)

  const { handleStateChange, endedLocally } = usePlayerSync({
    player,
    remote: video,
    canControl,
    unlocked,
    actions,
  })

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  // Reads the ready-gated player, not the ref: before onReady getCurrentTime answers
  // 0, so a click here would silently seek relative to the start of the video.
  const seekBy = (delta: number) => {
    if (player) actions.seek(Math.max(0, player.getCurrentTime() + delta))
  }

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <span className="label">Room</span>
          <strong className="code">{code}</strong>
        </div>
        <div className="header-actions">
          <button onClick={copyLink}>{copied ? 'Copied!' : 'Copy invite link'}</button>
          <button className="secondary" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      <main className="room-body">
        <div>
          {video?.videoId ? (
            /* pointer-events is the whole of the non-controller lockout: it needs no
               rebuild, so a promotion is a CSS change rather than a restart. */
            <div className="player-wrap" style={{ pointerEvents: canControl ? 'auto' : 'none' }}>
              <YouTubePlayer
                ref={playerRef}
                initialVideoId={video.videoId}
                onReady={() => setPlayer(playerRef.current)}
                onStateChange={handleStateChange}
              />
              {!unlocked && <SyncOverlay onUnlock={() => setUnlocked(true)} />}
            </div>
          ) : (
            /* No player at all until a video is chosen. Showing a stand-in video here
               would be a lie: the room's videoId is null, so nothing could drive it. */
            <EmptyStage canControl={canControl} />
          )}

          {endedLocally && <p className="hint">The video has ended.</p>}

          <Controls
            playState={video?.playState ?? 'paused'}
            canControl={canControl}
            // Playback needs a player that has reported ready; picking a video does not.
            ready={player !== null}
            onPlay={actions.play}
            onPause={actions.pause}
            onSeekBy={seekBy}
            onChangeVideo={actions.changeVideo}
          />
        </div>

        <ParticipantList participants={participants} me={me} actions={actions} />
      </main>
    </div>
  )
}

/** What a room looks like before anyone has chosen something to watch. */
function EmptyStage({ canControl }: { canControl: boolean }) {
  return (
    <div className="empty-stage">
      {canControl ? (
        <>
          <p className="empty-stage-title">Nothing playing yet</p>
          <p className="hint">Paste a YouTube link below to start the party.</p>
        </>
      ) : (
        <>
          <p className="empty-stage-title">Waiting for the host</p>
          <p className="hint">They have not picked a video yet.</p>
        </>
      )}
    </div>
  )
}
