import { useStore } from '../state/store'
import { ViewSelector } from './ViewSelector'
import type { ViewOption } from './ViewSelector'

const NAV_OPTIONS: ViewOption[] = [
  { value: 'briefing', label: 'Briefing' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'notes', label: 'Notes' },
]

// All task-filter views map to the "Tasks" nav tab.
function activeNavTab(selectedView: string): string {
  if (selectedView === 'briefing' || selectedView === 'notes') return selectedView
  return 'tasks'
}

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const { selectedView, setSelectedView, briefing } = useStore()

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <header className="flex-none border-b border-border px-6 py-3 flex items-center gap-6">
        <div className="flex items-baseline gap-3 shrink-0">
          <span className="font-display text-base font-bold tracking-display uppercase">
            Saboteur
          </span>
          {briefing?.contextName && (
            <span className="font-mono text-xs tracking-label text-muted-foreground uppercase">
              {briefing.contextName}
            </span>
          )}
        </div>
        <ViewSelector
          views={NAV_OPTIONS}
          selectedView={activeNavTab(selectedView)}
          onChange={setSelectedView}
        />
      </header>

      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
