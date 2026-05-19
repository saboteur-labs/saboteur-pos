import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          black: 'var(--color-brand-black)',
          white: 'var(--color-brand-white)',
          red: 'var(--color-brand-red)',
          mid: 'var(--color-brand-mid)',
          dim: 'var(--color-brand-dim)',
          rule: 'var(--color-brand-rule)',
          surface: 'var(--color-brand-surface)',
          surface2: 'var(--color-brand-surface2)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
        serif: ['var(--font-serif)'],
      },
      letterSpacing: {
        wordmark: 'var(--tracking-wordmark)',
        display: 'var(--tracking-display)',
        heading: 'var(--tracking-heading)',
        body: 'var(--tracking-body)',
        label: 'var(--tracking-label)',
        'label-wide': 'var(--tracking-label-wide)',
        'label-xl': 'var(--tracking-label-xl)',
        micro: 'var(--tracking-micro)',
      },
      lineHeight: {
        tight: 'var(--leading-tight)',
        snug: 'var(--leading-snug)',
        normal: 'var(--leading-normal)',
        relaxed: 'var(--leading-relaxed)',
        editorial: 'var(--leading-editorial)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      borderWidth: {
        hairline: 'var(--border-width-hairline)',
        thin: 'var(--border-width-thin)',
        bar: 'var(--border-width-bar)',
        mark: 'var(--border-width-mark)',
      },
    },
  },
  plugins: [],
} satisfies Config
