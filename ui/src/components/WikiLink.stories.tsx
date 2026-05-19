import type { Meta, StoryObj } from '@storybook/react'
import { WikiLink } from './WikiLink'

const meta = {
  title: 'Components/WikiLink',
  component: WikiLink,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    exists: { control: 'boolean' },
    onClick: { action: 'clicked' },
  },
} satisfies Meta<typeof WikiLink>

export default meta
type Story = StoryObj<typeof meta>

export const Exists: Story = {
  args: { slug: 'architecture-decisions', exists: true },
}

export const Broken: Story = {
  args: { slug: 'missing-note', exists: false },
}
