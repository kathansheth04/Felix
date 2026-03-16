import { useState, useEffect } from 'react'
import type { Project, ProjectView } from '../types'
import { cn } from '../lib/utils'
import {
  Kanban,
  Activity,
  Settings,
  SlidersHorizontal,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

const STORAGE_KEY = 'felix-sidebar-collapsed'

interface ProjectRailProps {
  activeProject: Project | null
  projectView: ProjectView
  onSetProjectView: (view: ProjectView) => void
  onOpenGlobalSettings: () => void
}

export function ProjectRail({
  activeProject,
  projectView,
  onSetProjectView,
  onOpenGlobalSettings,
}: ProjectRailProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed))
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const widthClass = collapsed ? 'w-14' : 'w-60'
  const showLabels = !collapsed

  return (
    <aside className={cn(widthClass, 'shrink-0 flex flex-col border-r border-border/60 bg-card/40 overflow-hidden transition-[width] duration-200')}>
      {/* Collapse toggle — top of sidebar */}
      <div className="shrink-0 border-b border-border/50 py-2 px-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'w-full flex items-center rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all duration-200',
            showLabels ? 'justify-start gap-3 px-3 py-2' : 'justify-center p-2'
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
          {showLabels && <span>Collapse</span>}
        </button>
      </div>

      {/* Project views — when a project is selected */}
      {activeProject && (
        <div className="flex-1 border-b border-border/50 py-2 px-2">
          {showLabels && (
            <div className="px-2.5 mb-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                {activeProject.name}
              </span>
            </div>
          )}
          <div className="space-y-0.5">
            <NavItem
              icon={<Kanban className="h-4 w-4" />}
              label="Board"
              showLabel={showLabels}
              active={projectView === 'board'}
              onClick={() => onSetProjectView('board')}
            />
            <NavItem
              icon={<Activity className="h-4 w-4" />}
              label="Sessions"
              showLabel={showLabels}
              active={projectView === 'sessions'}
              onClick={() => onSetProjectView('sessions')}
            />
            <NavItem
              icon={<Inbox className="h-4 w-4" />}
              label="Backlog"
              showLabel={showLabels}
              active={projectView === 'backlog'}
              onClick={() => onSetProjectView('backlog')}
            />
            <NavItem
              icon={<Settings className="h-4 w-4" />}
              label="Settings"
              showLabel={showLabels}
              active={projectView === 'settings'}
              onClick={() => onSetProjectView('settings')}
            />
          </div>
        </div>
      )}

      {/* API & Credentials */}
      <div className="border-t border-border/50 py-2 px-2">
        <NavItem
          icon={<SlidersHorizontal className="h-4 w-4" />}
          label="API & Credentials"
          showLabel={showLabels}
          active={false}
          onClick={onOpenGlobalSettings}
        />
      </div>
    </aside>
  )
}

function NavItem({
  icon,
  label,
  showLabel,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  showLabel: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-all duration-200',
        showLabel ? 'justify-start px-3' : 'justify-center',
        active
          ? 'bg-primary/12 text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50 hover:translate-x-0.5'
      )}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </button>
  )
}
