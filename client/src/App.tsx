import { useEffect, useState } from 'react'
import { Home } from './pages/Home'
import { PlayerLab } from './pages/PlayerLab'
import { Room } from './pages/Room'

/** /room/ABC123 -> "ABC123", anything else -> null (show Home). */
function readRoomCode(path: string): string | null {
  const match = path.match(/^\/room\/([A-Za-z0-9]+)\/?$/)
  return match ? match[1].toUpperCase() : null
}

/**
 * Two views and shareable URLs is all this app needs, so it uses the History API
 * directly instead of pulling in a router.
 */
export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [username, setUsername] = useState('')

  // Without this the browser's back button would change the URL but not the view.
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (to: string) => {
    window.history.pushState({}, '', to)
    setPath(to)
  }

  // Standalone player harness, kept off the room until phase 2b wires the two together.
  if (path === '/player-lab') return <PlayerLab />

  const roomCode = readRoomCode(path)

  if (!roomCode) {
    return (
      <Home
        username={username}
        onUsernameChange={setUsername}
        onEnterRoom={(code) => navigate(`/room/${code}`)}
      />
    )
  }

  return (
    <Room
      code={roomCode}
      username={username}
      onUsernameChange={setUsername}
      onLeave={() => navigate('/')}
    />
  )
}
