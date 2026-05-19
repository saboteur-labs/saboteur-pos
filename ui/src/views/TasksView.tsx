import { useEffect } from 'react'
import { useStore, TASK_VIEWS } from '../state/store'
import { TaskList } from '../components/TaskList'
import { ViewSelector } from '../components/ViewSelector'
import type { ViewOption } from '../components/ViewSelector'

const FILTER_OPTIONS: ViewOption[] = [
  { value: 'active',    label: 'Active' },
  { value: 'today',     label: 'Today' },
  { value: 'backlog',   label: 'Backlog' },
  { value: 'blocked',   label: 'Blocked' },
  { value: 'review',    label: 'Review' },
  { value: 'deep-work', label: 'Deep Work' },
  { value: 'stale',     label: 'Stale' },
]

export function TasksView() {
  const { tasks, selectedView, setSelectedView } = useStore()

  // Arriving here via the "Tasks" nav tab sets selectedView to 'tasks', which
  // has no ?view= filter. Default to 'active' so the filter strip and the
  // displayed list are always in sync.
  useEffect(() => {
    if (!TASK_VIEWS.has(selectedView)) {
      setSelectedView('active')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilter = TASK_VIEWS.has(selectedView) ? selectedView : 'active'

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none border-b border-border px-6 py-3">
        <ViewSelector
          views={FILTER_OPTIONS}
          selectedView={activeFilter}
          onChange={setSelectedView}
        />
      </div>

      <div className="flex-1 overflow-hidden px-6 py-4">
        <TaskList
          tasks={tasks}
          emptyMessage={`No ${activeFilter} tasks`}
          className="h-full"
        />
      </div>
    </div>
  )
}
