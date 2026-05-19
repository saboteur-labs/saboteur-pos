import { cn } from '@/lib/utils'

export interface ViewOption {
  value: string
  label: string
}

interface ViewSelectorProps {
  views: ViewOption[]
  selectedView: string
  onChange: (view: string) => void
  className?: string
}

export function ViewSelector({ views, selectedView, onChange, className }: ViewSelectorProps) {
  return (
    <nav
      className={cn('flex items-center gap-1 flex-wrap', className)}
      role="tablist"
      aria-label="View selector"
    >
      {views.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={selectedView === value}
          onClick={() => onChange(value)}
          className={cn(
            'font-mono text-xs px-3 py-1.5 rounded-sm transition-colors whitespace-nowrap tracking-label uppercase',
            selectedView === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
