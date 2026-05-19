import { cn } from '@/lib/utils'
import type { Task } from '../state/api'

const STATE_STYLES: Record<string, string> = {
  active: 'bg-green-950 text-green-400 border border-green-900',
  blocked: 'bg-red-950 text-red-400 border border-red-900',
  review: 'bg-yellow-950 text-yellow-400 border border-yellow-900',
  backlog: 'bg-accent text-muted-foreground border border-border',
  done: 'bg-muted text-muted-foreground border border-border',
}

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-primary',
  high: 'bg-orange-500',
  normal: 'bg-muted-foreground',
  low: 'bg-muted-foreground/40',
}

interface TaskCardProps {
  task: Task
  onClick?: () => void
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const stateClass = STATE_STYLES[task.state] ?? STATE_STYLES.backlog
  const dotClass = PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      className={cn(
        'group rounded-lg border border-border bg-card p-3 transition-colors',
        onClick && 'cursor-pointer hover:border-accent hover:bg-accent/40',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', dotClass)}
          aria-label={`Priority: ${task.priority}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug truncate">{task.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded-sm', stateClass)}>
              {task.state}
            </span>
            {task.energy && (
              <span className="font-mono text-xs text-muted-foreground">{task.energy}</span>
            )}
            {task.effort && (
              <span className="font-mono text-xs text-muted-foreground">{task.effort}</span>
            )}
            {task.blocked_by.length > 0 && (
              <span className="font-mono text-xs text-red-400">
                blocked by {task.blocked_by.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
