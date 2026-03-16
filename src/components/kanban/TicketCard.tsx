import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Ticket, TicketStatus } from '../../types'
import { BLOCKED_REASON_ICON, BLOCKED_REASON_LABEL } from '../../types'
import { cn } from '../../lib/utils'
import { ExternalLink, ScrollText } from 'lucide-react'

type InProgressPhase = 'planning' | 'plan-review' | 'implementing'

interface TicketCardProps {
  ticket: Ticket
  isPlanning?: boolean
  isImplementing?: boolean
  onClick?: () => void
  onViewPlan?: () => void
  onEdit?: () => void
  onApprovePlan?: () => void
  onViewLogs?: () => void
  onTriggerReview?: () => void
  isDragging?: boolean
}

const STATUS_LABEL: Partial<Record<TicketStatus, string>> = {
  QUEUED: 'Queued',
  IN_PROGRESS: 'Running',
  DEV_COMPLETE: 'PR Open',
  IN_REVIEW: 'In Review'
}

export function TicketCard({ ticket, isPlanning = false, isImplementing = false, onClick, onViewPlan, onEdit, onApprovePlan, onViewLogs, onTriggerReview, isDragging = false }: TicketCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging
  } = useSortable({ id: ticket.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  const isBlocked = ticket.status === 'BLOCKED'
  const isQueued = ticket.status === 'QUEUED'
  const isInProgress = ticket.status === 'IN_PROGRESS' || ticket.status === 'PLAN_REVIEW'
  const planReady = (ticket.plan && !ticket.pr_url) || ticket.status === 'PLAN_REVIEW'

  const inProgressPhase: InProgressPhase | null = isInProgress
    ? isPlanning
      ? 'planning'
      : isImplementing
        ? 'implementing'
        : planReady
          ? 'plan-review'
          : 'implementing'
    : null
  const hasActivePR = !!ticket.pr_url && (
    ticket.status === 'DEV_COMPLETE' ||
    ticket.status === 'IN_REVIEW' ||
    ticket.status === 'BLOCKED'
  )
  const prNumber = ticket.pr_number ?? ticket.pr_url?.match(/\/pull\/(\d+)/)?.[1]
  const issueKey = ticket.id.slice(-6).toUpperCase()
  const hasApprove = planReady && onApprovePlan && !isPlanning && !isImplementing

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group rounded border border-border/50 bg-card p-3 cursor-grab active:cursor-grabbing shadow-sm',
        'hover:border-border hover:shadow-lift transition-all duration-200 hover:-translate-y-0.5',
        (isSortableDragging || isDragging) && 'opacity-90 shadow-lg ring-2 ring-primary/40',
        isBlocked && 'border-destructive/30 bg-destructive/10',
        inProgressPhase === 'planning' && 'border-l-2 border-l-violet-500/60',
        inProgressPhase === 'plan-review' && 'border-l-2 border-l-warning/60',
        inProgressPhase === 'implementing' && 'border-l-2 border-l-teal/60'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      {/* Issue key + blocked icon — card click = details */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-mono text-muted-foreground/80" title={ticket.id}>
          {issueKey}
        </span>
        {isBlocked && ticket.blocked_reason && (
          <span className="shrink-0 text-sm leading-none" title={BLOCKED_REASON_LABEL[ticket.blocked_reason] ?? 'Something went wrong'}>
            {BLOCKED_REASON_ICON[ticket.blocked_reason]}
          </span>
        )}
      </div>
      {/* Title row */}
      <div className="flex items-start gap-2">
        <p className="text-sm font-medium leading-snug text-foreground line-clamp-2 flex-1">
          {ticket.title}
        </p>
      </div>

      {/* Blocked reason + View logs when blocked */}
      {isBlocked && ticket.blocked_reason && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-xs text-destructive/90 flex-1 min-w-0">
            {BLOCKED_REASON_LABEL[ticket.blocked_reason] ?? 'Something went wrong'}
          </p>
          {onViewLogs && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewLogs() }}
              className="shrink-0 text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1"
            >
              <ScrollText className="h-3 w-3" />
              Logs
            </button>
          )}
        </div>
      )}

      {/* Status badges — Queued and static labels only */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {isQueued && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-0.5 text-xs font-semibold text-muted-foreground tracking-wide">
            <span className="h-1 w-1 rounded-full bg-muted-foreground/70 animate-status-pulse" />
            QUEUED
          </span>
        )}
        {STATUS_LABEL[ticket.status] && !isQueued && !isInProgress && (
          <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-medium text-muted-foreground border border-border/50">
            {STATUS_LABEL[ticket.status]}
          </span>
        )}
      </div>

      {/* Bottom row — badges + PR (left) + Implement / Review (right) */}
      {(isInProgress && inProgressPhase) || hasActivePR || (!isDragging && (hasApprove || (ticket.status === 'DEV_COMPLETE' && onTriggerReview))) ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            {isInProgress && inProgressPhase === 'planning' && (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide border bg-violet-500/15 text-violet-400 border-violet-500/25">
                <span className="h-1.5 w-1.5 rounded-full animate-status-pulse bg-current" />
                Planning
              </span>
            )}
            {isInProgress && inProgressPhase === 'plan-review' && onViewPlan && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewPlan() }}
                className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide border bg-warning/15 text-warning border-warning/25 hover:bg-warning/25 transition-colors"
              >
                View plan
              </button>
            )}
            {isInProgress && inProgressPhase === 'implementing' && (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide border bg-teal/15 text-teal border-teal/25">
                <span className="h-1.5 w-1.5 rounded-full animate-status-pulse bg-current" />
                Implementing
              </span>
            )}
            {hasActivePR && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  window.open(ticket.pr_url!, '_blank')
                }}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/90 transition-colors shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                PR #{prNumber}
              </a>
            )}
          </div>
          {!isDragging && hasApprove && (
            <button
              onClick={(e) => { e.stopPropagation(); onApprovePlan!() }}
              className="shrink-0 text-xs font-medium text-primary hover:text-primary/80"
            >
              Implement
            </button>
          )}
          {!isDragging && ticket.status === 'DEV_COMPLETE' && onTriggerReview && (
            <button
              onClick={(e) => { e.stopPropagation(); onTriggerReview() }}
              className="shrink-0 text-xs font-medium text-primary hover:text-primary/80"
            >
              Review
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
