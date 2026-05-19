import { useEffect } from 'react'
import { useStore } from './state/store'
import { startSocket } from './state/socket'
import { AppShell } from './components/AppShell'
import { BriefingView } from './views/BriefingView'

function TasksView() {
  const { tasks, selectedView } = useStore()
  return (
    <div className="p-6 font-mono text-sm text-muted-foreground">
      Tasks ({selectedView}) — {tasks.length} items
    </div>
  )
}

function NotesView() {
  const { notes } = useStore()
  return (
    <div className="p-6 font-mono text-sm text-muted-foreground">
      Notes — {notes.length} items
    </div>
  )
}

export default function App() {
  const { selectedView, fetchBriefing, fetchTasks, fetchNotes } = useStore()

  useEffect(() => {
    fetchBriefing().catch(() => {})
    fetchTasks().catch(() => {})
    fetchNotes().catch(() => {})
    return startSocket()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const section =
    selectedView === 'briefing' ? 'briefing'
    : selectedView === 'notes' ? 'notes'
    : 'tasks'

  return (
    <AppShell>
      {section === 'briefing' && <BriefingView />}

      {section === 'tasks'    && <TasksView />}
      {section === 'notes'    && <NotesView />}
    </AppShell>
  )
}
