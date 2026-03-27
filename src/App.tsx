import { useState, useEffect, useCallback } from 'react'
import { KanbanBoard } from './components/kanban/KanbanBoard'
import { BacklogScreen } from './components/backlog/BacklogScreen'
import { SessionsScreen } from './components/sessions/SessionsScreen'
import { ProjectSettings } from './components/projects/ProjectSettings'
import { ProjectRail } from './components/ProjectRail'
import { HomePage } from './components/HomePage'
import { CreateProjectDialog } from './components/CreateProjectDialog'
import { GlobalSettings } from './components/GlobalSettings'
import { SetupScreen } from './components/SetupScreen'
import { SplashOverlay } from './components/SplashOverlay'
import type { Project, ProjectView, TicketStatusChangedEvent } from './types'
import { BLOCKED_REASON_LABEL } from './types'
import { ChevronLeft } from 'lucide-react'
import { Toaster } from './components/ui/toaster'
import { toast } from './components/ui/use-toast'

function getHasSeenSplash(): boolean {
  try {
    return window.sessionStorage.getItem('felix_has_seen_splash') === '1'
  } catch {
    return false
  }
}

function setHasSeenSplash() {
  try {
    window.sessionStorage.setItem('felix_has_seen_splash', '1')
  } catch {
    // non-fatal
  }
}

export default function App() {
  const [mainView, setMainView] = useState<'home' | 'project'>('home')
  const [projectView, setProjectView] = useState<ProjectView>('board')
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)

  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [dependenciesOk, setDependenciesOk] = useState<boolean | null>(null)
  const [hasSeenSplash, setHasSeenSplashState] = useState<boolean>(() => getHasSeenSplash())
  const [splashPhase, setSplashPhase] = useState<'intro' | 'outro' | 'done'>('intro')
  const [splashHint, setSplashHint] = useState<string | null>(null)
  const [ticketVersion, setTicketVersion] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)

  const [focusedTicketId, setFocusedTicketId] = useState<string | null>(null)

  useEffect(() => {
    window.api.checkDependencies().then((status) => {
      const ok = status.python && status.claude_agent_sdk && status.git
      setDependenciesOk(ok)
    }).catch(() => setDependenciesOk(false))
  }, [])

  useEffect(() => {
    if (dependenciesOk !== null) return
    const t = window.setTimeout(() => setSplashHint('Preparing workspace…'), 1500)
    return () => window.clearTimeout(t)
  }, [dependenciesOk])

  useEffect(() => {
    if (dependenciesOk === false) {
      setSplashPhase('done')
    }
  }, [dependenciesOk])

  useEffect(() => {
    if (!dependenciesOk || splashPhase !== 'intro') return
    const holdMs = hasSeenSplash ? 180 : 280
    const t = window.setTimeout(() => setSplashPhase('outro'), holdMs)
    return () => window.clearTimeout(t)
  }, [dependenciesOk, hasSeenSplash, splashPhase])

  useEffect(() => {
    if (splashPhase !== 'outro') return
    const t = window.setTimeout(() => setSplashPhase('done'), hasSeenSplash ? 320 : 420)
    return () => window.clearTimeout(t)
  }, [hasSeenSplash, splashPhase])

  useEffect(() => {
    if (splashPhase !== 'done') return
    setHasSeenSplash()
    setHasSeenSplashState(true)
  }, [splashPhase])

  useEffect(() => {
    if (dependenciesOk) {
      window.api.listProjects().then((list) => {
        setProjects(list)
        setActiveProject((prev) => {
          if (prev && list.some((p) => p.id === prev.id)) return prev
          return null
        })
      }).catch(console.error)
    }
  }, [dependenciesOk])
  // Don't auto-show project view on load — start on home

  useEffect(() => {
    const unsub = window.api.onTicketStatusChanged((data: TicketStatusChangedEvent) => {
      setTicketVersion((v) => v + 1)
      showStatusToast(data)
    })
    return unsub
  }, [])

  function openProject(project: Project) {
    setActiveProject(project)
    setProjectView('board')
    setMainView('project')
  }

  function goHome() {
    setMainView('home')
  }

  function openGlobalSettings() {
    setGlobalSettingsOpen(true)
  }

  function closeGlobalSettings() {
    setGlobalSettingsOpen(false)
  }

  const handleProjectCreated = useCallback((project: Project) => {
    setProjects((prev) => [...prev, project])
    setCreateOpen(false)
    openProject(project)
  }, [])

  const handleProjectUpdated = useCallback((project: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)))
    setActiveProject(project)
  }, [])

  const handleProjectDeleted = useCallback((projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId))
    setActiveProject((prev) => (prev?.id === projectId ? null : prev))
    setMainView('home')
  }, [])


  function showStatusToast(data: TicketStatusChangedEvent) {
    window.api.getTicket({ ticket_id: data.ticket_id })
      .then((ticket) => {
        const title = ticket.title ?? 'Ticket'
        switch (data.new_status) {
          case 'DEV_COMPLETE':
            toast({ title: 'PR ready for review', description: title })
            break
          case 'BLOCKED': {
            const reason = data.blocked_reason
              ? (BLOCKED_REASON_LABEL[data.blocked_reason as keyof typeof BLOCKED_REASON_LABEL] ?? 'Something went wrong')
              : 'Something went wrong'
            toast({ title: reason, description: title, variant: 'destructive' })
            break
          }
          case 'DONE':
            toast({ title: 'Ticket complete — worktree cleaned up', description: title })
            break
          case 'IN_REVIEW':
            toast({ title: 'Revision agent started', description: title })
            break
          case 'IN_PROGRESS':
            toast({ title: 'Agent started', description: title })
            break
        }
      })
      .catch(() => { /* non-fatal */ })
  }

  return (
    <div className="flex flex-col h-screen bg-canvas">
      <div className="flex flex-1 min-h-0">
        {dependenciesOk ? (
          <>
            {/* Sidebar — only when viewing a project */}
            {mainView === 'project' && (
              <div className="animate-rail-enter">
              <ProjectRail
                activeProject={activeProject}
                projectView={projectView}
                onSetProjectView={(view) => {
                  setProjectView(view)
                  setMainView('project')
                }}
                onOpenGlobalSettings={openGlobalSettings}
              />
              </div>
            )}

            {/* Main content */}
            <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
            {mainView === 'project' && (
              <div className="drag-region shrink-0 flex items-center h-10 px-4 border-b border-border/50 bg-background/80">
                <button
                  onClick={goHome}
                  className="no-drag flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                  title="Back to projects"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Projects
                </button>
              </div>
            )}
            <div key={mainView === 'home' ? 'home' : `project-${projectView}`} className="flex-1 min-h-0 animate-page-enter overflow-hidden">
            {mainView === 'home' ? (
              <HomePage
                projects={projects}
                onSelectProject={openProject}
                onCreateClick={() => setCreateOpen(true)}
                onOpenSettings={openGlobalSettings}
              />
            ) : activeProject && projectView === 'board' ? (
              <KanbanBoard
                project={activeProject}
                ticketVersion={ticketVersion}
                onNoProject={() => setProjectView('settings')}
                onViewLogs={(ticketId) => {
                  setFocusedTicketId(ticketId)
                  setProjectView('sessions')
                }}
              />
            ) : activeProject && projectView === 'backlog' ? (
              <BacklogScreen project={activeProject} ticketVersion={ticketVersion} />
            ) : activeProject && projectView === 'sessions' ? (
              <SessionsScreen
                project={activeProject}
                focusedTicketId={focusedTicketId}
                onFocusConsumed={() => setFocusedTicketId(null)}
              />
            ) : activeProject ? (
              <ProjectSettings
                project={activeProject}
                onProjectSaved={handleProjectUpdated}
                onProjectDeleted={handleProjectDeleted}
              />
            ) : (
              <HomePage
                projects={projects}
                onSelectProject={openProject}
                onCreateClick={() => setCreateOpen(true)}
                onOpenSettings={openGlobalSettings}
              />
            )}
            </div>
            <CreateProjectDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              onCreated={handleProjectCreated}
            />
            </main>
          </>
        ) : dependenciesOk === false ? (
          <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <SetupScreen />
          </main>
        ) : (
          <main className="flex-1 min-w-0 overflow-hidden flex flex-col" />
        )}
      </div>

      {/* Global settings overlay */}
      {globalSettingsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background animate-overlay-enter">
          <div className="drag-region flex items-center gap-4 h-12 pl-20 pr-5 border-b border-border/60 shrink-0 bg-card/30">
            <button
              onClick={closeGlobalSettings}
              className="no-drag flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <GlobalSettings />
          </div>
        </div>
      )}

      <Toaster />

      {(dependenciesOk === null || splashPhase !== 'done') && (
        <SplashOverlay
          phase={splashPhase === 'outro' ? 'outro' : 'intro'}
          variant={hasSeenSplash ? 'brief' : 'full'}
          hint={dependenciesOk === null ? (splashHint ?? undefined) : undefined}
        />
      )}
    </div>
  )
}
