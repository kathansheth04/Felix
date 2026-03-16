import { useState } from 'react'
import type { Project } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Field } from './ui/field'
import { ErrorBlock } from './ui/error-block'
import { Input } from './ui/input'
import { Button } from './ui/button'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: Project) => void
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateProjectDialogProps) {
  const [name, setName] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim() || !repoUrl.trim()) {
      setError('Name and repository URL are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const project = await window.api.createProject({
        name: name.trim(),
        repo_url: repoUrl.trim(),
        default_branch: branch.trim() || 'main',
      })
      onCreated(project)
      onOpenChange(false)
      setName('')
      setRepoUrl('')
      setBranch('main')
    } catch (err: unknown) {
      setError('Failed to create project. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setName('')
      setRepoUrl('')
      setBranch('main')
      setError(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Name">
            <Input
              placeholder="My App"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Repository URL" hint="GitHub HTTPS URL">
            <Input
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="font-mono text-sm"
            />
          </Field>
          <Field label="Default branch">
            <Input
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="font-mono text-sm"
            />
          </Field>
          {error && <ErrorBlock message={error} />}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
