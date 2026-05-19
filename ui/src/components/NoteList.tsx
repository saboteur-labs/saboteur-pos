import { ScrollArea } from '@/components/ui/scroll-area'
import type { Note } from '../state/api'
import { NoteCard } from './NoteCard'
import { EmptyState } from './EmptyState'

interface NoteListProps {
  notes: Note[]
  selectedId?: string | null
  emptyMessage?: string
  onNoteClick?: (note: Note) => void
  className?: string
}

export function NoteList({
  notes,
  selectedId,
  emptyMessage = 'No notes found',
  onNoteClick,
  className,
}: NoteListProps) {
  if (notes.length === 0) {
    return <EmptyState message={emptyMessage} />
  }

  return (
    <ScrollArea className={className}>
      <ul className="space-y-1.5 p-1">
        {notes.map((note) => (
          <li key={note.id}>
            <NoteCard
              note={note}
              selected={note.id === selectedId}
              onClick={onNoteClick ? () => onNoteClick(note) : undefined}
            />
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}
