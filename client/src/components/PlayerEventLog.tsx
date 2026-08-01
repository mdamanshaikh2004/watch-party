export interface LogEntry {
  seq: number
  sincePreviousMs: number
  /** Error codes and state codes overlap numerically, so every row says which it is. */
  kind: 'state' | 'error'
  code: number
  label: string
  timeAtEvent: number
}

interface Props {
  entries: LogEntry[]
}

/** Newest first, so the most recent transition is always in the same place. */
export function PlayerEventLog({ entries }: Props) {
  if (entries.length === 0) return <p className="hint">Nothing yet — press play.</p>

  return (
    <table className="lab-log">
      <thead>
        <tr>
          <th>#</th>
          <th>+ms</th>
          <th>kind</th>
          <th>code</th>
          <th>meaning</th>
          <th>at</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.seq} className={entry.kind === 'error' ? 'log-error' : undefined}>
            <td>{entry.seq}</td>
            <td>{entry.sincePreviousMs}</td>
            <td>{entry.kind === 'error' ? 'ERR' : 'state'}</td>
            <td>{entry.code}</td>
            <td>{entry.label}</td>
            <td>{entry.timeAtEvent.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
