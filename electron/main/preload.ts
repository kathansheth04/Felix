import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Typed API exposed to renderer via window.api
const api = {
  // Projects
  createProject: (params: { name: string; repo_url: string; default_branch: string }) =>
    ipcRenderer.invoke('create_project', params),

  listProjects: () =>
    ipcRenderer.invoke('list_projects', {}),

  updateProject: (params: { project_id: string; name?: string; repo_url?: string; default_branch?: string; agent_runtime?: string }) =>
    ipcRenderer.invoke('update_project', params),

  deleteProject: (params: { project_id: string }) =>
    ipcRenderer.invoke('delete_project', params),

  // Tickets
  createTicket: (params: {
    project_id: string
    title: string
    description?: string
    acceptance_criteria?: string
    test_commands?: string
    additional_information?: string
  }) => ipcRenderer.invoke('create_ticket', params),

  updateTicket: (params: {
    ticket_id: string
    title?: string
    description?: string
    acceptance_criteria?: string
    test_commands?: string
    additional_information?: string
  }) => ipcRenderer.invoke('update_ticket', params),

  moveTicket: (params: { ticket_id: string; new_status: string }) =>
    ipcRenderer.invoke('move_ticket', params),

  listTickets: (params: { project_id: string }) =>
    ipcRenderer.invoke('list_tickets', params),

  getTicket: (params: { ticket_id: string }) =>
    ipcRenderer.invoke('get_ticket', params),

  // Executions
  getExecutionLogs: (params: { execution_id: string }) =>
    ipcRenderer.invoke('get_execution_logs', params),

  listExecutions: (params: { project_id?: string; ticket_id?: string }) =>
    ipcRenderer.invoke('list_executions', params),

  cancelExecution: (params: { ticket_id: string }) =>
    ipcRenderer.invoke('cancel_execution', params),

  deleteTicket: (params: { ticket_id: string }) =>
    ipcRenderer.invoke('delete_ticket', params),

  // Plan Review
  approvePlan: (params: { ticket_id: string; approval_feedback?: string }) =>
    ipcRenderer.invoke('approve_plan', params),

  submitPlanFeedback: (params: { ticket_id: string; message: string }) =>
    ipcRenderer.invoke('submit_plan_feedback', params),

  submitPlanAnswer: (params: { ticket_id: string; answers: Record<string, string> }) =>
    ipcRenderer.invoke('submit_plan_answer', params),

  rejectPlan: (params: { ticket_id: string }) =>
    ipcRenderer.invoke('reject_plan', params),

  getPlanMessages: (params: { ticket_id: string }) =>
    ipcRenderer.invoke('get_plan_messages', params),

  // System
  checkDependencies: () =>
    ipcRenderer.invoke('check_dependencies', {}),

  // Credentials
  getCredentials: () =>
    ipcRenderer.invoke('get_credentials', {}),

  setCredentials: (params: { anthropic_api_key?: string; github_token?: string; git_name?: string; git_email?: string }) =>
    ipcRenderer.invoke('set_credentials', params),

  validateGithubToken: (params: { token: string }) =>
    ipcRenderer.invoke('validate_github_token', params),

  // IPC Event listeners (Python → frontend push)
  onExecutionLog: (callback: (data: ExecutionLogEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ExecutionLogEvent) => callback(data)
    ipcRenderer.on('execution-log', handler)
    return () => ipcRenderer.removeListener('execution-log', handler)
  },

  onTicketStatusChanged: (callback: (data: TicketStatusChangedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TicketStatusChangedEvent) => callback(data)
    ipcRenderer.on('ticket-status-changed', handler)
    return () => ipcRenderer.removeListener('ticket-status-changed', handler)
  },

  onPlanUpdated: (callback: (data: PlanUpdatedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PlanUpdatedEvent) => callback(data)
    ipcRenderer.on('plan-updated', handler)
    return () => ipcRenderer.removeListener('plan-updated', handler)
  },

  onPlanMessage: (callback: (data: PlanMessageEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PlanMessageEvent) => callback(data)
    ipcRenderer.on('plan-message', handler)
    return () => ipcRenderer.removeListener('plan-message', handler)
  },

  onPlanQuestion: (callback: (data: PlanQuestionEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PlanQuestionEvent) => callback(data)
    ipcRenderer.on('plan-question', handler)
    return () => ipcRenderer.removeListener('plan-question', handler)
  },

  onPlanningStarted: (callback: (data: { ticket_id: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { ticket_id: string }) => callback(data)
    ipcRenderer.on('planning-started', handler)
    return () => ipcRenderer.removeListener('planning-started', handler)
  },

  onPlanningEnded: (callback: (data: { ticket_id: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { ticket_id: string }) => callback(data)
    ipcRenderer.on('planning-ended', handler)
    return () => ipcRenderer.removeListener('planning-ended', handler)
  },

  onImplementationStarted: (callback: (data: { ticket_id: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { ticket_id: string }) => callback(data)
    ipcRenderer.on('implementation-started', handler)
    return () => ipcRenderer.removeListener('implementation-started', handler)
  },

  onImplementationEnded: (callback: (data: { ticket_id: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { ticket_id: string }) => callback(data)
    ipcRenderer.on('implementation-ended', handler)
    return () => ipcRenderer.removeListener('implementation-ended', handler)
  }
}

// Types for IPC events
interface ExecutionLogEvent {
  event: 'execution-log'
  execution_id: string
  ticket_id: string
  message: string
  timestamp: string
}

interface TicketStatusChangedEvent {
  event: 'ticket-status-changed'
  ticket_id: string
  new_status: string
  blocked_reason?: string
}

interface PlanUpdatedEvent {
  event: 'plan-updated'
  ticket_id: string
  plan: string
}

interface PlanMessageEvent {
  event: 'plan-message'
  ticket_id: string
  message: { id: string; ticket_id: string; role: string; content: string; created_at: string }
}

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

interface PlanQuestionEvent {
  event: 'plan-question'
  ticket_id: string
  questions: PlanQuestion[]
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
