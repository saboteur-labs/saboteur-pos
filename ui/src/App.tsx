import { useEffect } from 'react'
import { useStore } from './state/store'
import { startSocket } from './state/socket'
import { AppShell } from './components/AppShell'
import { BriefingView } from './views/BriefingView'
import { TasksView } from './views/TasksView'
import { NotesView } from './views/NotesView'

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

      {section === 'tasks' && <TasksView />}
      {section === 'notes' && <NotesView />}
    </AppShell>
  )
}
