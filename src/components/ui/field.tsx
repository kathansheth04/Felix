import { Label } from './label'

interface FieldProps {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}

/** Shared form field: label, optional hint, required indicator, children. */
export function Field({ label, hint, required, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
