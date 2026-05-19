import type { Meta, StoryObj } from '@storybook/react'
import type { Note } from '../state/api'
import { NoteCard } from './NoteCard'

const base: Note = {
  id: 'note_001',
  source_id: 'personal-notes',
  type: 'note',
  title: 'Architecture decisions',
  tags: ['architecture', 'design'],
  task_id: null,
  context_id: 'personal',
  path: '/notes/architecture.md',
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-19T08:00:00Z',
}

const meta = {
  title: 'Components/NoteCard',
  component: NoteCard,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  argTypes: { onClick: { action: 'clicked' } },
} satisfies Meta<typeof NoteCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { note: base },
}

export const Selected: Story = {
  args: { note: base, selected: true },
}

export const NoTags: Story = {
  args: { note: { ...base, tags: [], title: 'Quick scratch note' } },
}

export const Untitled: Story = {
  args: { note: { ...base, title: null, tags: ['scratch'] } },
}
