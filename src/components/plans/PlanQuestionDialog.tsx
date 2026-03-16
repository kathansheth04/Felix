import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { useToast } from '../ui/use-toast'
import { HelpCircle } from 'lucide-react'

interface PlanQuestionOption {
  label: string
  description: string
}

interface PlanQuestion {
  question: string
  header: string
  options: PlanQuestionOption[]
  multiSelect?: boolean
}

interface PlanQuestionDialogProps {
  ticketId: string
  ticketTitle?: string
  questions: PlanQuestion[]
  onClose: () => void
  onSubmit: (answers: Record<string, string>) => Promise<void>
  onCancel?: () => void
}

export function PlanQuestionDialog({
  ticketId,
  ticketTitle = 'Ticket',
  questions,
  onClose,
  onSubmit,
  onCancel,
}: PlanQuestionDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  const handleSelect = (questionText: string, optionLabel: string, multiSelect: boolean) => {
    setAnswers((prev) => {
      if (!multiSelect) {
        return { ...prev, [questionText]: optionLabel }
      }
      const current = (prev[questionText] || '').split(', ').filter(Boolean)
      const idx = current.indexOf(optionLabel)
      const next = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, optionLabel]
      return { ...prev, [questionText]: next.join(', ') }
    })
  }

  const isSelected = (questionText: string, optionLabel: string) => {
    const val = answers[questionText] || ''
    return val.includes(optionLabel)
  }

  const allAnswered = questions.every((q) => {
    const val = answers[q.question]
    return val != null && val.trim() !== ''
  })

  async function handleSubmit() {
    if (!allAnswered) return
    setSubmitting(true)
    try {
      await onSubmit(answers)
      onClose()
    } catch (err) {
      toast({ title: 'Failed to submit', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-violet-400" />
            <DialogTitle>Claude needs your input</DialogTitle>
          </div>
          <p className="text-sm text-muted-foreground">{ticketTitle}</p>
        </DialogHeader>
        <div className="space-y-5 py-2">
          {questions.map((q) => (
            <div key={q.question} className="space-y-2">
              <p className="text-sm font-medium">{q.header || q.question}</p>
              <p className="text-sm text-muted-foreground">{q.question}</p>
              <div className="flex flex-col gap-2">
                {q.options.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => handleSelect(q.question, opt.label, !!q.multiSelect)}
                    className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      isSelected(q.question, opt.label)
                        ? 'border-violet-500/60 bg-violet-500/10 text-foreground'
                        : 'border-border/50 bg-muted/20 hover:bg-muted/40'
                    }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="text-xs text-muted-foreground mt-0.5">{opt.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => {
              onCancel?.()
              onClose()
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!allAnswered || submitting}>
            {submitting ? 'Submitting…' : 'Submit answers'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
