import type { ReactNode } from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'
import type { Ticket, PlanMessage } from '../../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { useToast } from '../ui/use-toast'
import { Check, X, Send, Loader2, FileText, Pencil } from 'lucide-react'

const api = window.api
const has = (fn: unknown): fn is Function => typeof fn === 'function'

interface PlanReviewDialogProps {
  ticket: Ticket
  isPlanning?: boolean
  onClose: () => void
  onStatusChange: (ticket: Ticket) => void
  onEdit?: (ticket: Ticket) => void
  onFeedbackSubmitted?: (ticketId: string) => void
}

export function PlanReviewDialog({ ticket, isPlanning = false, onClose, onStatusChange, onEdit, onFeedbackSubmitted }: PlanReviewDialogProps) {
  const [messages, setMessages] = useState<PlanMessage[]>([])
  const [planText, setPlanText] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [revising, setRevising] = useState(false)
  const { toast } = useToast()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const revisingSnapshotRef = useRef<{ messageCount: number; planLength: number } | null>(null)

  const loadMessages = useCallback(async () => {
    try {
      if (has(api.getPlanMessages)) {
        const msgs = await api.getPlanMessages({ ticket_id: ticket.id })
        setMessages(msgs)
      }
      if (has(api.getTicket)) {
        const fresh = await api.getTicket({ ticket_id: ticket.id })
        setPlanText(fresh.plan ?? null)
      } else {
        setPlanText(ticket.plan ?? null)
      }
    } catch (err) {
      console.error('Failed to load plan messages', err)
      setPlanText(ticket.plan ?? null)
    } finally {
      setLoading(false)
    }
  }, [ticket.id, ticket.plan])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  useEffect(() => {
    const unsubs: (() => void)[] = []

    if (has(api.onPlanUpdated)) {
      unsubs.push(api.onPlanUpdated((data: { ticket_id: string; plan?: string }) => {
        if (data.ticket_id === ticket.id) {
          setRevising(false)
          revisingSnapshotRef.current = null
          if (data.plan != null) setPlanText(data.plan)
          loadMessages()
        }
      }))
    }

    if (has(api.onPlanMessage)) {
      unsubs.push(api.onPlanMessage((data: { ticket_id: string; message: PlanMessage }) => {
        if (data.ticket_id === ticket.id) {
          setMessages((prev) => [...prev, data.message])
        }
      }))
    }

    if (has(api.onTicketStatusChanged)) {
      unsubs.push(api.onTicketStatusChanged((data: { ticket_id: string; new_status: string }) => {
        if (data.ticket_id === ticket.id && data.new_status === 'TODO') {
          onClose()
        }
      }))
    }

    return () => unsubs.forEach((fn) => fn())
  }, [ticket.id, loadMessages, onClose])

  // Fallback polling when push events aren't available (preload not rebuilt)
  useEffect(() => {
    if (has(api.onPlanUpdated) || !revising) return
    revisingSnapshotRef.current = { messageCount: messages.length, planLength: (planText ?? '').length }
    const interval = setInterval(async () => {
      if (!has(api.getTicket)) return
      try {
        const fresh = await api.getTicket({ ticket_id: ticket.id })
        const newPlan = fresh.plan ?? null
        const newMsgs = has(api.getPlanMessages)
          ? await api.getPlanMessages({ ticket_id: ticket.id })
          : null
        const snap = revisingSnapshotRef.current
        const planChanged = snap && (newPlan ?? '').length !== snap.planLength
        const messagesChanged = snap && newMsgs != null && newMsgs.length > snap.messageCount
        if (snap && (planChanged || messagesChanged)) {
          if (newMsgs != null) setMessages(newMsgs)
          if (newPlan != null) setPlanText(newPlan)
          setRevising(false)
          revisingSnapshotRef.current = null
        }
      } catch {
        /* ignore */
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [revising, ticket.id, messages.length, planText])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [planText])

  const preloadMissing = () => {
    toast({
      title: 'Preload not rebuilt',
      description: 'Restart the Electron dev server to enable plan review actions.',
      variant: 'destructive',
    })
  }

  async function handleApprove() {
    if (!has(api.approvePlan)) {
      if (has(api.moveTicket)) {
        setApproving(true)
        try {
          const updated = await api.moveTicket({ ticket_id: ticket.id, new_status: 'IN_PROGRESS' })
          onStatusChange(updated)
          toast({ title: 'Plan approved', description: 'Implementation starting…' })
          onClose()
        } catch (err: unknown) {
          toast({ title: 'Failed to approve', description: 'Please try again.', variant: 'destructive' })
        } finally { setApproving(false) }
      } else { preloadMissing() }
      return
    }

    setApproving(true)
    try {
      const updated = await api.approvePlan({
        ticket_id: ticket.id,
        approval_feedback: feedback.trim() || undefined,
      })
      setFeedback('')
      onStatusChange(updated)
      toast({ title: 'Plan approved', description: 'Implementation starting…' })
      onClose()
    } catch (err: unknown) {
      toast({ title: 'Failed to approve plan', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setApproving(false)
    }
  }

  async function handleReject() {
    if (!has(api.rejectPlan)) {
      if (has(api.moveTicket)) {
        setRejecting(true)
        try {
          const updated = await api.moveTicket({ ticket_id: ticket.id, new_status: 'TODO' })
          onStatusChange(updated)
          toast({ title: 'Plan rejected', description: 'Ticket moved to To Do' })
          onClose()
        } catch (err: unknown) {
          toast({ title: 'Failed to reject', description: 'Please try again.', variant: 'destructive' })
        } finally { setRejecting(false) }
      } else { preloadMissing() }
      return
    }

    setRejecting(true)
    try {
      const updated = await api.rejectPlan({ ticket_id: ticket.id })
      onStatusChange(updated)
      toast({ title: 'Plan rejected', description: 'Ticket moved to To Do' })
      onClose()
    } catch (err: unknown) {
      toast({ title: 'Failed to reject plan', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setRejecting(false)
    }
  }

  async function handleSendFeedback() {
    if (!feedback.trim()) return
    if (!has(api.submitPlanFeedback)) { preloadMissing(); return }
    setSubmitting(true)
    setRevising(true)
    try {
      await api.submitPlanFeedback({ ticket_id: ticket.id, message: feedback.trim() })
      setFeedback('')
      textareaRef.current?.focus()
      onFeedbackSubmitted?.(ticket.id)
    } catch (err: unknown) {
      setRevising(false)
      toast({ title: 'Failed to send feedback', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !submitting && feedback.trim()) {
      e.preventDefault()
      handleSendFeedback()
    }
  }

  const isBusy = approving || rejecting || submitting

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 shrink-0 text-violet-400" />
              <DialogTitle className="tracking-tight">View Plan</DialogTitle>
            </div>
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => { onClose(); onEdit(ticket) }}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{ticket.title}</p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <div className="px-6 py-4 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (revising || isPlanning) ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
                <p className="text-sm text-muted-foreground">
                  {revising ? 'Revising the plan based on your feedback…' : 'Planning…'}
                </p>
              </div>
            ) : planText ? (
              <>
                {/Risks|Open Questions|\?/i.test(planText) && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-200/90">
                    <span className="font-medium">Claude might have questions.</span> Your response to them will refine the plan.
                  </div>
                )}
                <div className="rounded-lg border border-border/50 bg-card">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-muted/30">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Claude's Plan</span>
                  </div>
                  <div className="px-4 py-3 overflow-x-auto">
                    <PlanBlock content={planText} />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">No plan yet.</p>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t border-border/50 px-6 py-4 shrink-0 space-y-3 bg-background">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              placeholder="Answer Claude's questions or send feedback to refine the plan… (⌘+Enter to send)"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={isBusy || revising}
              className="pr-12 resize-none"
            />
            <Button
              size="sm"
              variant="ghost"
              className="absolute right-2 bottom-2 h-7 w-7 p-0"
              onClick={handleSendFeedback}
              disabled={isBusy || revising || !feedback.trim()}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReject}
              disabled={isBusy || revising}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              {rejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <X className="h-3.5 w-3.5 mr-1.5" />}
              Reject
            </Button>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={isBusy || revising}
            >
              {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              Approve & Implement
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Initialize mermaid once for dark theme compatibility
let mermaidInit = false
function initMermaid() {
  if (mermaidInit) return
  mermaidInit = true
  mermaid.initialize({ startOnLoad: false, theme: 'dark', themeVariables: { primaryColor: '#a78bfa', primaryTextColor: '#fff' } })
}

function MermaidDiagram({ id, source }: { id: string; source: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || !source.trim()) return
    initMermaid()
    const uid = `mermaid-${id}`
    mermaid.render(uid, source.trim()).then(
      ({ svg, bindFunctions }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg
          bindFunctions?.(containerRef.current)
        }
        setError(null)
      },
      () => setError('Could not render diagram.')
    )
  }, [id, source])

  if (error) {
    return <pre className="text-xs text-destructive/90 overflow-x-auto p-2 bg-destructive/10 rounded">{error}</pre>
  }
  return <div ref={containerRef} className="mermaid-diagram flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" />
}

function PlanBlock({ content }: { content: string }) {
  const mermaidIdRef = useRef(0)

  const components = {
    code(props: { node?: unknown; className?: string; children?: ReactNode; inline?: boolean }) {
      const { node: _node, className, children, inline, ...rest } = props
      const isMermaid = !inline && typeof className === 'string' && className.includes('language-mermaid')
      const source = typeof children === 'string' ? children : Array.isArray(children) && typeof children[0] === 'string' ? children[0] : ''
      if (isMermaid && source) {
        mermaidIdRef.current += 1
        return (
          <div className="my-3 overflow-x-auto rounded-md bg-muted/20 p-4">
            <MermaidDiagram id={String(mermaidIdRef.current)} source={source} />
          </div>
        )
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    },
  }

  return (
    <div className="plan-prose prose prose-sm prose-invert max-w-none text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5 [&_code]:text-xs [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-muted/30 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:text-xs [&_pre]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_tbody_tr]:hover:bg-muted/20">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
    </div>
  )
}
