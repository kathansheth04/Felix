import { cn } from '../lib/utils'
import type { Project, ProjectView } from '../types'
import {
  Kanban,
  Activity,
  Settings,
  SlidersHorizontal,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

interface SidebarProps {
  projectView: ProjectView
  activeProject: Project | null
  collapsed: boolean
  onToggleCollapse: () => void
  onGoToDashboard: () => void
  onSetProjectView: (view: ProjectView) => void
  onOpenGlobalSettings: () => void
}

export function Sidebar({
  projectView,
  activeProject,
  collapsed,
  onToggleCollapse,
  onGoToDashboard,
  onSetProjectView,
  onOpenGlobalSettings,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border/60 shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out bg-background/50 backdrop-blur-sm',
        collapsed ? 'w-[56px]' : 'w-[220px]'
      )}
    >
      {/* Header: back button (expanded) + collapse toggle (always) */}
      <div
        className={cn(
          'flex items-center h-12 shrink-0 border-b border-border/50',
          collapsed ? 'justify-center' : 'px-3 gap-2'
        )}
      >
        {!collapsed && (
          <button
            onClick={onGoToDashboard}
            className="flex items-center gap-2 flex-1 min-w-0 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{activeProject?.name ?? 'Project'}</span>
          </button>
        )}

        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
        >
          {collapsed
            ? <PanelLeftOpen className="h-4 w-4" />
            : <PanelLeftClose className="h-4 w-4" />
          }
        </button>
      </div>

      {/* Nav items */}
      <nav
        className={cn(
          'flex-1 py-4 space-y-0.5 overflow-hidden',
          collapsed ? 'px-2' : 'px-3'
        )}
      >
        {/* Back to projects — only visible when collapsed */}
        {collapsed && (
          <NavItem
            icon={<ChevronLeft className="h-4 w-4" />}
            label="Back to Projects"
            active={false}
            collapsed={collapsed}
            onClick={onGoToDashboard}
          />
        )}

        <NavItem
          icon={<Kanban className="h-4 w-4" />}
          label="Board"
          active={projectView === 'board'}
          collapsed={collapsed}
          onClick={() => onSetProjectView('board')}
        />
        <NavItem
          icon={<Activity className="h-4 w-4" />}
          label="Sessions"
          active={projectView === 'sessions'}
          collapsed={collapsed}
          onClick={() => onSetProjectView('sessions')}
        />
        <NavItem
          icon={<Settings className="h-4 w-4" />}
          label="Settings"
          active={projectView === 'settings'}
          collapsed={collapsed}
          onClick={() => onSetProjectView('settings')}
        />
      </nav>

      {/* Bottom: global settings */}
      <div
        className={cn(
          'border-t border-border/50 py-2',
          collapsed ? 'px-1.5' : 'px-2'
        )}
      >
        <NavItem
          icon={<SlidersHorizontal className="h-4 w-4" />}
          label="API & Credentials"
          active={false}
          collapsed={collapsed}
          onClick={onOpenGlobalSettings}
        />
      </div>
    </aside>
  )
}

function NavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-lg text-sm font-medium transition-all duration-200',
        collapsed
          ? 'justify-center h-9 w-9 mx-auto'
          : 'w-full gap-3 px-3 py-2',
        active
          ? cn('bg-primary/15 text-primary', !collapsed && 'border-l-2 border-primary -ml-px pl-[calc(0.75rem+2px)]')
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
      )}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
}
