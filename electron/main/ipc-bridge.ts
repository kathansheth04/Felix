import { app, ipcMain, BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { request as httpsRequest } from 'https'

type WindowGetter = () => BrowserWindow | null

let pythonProcess: ChildProcess | null = null
let isShuttingDown = false
let windowGetter: WindowGetter = () => null

// ─── Credential Storage (userData, restricted permissions) ────────────────────
// Stored as JSON in userData with 0o600 — no Keychain prompt, still user-private.

interface StoredCredentials {
  anthropic_api_key: string
  github_token: string
  git_name: string
  git_email: string
}

const CREDENTIALS_MODE = 0o600

function credentialsPath(): string {
  return join(app.getPath('userData'), 'credentials.json')
}

function loadCredentials(): StoredCredentials {
  const empty = { anthropic_api_key: '', github_token: '', git_name: '', git_email: '' }
  try {
    if (!existsSync(credentialsPath())) return empty
    const data = JSON.parse(readFileSync(credentialsPath(), 'utf-8'))
    return { ...empty, ...data }
  } catch {
    return empty
  }
}

function saveCredentials(creds: Partial<StoredCredentials>): void {
  const existing = loadCredentials()
  const updated = { ...existing, ...creds }
  writeFileSync(credentialsPath(), JSON.stringify(updated), { mode: CREDENTIALS_MODE })
}

// ─── GitHub API Helper ────────────────────────────────────────────────────────

interface GitHubUser {
  login: string
  name: string
  email: string
  avatar_url: string
}

function githubGet(path: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: 'api.github.com',
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Felix',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub returned ${res.statusCode}: ${data}`))
            return
          }
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON from GitHub API')) }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

// ─── Pending JSON-RPC requests awaiting Python response, keyed by request ID
const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()

// Write a JSON-RPC request to Python stdin
function callPython(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!pythonProcess?.stdin) {
      return reject(new Error('Python backend not running'))
    }

    const id = randomUUID()
    pendingRequests.set(id, { resolve, reject })

    const request = JSON.stringify({ id, method, params })
    pythonProcess.stdin.write(request + '\n')

    // Timeout after 30s for most requests, 5min for long-running
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }
    }, 300_000)
  })
}

export function startPythonBackend(getWindow: WindowGetter): void {
  windowGetter = getWindow

  const creds = loadCredentials()
  const env = { ...process.env }
  if (creds.anthropic_api_key) env['ANTHROPIC_API_KEY'] = creds.anthropic_api_key
  if (creds.github_token)      env['GITHUB_TOKEN']       = creds.github_token
  if (creds.git_name)  { env['GIT_AUTHOR_NAME']    = creds.git_name;  env['GIT_COMMITTER_NAME']  = creds.git_name  }
  if (creds.git_email) { env['GIT_AUTHOR_EMAIL']   = creds.git_email; env['GIT_COMMITTER_EMAIL'] = creds.git_email }

  const bundledPython = join(process.resourcesPath, 'python-env', 'python', 'bin', 'python3')
  const pythonBin = app.isPackaged
    ? bundledPython
    : (process.platform === 'win32' ? 'python' : 'python3')

  if (app.isPackaged) {
    env['PYTHONNOUSERSITE'] = '1'
    env['PYTHONUNBUFFERED'] = '1'
    const bundledBinDir = join(process.resourcesPath, 'python-env', 'python', 'bin')
    const sep = process.platform === 'win32' ? ';' : ':'
    env['PATH'] = `${bundledBinDir}${sep}${env['PATH'] ?? ''}`
  }
  const appPath = app.getAppPath()
  const cwd = app.isPackaged
    ? join(appPath, '..', 'app.asar.unpacked')
    : appPath
  pythonProcess = spawn(pythonBin, ['-m', 'backend.server'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let stdoutBuffer = ''

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.event) {
          // Push event to renderer
          const win = getWindow()
          win?.webContents.send(parsed.event, parsed)
        } else if (parsed.id && pendingRequests.has(parsed.id)) {
          // JSON-RPC response
          const pending = pendingRequests.get(parsed.id)!
          pendingRequests.delete(parsed.id)
          if (parsed.error) {
            pending.reject(new Error(parsed.error.message))
          } else {
            pending.resolve(parsed.result)
          }
        }
      } catch {
        // Non-JSON output from Python (e.g. print statements during dev) — ignore
      }
    }
  })

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[Python]', data.toString())
  })

  pythonProcess.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      console.error(`Python backend exited unexpectedly: code=${code} signal=${signal}`)
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error('Python backend exited unexpectedly'))
        pendingRequests.delete(id)
      }
      // Attempt restart after short delay
      setTimeout(() => startPythonBackend(getWindow), 2000)
    }
  })
}

export function stopPythonBackend(): void {
  isShuttingDown = true
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM')
    pythonProcess = null
  }
}

// IPC methods that proxy to Python backend
const IPC_METHODS = [
  'create_project',
  'list_projects',
  'update_project',
  'delete_project',
  'create_ticket',
  'update_ticket',
  'move_ticket',
  'list_tickets',
  'get_ticket',
  'get_execution_logs',
  'list_executions',
  'cancel_execution',
  'delete_ticket',
  'check_dependencies',
  'approve_plan',
  'submit_plan_feedback',
  'submit_plan_answer',
  'reject_plan',
  'get_plan_messages'
] as const

export function setupIpcBridge(getWindow: WindowGetter): void {
  for (const method of IPC_METHODS) {
    ipcMain.handle(method, async (_event, params: Record<string, unknown> = {}) => {
      return callPython(method, params)
    })
  }

  ipcMain.handle('get_credentials', async () => {
    return loadCredentials()
  })

  ipcMain.handle('set_credentials', async (_event, params: Partial<StoredCredentials>) => {
    saveCredentials(params)
    // Restart Python so it picks up the new env vars immediately
    isShuttingDown = true
    if (pythonProcess) {
      pythonProcess.kill('SIGTERM')
      pythonProcess = null
    }
    isShuttingDown = false
    startPythonBackend(getWindow)
  })

  ipcMain.handle('validate_github_token', async (_event, { token }: { token: string }): Promise<GitHubUser> => {
    const [userRaw, emailsRaw] = await Promise.all([
      githubGet('/user', token),
      githubGet('/user/emails', token).catch(() => []),
    ])

    const user = userRaw as { login: string; name: string | null; email: string | null; avatar_url: string }
    const emails = emailsRaw as { email: string; primary: boolean; verified: boolean }[]

    const primaryEmail =
      (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.primary))?.email ||
      user.email ||
      ''

    return {
      login: user.login,
      name: user.name || user.login,
      email: primaryEmail,
      avatar_url: user.avatar_url,
    }
  })
}
