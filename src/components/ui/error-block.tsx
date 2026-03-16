import { cn } from '../../lib/utils'

interface ErrorBlockProps {
  message: string
  action?: React.ReactNode
  className?: string
}

/** Consistent error block: message + optional action. */
export function ErrorBlock({ message, action, className }: ErrorBlockProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3',
        className
      )}
      role="alert"
    >
      <p className="flex-1 text-sm text-destructive">{message}</p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
