import { ScrollArea } from '@/components/ui/scroll-area'
import { BriefingSection } from '../components/BriefingSection'
import { TaskCard } from '../components/TaskCard'
import { EmptyState } from '../components/EmptyState'
import { useStore } from '../state/store'
import type { Task } from '../state/api'

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

function TaskRows({ tasks }: { tasks: Task[] }) {
  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
        <li key={t.id}>
          <TaskCard task={t} />
        </li>
      ))}
    </ul>
  )
}

export function BriefingView() {
  const { briefing } = useStore()

  if (!briefing) {
    return <EmptyState message="Loading…" />
  }

  const {
    inboxTaskCount,
    inboxNoteCount,
    activeContext,
    contextName,
    activeTasks,
    staleTasks,
    blockedTasks,
    reviewTasks,
    yesterdayNotes,
  } = briefing

  const hasOptionalContent =
    inboxTaskCount > 0 ||
    inboxNoteCount > 0 ||
    activeTasks.length > 0 ||
    staleTasks.length > 0 ||
    blockedTasks.length > 0 ||
    reviewTasks.length > 0 ||
    yesterdayNotes.length > 0

  return (
    <ScrollArea className="h-full">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">

        {/* §1 Inbox — omit if both counts are 0 */}
        {(inboxTaskCount > 0 || inboxNoteCount > 0) && (
          <BriefingSection title="Inbox">
            <p className="font-mono text-sm text-foreground">
              {inboxTaskCount} unsorted task{inboxTaskCount !== 1 ? 's' : ''}
              {', '}
              {inboxNoteCount} unsorted note{inboxNoteCount !== 1 ? 's' : ''}
            </p>
          </BriefingSection>
        )}

        {/* §2 Active Context — always shown */}
        <BriefingSection title="Active Context">
          <p className="font-mono text-sm">
            <span className="text-primary">{activeContext}</span>
            <span className="text-muted-foreground"> ({contextName})</span>
          </p>
        </BriefingSection>

        {/* §3 Active Tasks — always shown, stale tasks excluded */}
        <BriefingSection title="Active Tasks" count={activeTasks.length}>
          {activeTasks.length === 0
            ? <p className="font-mono text-xs text-muted-foreground">(none)</p>
            : <TaskRows tasks={activeTasks} />}
        </BriefingSection>

        {/* §4 Stale Tasks — omit if empty */}
        {staleTasks.length > 0 && (
          <BriefingSection title="Stale Tasks" count={staleTasks.length}>
            <ul className="space-y-2">
              {staleTasks.map((t) => (
                <li key={t.id} className="flex items-baseline gap-3 font-mono text-sm">
                  <span className="text-muted-foreground shrink-0 text-xs">{t.id}</span>
                  <span className="text-amber-400 flex-1 truncate">{t.title}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {daysSince(t.updated_at)}d
                  </span>
                </li>
              ))}
            </ul>
          </BriefingSection>
        )}

        {/* §5 Blocked Tasks — omit if empty */}
        {blockedTasks.length > 0 && (
          <BriefingSection title="Blocked Tasks" count={blockedTasks.length}>
            <TaskRows tasks={blockedTasks} />
          </BriefingSection>
        )}

        {/* §6 In Review — omit if empty */}
        {reviewTasks.length > 0 && (
          <BriefingSection title="In Review" count={reviewTasks.length}>
            <TaskRows tasks={reviewTasks} />
          </BriefingSection>
        )}

        {/* §7 Yesterday's Notes — omit if empty */}
        {yesterdayNotes.length > 0 && (
          <BriefingSection title="Yesterday's Notes" count={yesterdayNotes.length}>
            <ul className="space-y-1.5">
              {yesterdayNotes.map((n) => (
                <li key={n.id} className="flex items-baseline gap-3 font-mono text-sm">
                  <span className="text-muted-foreground shrink-0 text-xs">{n.id}</span>
                  <span className="text-foreground flex-1 truncate">
                    {n.title ?? '(untitled)'}
                  </span>
                  {n.task_title && (
                    <span className="text-primary shrink-0 text-xs">→ {n.task_title}</span>
                  )}
                </li>
              ))}
            </ul>
          </BriefingSection>
        )}

        {/* Empty briefing — all optional sections empty */}
        {!hasOptionalContent && (
          <p className="font-mono text-sm text-muted-foreground">
            Nothing active in {activeContext}. Check your inbox or backlog.
          </p>
        )}

      </div>
    </ScrollArea>
  )
}
