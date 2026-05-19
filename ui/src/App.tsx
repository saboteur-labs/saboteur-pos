import { useEffect } from 'react'
import { useStore } from './state/store'
import { startSocket } from './state/socket'

export default function App() {
  const { briefing, tasks, notes, fetchBriefing, fetchTasks, fetchNotes } = useStore()

  useEffect(() => {
    fetchBriefing().catch(() => {})
    fetchTasks().catch(() => {})
    fetchNotes().catch(() => {})

    const stopSocket = startSocket()
    return stopSocket
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4 tracking-heading font-display">Saboteur POS</h1>
      <p className="text-muted-foreground mb-1">Context: {briefing?.contextName ?? '—'}</p>
      <p className="text-muted-foreground mb-1">Active tasks: {tasks.length}</p>
      <p className="text-muted-foreground">Notes: {notes.length}</p>
    </div>
  )
}
