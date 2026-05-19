import type { Meta, StoryObj } from '@storybook/react'
import { BriefingSection } from './BriefingSection'

const meta = {
  title: 'Components/BriefingSection',
  component: BriefingSection,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof BriefingSection>

export default meta
type Story = StoryObj<typeof meta>

export const WithContent: Story = {
  args: {
    title: 'Active Tasks',
    count: 3,
    children: (
      <ul className="space-y-1 text-sm text-foreground font-mono">
        <li>Build read-only UI server</li>
        <li>Write Storybook stories</li>
        <li>Wire Zustand store</li>
      </ul>
    ),
  },
}

export const InboxAlert: Story = {
  args: {
    title: 'Inbox',
    count: 5,
    children: (
      <p className="text-sm text-muted-foreground font-mono">5 tasks need triage</p>
    ),
  },
}

export const NoCount: Story = {
  args: {
    title: 'Yesterday\'s Notes',
    children: (
      <p className="text-sm text-muted-foreground font-mono">Architecture decisions · 2 notes</p>
    ),
  },
}
