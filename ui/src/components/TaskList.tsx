import { ScrollArea } from '@/components/ui/scroll-area'
import type { Task } from '../state/api'
import { TaskCard } from './TaskCard'
import { EmptyState } from './EmptyState'

interface TaskListProps {
  tasks: Task[]
  emptyMessage?: string
  onTaskClick?: (task: Task) => void
  className?: string
}

export function TaskList({
  tasks,
  emptyMessage = 'No tasks in this view',
  onTaskClick,
  className,
}: TaskListProps) {
  if (tasks.length === 0) {
    return <EmptyState message={emptyMessage} />
  }

  return (
    <ScrollArea className={className}>
      <ul className="space-y-2 p-1">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskCard task={task} onClick={onTaskClick ? () => onTaskClick(task) : undefined} />
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}
