import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './button'

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: 'Button' },
}

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
}

export const Outline: Story = {
  args: { children: 'Button', variant: 'outline' },
}

export const Secondary: Story = {
  args: { children: 'Button', variant: 'secondary' },
}

export const Ghost: Story = {
  args: { children: 'Button', variant: 'ghost' },
}

export const Link: Story = {
  args: { children: 'Button', variant: 'link' },
}

export const Disabled: Story = {
  args: { children: 'Button', disabled: true },
}

export const Small: Story = {
  args: { children: 'Button', size: 'sm' },
}

export const Large: Story = {
  args: { children: 'Button', size: 'lg' },
}
