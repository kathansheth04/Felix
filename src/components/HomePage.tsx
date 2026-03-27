import { useMemo, useState, useEffect, useCallback } from 'react'
import type { Project } from '../types'
import { Plus, Search, SlidersHorizontal, GitBranch, LayoutList, Kanban } from 'lucide-react'
import { cn } from '../lib/utils'
import { EmptyState } from './ui/empty-state'
import { Input } from './ui/input'

// Distinct palette for project avatars — derived from name, consistent per project
const AVATAR_PALETTE = [
  'bg-rose-500/25 text-rose-400',
  'bg-violet-500/25 text-violet-400',
  'bg-teal-500/25 text-teal-400',
  'bg-amber-500/25 text-amber-400',
  'bg-cyan-500/25 text-cyan-400',
  'bg-emerald-500/25 text-emerald-400',
  'bg-indigo-500/25 text-indigo-400',
  'bg-white/15 text-white',
] as const

function projectAvatarStyle(name: string): (typeof AVATAR_PALETTE)[number] {
  let n = 0
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i)
  return AVATAR_PALETTE[n % AVATAR_PALETTE.length]
}

function ProjectAvatar({ name }: { name: string }) {
  const letter = name.trim()[0]?.toUpperCase() || '?'
  const style = projectAvatarStyle(name || '')
  return (
    <div
      className={cn(
        'flex items-center justify-center w-9 h-9 rounded-xl font-semibold text-sm shrink-0',
        style
      )}
    >
      {letter}
    </div>
  )
}

interface HomePageProps {
  projects: Project[]
  onSelectProject: (project: Project) => void
  onCreateClick: () => void
  onOpenSettings: () => void
}

export function HomePage({
  projects,
  onSelectProject,
  onCreateClick,
  onOpenSettings,
}: HomePageProps) {
  const [query, setQuery] = useState('')
  const [projectStats, setProjectStats] = useState<Record<string, { total: number; onBoard: number }>>({})

  const loadStats = useCallback(async () => {
    if (projects.length === 0) return
    const results = await Promise.all(
      projects.map(async (p) => {
        const tickets = await window.api.listTickets({ project_id: p.id })
        const onBoard = tickets.filter(
          (t) => t.status !== 'BACKLOG'
        ).length
        return { id: p.id, total: tickets.length, onBoard }
      })
    )
    setProjectStats(Object.fromEntries(results.map((r) => [r.id, { total: r.total, onBoard: r.onBoard }])))
  }, [projects])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const filtered = useMemo(() => {
    if (!query.trim()) return projects
    const q = query.trim().toLowerCase()
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.repo_url.toLowerCase().includes(q)
    )
  }, [projects, query])

  if (projects.length === 0) {
    return (
      <div className="h-full flex flex-col bg-home-gradient">
        <div className="flex justify-end h-10 px-5 border-b border-border/50 shrink-0 items-center">
          <button
            onClick={onOpenSettings}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
            title="API & Credentials"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            API & Credentials
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <EmptyState
            variant="hero"
            headline="No projects yet"
            description="Create your first project to connect a repository and start the autonomous agent."
            action={
              <button
                onClick={onCreateClick}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                New project
              </button>
            }
            className="animate-fade-in-up"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-home-gradient">
      {/* Header: title + settings */}
      <div className="drag-region shrink-0 px-5 pt-6 pb-4 border-b border-border/50 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight animate-felix-home-title-in [animation-delay:120ms] motion-reduce:animate-none">
          Felix
        </h1>
        <button
          onClick={onOpenSettings}
          className="no-drag text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          title="API & Credentials"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          API & Credentials
        </button>
      </div>
      {/* Search bar — centered, below divider */}
      <div className="shrink-0 px-5 py-4 flex justify-center">
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
          <Input
            type="search"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Grid of project cards + New project card */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-8">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No projects match your search.
              </p>
            </div>
          ) : (
            <div
              className={cn(
                'grid gap-3',
                'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              )}
            >
              {/* New project card — always first, contextual in the grid */}
              <button
                onClick={onCreateClick}
                className={cn(
                  'flex flex-col items-center justify-center gap-2 min-h-[120px]',
                  'rounded-xl border-2 border-dashed border-border/60',
                  'text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5',
                  'hover-lift-card animate-fade-in-up'
                )}
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-secondary/80">
                  <Plus className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium">New project</span>
              </button>

              {/* Project cards */}
              {filtered.map((project, index) => {
                const stats = projectStats[project.id]
                return (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className={cn(
                      'flex flex-col gap-2 min-h-[120px] p-4 text-left rounded-xl',
                      'border border-border/50 bg-card/50',
                      'hover:border-border hover-lift-card',
                      'animate-fade-in-up'
                    )}
                    style={{ animationDelay: `${Math.min(index + 1, 5) * 60}ms` }}
                  >
                    <div className="flex items-start gap-3">
                      <ProjectAvatar name={project.name} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{project.name}</p>
                        {stats && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <LayoutList className="h-3 w-3 shrink-0" />
                              {stats.total} ticket{stats.total !== 1 ? 's' : ''}
                            </span>
                            {stats.onBoard > 0 && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground/80">
                                <Kanban className="h-3 w-3 shrink-0" />
                                {stats.onBoard} on board
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-auto flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                      <span className="text-xs text-muted-foreground/70 font-mono">
                        {project.default_branch}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
