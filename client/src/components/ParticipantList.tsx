import type { ParticipantDTO, Role } from '@shared/types'
import type { RoomActions } from '../hooks/useSocket'
import { ParticipantRow } from './ParticipantRow'

const ROLE_ORDER: Record<Role, number> = { host: 0, moderator: 1, participant: 2 }

interface Props {
  participants: ParticipantDTO[]
  me: ParticipantDTO | null
  actions: RoomActions
}

export function ParticipantList({ participants, me, actions }: Props) {
  // Copy before sorting — sort() mutates, and this array is React state.
  const ordered = [...participants].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
  const iAmHost = me?.role === 'host'

  return (
    <aside className="participants">
      <h2>In this room ({participants.length})</h2>
      <ul>
        {ordered.map((participant) => (
          <ParticipantRow
            key={participant.id}
            participant={participant}
            isMe={participant.id === me?.id}
            // Never on your own row: the server refuses self-targeting anyway, so
            // offering the buttons would only promise something it will reject.
            showActions={iAmHost && participant.id !== me?.id}
            onMakeModerator={() => actions.assignRole(participant.id, 'moderator')}
            onMakeParticipant={() => actions.assignRole(participant.id, 'participant')}
            onMakeHost={() => actions.transferHost(participant.id)}
            onRemove={() => actions.removeParticipant(participant.id)}
          />
        ))}
      </ul>
    </aside>
  )
}
