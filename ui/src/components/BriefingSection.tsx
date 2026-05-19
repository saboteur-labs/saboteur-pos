import { cn } from '@/lib/utils'

interface BriefingSectionProps {
  title: string
  count?: number
  children: React.ReactNode
  className?: string
}

export function BriefingSection({ title, count, children, className }: BriefingSectionProps) {
  return (
    <section className={cn('border-l-[3px] border-l-primary pl-4 py-1', className)}>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="font-mono text-xs tracking-label uppercase text-muted-foreground">
          {title}
        </h2>
        {count !== undefined && (
          <span className="font-mono text-xs text-muted-foreground">({count})</span>
        )}
      </div>
      <div>{children}</div>
    </section>
  )
}
