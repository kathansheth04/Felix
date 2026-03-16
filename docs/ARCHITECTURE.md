# Felix — System Architecture Specification

## Overview

Felix is a desktop application for automating software development tasks using an autonomous coding agent. Built with Electron, the app runs natively on the host machine with direct access to the filesystem, git, and the Claude Agent SDK. A TypeScript/React frontend provides the Kanban interface. A Python backend handles state management, process management, and git operations. The Claude Agent SDK (headless mode via `claude_agent_sdk`) acts as the agent orchestrator — coordinating specialized subagents to implement tickets via TDD, commit changes, and open pull requests for human review.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   Electron Desktop App                       │
│                                                              │
│  ┌──────────────────┐  IPC Bridge  ┌───────────────────────┐│
│  │  React Frontend  │◄────────────►│   Python Backend      ││
│  │  (TypeScript +   │              │   (FastAPI + asyncio) ││
│  │   Vite + React)  │              │                       ││
│  │                  │              │  State Machine        ││
│  │  Kanban Board    │              │  Job Queue            ││
│  │  Sessions Screen │              │  (asyncio tasks)      ││
│  │  Project Settings│              │  SQLite               ││
│  │  Ticket Editor   │              │  Git Operations       ││
│  └──────────────────┘              │  GitHub REST API      ││
│           │                        │  Agent SDK Manager    ││
│           │ Electron IPC events    └──────────┬────────────┘│
│           │◄───────────────────────────────── │             │
│           │  (execution logs, status)          │ python SDK  │
└───────────┼────────────────────────────────── │ ────────────┘
            │                                   │
            │                                   │ claude_agent_sdk.query()
            │                                   ▼
            │                    ┌──────────────────────────┐
            │                    │   Claude Agent SDK       │
            │                    │   (headless mode)        │
            │                    │   claude_agent_sdk       │
            │                    │   permission_mode=       │
            │                    │     'acceptEdits'        │
            │                    └──────────┬───────────────┘
            │                               │ subagents
            │                    ┌──────────┴───────────────┐
            │                    │  /explore                │
            │                    │  /write-tests            │
            │                    │  /implement              │
            │                    │  /review                 │
            │                    │  /git-commit             │
            │                    │  /create-pr              │
            │                    └──────────┬───────────────┘
            │                               │
            │                    ┌──────────▼───────────────┐
            │                    │    Git Workspaces        │
            │                    │  ~/felix-kanban/       │
            │                    │    repo-main/            │
            │                    │    worktrees/            │
            │                    │    .agent/context/       │
            │                    └──────────────────────────┘
            │
            ▼
   IPC events → frontend log viewer
   (streamed line by line via mainWindow.webContents.send)
```

---

## 1. Frontend Layer

**Tech Stack:** Vite, React, TypeScript, TailwindCSS, shadcn/ui, @dnd-kit, Electron IPC

**Why Electron over Tauri:** Electron uses Node.js + Chromium and has a mature TypeScript-first ecosystem. It integrates naturally with a Python backend via IPC child process communication, and avoids Rust complexity while still delivering a native desktop experience.

**Board Columns:** (Backlog is a separate screen, not a column)
```
To Do | In Progress | Dev Complete | In Review | Done | Blocked
```

**Responsibilities:**
- Kanban board with all six columns including Blocked
- Ticket creation and editing (title, description, acceptance criteria, test commands, additional information)
- Enforce transition rules — humans only move cards forward, or back to TODO
- Display PR links and status on cards
- Visual indicators on Blocked cards: FAILED ⚠️, NEEDS_HUMAN ❓, PAUSED ⏸️, CRASHED ⚠️, GIT_ERROR ⚠️ with reason text
- QUEUED badge on cards waiting for a concurrency slot
- Sessions screen: real-time log viewer per execution via Electron IPC events (read-only)
- Project settings: repo URL, default branch, agent runtime selection
- Startup check: verify Python backend and dependencies are available — show setup screen if missing

**Communication with Python backend:**
- **Electron IPC (invoke)** — renderer calls main process handlers for CRUD, state transitions, git operations
- **Electron IPC (send/on)** — main process pushes real-time execution log lines and status changes to renderer

**Blocked Column Card Examples:**
```
┌──────────────────────────────────────────────────────────┐
│ Blocked                                                  │
├──────────────────────────────────────────────────────────┤
│ #101 Add sidebar navigation                          ⚠️  │
│ Could not satisfy tests after 3 attempts                 │
│                                                          │
│ #98  Fix API rate limiting                           ❓  │
│ Acceptance criteria are contradictory                    │
│                                                          │
│ #95  Update user settings                            ⏸️  │
│ Claude usage limit reached                               │
└──────────────────────────────────────────────────────────┘
```

**Sessions Screen:**
```
┌──────────────────────────────────────────────────────────┐
│ Active Sessions                              3 running   │
├──────────────────────────────────────────────────────────┤
│ #101 Add sidebar navigation      RUNNING   3 mins ago   │
│ #98  Fix API rate limiting       RUNNING   7 mins ago   │
│ #95  Update user settings        DONE      1 hour ago   │
│ #91  Add dark mode toggle        BLOCKED   2 hours ago  │
└──────────────────────────────────────────────────────────┘
```

Clicking any row opens the full log view. Blocked sessions surface the reason prominently at the bottom of the log.

---

## 2. Python Backend

**Tech Stack:** Python 3.11+, FastAPI, asyncio, aiosqlite, httpx, GitPython, claude-agent-sdk

**Why Python backend:** The Claude Agent SDK (`claude_agent_sdk`) is a first-class Python package. Using Python as the backend gives native async integration with the SDK — streaming messages, monitoring tool use events, detecting sentinels, and handling cancellation — all without subprocess orchestration or shell piping. asyncio replaces Tokio for async task management.

**Responsibilities:**
- Expose IPC handlers for all frontend interactions (via Electron main process bridge)
- Ticket and project CRUD against SQLite via aiosqlite
- Ticket state machine with transition validation
- Job queue via asyncio tasks with Semaphore concurrency control
- Job deduplication via in-memory active execution tracking
- Invoke Claude Agent SDK sessions (headless mode) and stream messages
- Stream Claude Agent SDK messages line by line → SQLite logs + IPC events to frontend
- Per-repo asyncio Lock for safe concurrent git operations
- Git operations (clone, pull, worktree add/remove, branch management) via GitPython + subprocess
- GitHub REST API calls via httpx
- Startup recovery for crashed executions
- Slash command and `.agent/context/` injection into worktrees

**IPC Handlers (frontend → Python via Electron main):**
```python
# Registered as ipcMain.handle() in Electron main process
create_project(name, repo_url, default_branch) -> Project
list_projects() -> List[Project]
create_ticket(project_id, fields) -> Ticket
update_ticket(ticket_id, fields) -> Ticket
move_ticket(ticket_id, new_status) -> Ticket
list_tickets(project_id) -> List[Ticket]
get_execution_logs(execution_id) -> List[LogEntry]
cancel_execution(ticket_id) -> None
check_dependencies() -> DependencyStatus
```

**IPC Events (Python → frontend via Electron main):**
```python
# Emitted via mainWindow.webContents.send() in Electron main process
{
  "event": "execution-log",
  "execution_id": "...",
  "ticket_id": "...",
  "message": "...",
  "timestamp": "..."
}

{
  "event": "ticket-status-changed",
  "ticket_id": "...",
  "new_status": "...",
  "blocked_reason": "..." | None
}
```

**State Machine — Enforced Transitions:**
```
BACKLOG        → TODO (human — promote to board)
TODO           → IN_PROGRESS (human)
TODO           → BACKLOG (human — send back to backlog)
TODO           → QUEUED (system — concurrency slot unavailable)
QUEUED            → IN_PROGRESS (system — slot becomes available)
IN_PROGRESS       → DEV_COMPLETE (agent sentinel: COMPLETED)
IN_PROGRESS       → BLOCKED (agent sentinel: FAILED | NEEDS_HUMAN | crash | usage limit | git error)
IN_PROGRESS       → TODO (human — triggers cancellation + cleanup)
DEV_COMPLETE      → IN_REVIEW (human)
DEV_COMPLETE      → DONE (human — after merging PR on GitHub)
DEV_COMPLETE      → TODO (human — triggers cancellation + cleanup)
IN_REVIEW         → DEV_COMPLETE (agent sentinel: COMPLETED)
IN_REVIEW         → BLOCKED (agent sentinel: FAILED | NEEDS_HUMAN | crash | usage limit | git error)
BLOCKED           → TODO (human — after refining ticket or resolving blocker)
```

**IN_REVIEW is fully locked to humans** — no human-initiated transitions are permitted from this column. Only the agent can move a ticket out of IN_REVIEW.

**Startup Recovery:**
```python
# Run once on app start before processing any jobs
async def recover_crashed_executions(db, ipc_emitter):
    stuck = await db.fetch_all(
        "SELECT * FROM executions WHERE status = 'IN_PROGRESS'"
    )
    for execution in stuck:
        await db.execute(
            "UPDATE executions SET status = 'CRASHED' WHERE id = ?",
            execution["id"]
        )
        await db.execute(
            "UPDATE tickets SET status = 'BLOCKED', blocked_reason = 'CRASHED' WHERE id = ?",
            execution["ticket_id"]
        )
        ipc_emitter.send("ticket-status-changed", {
            "ticket_id": execution["ticket_id"],
            "new_status": "BLOCKED",
            "blocked_reason": "CRASHED"
        })
```

---

## 3. Electron Main Process (IPC Bridge)

**Tech Stack:** TypeScript, Electron, Node.js child_process

**Responsibilities:**
- Launch Python backend as a managed child process on app start
- Proxy IPC calls between renderer (frontend) and Python backend
- Relay Python backend events to renderer via `mainWindow.webContents.send()`
- Handle app lifecycle (startup, quit, crash recovery trigger)
- Manage Python process health — restart on unexpected exit

**IPC Bridge Pattern:**
```typescript
// main/index.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn, ChildProcess } from 'child_process'

let pythonProcess: ChildProcess

function startPythonBackend() {
  pythonProcess = spawn('python', ['-m', 'backend.server'], {
    env: { ...process.env }
  })

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    const messages = data.toString().split('\n').filter(Boolean)
    for (const msg of messages) {
      const parsed = JSON.parse(msg)
      if (parsed.event) {
        mainWindow.webContents.send(parsed.event, parsed)
      }
    }
  })
}

// Forward IPC calls from renderer to Python via stdin/stdout JSON-RPC
ipcMain.handle('move_ticket', async (_event, ticketId, newStatus) => {
  return await callPython('move_ticket', { ticket_id: ticketId, new_status: newStatus })
})
```

---

## 4. Job Queue (asyncio)

**Tech Stack:** asyncio tasks, asyncio.Semaphore, in-memory set for deduplication

**Concurrency limit of 3:**
```python
semaphore = asyncio.Semaphore(3)

async def enqueue_ticket(ticket_id: str, context: TicketContext):
    async with semaphore:
        await run_execution(ticket_id, context)

# When ticket moves to IN_PROGRESS
asyncio.create_task(enqueue_ticket(ticket_id, context))
```

**Job deduplication:**
```python
# In-memory set of currently active ticket IDs
active_executions: set[str] = set()
active_lock = asyncio.Lock()

async def try_enqueue(ticket_id: str, context: TicketContext) -> bool:
    async with active_lock:
        if ticket_id in active_executions:
            return False  # already running, ignore duplicate
        active_executions.add(ticket_id)

    try:
        await run_execution(ticket_id, context)
    finally:
        async with active_lock:
            active_executions.discard(ticket_id)
    return True
```

If the semaphore is full, ticket enters QUEUED status in SQLite and the asyncio task awaits the semaphore — automatically proceeding when a slot frees.

---

## 5. Runner (Python)

**Purpose:** Owns the Claude Agent SDK session lifecycle. Manages worktree bootstrap, prompt building, SDK session invocation, message streaming, sentinel detection, and cancellation. Runs as part of the Python backend.

**Responsibilities:**
- Determine execution mode (IMPLEMENTATION vs REVISION) from pr_exists flag
- Acquire per-repo asyncio Lock before git pull + worktree operations
- Bootstrap worktree — check if exists first, create only if needed; handle stale branch collision
- Configure authenticated git remote URL and identity using GITHUB_TOKEN
- Inject `.claude/commands/` and `.agent/context/` directories into worktree
- Clear `.agent/context/` at start of every new session (prevents stale handoff files)
- Build and inject appropriate prompt (implementation or revision) with system context
- Invoke Claude Agent SDK via `claude_agent_sdk.query()` in headless mode
- Stream SDK messages → SQLite execution_logs + IPC events to frontend
- Reset inactivity timer on each message received — cancel session and BLOCKED/CRASHED if silent for 15 minutes
- Detect sentinel in TextBlock messages — act after SDK session completes
- Handle cancellation signal → interrupt SDK client → run cleanup
- Update execution status throughout

**Per-Repo Lock (prevents concurrent git pull conflicts):**
```python
# One asyncio.Lock per repo URL, stored in shared state dict
repo_locks: dict[str, asyncio.Lock] = {}

async def get_repo_lock(repo_url: str) -> asyncio.Lock:
    if repo_url not in repo_locks:
        repo_locks[repo_url] = asyncio.Lock()
    return repo_locks[repo_url]

# In runner
lock = await get_repo_lock(repo_url)
async with lock:
    # git pull + worktree creation — sequential per repo
    await git_pull_and_create_worktree(repo_url, ticket_id)

# Lock released — parallel SDK sessions proceed freely
await run_agent_session(ticket_id, prompt, worktree_path)
```

**Execution Mode Determination:**
```python
# Mode determined by whether a PR already exists for this ticket —
# not by comment count. A reviewer may approve with no comments.
mode = ExecutionMode.REVISION if context.pr_exists else ExecutionMode.IMPLEMENTATION
```

**Execution Flow:**
```
Enqueue asyncio task (awaits Semaphore if concurrency full → QUEUED)
  → current_step = "bootstrap"
  → Acquire repo lock
      → git pull repo-main
          → if git pull fails: release lock → ticket → BLOCKED (blocked_reason = GIT_ERROR) → abort
      → Create worktree if not exists:
          → if branch already exists (stale from a previous crashed run): delete stale worktree + branch first
          → git worktree add -b ticket-{id} main
  → Release repo lock
  → Install dependencies inside worktree (npm install / equivalent)
  → Inject .claude/commands/ into worktree
  → Clear and recreate .agent/context/ directory in worktree
  → Determine mode: pr_exists ? REVISION : IMPLEMENTATION
  → If REVISION: fetch PR comment bodies from GitHub REST API via httpx
  → Build prompt with mode + ticket context + system context
  → current_step = "agent_running"
  → Invoke claude_agent_sdk.query(prompt=prompt, options=ClaudeAgentOptions(
        cwd=worktree_path,
        permission_mode='acceptEdits',
        allowed_tools=['Read', 'Write', 'Bash', 'Grep', 'Glob']
    ))
      async for message in sdk_session:
          stream message text → SQLite execution_logs + IPC event to frontend
          reset inactivity timer on each message received
          if no messages for 15 minutes: cancel task → ticket → BLOCKED (blocked_reason = CRASHED)
          watch for cancellation signal
          track last TextBlock content for sentinel detection
  → Session completes:
      parse sentinel from last TextBlock content
      COMPLETED   → ticket → DEV_COMPLETE, write pr_url + pr_number + branch_name to ticket
      FAILED      → ticket → BLOCKED (blocked_reason = FAILED)
      NEEDS_HUMAN → ticket → BLOCKED (blocked_reason = NEEDS_HUMAN)
      no sentinel + usage limit in output → ticket → BLOCKED (blocked_reason = PAUSED)
      no sentinel + otherwise             → ticket → BLOCKED (blocked_reason = CRASHED)
  → Cancellation signal received:
      interrupt SDK client → run cleanup sequence → ticket → TODO
  → Emit ticket-status-changed IPC event to frontend
```

**Sentinel Detection (last TextBlock content):**
```python
import json
from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, TextBlock

last_text_content = ""

options = ClaudeAgentOptions(
    cwd=worktree_path,
    permission_mode='acceptEdits',
    allowed_tools=['Read', 'Write', 'Bash', 'Grep', 'Glob']
)

async for message in query(prompt=prompt, options=options):
    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock):
                # Stream to logs and frontend
                await db.insert_log(execution_id, block.text)
                ipc_emitter.send("execution-log", {
                    "execution_id": execution_id,
                    "message": block.text
                })
                stripped = block.text.strip()
                if stripped:
                    last_text_content = stripped

# SDK session complete — parse sentinel from last text content
sentinel = parse_sentinel(last_text_content)

def parse_sentinel(text: str) -> dict | None:
    try:
        value = json.loads(text)
        if value.get("status") in ("COMPLETED", "FAILED", "NEEDS_HUMAN"):
            return value
    except (json.JSONDecodeError, AttributeError):
        pass
    return None
```

**Cancellation Cleanup Sequence:**
```
1. Mark execution CANCELLED in SQLite
2. Cancel asyncio task (task.cancel())
3. Close PR on GitHub via REST API (if exists)
4. Delete remote branch via REST API (if exists)
5. Remove local worktree (git worktree remove --force)
6. Delete local branch (git branch -D)
7. Clear tickets.branch_name in SQLite
8. Set ticket → TODO in SQLite
9. Emit ticket-status-changed IPC event to frontend
```

Cancellation only processed between pipeline steps — git operations never interrupted mid-execution.

---

## 6. Claude Agent SDK Integration (Headless Mode)

**Package:** `claude-agent-sdk` (Python) — `pip install claude-agent-sdk`

**Why Claude Agent SDK over Claude Code CLI:** The SDK provides native Python async integration — no subprocess management, no stdout parsing, no shell invocation. Messages arrive as typed Python objects (`AssistantMessage`, `TextBlock`, `ToolUseBlock`). The SDK handles context compaction, the agent loop, and tool execution internally. Cancellation is handled via asyncio task cancellation rather than `os.kill()`.

**SDK Invocation:**
```python
from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, TextBlock, ToolUseBlock

options = ClaudeAgentOptions(
    cwd=str(worktree_path),           # scoped to worktree directory
    permission_mode='acceptEdits',    # auto-accept file edits
    allowed_tools=['Read', 'Write', 'Bash', 'Grep', 'Glob'],
    system_prompt=None,               # use default Claude Code system prompt
)

async for message in query(prompt=prompt, options=options):
    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock):
                await handle_text(block.text)
            elif isinstance(block, ToolUseBlock):
                await handle_tool_use(block.name, block.input)
```

**Security Boundary:**
- The host OS user account is the security boundary — no container isolation
- SDK `cwd` is scoped to the worktree directory
- `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` are host environment variables, inherited by the SDK process

**AgentRuntime Interface:**
```python
from abc import ABC, abstractmethod
from pathlib import Path

class AgentRuntime(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def run(self, prompt: str, worktree_path: Path) -> AsyncIterator[str]: ...

    @abstractmethod
    def detect_usage_limit_error(self, output: str) -> bool: ...

    @abstractmethod
    def parse_sentinel(self, text: str) -> dict | None: ...

class ClaudeAgentSDKRuntime(AgentRuntime):
    @property
    def name(self) -> str:
        return "claude-agent-sdk"

    async def run(self, prompt: str, worktree_path: Path):
        from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, TextBlock
        options = ClaudeAgentOptions(
            cwd=str(worktree_path),
            permission_mode='acceptEdits',
            allowed_tools=['Read', 'Write', 'Bash', 'Grep', 'Glob']
        )
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock) and block.text.strip():
                        yield block.text

    def detect_usage_limit_error(self, output: str) -> bool:
        return "usage limit" in output.lower()

    def parse_sentinel(self, text: str) -> dict | None:
        try:
            value = json.loads(text.strip())
            if value.get("status") in ("COMPLETED", "FAILED", "NEEDS_HUMAN"):
                return value
        except (json.JSONDecodeError, AttributeError):
            pass
        return None
```

---

## 7. Agent Prompts

Two prompt templates exist — selected by the runner based on execution mode. Identical content to the original architecture; only the delivery mechanism changes (passed as `prompt=` to `claude_agent_sdk.query()` instead of CLI `-p` flag).

### Implementation Prompt
Used when: first execution of a ticket (no existing PR)

```
MODE: IMPLEMENTATION

You are an autonomous software engineer implementing a new ticket from
scratch using test-driven development. Coordinate specialist subagents
via slash commands for focused, high-quality work.

TICKET:
Title: {title}
Description: {description}
Acceptance Criteria: {acceptance_criteria}
Test Commands: {test_commands}

ADDITIONAL INFORMATION (human-provided guidance):
{additional_information}

WORKFLOW:
1. Use /explore — understand relevant codebase context
   (output written to .agent/context/explorer.md)
2. Use /write-tests — write failing tests from acceptance criteria
   (output written to .agent/context/test-files.md)
3. Run {test_commands} — confirm FAIL before proceeding
4. Use /implement — write implementation satisfying the tests
5. Run {test_commands} — confirm PASS before proceeding
6. Run: git diff HEAD
   Use /review — validate all changes
   (output written to .agent/context/review-result.md)
7. If /review returns FIX_REQUESTS:
   - Use /implement with fix list
   - Repeat from step 5
   - Maximum 3 implement/review cycles total
8. Once /review returns APPROVED:
   - Use /git-commit to commit all changes
   - Use /create-pr to push branch and open pull request
9. Output sentinel line and exit

CONSTRAINTS:
- Never call /implement before tests are confirmed red
- Never call /review before tests are confirmed green
- Never call /git-commit before /review returns APPROVED
- Do not commit or push manually — use /git-commit and /create-pr only
- Unit and functional tests only — no E2E tests
- Mock all external dependencies in tests
- Do not modify files outside the scope of this ticket
- If 3 implement/review cycles are exhausted — output FAILED sentinel

WHEN YOU CANNOT PROCEED:
Output NEEDS_HUMAN sentinel immediately if you encounter:
- Contradictory acceptance criteria
- Required file or component that does not exist in codebase
- Implementation requiring architectural changes beyond ticket scope
- Existing tests that directly conflict with this ticket's requirements
Do not guess. Do not proceed past a genuine blocker.

FINAL OUTPUT — output exactly one as your last line, then exit:
{"status": "COMPLETED", "pr_url": "...", "pr_number": 123, "branch": "ticket-{id}"}
{"status": "FAILED", "reason": "..."}
{"status": "NEEDS_HUMAN", "reason": "..."}
```

### Revision Prompt
Used when: ticket moves Dev Complete → In Review (existing PR, comment cycle)

```
MODE: REVISION

You are addressing review comments on an existing pull request.
Do not re-implement from scratch. Do not open a new PR.

TICKET:
Title: {title}
Description: {description}
Acceptance Criteria: {acceptance_criteria}
Test Commands: {test_commands}

SYSTEM CONTEXT (injected by runner — do not modify):
Branch: {branch_name}
PR Number: {pr_number}
PR URL: {pr_url}
Unresolved Comments:
  - [{comment_id}] {file_path} line {line}: "{body}"
  - [{comment_id}] {file_path} line {line}: "{body}"

ADDITIONAL INFORMATION (human-provided guidance):
{additional_information}

WORKFLOW:
1. Use /explore — read current state of files referenced in comments
2. Address each unresolved comment by modifying relevant files
3. Run {test_commands} — confirm all existing tests still pass
4. Run: git diff HEAD
   Use /review — validate changes
5. If /review returns FIX_REQUESTS — apply fixes, repeat (max 3 cycles)
6. Once /review returns APPROVED:
   - Use /git-commit to commit all changes to existing branch
   - Do not create a new PR
7. Output sentinel line and exit

FINAL OUTPUT — output exactly one as your last line, then exit:
{"status": "COMPLETED", "pr_url": "{existing_pr_url}", "branch": "{branch_name}"}
{"status": "FAILED", "reason": "..."}
{"status": "NEEDS_HUMAN", "reason": "..."}
```

---

## 8. Slash Commands

Commands live in `.claude/commands/` and are injected into every worktree by the runner. They are system-owned — not managed by the target repository.

Subagents communicate via files in `.agent/context/` rather than prompt arguments, avoiding argument length limits and enabling reliable large-output handoff.

```
.claude/commands/
  explore.md
  write-tests.md
  implement.md
  review.md
  git-commit.md
  create-pr.md

.agent/context/           ← cleared and recreated by runner before each session
  explorer.md             ← written by /explore, read by /write-tests and /implement
  test-files.md           ← written by /write-tests, read by /implement
  review-result.md        ← written by /review, read by main agent
```

All slash command content is identical to the original architecture — the commands themselves are unchanged. The only difference is they are now invoked within a Claude Agent SDK session rather than a standalone Claude Code CLI process.

---

## 9. Git Workspace Strategy

Identical to original architecture. The target repo is cloned **once per project**. Git worktrees share the object store — no re-cloning per ticket. Worktrees persist for the full lifetime of a ticket and are deleted only when the ticket moves to DONE or TODO.

**Workspace Structure:**
```
~/felix-kanban/
  {repo-name}/
    repo-main/            ← single clone, always kept current
      .git/               ← shared object store
    worktrees/
      ticket-101/         ← persists until DONE or TODO
        node_modules/     ← installed independently per worktree
        .claude/commands/ ← injected by runner
        .agent/context/   ← subagent handoff files, cleared each session
      ticket-102/
```

**Git operations** use GitPython for Python-native integration:
```python
import subprocess

async def git_pull_repo_main(repo_path: Path) -> None:
    result = await asyncio.create_subprocess_exec(
        'git', '-C', str(repo_path), 'pull', 'origin', default_branch,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await result.communicate()
    if result.returncode != 0:
        raise GitError(f"git pull failed: {stderr.decode()}")
```

---

## 10. GitHub REST API Operations

All GitHub operations use `httpx` with `Authorization: Bearer ${GITHUB_TOKEN}`. The `gh` CLI is never used.

```python
import httpx
import os

async def github_request(method: str, path: str, **kwargs) -> dict:
    token = os.environ["GITHUB_TOKEN"]
    async with httpx.AsyncClient() as client:
        response = await client.request(
            method,
            f"https://api.github.com{path}",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            **kwargs
        )
        response.raise_for_status()
        return response.json()

# Create PR
await github_request("POST", f"/repos/{owner}/{repo}/pulls", json={
    "title": title,
    "body": body,
    "head": branch,
    "base": default_branch
})

# Fetch PR comments (revision cycle)
comments = await github_request("GET", f"/repos/{owner}/{repo}/pulls/{pr_number}/comments")

# Close PR (cancellation)
await github_request("PATCH", f"/repos/{owner}/{repo}/pulls/{pr_number}", json={"state": "closed"})

# Delete remote branch (cancellation)
await github_request("DELETE", f"/repos/{owner}/{repo}/git/refs/heads/{branch}")
```

All GitHub API calls are wrapped in retry logic with exponential backoff.

---

## 11. Database Schema

**Database:** SQLite (embedded, no server required)
**Location:** `{app_data_dir}/felix/db.sqlite`
**Migrations:** versioned `.sql` migration files applied via aiosqlite

**Projects Table:**
```sql
id             TEXT PRIMARY KEY    -- UUID as text
name           TEXT NOT NULL
repo_url       TEXT NOT NULL       -- full https://github.com/owner/repo URL
default_branch TEXT NOT NULL DEFAULT 'main'
agent_runtime  TEXT NOT NULL DEFAULT 'claude-agent-sdk'
created_at     TEXT NOT NULL       -- ISO 8601
```

**Tickets Table:**
```sql
id                     TEXT PRIMARY KEY
project_id             TEXT NOT NULL REFERENCES projects(id)
title                  TEXT NOT NULL
description            TEXT
acceptance_criteria    TEXT
test_commands          TEXT
additional_information TEXT        -- human-written only, never system-written
status                 TEXT NOT NULL
branch_name            TEXT
pr_url                 TEXT
pr_number              INTEGER
blocked_reason         TEXT        -- FAILED | NEEDS_HUMAN | PAUSED | CRASHED | GIT_ERROR
created_at             TEXT NOT NULL
updated_at             TEXT NOT NULL
```

**Executions Table:**
```sql
id            TEXT PRIMARY KEY
ticket_id     TEXT NOT NULL REFERENCES tickets(id)
mode          TEXT NOT NULL       -- IMPLEMENTATION | REVISION
status        TEXT NOT NULL
current_step  TEXT
retry_count   INTEGER NOT NULL DEFAULT 0
started_at    TEXT NOT NULL
completed_at  TEXT
```

**Execution Logs Table:**
```sql
id            TEXT PRIMARY KEY
execution_id  TEXT NOT NULL REFERENCES executions(id)
step          TEXT
message       TEXT NOT NULL
timestamp     TEXT NOT NULL
```

**Pull Requests Table:**
```sql
id         TEXT PRIMARY KEY
ticket_id  TEXT NOT NULL REFERENCES tickets(id)
pr_url     TEXT
pr_number  INTEGER
status     TEXT
created_at TEXT NOT NULL
```

---

## 12. Ticket Status Enum

```
BACKLOG     — not yet on board; new items start here
TODO        — on board, not started, or returned from Blocked for rework
QUEUED        — waiting for concurrency slot
IN_PROGRESS   — Claude Agent SDK session active
DEV_COMPLETE  — PR open, awaiting human review
IN_REVIEW     — agent addressing PR review comments
DONE          — PR merged, task complete
BLOCKED       — requires human attention (reason in tickets.blocked_reason)
```

**Blocked Reason Values:**
```
FAILED      — agent exhausted implement/review cycles (⚠️)
NEEDS_HUMAN — agent requires clarification to proceed (❓)
PAUSED      — Claude usage limit reached (⏸️)
CRASHED     — unexpected SDK session exit or inactivity timeout (⚠️)
GIT_ERROR   — git pull failed during worktree bootstrap (⚠️)
```

---

## 13. Workflow Example

**Initial Implementation:**
1. Engineer creates ticket with all fields including optional additional information
2. Engineer moves ticket to **In Progress**
3. Python backend validates transition, spawns asyncio task (enters QUEUED if concurrency full)
4. Runner acquires repo lock, pulls repo-main, creates worktree (handles stale branch if needed)
5. Runner releases lock, installs dependencies, injects slash commands, clears `.agent/context/`
6. Runner builds IMPLEMENTATION prompt, invokes Claude Agent SDK via `claude_agent_sdk.query()`
7. Agent SDK runs full TDD workflow via slash commands, outputs COMPLETED sentinel in final TextBlock
8. Runner detects sentinel → writes pr_url/pr_number/branch_name to ticket → ticket moves to **Dev Complete**
9. All SDK messages streamed live via IPC events → Sessions screen

**Revision Cycle:**
10. Engineer reviews PR on GitHub, leaves comments
11. Engineer moves ticket to **In Review**
12. Runner fetches unresolved comment bodies from GitHub REST API via httpx
13. Runner builds REVISION prompt with system context (branch, PR, comments)
14. Runner invokes new Claude Agent SDK session — worktree already exists
15. Agent addresses comments, outputs COMPLETED sentinel
16. Ticket moves back to **Dev Complete**

**Completion:**
17. Engineer approves and merges PR on GitHub
18. Engineer moves ticket from **Dev Complete** to **Done**
19. Runner cleans up worktree and local branch

---

## 14. Deployment Model (Desktop App)

**Distribution:** Single Electron application bundle — no Docker, no server, no compose file required.

**Project Structure:**
```
felix/
  electron/
    main/
      index.ts              ← Electron app entry, BrowserWindow setup
      ipc-bridge.ts         ← IPC handler registration, Python process management
      preload.ts            ← contextBridge API exposure to renderer
    tsconfig.json
  src/
    components/
      kanban/
      sessions/
      tickets/
      projects/
    App.tsx
    main.tsx
  backend/
    __init__.py
    server.py               ← asyncio server, IPC JSON-RPC handler
    state_machine.py        ← transition validation logic
    runner.py               ← Claude Agent SDK invocation + message handling
    git.py                  ← worktree operations
    github.py               ← httpx-based GitHub REST API calls
    prompts.py              ← implementation + revision prompt builders
    db/
      __init__.py
      tickets.py
      executions.py
      logs.py
    migrations/
      001_initial.sql
  package.json
  vite.config.ts
  requirements.txt
```

**Resource Targets:**
- Disk: ~3GB for repo + worktrees (grows with concurrent tickets)
- Concurrency: max 3 simultaneous Claude Agent SDK sessions

**Host Prerequisites (checked at startup):**
```
Python 3.11+         — required to run backend (claude-agent-sdk requires Python 3.11+)
claude-agent-sdk     — pip install claude-agent-sdk
Git 2.5+             — required for git worktree support
curl                 — GitHub REST API fallback (built-in on macOS/Linux)
```

**Environment Variables (host machine, never stored in app):**
```
GITHUB_TOKEN=ghp_xxxxxxxxxxxx        # PAT with repo + pull_requests scopes
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
```

---

## 15. Architectural Rules

- The Python backend owns all state — frontend is display only
- Electron IPC for all frontend → backend interactions
- IPC events for all backend → frontend push (log streaming, status changes)
- Claude Agent SDK is the orchestrator — slash commands are focused subagents
- Slash commands communicate via `.agent/context/` files — not prompt arguments
- `.agent/context/` is cleared at the start of every new SDK session
- Slash commands are injected by the runner — not managed by target repo
- Humans only move cards forward — agents move cards only via sentinel output
- IN_REVIEW is fully locked to humans — only the agent can exit IN_REVIEW
- Any move to TODO triggers full cleanup — no exceptions
- Cancellation is processed between steps — never mid-git-operation
- All agent outcomes route through the sentinel protocol — no ambiguous exits
- Sentinel is detected in the last non-empty TextBlock of the SDK session only
- Sentinel is acted on only after the SDK session fully completes
- BLOCKED is the single destination for all non-cancellation failure modes
- Worktrees persist for the lifetime of a ticket — created on first IN_PROGRESS, deleted on DONE or TODO
- Per-repo asyncio Lock serializes git pull + worktree creation — parallel sessions run freely after
- asyncio Semaphore enforces max 3 concurrent executions — in-memory set deduplicates
- Git authentication and identity (remote URL with PAT, user.email, user.name) configured on repo-main during project setup and inherited by all worktrees via the shared .git directory
- git pull failure inside the lock routes to BLOCKED with GIT_ERROR reason — job does not proceed
- If a branch already exists when creating a worktree, the stale worktree and branch are deleted first
- node_modules are never shared between repo-main and worktrees — each worktree installs independently
- Agent inactivity timeout: if no SDK messages received for 15 minutes, the task is cancelled and ticket moves to BLOCKED/CRASHED
- Python backend creates the execution row before invoking SDK — the runner never creates execution rows independently
- Execution mode is determined by pr_exists flag — not by comment count
- All GitHub API calls use httpx with GITHUB_TOKEN — gh CLI and curl are never used
- `additional_information` is human-written only — the system never writes to it
- Revision cycle system context (branch, PR, comments) is injected by runner into prompt — not stored on ticket
- pr_url and pr_number are stored directly on the tickets table — set on COMPLETED sentinel
- default_branch is a project-level setting — /create-pr never hardcodes the base branch
- Credentials live in host environment variables — never stored in SQLite or app config
- GitHub API calls include retry logic with exponential backoff
- Max 3 implement/review cycles per session enforced in main agent prompt
- On app startup, runner recovers all IN_PROGRESS executions to BLOCKED/CRASHED

---

## 16. Future Enhancements (Post-MVP)

- Interactive terminal for agent sessions (PTY-based via node-pty)
- Additional AgentRuntime implementations (Codex CLI, Aider, local models via Ollama)
- Per-project slash command customization (engineer-owned `.claude/commands/`)
- Codebase context retrieval engine for smarter /explore
- Automatic task decomposition
- Dependency-aware task graphs
- CI/CD integration (replace local test execution with CI pipeline)
- Automatic merge conflict resolution
- Team/server mode (web interface on top of same Python core)
- Enhanced observability and dashboards
- Claude Agent SDK `ClaudeSDKClient` for interactive/multi-turn sessions (post-MVP)
