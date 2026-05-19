import { cn } from '@/lib/utils'
import type { Note } from '../state/api'

interface NoteCardProps {
  note: Note
  selected?: boolean
  onClick?: () => void
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function NoteCard({ note, selected = false, onClick }: NoteCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={cn(
        'rounded-md border px-3 py-2.5 cursor-pointer transition-colors',
        selected
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-card hover:border-accent hover:bg-accent/40 text-foreground',
      )}
    >
      <p className="text-sm font-medium leading-snug truncate">
        {note.title ?? <span className="text-muted-foreground italic">Untitled</span>}
      </p>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        {note.updated_at && (
          <span className="font-mono text-xs text-muted-foreground">
            {formatDate(note.updated_at)}
          </span>
        )}
        {note.tags.map((tag) => (
          <span
            key={tag}
            className="font-mono text-xs px-1.5 py-0.5 rounded-sm bg-accent text-muted-foreground border border-border"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}
