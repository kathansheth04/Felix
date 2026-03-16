import { cn } from '../../lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  headline: string
  description?: string
  action?: React.ReactNode
  variant?: 'default' | 'hero' | 'minimal'
  className?: string
}

/** Shared empty state: icon (optional), headline, description, primary CTA. */
export function EmptyState({
  icon,
  headline,
  description,
  action,
  variant = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        variant === 'hero' && 'px-8 py-12',
        variant === 'default' && 'px-6 py-8',
        variant === 'minimal' && 'px-4 py-6',
        className
      )}
    >
      {icon && (
        <div className={cn(
          'text-muted-foreground/60',
          variant === 'hero' ? 'mb-4' : 'mb-3'
        )}>
          {icon}
        </div>
      )}
      <h2
        className={cn(
          'font-semibold tracking-tight text-foreground',
          variant === 'hero' && 'text-2xl mb-1',
          variant === 'default' && 'text-sm',
          variant === 'minimal' && 'text-xs'
        )}
      >
        {headline}
      </h2>
      {description && (
        <p
          className={cn(
            'text-muted-foreground leading-relaxed',
            variant === 'hero' && 'text-sm max-w-md mt-2',
            variant === 'default' && 'text-xs max-w-xs mt-1',
            variant === 'minimal' && 'text-xs max-w-[200px] mt-0.5'
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <div className={cn(variant === 'hero' ? 'mt-6' : 'mt-4')}>
          {action}
        </div>
      )}
    </div>
  )
}
