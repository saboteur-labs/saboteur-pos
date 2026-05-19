import type { Meta, StoryObj } from '@storybook/react'
import type { Note } from '../state/api'
import { NoteList } from './NoteList'

const make = (overrides: Partial<Note> & { id: string; title: string }): Note => ({
  source_id: 'personal-notes',
  type: 'note',
  tags: [],
  task_id: null,
  context_id: 'personal',
  path: `/notes/${overrides.id}.md`,
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-19T08:00:00Z',
  ...overrides,
})

const notes: Note[] = [
  make({ id: 'note_001', title: 'Architecture decisions', tags: ['architecture', 'design'] }),
  make({ id: 'note_002', title: 'Sprint retro notes', tags: ['retro'] }),
  make({ id: 'note_003', title: 'API design sketch', tags: ['api', 'design'] }),
  make({ id: 'note_004', title: 'Quick scratch', tags: [] }),
]

const meta = {
  title: 'Components/NoteList',
  component: NoteList,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  argTypes: { onNoteClick: { action: 'noteClicked' } },
} satisfies Meta<typeof NoteList>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  args: { notes },
}

export const WithSelection: Story = {
  args: { notes, selectedId: 'note_002' },
}

export const Empty: Story = {
  args: { notes: [] },
}

export const EmptyCustomMessage: Story = {
  args: { notes: [], emptyMessage: 'No notes in this context' },
}
