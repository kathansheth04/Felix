import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { TicketCard } from './TicketCard'
import { EmptyState } from '../ui/empty-state'
import type { KanbanColumn as KanbanColumnType, Ticket, TicketStatus } from '../../types'
import { HUMAN_TRANSITIONS } from '../../types'
import { cn } from '../../lib/utils'

/** Column accents — semantic tokens */
const COLUMN_ACCENT: Record<string, string> = {
  TODO: 'bg-muted-foreground/30',
  IN_PROGRESS: 'bg-amber-400/60',
  QUEUED: 'bg-amber-400/60',
  DEV_COMPLETE: 'bg-primary/50',
  IN_REVIEW: 'bg-orange-500/60',
  DONE: 'bg-success/60',
  BLOCKED: 'bg-destructive/60'
}

interface KanbanColumnProps {
  column: KanbanColumnType
  activeTicket?: Ticket | null
  planningTicketIds?: Set<string>
  implementingTicketIds?: Set<string>
  onTicketClick: (ticket: Ticket) => void
  onViewPlan?: (ticket: Ticket) => void
  onEditTicket?: (ticket: Ticket) => void
  onApprovePlan?: (ticket: Ticket) => Promise<void>
  onMoveTicket?: (ticket: Ticket, newStatus: TicketStatus) => Promise<void>
  onViewLogs: (ticketId: string) => void
}

export function KanbanColumn({ column, activeTicket, planningTicketIds = new Set(), implementingTicketIds = new Set(), onTicketClick, onViewPlan, onEditTicket, onApprovePlan, onMoveTicket, onViewLogs }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const ticketIds = column.tickets.map((t) => t.id)
  const accentClass = COLUMN_ACCENT[column.id] ?? 'bg-muted-foreground/30'

  // Highlight only when drop is acceptable per state machine
  const allowed = activeTicket ? HUMAN_TRANSITIONS[activeTicket.status] : undefined
  const isValidDrop = isOver && activeTicket && allowed?.includes(column.id as TicketStatus)

  return (
    <div
      className={cn(
        'flex flex-col w-72 shrink-0 rounded-lg bg-background/95 border border-border/50 overflow-hidden transition-all duration-200',
        isValidDrop && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background'
      )}
    >
      {/* Column header — Jira-style with colored top bar */}
      <div className={cn('shrink-0 border-b border-border/40', accentClass, 'h-2')} />
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0 bg-muted/30 border-b border-border/40">
        <span className="text-xs font-semibold text-foreground/90">
          {column.label}
        </span>
        <span className="text-xs font-medium text-muted-foreground bg-background/80 rounded px-2 py-0.5 tabular-nums">
          {column.tickets.length}
        </span>
      </div>

      {/* Ticket list */}
      <div
        ref={setNodeRef}
        className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-[100px]"
      >
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          {column.tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              isPlanning={planningTicketIds.has(ticket.id)}
              isImplementing={implementingTicketIds.has(ticket.id)}
              onClick={() => onTicketClick(ticket)}
              onViewPlan={onViewPlan && (ticket.status === 'IN_PROGRESS' || ticket.status === 'PLAN_REVIEW' || ticket.status === 'QUEUED') ? () => onViewPlan(ticket) : undefined}
              onEdit={onEditTicket && (ticket.status === 'IN_PROGRESS' || ticket.status === 'PLAN_REVIEW' || ticket.status === 'QUEUED') ? () => onEditTicket(ticket) : undefined}
              onApprovePlan={onApprovePlan ? () => onApprovePlan(ticket) : undefined}
              onTriggerReview={onMoveTicket && ticket.status === 'DEV_COMPLETE' ? () => onMoveTicket(ticket, 'IN_REVIEW') : undefined}
              onViewLogs={() => onViewLogs(ticket.id)}
            />
          ))}
        </SortableContext>

        {column.tickets.length === 0 && (
          <div className="m-2 border-2 border-dashed border-border/40 rounded-lg select-none">
            <EmptyState variant="minimal" headline="Drop here" className="py-4" />
          </div>
        )}
      </div>
    </div>
  )
}
