import { useState } from 'react'
import type { Ticket } from '../../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Field } from '../ui/field'
import { ErrorBlock } from '../ui/error-block'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Button } from '../ui/button'
import { Trash2 } from 'lucide-react'

interface TicketDialogProps {
  projectId: string
  ticket?: Ticket
  onClose: () => void
  onSaved: (ticket: Ticket) => void
  onDeleted?: (ticketId: string) => void
}

export function TicketDialog({ projectId, ticket, onClose, onSaved, onDeleted }: TicketDialogProps) {
  const isEditing = !!ticket

  const [title, setTitle] = useState(ticket?.title ?? '')
  const [description, setDescription] = useState(ticket?.description ?? '')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(ticket?.acceptance_criteria ?? '')
  const [testCommands, setTestCommands] = useState(ticket?.test_commands ?? '')
  const [additionalInfo, setAdditionalInfo] = useState(ticket?.additional_information ?? '')
  const [requirePlanReview, setRequirePlanReview] = useState(ticket?.require_plan_review ?? 1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!ticket) return
    setDeleting(true)
    setError(null)
    try {
      await window.api.deleteTicket({ ticket_id: ticket.id })
      onDeleted?.(ticket.id)
      onClose()
    } catch (err: unknown) {
      setError('Failed to delete ticket. Please try again.')
      setConfirmingDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let saved: Ticket
      if (isEditing) {
        saved = await window.api.updateTicket({
          ticket_id: ticket.id,
          title: title.trim(),
          description: description.trim() || undefined,
          acceptance_criteria: acceptanceCriteria.trim() || undefined,
          test_commands: testCommands.trim() || undefined,
          additional_information: additionalInfo.trim() || undefined,
          require_plan_review: requirePlanReview
        })
      } else {
        saved = await window.api.createTicket({
          project_id: projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          acceptance_criteria: acceptanceCriteria.trim() || undefined,
          test_commands: testCommands.trim() || undefined,
          additional_information: additionalInfo.trim() || undefined,
          require_plan_review: requirePlanReview
        })
      }
      onSaved(saved)
    } catch (err: unknown) {
      setError('Failed to save ticket. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="tracking-tight">{isEditing ? 'Edit Ticket' : 'New Ticket'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="Title" required>
            <Input
              placeholder="e.g. Add sidebar navigation"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Field>

          <Field label="Description">
            <Textarea
              placeholder="What needs to be built?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>

          <Field label="Acceptance Criteria" hint="The agent derives tests from these">
            <Textarea
              placeholder="- Sidebar appears on dashboard page&#10;- Navigation links: Dashboard, Tasks, Settings&#10;- Sidebar collapses and expands"
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              rows={4}
            />
          </Field>

          <Field label="Test Commands" hint="Commands the agent runs to validate">
            <Textarea
              placeholder="npm install&#10;npm run test -- --testPathPattern=sidebar"
              value={testCommands}
              onChange={(e) => setTestCommands(e.target.value)}
              rows={2}
              className="font-mono"
            />
          </Field>

          <Field label="Additional Information" hint="Human-provided guidance only (never written by agent)">
            <Textarea
              placeholder="Known constraints, design notes, or implementation hints…"
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              rows={2}
            />
          </Field>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Plan Review</span>
              <p className="text-xs text-muted-foreground">
                Review Claude's implementation plan before it starts coding
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={requirePlanReview === 1}
              onClick={() => setRequirePlanReview(requirePlanReview === 1 ? 0 : 1)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                requirePlanReview === 1 ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  requirePlanReview === 1 ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>

          {error && <ErrorBlock message={error} />}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          {isEditing && (
            <div className="flex items-center gap-2 sm:mr-auto">
              {confirmingDelete ? (
                <>
                  <span className="text-xs text-destructive">Delete this ticket and kill any running job?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              )}
            </div>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || deleting || !title.trim()}>
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

