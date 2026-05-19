import type { Meta, StoryObj } from '@storybook/react'
import type { Task } from '../state/api'
import { TaskList } from './TaskList'

const make = (overrides: Partial<Task> & { id: string; title: string }): Task => ({
  state: 'active',
  context_id: 'personal',
  priority: 'normal',
  energy: null,
  effort: null,
  blocks: [],
  blocked_by: [],
  note_id: null,
  repo: null,
  branch: null,
  state_history: [],
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-19T08:00:00Z',
  ...overrides,
})

const tasks: Task[] = [
  make({ id: 'task_001', title: 'Build read-only UI server', priority: 'critical', energy: 'deep', effort: 'm' }),
  make({ id: 'task_002', title: 'Wire Zustand store + WebSocket client', priority: 'high', energy: 'deep' }),
  make({ id: 'task_003', title: 'Write Storybook stories', priority: 'normal', energy: 'shallow', effort: 's' }),
  make({ id: 'task_004', title: 'Triage inbox', priority: 'low', energy: 'admin' }),
]

const meta = {
  title: 'Components/TaskList',
  component: TaskList,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  argTypes: { onTaskClick: { action: 'taskClicked' } },
} satisfies Meta<typeof TaskList>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  args: { tasks },
}

export const WithBlocked: Story = {
  args: {
    tasks: [
      ...tasks,
      make({ id: 'task_005', title: 'Waiting on design review', state: 'blocked', priority: 'high', blocked_by: ['task_ext'] }),
    ],
  },
}

export const Empty: Story = {
  args: { tasks: [] },
}

export const EmptyCustomMessage: Story = {
  args: { tasks: [], emptyMessage: 'No deep-work tasks today' },
}
