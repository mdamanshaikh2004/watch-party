import { useState } from 'react'
import { RoomShell } from '../components/RoomShell'
import { useSocket } from '../hooks/useSocket'

interface Props {
  code: string
  username: string
  onUsernameChange: (name: string) => void
  onLeave: () => void
}

export function Room({ code, username, onUsernameChange, onLeave }: Props) {
  // useSocket stays outside the branch below because hooks cannot be conditional;
  // it simply does nothing until there is a username to join with.
  const { participants, me, connectionState, error, video, removedReason, actions } = useSocket(
    code,
    username,
  )

  if (!username) {
    return <NamePrompt code={code} onSubmit={onUsernameChange} />
  }

  // Checked before the connection states below: once removed, this tab is no longer
  // in the room, and rendering the player would be a lie.
  if (removedReason) {
    return (
      <div className="notice">
        <h1>You were removed</h1>
        <p className="error">{removedReason}</p>
        <button onClick={onLeave}>Back to start</button>
      </div>
    )
  }

  if (connectionState === 'failed') {
    return (
      <div className="notice">
        <h1>Cannot join {code}</h1>
        <p className="error">{error?.message ?? 'Something went wrong.'}</p>
        <button onClick={onLeave}>Back to start</button>
      </div>
    )
  }

  if (connectionState !== 'joined') {
    return <div className="notice">Joining {code}…</div>
  }

  return (
    <RoomShell
      code={code}
      participants={participants}
      me={me}
      video={video}
      actions={actions}
      onLeave={onLeave}
    />
  )
}

/** Shown when someone opens an invite link directly and has no name yet. */
function NamePrompt({ code, onSubmit }: { code: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')

  return (
    <form
      className="notice"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onSubmit(name.trim())
      }}
    >
      <h1>Join room {code}</h1>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Your name"
        maxLength={20}
        autoFocus
      />
      <button type="submit" disabled={!name.trim()}>
        Join
      </button>
    </form>
  )
}
