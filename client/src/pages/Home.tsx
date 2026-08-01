import { useState } from 'react'

interface Props {
  username: string
  onUsernameChange: (name: string) => void
  onEnterRoom: (code: string) => void
}

export function Home({ username, onUsernameChange, onEnterRoom }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = username.trim()

  const createRoom = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/rooms', { method: 'POST' })
      if (!response.ok) throw new Error('Request failed')
      const { code: newCode } = (await response.json()) as { code: string }
      onEnterRoom(newCode)
    } catch {
      setError('Could not create a room. Is the server running?')
    } finally {
      setBusy(false)
    }
  }

  const joinRoom = () => {
    const trimmedCode = code.trim().toUpperCase()
    if (!trimmedCode) {
      setError('Enter a room code to join.')
      return
    }
    onEnterRoom(trimmedCode)
  }

  return (
    <div className="home">
      <h1>Watch Party</h1>
      <p className="subtitle">Watch YouTube together, in sync.</p>

      <label>
        Your name
        <input
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="e.g. Aman"
          maxLength={20}
        />
      </label>

      <div className="actions">
        <button disabled={!trimmedName || busy} onClick={createRoom}>
          {busy ? 'Creating…' : 'Create a room'}
        </button>

        <div className="join">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Room code"
            maxLength={6}
          />
          <button className="secondary" disabled={!trimmedName} onClick={joinRoom}>
            Join
          </button>
        </div>
      </div>

      {!trimmedName && <p className="hint">Enter a name first.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
