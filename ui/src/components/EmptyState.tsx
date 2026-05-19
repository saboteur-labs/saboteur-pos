interface EmptyStateProps {
  message: string
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <p className="font-mono text-xs tracking-label text-muted-foreground uppercase">{message}</p>
    </div>
  )
}
