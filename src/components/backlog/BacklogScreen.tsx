import { useState, useEffect, useCallback } from 'react'
import type { Project, Ticket } from '../../types'
import { TicketDialog } from '../tickets/TicketDialog'
import { ChevronRight, Plus, Inbox } from 'lucide-react'
import { Button } from '../ui/button'
import { useToast } from '../ui/use-toast'
import { cn } from '../../lib/utils'

interface BacklogScreenProps {
  project: Project
  ticketVersion: number
}

export function BacklogScreen({ project, ticketVersion }: BacklogScreenProps) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const loadTickets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.listTickets({ project_id: project.id })
      setTickets(data.filter((t) => t.status === 'BACKLOG'))
    } catch (err) {
      console.error('Failed to load backlog', err)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    loadTickets()
  }, [loadTickets, ticketVersion])

  async function promoteToBoard(ticket: Ticket) {
    try {
      const updated = await window.api.moveTicket({ ticket_id: ticket.id, new_status: 'TODO' })
      setTickets((prev) => prev.filter((t) => t.id !== updated.id))
    } catch (err: unknown) {
      toast({ title: 'Failed to add to board', description: 'Please try again.', variant: 'destructive' })
    }
  }

  return (
    <div className="h-full flex flex-col bg-backlog-gradient">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {tickets.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 animate-fade-in-up">
              <div className="mb-6 rounded-xl bg-muted/30 p-5 border border-border/40">
                <Inbox className="h-11 w-11 text-muted-foreground/60" strokeWidth={1.5} />
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-foreground mb-1.5">
                No tickets yet
              </h3>
              <p className="text-sm text-muted-foreground/80 leading-relaxed mb-6 max-w-xs">
                Dump ideas and tasks here. Add to board when you want to work on them.
              </p>
              <Button size="sm" onClick={() => setIsCreating(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create ticket
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground/80 mb-5">
                Dump ideas and tasks here. Add to board when you want to work on them.
              </p>
            <div className="border border-border/50 rounded-xl overflow-hidden bg-background/30">
              {tickets.map((ticket, index) => {
                const issueKey = ticket.id.slice(-6).toUpperCase()
                return (
                  <div
                    key={ticket.id}
                    className={cn(
                      'group flex items-center gap-4 px-4 py-3 transition-all duration-200 animate-fade-in-up',
                      'hover:bg-secondary/50 hover:translate-x-0.5',
                      index > 0 && 'border-t border-border/40'
                    )}
                    style={{ animationDelay: `${Math.min(index, 4) * 75}ms` }}
                  >
                    <span className="text-xs font-mono text-muted-foreground/80 shrink-0 tabular-nums">
                      {issueKey}
                    </span>
                    <button
                      onClick={() => setEditingTicket(ticket)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="font-medium text-sm truncate">{ticket.title}</p>
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        promoteToBoard(ticket)
                      }}
                    >
                      <ChevronRight className="h-3.5 w-3.5 mr-1" />
                      Add to board
                    </Button>
                  </div>
                )
              })}
            </div>
            </>
          )}
        </div>
      </div>

      {isCreating && (
        <TicketDialog
          projectId={project.id}
          onClose={() => setIsCreating(false)}
          onSaved={(ticket) => {
            setTickets((prev) => [...prev, ticket])
            setIsCreating(false)
          }}
        />
      )}

      {editingTicket && (
        <TicketDialog
          projectId={project.id}
          ticket={editingTicket}
          onClose={() => setEditingTicket(null)}
          onSaved={(ticket) => {
            setTickets((prev) =>
              prev.map((t) => (t.id === ticket.id ? ticket : t))
            )
            setEditingTicket(null)
          }}
          onDeleted={(ticketId) => {
            setTickets((prev) => prev.filter((t) => t.id !== ticketId))
            setEditingTicket(null)
          }}
        />
      )}
    </div>
  )
}
