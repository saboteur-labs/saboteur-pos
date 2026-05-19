import { cn } from '@/lib/utils'

interface WikiLinkProps {
  slug: string
  exists: boolean
  onClick?: () => void
}

export function WikiLink({ slug, exists, onClick }: WikiLinkProps) {
  return (
    <button
      type="button"
      onClick={exists ? onClick : undefined}
      disabled={!exists}
      className={cn(
        'font-mono text-sm rounded-sm px-0.5 transition-colors',
        exists
          ? 'text-primary underline underline-offset-2 hover:text-primary/80 cursor-pointer'
          : 'text-muted-foreground line-through cursor-not-allowed opacity-50',
      )}
      aria-label={exists ? `Open note: ${slug}` : `Broken link: ${slug}`}
    >
      {'[['}
      {slug}
      {']]'}
    </button>
  )
}
