import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { KanbanColumn } from './KanbanColumn'
import { TicketCard } from './TicketCard'
import { TicketDialog } from '../tickets/TicketDialog'
import { PlanReviewDialog } from '../plans/PlanReviewDialog'
import { PlanQuestionDialog } from '../plans/PlanQuestionDialog'
import type { Ticket, Project, TicketStatus, PlanQuestionEvent, KanbanColumn as KanbanColumnType } from '../../types'
import { BOARD_COLUMNS, HUMAN_TRANSITIONS } from '../../types'
import { Plus } from 'lucide-react'
import { useToast } from '../ui/use-toast'
import { Button } from '../ui/button'

interface KanbanBoardProps {
  project: Project | null
  ticketVersion: number
  onNoProject: () => void
  onViewLogs: (ticketId: string) => void
}

export function KanbanBoard({ project, ticketVersion, onNoProject, onViewLogs }: KanbanBoardProps) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [planningTicketIds, setPlanningTicketIds] = useState<Set<string>>(new Set())
  const [implementingTicketIds, setImplementingTicketIds] = useState<Set<string>>(new Set())
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null)
  const [reviewingPlan, setReviewingPlan] = useState<Ticket | null>(null)
  const [pendingPlanQuestion, setPendingPlanQuestion] = useState<{
    ticket_id: string
    questions: Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiSelect?: boolean
    }>
  } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const loadExecutionPhases = useCallback(async () => {
    if (!project) return
    try {
      const execs = await window.api.listExecutions({ project_id: project.id })
      const planning = new Set(
        execs
          .filter((e) => e.status === 'IN_PROGRESS' && e.mode === 'PLANNING')
          .map((e) => e.ticket_id)
      )
      const implementing = new Set(
        execs
          .filter((e) => e.status === 'IN_PROGRESS' && (e.mode === 'IMPLEMENTATION' || e.mode === 'REVISION'))
          .map((e) => e.ticket_id)
      )
      setPlanningTicketIds(planning)
      setImplementingTicketIds(implementing)
    } catch {
      /* ignore */
    }
  }, [project])

  useEffect(() => {
    loadExecutionPhases()
  }, [loadExecutionPhases])

  useEffect(() => {
    if (!project) return
    const unsubPlanStart =
      typeof window.api.onPlanningStarted === 'function'
        ? window.api.onPlanningStarted((d) => setPlanningTicketIds((s) => new Set(s).add(d.ticket_id)))
        : () => {}
    const unsubPlanEnd =
      typeof window.api.onPlanningEnded === 'function'
        ? window.api.onPlanningEnded((d) =>
            setPlanningTicketIds((s) => {
              const next = new Set(s)
              next.delete(d.ticket_id)
              return next
            })
          )
        : () => {}
    const unsubImplStart =
      typeof window.api.onImplementationStarted === 'function'
        ? window.api.onImplementationStarted((d) => setImplementingTicketIds((s) => new Set(s).add(d.ticket_id)))
        : () => {}
    const unsubImplEnd =
      typeof window.api.onImplementationEnded === 'function'
        ? window.api.onImplementationEnded((d) =>
            setImplementingTicketIds((s) => {
              const next = new Set(s)
              next.delete(d.ticket_id)
              return next
            })
          )
        : () => {}
    const unsubPlanQuestion =
      typeof window.api.onPlanQuestion === 'function'
        ? window.api.onPlanQuestion((d: PlanQuestionEvent) =>
            setPendingPlanQuestion({ ticket_id: d.ticket_id, questions: d.questions })
          )
        : () => {}
    return () => {
      unsubPlanStart()
      unsubPlanEnd()
      unsubImplStart()
      unsubImplEnd()
      unsubPlanQuestion()
    }
  }, [project])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const loadTickets = useCallback(async () => {
    if (!project) return
    setLoading(true)
    try {
      const data = await window.api.listTickets({ project_id: project.id })
      setTickets(data)
    } catch (err) {
      console.error('Failed to load tickets', err)
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    loadTickets()
  }, [loadTickets, ticketVersion])

  const columns: KanbanColumnType[] = BOARD_COLUMNS.map((col) => ({
    ...col,
    tickets: tickets.filter((t) => {
      if (col.id === 'IN_PROGRESS') return t.status === 'IN_PROGRESS' || t.status === 'QUEUED' || t.status === 'PLAN_REVIEW'
      return t.status === col.id
    })
  }))

  function getColumnIdForTicket(ticket: Ticket): TicketStatus {
    if (ticket.status === 'IN_PROGRESS' || ticket.status === 'QUEUED' || ticket.status === 'PLAN_REVIEW') return 'IN_PROGRESS'
    return ticket.status
  }

  function handleDragStart(event: DragStartEvent) {
    const ticket = tickets.find((t) => t.id === event.active.id)
    setActiveTicket(ticket ?? null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTicket(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const ticket = tickets.find((t) => t.id === active.id)
    if (!ticket) return

    // Resolve target column: over.id may be column ID or a ticket ID in the target column
    let targetColumn = BOARD_COLUMNS.find((c) => c.id === over.id)
    if (!targetColumn) {
      const targetTicket = tickets.find((t) => t.id === over.id)
      if (targetTicket) targetColumn = BOARD_COLUMNS.find((c) => c.id === getColumnIdForTicket(targetTicket))
    }
    if (!targetColumn) return

    const newStatus = targetColumn.id as TicketStatus

    // Validate human transition
    const allowed = HUMAN_TRANSITIONS[ticket.status]
    if (!allowed?.includes(newStatus)) {
      toast({
        title: 'Transition not allowed',
        description: `Cannot move "${ticket.title}" to ${targetColumn.label} from ${ticket.status}.`,
        variant: 'destructive'
      })
      return
    }

    try {
      const updated = await window.api.moveTicket({ ticket_id: ticket.id, new_status: newStatus })
      setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    } catch (err: unknown) {
      toast({ title: 'Failed to move ticket', description: 'Please try again.', variant: 'destructive' })
    }
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground text-sm">No project configured.</p>
        <button
          onClick={onNoProject}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Set up a project →
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar — Jira-style header */}
      <div className="flex items-center justify-between h-10 px-5 border-b border-border/50 shrink-0 bg-background">
        <span className="text-xs text-muted-foreground tabular-nums">
          {tickets.length} issue{tickets.length !== 1 ? 's' : ''}
          {loading && <span className="animate-pulse"> · loading…</span>}
        </span>
        <Button size="sm" onClick={() => setIsCreating(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create
        </Button>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden bg-muted/20 scroll-smooth">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 h-full p-4 min-w-max">
            {columns.map((col) => (
              <KanbanColumn
                key={col.id}
                column={col}
                activeTicket={activeTicket}
                planningTicketIds={planningTicketIds}
                implementingTicketIds={implementingTicketIds}
                onTicketClick={(ticket) => setEditingTicket(ticket)}
                onViewPlan={(ticket) => setReviewingPlan(ticket)}
                onEditTicket={(ticket) => setEditingTicket(ticket)}
                onViewLogs={onViewLogs}
                onMoveTicket={async (ticket, newStatus) => {
                  try {
                    const updated = await window.api.moveTicket({ ticket_id: ticket.id, new_status: newStatus })
                    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
                  } catch (err: unknown) {
                    toast({ title: 'Failed to move ticket', description: 'Please try again.', variant: 'destructive' })
                  }
                }}
                onApprovePlan={async (ticket) => {
                  try {
                    const updated = await window.api.approvePlan({ ticket_id: ticket.id })
                    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
                    toast({ title: 'Plan approved', description: 'Implementation starting…' })
                  } catch (err: unknown) {
                    toast({ title: 'Failed to approve plan', description: 'Please try again.', variant: 'destructive' })
                  }
                }}
              />
            ))}
          </div>

          <DragOverlay>
            {activeTicket ? (
              <TicketCard
                ticket={activeTicket}
                isPlanning={planningTicketIds.has(activeTicket.id)}
                isImplementing={implementingTicketIds.has(activeTicket.id)}
                isDragging
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Create dialog */}
      {isCreating && (
        <TicketDialog
          projectId={project.id}
          onClose={() => setIsCreating(false)}
          onSaved={async (ticket) => {
            setTickets((prev) => [...prev, ticket])
            setIsCreating(false)
          }}
        />
      )}

      {/* Edit dialog */}
      {editingTicket && (
        <TicketDialog
          projectId={project.id}
          ticket={editingTicket}
          onClose={() => setEditingTicket(null)}
          onSaved={(ticket) => {
            setTickets((prev) => prev.map((t) => (t.id === ticket.id ? ticket : t)))
            setEditingTicket(null)
          }}
          onDeleted={(ticketId) => {
            setTickets((prev) => prev.filter((t) => t.id !== ticketId))
            setEditingTicket(null)
          }}
        />
      )}

      {/* Plan review dialog */}
      {reviewingPlan && (
        <PlanReviewDialog
          ticket={reviewingPlan}
          isPlanning={planningTicketIds.has(reviewingPlan.id)}
          onClose={() => setReviewingPlan(null)}
          onEdit={() => { setReviewingPlan(null); setEditingTicket(reviewingPlan) }}
          onFeedbackSubmitted={(ticketId) => {
            setPlanningTicketIds((prev) => new Set(prev).add(ticketId))
          }}
          onStatusChange={(updatedTicket) => {
            setTickets((prev) => prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t)))
            setReviewingPlan(null)
          }}
        />
      )}

      {/* Claude's clarifying questions during planning */}
      {pendingPlanQuestion && (
        <PlanQuestionDialog
          ticketId={pendingPlanQuestion.ticket_id}
          ticketTitle={tickets.find((t) => t.id === pendingPlanQuestion.ticket_id)?.title}
          questions={pendingPlanQuestion.questions}
          onClose={() => setPendingPlanQuestion(null)}
          onCancel={() => {
            window.api.cancelExecution({ ticket_id: pendingPlanQuestion.ticket_id })
            toast({ title: 'Planning cancelled', description: 'You can move the ticket to In Progress again to retry.' })
          }}
          onSubmit={async (answers) => {
            if (typeof window.api.submitPlanAnswer === 'function') {
              await window.api.submitPlanAnswer({
                ticket_id: pendingPlanQuestion.ticket_id,
                answers,
              })
              toast({ title: 'Answers submitted', description: 'Claude will continue planning…' })
            }
          }}
        />
      )}
    </div>
  )
}
