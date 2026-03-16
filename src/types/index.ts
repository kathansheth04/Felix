// ─── App navigation ──────────────────────────────────────────────────────────

export type AppView = 'dashboard' | 'project' | 'global-settings'
export type ProjectView = 'board' | 'backlog' | 'sessions' | 'settings'

// ─── Enums ───────────────────────────────────────────────────────────────────

export type TicketStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'PLAN_REVIEW'  // legacy; migrated to IN_PROGRESS, kept for backwards compat
  | 'DEV_COMPLETE'
  | 'IN_REVIEW'
  | 'DONE'
  | 'BLOCKED'

export type BlockedReason = 'FAILED' | 'NEEDS_HUMAN' | 'PAUSED' | 'CRASHED' | 'GIT_ERROR'

export type ExecutionMode = 'PLANNING' | 'IMPLEMENTATION' | 'REVISION'

export type ExecutionStatus =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'CRASHED'

export type AgentRuntime = 'claude-agent-sdk'

// ─── Domain Models ────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  repo_url: string
  default_branch: string
  agent_runtime: AgentRuntime
  created_at: string
}

export interface Ticket {
  id: string
  project_id: string
  title: string
  description: string | null
  acceptance_criteria: string | null
  test_commands: string | null
  additional_information: string | null
  status: TicketStatus
  branch_name: string | null
  pr_url: string | null
  pr_number: number | null
  blocked_reason: BlockedReason | null
  plan: string | null
  require_plan_review: number
  created_at: string
  updated_at: string
}

export interface Execution {
  id: string
  ticket_id: string
  mode: ExecutionMode
  status: ExecutionStatus
  current_step: string | null
  retry_count: number
  started_at: string
  completed_at: string | null
}

export interface LogEntry {
  id: string
  execution_id: string
  step: string | null
  message: string
  timestamp: string
}

export interface PlanMessage {
  id: string
  ticket_id: string
  role: 'agent' | 'human'
  content: string
  created_at: string
}

// ─── IPC Event Payloads ───────────────────────────────────────────────────────

export interface ExecutionLogEvent {
  event: 'execution-log'
  execution_id: string
  ticket_id: string
  message: string
  timestamp: string
}

export interface TicketStatusChangedEvent {
  event: 'ticket-status-changed'
  ticket_id: string
  new_status: TicketStatus
  blocked_reason?: BlockedReason
}

export interface PlanUpdatedEvent {
  event: 'plan-updated'
  ticket_id: string
  plan: string
}

export interface PlanMessageEvent {
  event: 'plan-message'
  ticket_id: string
  message: PlanMessage
}

export interface PlanQuestionOption {
  label: string
  description: string
}

export interface PlanQuestion {
  question: string
  header: string
  options: PlanQuestionOption[]
  multiSelect?: boolean
}

export interface PlanQuestionEvent {
  event: 'plan-question'
  ticket_id: string
  questions: PlanQuestion[]
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export interface KanbanColumn {
  id: TicketStatus
  label: string
  tickets: Ticket[]
}

// Valid human-initiated transitions from each status
export const HUMAN_TRANSITIONS: Partial<Record<TicketStatus, TicketStatus[]>> = {
  BACKLOG: ['TODO'],
  TODO: ['IN_PROGRESS', 'BACKLOG'],
  IN_PROGRESS: ['TODO'],
  QUEUED: ['TODO'],
  DEV_COMPLETE: ['IN_REVIEW', 'DONE', 'TODO'],
  BLOCKED: ['TODO', 'DEV_COMPLETE', 'BACKLOG']
}

// Columns shown on the board (IN_REVIEW is shown but locked)
// PLAN_REVIEW tickets appear under In Progress
// Backlog is a separate screen — board shows only active work (To Do = current sprint/week)
export const BOARD_COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: 'TODO', label: 'To Do' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'DEV_COMPLETE', label: 'Dev Complete' },
  { id: 'IN_REVIEW', label: 'In Review' },
  { id: 'DONE', label: 'Done' },
  { id: 'BLOCKED', label: 'Blocked' }
]

export const BLOCKED_REASON_ICON: Record<BlockedReason, string> = {
  FAILED: '⚠️',
  NEEDS_HUMAN: '❓',
  PAUSED: '⏸️',
  CRASHED: '⚠️',
  GIT_ERROR: '⚠️'
}

export const BLOCKED_REASON_LABEL: Record<BlockedReason, string> = {
  FAILED: 'Could not satisfy tests after 3 attempts',
  NEEDS_HUMAN: 'Requires human clarification',
  PAUSED: 'Claude usage limit reached',
  CRASHED: 'Unexpected agent exit',
  GIT_ERROR: 'Git pull failed'
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

export interface GitHubUser {
  login: string
  name: string
  email: string
  avatar_url: string
}

// ─── Window API (injected by preload) ────────────────────────────────────────

export interface WindowAPI {
  createProject: (params: { name: string; repo_url: string; default_branch: string }) => Promise<Project>
  listProjects: () => Promise<Project[]>
  updateProject: (params: { project_id: string; name?: string; repo_url?: string; default_branch?: string; agent_runtime?: string }) => Promise<Project>
  deleteProject: (params: { project_id: string }) => Promise<{ deleted: string }>
  createTicket: (params: { project_id: string; title: string; description?: string; acceptance_criteria?: string; test_commands?: string; additional_information?: string; require_plan_review?: number }) => Promise<Ticket>
  updateTicket: (params: { ticket_id: string; title?: string; description?: string; acceptance_criteria?: string; test_commands?: string; additional_information?: string; require_plan_review?: number }) => Promise<Ticket>
  moveTicket: (params: { ticket_id: string; new_status: string }) => Promise<Ticket>
  listTickets: (params: { project_id: string }) => Promise<Ticket[]>
  getTicket: (params: { ticket_id: string }) => Promise<Ticket>
  getExecutionLogs: (params: { execution_id: string }) => Promise<LogEntry[]>
  listExecutions: (params: { project_id?: string; ticket_id?: string }) => Promise<Execution[]>
  cancelExecution: (params: { ticket_id: string }) => Promise<void>
  deleteTicket: (params: { ticket_id: string }) => Promise<{ deleted: string }>
  approvePlan: (params: { ticket_id: string; approval_feedback?: string }) => Promise<Ticket>
  submitPlanFeedback: (params: { ticket_id: string; message: string }) => Promise<PlanMessage>
  submitPlanAnswer: (params: { ticket_id: string; answers: Record<string, string> }) => Promise<{ ok: boolean }>
  rejectPlan: (params: { ticket_id: string }) => Promise<Ticket>
  getPlanMessages: (params: { ticket_id: string }) => Promise<PlanMessage[]>
  checkDependencies: () => Promise<{ python: boolean; claude_agent_sdk: boolean; git: boolean }>
  getCredentials: () => Promise<{ anthropic_api_key: string; github_token: string; git_name: string; git_email: string }>
  setCredentials: (params: { anthropic_api_key?: string; github_token?: string; git_name?: string; git_email?: string }) => Promise<void>
  validateGithubToken: (params: { token: string }) => Promise<GitHubUser>
  onExecutionLog: (cb: (data: ExecutionLogEvent) => void) => () => void
  onTicketStatusChanged: (cb: (data: TicketStatusChangedEvent) => void) => () => void
  onPlanUpdated: (cb: (data: PlanUpdatedEvent) => void) => () => void
  onPlanMessage: (cb: (data: PlanMessageEvent) => void) => () => void
  onPlanQuestion: (cb: (data: PlanQuestionEvent) => void) => () => void
  onPlanningStarted: (cb: (data: { ticket_id: string }) => void) => () => void
  onPlanningEnded: (cb: (data: { ticket_id: string }) => void) => () => void
  onImplementationStarted: (cb: (data: { ticket_id: string }) => void) => () => void
  onImplementationEnded: (cb: (data: { ticket_id: string }) => void) => () => void
}

declare global {
  interface Window {
    api: WindowAPI
  }
}
