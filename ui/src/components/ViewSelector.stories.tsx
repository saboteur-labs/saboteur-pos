import type { Meta, StoryObj } from '@storybook/react'
import { ViewSelector } from './ViewSelector'

const NAV_VIEWS = [
  { value: 'briefing', label: 'Briefing' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'notes', label: 'Notes' },
]

const TASK_VIEWS = [
  { value: 'active', label: 'Active' },
  { value: 'today', label: 'Today' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'Review' },
  { value: 'deep-work', label: 'Deep Work' },
  { value: 'stale', label: 'Stale' },
]

const meta = {
  title: 'Components/ViewSelector',
  component: ViewSelector,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  args: {
    onChange: () => {},
  },
  argTypes: {
    onChange: { action: 'changed' },
  },
} satisfies Meta<typeof ViewSelector>

export default meta
type Story = StoryObj<typeof meta>

export const MainNav: Story = {
  args: { views: NAV_VIEWS, selectedView: 'briefing' },
}

export const MainNavTasksSelected: Story = {
  args: { views: NAV_VIEWS, selectedView: 'tasks' },
}

export const TaskFilter: Story = {
  args: { views: TASK_VIEWS, selectedView: 'active' },
}

export const TaskFilterBlocked: Story = {
  args: { views: TASK_VIEWS, selectedView: 'blocked' },
}
