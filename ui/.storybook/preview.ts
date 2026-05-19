import type { Preview } from '@storybook/react'
import '../src/styles/app.css'

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: 'var(--color-brand-black)' },
        { name: 'surface', value: 'var(--color-brand-surface)' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview
