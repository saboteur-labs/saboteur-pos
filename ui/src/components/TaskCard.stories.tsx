import type { Meta, StoryObj } from '@storybook/react'
import type { Task } from '../state/api'
import { TaskCard } from './TaskCard'

const base: Task = {
  id: 'task_001',
  title: 'Build read-only UI server',
  state: 'active',
  context_id: 'personal',
  priority: 'high',
  energy: 'deep',
  effort: 'm',
  blocks: [],
  blocked_by: [],
  note_id: null,
  repo: null,
  branch: null,
  state_history: [{ state: 'backlog', timestamp: '2026-05-01T10:00:00Z' }],
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-19T08:00:00Z',
}

const meta = {
  title: 'Components/TaskCard',
  component: TaskCard,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  argTypes: { onClick: { action: 'clicked' } },
} satisfies Meta<typeof TaskCard>

export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {
  args: { task: base },
}

export const Backlog: Story = {
  args: { task: { ...base, state: 'backlog', priority: 'normal', energy: null, effort: null } },
}

export const Blocked: Story = {
  args: {
    task: {
      ...base,
      state: 'blocked',
      priority: 'critical',
      blocked_by: ['task_002'],
    },
  },
}

export const InReview: Story = {
  args: { task: { ...base, state: 'review', priority: 'high', energy: 'shallow' } },
}

export const Critical: Story = {
  args: { task: { ...base, priority: 'critical', effort: 'l' } },
}

export const Clickable: Story = {
  args: { task: base, onClick: () => {} },
}
