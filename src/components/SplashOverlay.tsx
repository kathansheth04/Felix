import { cn } from '../lib/utils'

type SplashPhase = 'intro' | 'outro'

export function SplashOverlay({
  phase,
  variant = 'full',
  hint,
  className,
}: {
  phase: SplashPhase
  variant?: 'full' | 'brief'
  hint?: string
  className?: string
}) {
  const isOutro = phase === 'outro'
  const isBrief = variant === 'brief'

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center bg-splash',
        'pointer-events-none select-none',
        isOutro ? (isBrief ? 'animate-felix-splash-out-brief' : 'animate-felix-splash-out') : 'opacity-100',
        className
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className={cn(
            'text-[40px] leading-none font-semibold tracking-tight text-foreground',
            'drop-shadow-[0_0_24px_hsl(214_50%_52%_/_0.10)]',
            isOutro
              ? (isBrief ? 'animate-felix-mark-out-brief motion-reduce:animate-none' : 'animate-felix-mark-out motion-reduce:animate-none')
              : (isBrief ? 'animate-felix-mark-in-brief motion-reduce:animate-none' : 'animate-felix-mark-in motion-reduce:animate-none')
          )}
          aria-hidden="true"
        >
          Felix
        </div>
        {hint ? (
          <div className="text-xs text-muted-foreground animate-felix-splash-hint-in motion-reduce:animate-none">
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  )
}

