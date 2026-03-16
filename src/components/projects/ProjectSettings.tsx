import { useState, useEffect } from 'react'
import type { Project } from '../../types'
import { Field } from '../ui/field'
import { ErrorBlock } from '../ui/error-block'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Trash2 } from 'lucide-react'

interface ProjectSettingsProps {
  project: Project
  onProjectSaved: (project: Project) => void
  onProjectDeleted: (projectId: string) => void
}

export function ProjectSettings({ project, onProjectSaved, onProjectDeleted }: ProjectSettingsProps) {
  const [name, setName] = useState(project.name)
  const [repoUrl, setRepoUrl] = useState(project.repo_url)
  const [defaultBranch, setDefaultBranch] = useState(project.default_branch)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  useEffect(() => {
    setName(project.name)
    setRepoUrl(project.repo_url)
    setDefaultBranch(project.default_branch)
  }, [project])

  async function handleSave() {
    if (!name.trim() || !repoUrl.trim()) {
      setError('Name and repository URL are required.')
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const saved = await window.api.updateProject({
        project_id: project.id,
        name: name.trim(),
        repo_url: repoUrl.trim(),
        default_branch: defaultBranch.trim() || 'main',
      })
      onProjectSaved(saved)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      setError('Failed to save project. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await window.api.deleteProject({ project_id: project.id })
      onProjectDeleted(project.id)
      setDeleteDialogOpen(false)
    } catch (err: unknown) {
      setError('Failed to delete project. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-backlog-gradient">
      <div className="min-h-full flex flex-col justify-center max-w-lg mx-auto p-8 w-full space-y-6">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Project Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure the repository this project operates on.
          </p>
        </div>

        <div className="space-y-5">
          <Field label="Project Name">
            <Input
              placeholder="My App"
              value={name}
              onChange={(e) => setName(e.target.value)}
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

          <Field label="Default Branch">
            <Input
              placeholder="main"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              className="font-mono text-sm"
            />
          </Field>
        </div>

        {error && <ErrorBlock message={error} />}
        {success && <p className="text-sm text-emerald-400">Settings saved.</p>}

        <Button onClick={handleSave} disabled={saving || deleting} className="w-full">
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>

        <div className="pt-6 mt-6 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 w-full"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={saving || deleting}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete project
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the project, all its tickets, and the cloned repository.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

