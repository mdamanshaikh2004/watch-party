import type { ParticipantDTO, Role } from '@shared/types'

/**
 * The same words the wire uses. An interface that says "Viewer" for a role the API
 * calls `participant` is a question waiting to be asked.
 */
const ROLE_LABEL: Record<Role, string> = {
  host: 'Host',
  moderator: 'Moderator',
  participant: 'Participant',
}

interface Props {
  participant: ParticipantDTO
  isMe: boolean
  /** Host-only actions render only when you are the host and this row is not you. */
  showActions: boolean
  onMakeModerator: () => void
  onMakeParticipant: () => void
  onMakeHost: () => void
  onRemove: () => void
}

export function ParticipantRow({
  participant,
  isMe,
  showActions,
  onMakeModerator,
  onMakeParticipant,
  onMakeHost,
  onRemove,
}: Props) {
  return (
    <li className={participant.connected ? undefined : 'offline'}>
      <div className="participant-line">
        <span className="name">
          {participant.username}
          {isMe && <span className="you"> (you)</span>}
        </span>
        <span className={`badge badge-${participant.role}`}>{ROLE_LABEL[participant.role]}</span>
      </div>

      {/* A dropped participant is held briefly so their role survives a blip, so say
          that rather than letting them silently vanish from the list. */}
      {!participant.connected && <span className="hint">reconnecting…</span>}

      {showActions && (
        <div className="row-actions">
          {participant.role === 'participant' ? (
            <button className="tiny" onClick={onMakeModerator}>
              Make moderator
            </button>
          ) : (
            <button className="tiny" onClick={onMakeParticipant}>
              Make participant
            </button>
          )}
          <button className="tiny" onClick={onMakeHost}>
            Make host
          </button>
          <button className="tiny danger" onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </li>
  )
}
