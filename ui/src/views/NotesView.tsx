import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { fetchNoteDetail } from '../state/api'
import { NoteList } from '../components/NoteList'
import { NoteBody } from '../components/NoteBody'
import { EmptyState } from '../components/EmptyState'
import type { NoteDetail } from '../state/api'

export function NotesView() {
  const { notes, selectedNoteId, setSelectedNoteId } = useStore()
  const [detail, setDetail] = useState<NoteDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedNoteId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchNoteDetail(selectedNoteId)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch(() => { if (!cancelled) setDetail(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedNoteId])

  return (
    <div className="flex h-full">
      {/* Left pane — note list */}
      <aside className="w-72 flex-none border-r border-border overflow-hidden">
        <NoteList
          notes={notes}
          selectedId={selectedNoteId}
          emptyMessage="No notes found"
          onNoteClick={(note) => setSelectedNoteId(note.id)}
          className="h-full"
        />
      </aside>

      {/* Right pane — note body */}
      <main className="flex-1 overflow-hidden">
        {!selectedNoteId && (
          <EmptyState message="Select a note to read" />
        )}
        {selectedNoteId && loading && (
          <EmptyState message="Loading…" />
        )}
        {selectedNoteId && !loading && detail && (
          <NoteBody
            note={detail}
            notes={notes}
            onLinkClick={setSelectedNoteId}
            className="h-full"
          />
        )}
        {selectedNoteId && !loading && !detail && (
          <EmptyState message="Note could not be loaded" />
        )}
      </main>
    </div>
  )
}
