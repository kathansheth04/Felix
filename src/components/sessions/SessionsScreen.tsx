import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Execution, Project, Ticket, TicketStatusChangedEvent } from '../../types'
import { LogViewer } from './LogViewer'
import { EmptyState } from '../ui/empty-state'
import { cn } from '../../lib/utils'
import { formatDistanceToNow } from '../../lib/time'
import { ChevronDown, ChevronRight, Search, X, ScrollText } from 'lucide-react'

interface SessionsScreenProps {
  project: Project | null
  focusedTicketId?: string | null
  onFocusConsumed?: () => void
}

// ─── Status badge config ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  IN_PROGRESS: { label: 'Running',   className: 'bg-teal/15 text-teal border border-teal/20' },
  COMPLETED:   { label: 'Done',      className: 'bg-success/15 text-success border border-success/20' },
  FAILED:      { label: 'Failed',    className: 'bg-destructive/15 text-destructive border border-destructive/20' },
  CANCELLED:   { label: 'Cancelled', className: 'bg-muted/60 text-muted-foreground border border-border/50' },
  CRASHED:     { label: 'Crashed',   className: 'bg-warning/15 text-warning border border-warning/20' },
}

// ─── Data grouping ────────────────────────────────────────────────────────────

interface TicketGroup {
  ticketId: string
  ticket: Ticket | null
  executions: Execution[]   // sorted newest → oldest
  hasRunning: boolean
}

function buildGroups(executions: Execution[], ticketMap: Record<string, Ticket>): TicketGroup[] {
  const groupMap = new Map<string, Execution[]>()
  for (const exec of executions) {
    if (!groupMap.has(exec.ticket_id)) groupMap.set(exec.ticket_id, [])
    groupMap.get(exec.ticket_id)!.push(exec)
  }

  const groups: TicketGroup[] = []
  for (const [ticketId, execs] of groupMap) {
    groups.push({
      ticketId,
      ticket: ticketMap[ticketId] ?? null,
      executions: execs, // API returns DESC by started_at
      hasRunning: execs.some((e) => e.status === 'IN_PROGRESS'),
    })
  }

  // Running groups first, then by most recent execution
  groups.sort((a, b) => {
    if (a.hasRunning !== b.hasRunning) return a.hasRunning ? -1 : 1
    const aTime = new Date(a.executions[0]?.started_at ?? 0).getTime()
    const bTime = new Date(b.executions[0]?.started_at ?? 0).getTime()
    return bTime - aTime
  })

  return groups
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionsScreen({ project, focusedTicketId, onFocusConsumed }: SessionsScreenProps) {
  const [executions, setExecutions] = useState<Execution[]>([])
  const [ticketMap, setTicketMap] = useState<Record<string, Ticket>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [ticketSearch, setTicketSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const loadData = useCallback(async () => {
    if (!project) return
    const [execs, tickets] = await Promise.all([
      window.api.listExecutions({ project_id: project.id }),
      window.api.listTickets({ project_id: project.id }),
    ])
    setExecutions(execs)

    const map: Record<string, Ticket> = {}
    for (const t of tickets) map[t.id] = t
    setTicketMap(map)

    setExpandedTickets((prev) => {
      const next = new Set(prev)
      const sid = selectedIdRef.current
      if (sid) {
        const exec = execs.find((e) => e.id === sid)
        if (exec) next.add(exec.ticket_id)
      }
      for (const e of execs) {
        if (e.status === 'IN_PROGRESS') next.add(e.ticket_id)
      }
      return next
    })

    setSelectedId((prev) => {
      if (focusedTicketId) return prev
      return prev && execs.find((e) => e.id === prev) ? prev : null
    })
  }, [project, focusedTicketId])

  useEffect(() => {
    if (!project) return
    setLoading(true)
    loadData().catch(console.error).finally(() => setLoading(false))
  }, [project, loadData])

  useEffect(() => {
    if (!project) return
    const unsub = window.api.onTicketStatusChanged((_data: TicketStatusChangedEvent) => {
      loadData().catch(console.error)
    })
    return unsub
  }, [project, loadData])

  useEffect(() => {
    if (!project) return
    const hasRunning = executions.some((e) => e.status === 'IN_PROGRESS')
    if (!hasRunning) return
    const timer = setInterval(() => loadData().catch(console.error), 4000)
    return () => clearInterval(timer)
  }, [project, executions, loadData])

  // When navigating here from a blocked ticket, jump to its latest execution
  useEffect(() => {
    if (!focusedTicketId || executions.length === 0) return
    const ticketExecs = executions.filter((e) => e.ticket_id === focusedTicketId)
    if (ticketExecs.length === 0) return
    setExpandedTickets((prev) => new Set([...prev, focusedTicketId]))
    setSelectedId(ticketExecs[0].id)
    onFocusConsumed?.()
  }, [focusedTicketId, executions, onFocusConsumed])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // Only intercept when sessions screen is rendered
        const sidebar = searchRef.current
        if (!sidebar) return
        e.preventDefault()
        sidebar.focus()
        sidebar.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const groups = useMemo(() => buildGroups(executions, ticketMap), [executions, ticketMap])

  const filteredGroups = useMemo(() => {
    if (!ticketSearch.trim()) return groups
    const q = ticketSearch.toLowerCase()
    return groups.filter((g) =>
      (g.ticket?.title ?? 'Deleted ticket').toLowerCase().includes(q)
    )
  }, [groups, ticketSearch])

  const running = executions.filter((e) => e.status === 'IN_PROGRESS').length
  const selected = selectedId ? executions.find((e) => e.id === selectedId) ?? null : null

  function toggleGroup(ticketId: string) {
    setExpandedTickets((prev) => {
      const next = new Set(prev)
      if (next.has(ticketId)) next.delete(ticketId)
      else next.add(ticketId)
      return next
    })
  }

  function selectSession(executionId: string) {
    setSelectedId(executionId)
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No project configured.
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-72 shrink-0 border-r border-border/60 flex flex-col bg-background/40">
        <div className="flex items-center justify-between h-10 px-5 border-b border-border/50 shrink-0">
          <h2 className="text-sm font-semibold tracking-tight">Sessions</h2>
          {running > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-teal">
              <span className="h-1.5 w-1.5 rounded-full bg-teal animate-status-pulse" />
              {running} running
            </span>
          )}
        </div>

        {/* Search bar */}
        <div className="px-3 py-2.5 border-b border-border/40 shrink-0">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground/40 pointer-events-none" />
            <input
              ref={searchRef}
              value={ticketSearch}
              onChange={(e) => setTicketSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setTicketSearch('')}
              placeholder="Search tickets… (⌘F)"
              className="w-full rounded-lg bg-secondary/40 border border-border/50 pl-7 pr-7 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
            {ticketSearch && (
              <button
                onClick={() => setTicketSearch('')}
                className="absolute right-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && groups.length === 0 && (
            <div className="flex items-center justify-center h-24 text-xs text-muted-foreground animate-pulse">
              Loading…
            </div>
          )}
          {groups.length === 0 && !loading && (
            <div className="h-24">
              <EmptyState variant="minimal" headline="No sessions yet" />
            </div>
          )}

          {groups.length > 0 && filteredGroups.length === 0 && (
            <div className="h-24">
              <EmptyState variant="minimal" headline="No matching tickets" />
            </div>
          )}

          {filteredGroups.map((group, index) => {
            const isExpanded = expandedTickets.has(group.ticketId)
            const ticketTitle = group.ticket?.title ?? 'Deleted ticket'
            const runCount = group.executions.length

            return (
              <div key={group.ticketId} className="border-b border-border/40">
                {/* Ticket group header */}
                  <button
                  onClick={() => toggleGroup(group.ticketId)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-secondary/50 transition-all duration-200 text-left rounded-md animate-fade-in-up hover:translate-x-0.5"
                  style={{ animationDelay: `${Math.min(index, 4) * 75}ms` }}
                >
                  <span className="text-muted-foreground/60 shrink-0">
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5" />
                      : <ChevronRight className="h-3.5 w-3.5" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate block">
                      {ticketTitle}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      {runCount} run{runCount !== 1 ? 's' : ''}
                      {group.hasRunning && (
                        <span className="ml-1.5 text-teal">· running</span>
                      )}
                    </span>
                  </span>
                </button>

                {/* Sessions within this group — grid animation for expand */}
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="bg-secondary/20">
                      {group.executions.map((execution, idx) => {
                      // Run number: oldest is #1, so reverse index
                      const runNumber = group.executions.length - idx
                      const badge = STATUS_BADGE[execution.status] ?? { label: execution.status, className: 'bg-secondary text-muted-foreground' }
                      const isRunning = execution.status === 'IN_PROGRESS'
                      const isSelected = selectedId === execution.id

                      return (
                        <button
                          key={execution.id}
                          onClick={() => selectSession(execution.id)}
                          className={cn(
                            'w-full text-left pl-8 pr-3 py-2.5 border-t border-border/30 transition-all duration-200 rounded-sm',
                            isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-secondary/60 hover:translate-x-0.5'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">
                              Run #{runNumber}
                              <span className="ml-1.5 font-normal text-muted-foreground capitalize">
                                · {execution.mode.toLowerCase()}
                              </span>
                            </span>
                            <span className={cn(
                              'rounded-full px-1.5 py-0.5 text-xs font-medium shrink-0 flex items-center gap-1',
                              badge.className
                            )}>
                              {isRunning && <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />}
                              {badge.label}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-xs text-muted-foreground/60">
                              {formatDistanceToNow(execution.started_at)}
                            </span>
                            {isRunning && execution.current_step && (
                              <span className="text-xs text-teal/70 truncate max-w-[100px]">
                                {execution.current_step.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Log viewer */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <LogViewer
            execution={selected}
            ticketTitle={ticketMap[selected.ticket_id]?.title}
            runNumber={(() => {
              const group = groups.find((g) => g.ticketId === selected.ticket_id)
              if (!group) return undefined
              const idx = group.executions.findIndex((e) => e.id === selected.id)
              return idx === -1 ? undefined : group.executions.length - idx
            })()}
          />
        ) : (
          <div className="flex items-center justify-center h-full px-8 bg-logs-empty-gradient">
            <div className="flex flex-col items-center text-center max-w-sm animate-fade-in-up">
              <div className="mb-6 rounded-xl bg-muted/30 p-6 border border-border/40">
                <ScrollText className="h-12 w-12 text-muted-foreground/60" strokeWidth={1.5} />
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">
                Select a session to view logs
              </h3>
              <p className="text-sm text-muted-foreground/80 leading-relaxed mb-5">
                Choose a run from the sidebar to see agent output, tool calls, and results.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-violet/15 text-violet border border-violet/25">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet/80" />
                  Planning
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-teal/15 text-teal border border-teal/25">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal/80" />
                  Implementation
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-primary/15 text-primary border border-primary/25">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/80" />
                  Revision
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
