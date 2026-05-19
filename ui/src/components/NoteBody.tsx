import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { WikiLink } from './WikiLink'
import type { Note, NoteDetail } from '../state/api'

// Matches LOGIC.md §6 slug generation.
function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function resolveLink(
  slug: string,
  notes: Note[],
): { exists: boolean; id: string | null } {
  const byId = notes.find((n) => n.id === slug)
  if (byId) return { exists: true, id: byId.id }

  const bySlug = notes.find((n) => n.title !== null && slugify(n.title) === slug)
  if (bySlug) return { exists: true, id: bySlug.id }

  return { exists: false, id: null }
}

function renderBody(
  body: string,
  notes: Note[],
  onLinkClick: (id: string) => void,
): React.ReactNode {
  const segments: React.ReactNode[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let last = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(body)) !== null) {
    if (match.index > last) {
      segments.push(<span key={key++}>{body.slice(last, match.index)}</span>)
    }

    const slug = match[1]
    const { exists, id } = resolveLink(slug, notes)
    segments.push(
      <WikiLink
        key={key++}
        slug={slug}
        exists={exists}
        onClick={exists && id ? () => onLinkClick(id) : undefined}
      />,
    )
    last = match.index + match[0].length
  }

  if (last < body.length) {
    segments.push(<span key={key++}>{body.slice(last)}</span>)
  }

  return segments
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface NoteBodyProps {
  note: NoteDetail
  notes: Note[]
  onLinkClick: (id: string) => void
  className?: string
}

export function NoteBody({ note, notes, onLinkClick, className }: NoteBodyProps) {
  return (
    <ScrollArea className={className ?? 'h-full'}>
      <div className="px-8 py-6 max-w-2xl">
        {/* Header */}
        <h2 className="font-display text-xl font-bold tracking-heading mb-2">
          {note.title ?? <span className="text-muted-foreground italic">Untitled</span>}
        </h2>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground mb-1">
          {note.updated_at && <span>{formatDate(note.updated_at)}</span>}
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded-sm bg-accent border border-border"
            >
              {tag}
            </span>
          ))}
        </div>

        <Separator className="my-4" />

        {/* Body */}
        <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
          {note.body
            ? renderBody(note.body, notes, onLinkClick)
            : <span className="text-muted-foreground italic">No content.</span>}
        </div>
      </div>
    </ScrollArea>
  )
}
