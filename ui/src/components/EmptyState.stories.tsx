import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState } from './EmptyState'

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const NoTasks: Story = {
  args: { message: 'No tasks in this view' },
}

export const NoNotes: Story = {
  args: { message: 'No notes found' },
}

export const NothingInInbox: Story = {
  args: { message: 'Inbox is clear' },
}
