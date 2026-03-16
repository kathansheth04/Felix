# Felix — MVP Specification

## Overview

Felix is a **desktop application** that combines a Kanban task board with an autonomous coding agent. Built with Electron, it runs natively on the developer's machine with direct access to the local filesystem, git, and the Claude Agent SDK. Each ticket on the board can trigger an AI agent that implements the task in a linked Git repository, creates a branch, writes and runs tests, commits the changes, and opens a pull request.

Humans remain in the loop for:
- Task prioritization
- Ticket clarity and acceptance criteria
- PR review and merge decisions
- Resolving blocked tickets

The goal is to automate the **implementation phase of software development**, where engineers often spend time executing well-defined tasks.

---

## Core Concept

A Kanban board controls an autonomous coding agent. State transitions trigger automation.

```
TODO → In Progress → Dev Complete ⇄ In Review → Done
                                                       ↕
                                                   Blocked
```

When a ticket is moved to **In Progress**, the Claude Agent SDK begins implementing the ticket in the repository autonomously using test-driven development.

---

## Why Desktop

This system is inherently local — it manages git worktrees on the host filesystem, invokes the Claude Agent SDK as an in-process async call, and runs test commands in the local environment. A desktop app (Electron) gives direct access to all of these without the complexity of Docker containers, volume mounts, or containerized networking. The result is a dramatically simpler deployment: install the app, set two environment variables, and run.

---

## Key Principles

### Human-controlled scheduling
Humans decide:
- Which tasks start
- Which tasks run in parallel (up to 3 concurrent)
- When PRs get merged
- When blocked tickets are refined and re-triggered

Agents only execute work once triggered by a human transition.

### Ticket-driven development
Each ticket represents an atomic engineering task. Tickets must include clear acceptance criteria — the agent derives tests directly from them.

Examples:
- Implement sidebar navigation UI
- Add API endpoint for task assignment
- Add dark mode toggle

### Test-driven development
Agents enforce TDD strictly:
1. Write failing tests derived from acceptance criteria (red)
2. Confirm tests fail before writing any implementation
3. Write implementation to satisfy tests (green)
4. Confirm all tests pass before proceeding to review
5. Never commit unless tests are green and review is approved

Agents implement **unit and functional tests only**. End-to-end tests and tests requiring external services are out of scope. All external dependencies must be mocked.

### Autonomous agent orchestration via Claude Agent SDK (headless mode)
The Claude Agent SDK acts as the agent orchestrator, coordinating focused subagents for separation of concerns and context management. It is invoked via the Python `claude_agent_sdk` package using `query()` in headless mode — no subprocess spawning or CLI invocation required.

```
/explore      — understand codebase context
/write-tests  — write failing tests from acceptance criteria
/implement    — write implementation to satisfy tests
/review       — validate changes before commit
/git-commit   — commit all approved changes
/create-pr    — push branch and open pull request via GitHub REST API
```

Subagents communicate via files in `.agent/context/` within the worktree — not via prompt arguments — ensuring reliable handoff of large outputs between subagents.

The agent handles the full implementation lifecycle. The Python runner handles only bootstrapping and session lifecycle management.

### GitHub API via httpx only
All GitHub operations (PR creation, comment fetching, branch deletion, PR closing) use `httpx` against the GitHub REST API with a PAT. The `gh` CLI and `curl` are never used anywhere in the system.

---

## Tech Stack

**Frontend:**
```
Vite + React + TypeScript    — UI framework
TailwindCSS                   — styling
shadcn/ui                     — component library
@dnd-kit                      — drag and drop
Electron IPC (contextBridge)  — IPC bridge to main process + Python backend
```

**Electron Main Process:**
```
TypeScript                    — main process language
Electron                      — desktop app framework
Node.js child_process         — Python backend process management
IPC bridge                    — JSON-RPC over stdio between Electron and Python
```

**Backend:**
```
Python 3.11+                  — backend language
asyncio                       — async runtime + job queue + concurrency
aiosqlite                     — async SQLite driver with migrations
httpx                         — async HTTP client (GitHub REST API)
```

**Agent:**
```
claude-agent-sdk              — pip install claude-agent-sdk
                                Native Python async SDK for Claude Agent
                                Headless mode via query() function
                                permission_mode='acceptEdits' for autonomous operation
                                Bundled CLI — no separate Claude Code installation required
```

**Database:**
```
SQLite                        — embedded, no server, single file
                                stored at: {app_data_dir}/felix/db.sqlite
```

---

## Host Prerequisites

The app verifies these on startup and shows a setup screen if any are missing:

```
Python 3.11+         — required to run backend
claude-agent-sdk     — pip install claude-agent-sdk (bundles Claude Code CLI)
Git 2.5+             — required for git worktree support
```

**Environment variables (set on host machine):**
```
GITHUB_TOKEN=ghp_xxxxxxxxxxxx        # PAT — scopes: repo, pull_requests
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
```

These are read directly from the host environment. They are never stored in the app database or any config file. The Claude Agent SDK inherits `ANTHROPIC_API_KEY` automatically from the process environment.

---

## Backlog and Board

**Backlog** is a separate screen (not a board column). Users dump tickets there. New tickets are created in Backlog.

**Board** shows active work — To Do represents what the user is currently working on (e.g. current sprint or week).

| Board Column | Meaning | Who moves cards here |
|---|---|---|
| To Do | On board, not started (or returned for rework) | Human |
| In Progress | Agent actively working | Human |
| Dev Complete | PR open, awaiting human review | Agent only (via COMPLETED sentinel) |
| In Review | Agent addressing PR review comments | Human |
| Done | PR merged, task complete | Human |
| Blocked | Requires human attention | Agent (via FAILED/NEEDS_HUMAN sentinel or crash) |

**Transition rules:**
- Backlog (separate screen): promote to To Do via "Add to board"
- Humans move cards: To Do → In Progress or Backlog, In Progress → To Do, Dev Complete → In Review / Done / To Do, Blocked → To Do / Dev Complete
- Agents move cards: to Dev Complete (COMPLETED sentinel) or Blocked (FAILED/NEEDS_HUMAN/crash sentinel)
- In Review is fully locked to humans — only the agent can exit In Review (to Dev Complete or Blocked)
- Blocked → TODO is always human-initiated after refining the ticket

---

## Ticket Structure

| Field | Type | Required | Notes |
|---|---|---|---|
| Title | Short text | Yes | |
| Description | Long text | Yes | |
| Acceptance Criteria | Long text | Yes | Agent derives tests from this |
| Test Commands | Multi-line text | Yes | Commands agent runs to validate |
| Additional Information | Long text | No | Human-written guidance only — system never writes here |

**Example ticket:**

Title: Add sidebar navigation

Description: Add a collapsible sidebar to the dashboard page with navigation links.

Acceptance Criteria:
- Sidebar appears on the dashboard page
- Navigation links: Dashboard, Tasks, Settings
- Sidebar can collapse and expand
- Collapse state persists across page reloads

Test Commands:
```
npm install
npm run test -- --testPathPattern=sidebar
```

Additional Information: *(optional — engineer can add clarifications, known constraints, or guidance here)*

The `additional_information` field is for human guidance only. It is never written to by the system.

---

## Execution Modes

The agent runs in one of two modes, determined by whether an existing PR is associated with the ticket:

**IMPLEMENTATION mode** — first execution, no existing PR (`pr_url` is null on the ticket):
- Full TDD workflow from scratch
- Writes tests, implements, reviews, commits, opens PR

**REVISION mode** — triggered by Dev Complete → In Review (`pr_url` is set on the ticket):
- Existing PR and branch already exist
- Agent reads unresolved PR comments (injected as system context by runner)
- Addresses comments, runs tests, reviews, commits to existing branch
- Does not open a new PR

---

## Agent Sentinel Protocol

The Claude Agent SDK session communicates its outcome by outputting exactly one structured JSON line as the final TextBlock content before the session completes:

```json
{"status": "COMPLETED", "pr_url": "https://github.com/org/repo/pull/123", "pr_number": 123, "branch": "ticket-101"}
{"status": "FAILED", "reason": "Could not satisfy tests after 3 implement/review cycles"}
{"status": "NEEDS_HUMAN", "reason": "Acceptance criteria are contradictory — cannot proceed"}
```

| Sentinel | Ticket destination |
|---|---|
| COMPLETED | Dev Complete — `pr_url`, `pr_number`, and `branch_name` written to ticket |
| FAILED | Blocked |
| NEEDS_HUMAN | Blocked |
| No sentinel + usage limit detected | Blocked (PAUSED) |
| No sentinel + unexpected exit | Blocked (CRASHED) |

The runner inspects the last non-empty `TextBlock` after the SDK session completes. Sentinel is never parsed mid-session — only after `query()` exhausts its async iterator.

---

## Ticket Status Enum

```
BACKLOG      — not yet on the board; created items start here
TODO         — on board, not started, or returned from Blocked for rework
QUEUED       — waiting for a concurrency slot to free up
IN_PROGRESS  — Claude Agent SDK session active
DEV_COMPLETE — PR open, awaiting human review
IN_REVIEW    — agent addressing PR review comments
DONE         — PR merged, task complete
BLOCKED      — requires human attention (reason displayed on card)
```

**Blocked reason values (stored in DB, shown on card):**
```
FAILED        ⚠️  — agent exhausted implement/review cycles
NEEDS_HUMAN   ❓  — agent requires clarification to proceed
PAUSED        ⏸️  — Claude usage limit reached
CRASHED       ⚠️  — unexpected SDK session exit or inactivity timeout
GIT_ERROR     ⚠️  — git pull failed during worktree bootstrap
```

---

## Cancellation Rule

Any ticket moved to TODO triggers full cleanup with no exceptions:

```
1. Mark execution CANCELLED
2. Cancel asyncio task (task.cancel())
3. Close PR on GitHub via REST API using httpx (if exists)
4. Delete remote branch via REST API using httpx (if exists)
5. Remove local worktree
6. Delete local branch
7. Clear branch_name on ticket
8. Set ticket → TODO
```

Cleanup is processed between pipeline steps — git operations are never interrupted mid-execution.

---

## Worktree Lifecycle

Worktrees persist for the full lifetime of a ticket:

```
Created   → ticket first enters IN_PROGRESS
Persists  → IN_PROGRESS, DEV_COMPLETE, IN_REVIEW (all revision cycles)
Deleted   → ticket moves to DONE or TODO
```

This means revision cycle sessions reuse the existing worktree and branch without any re-setup.

---

## PR Comment Cycle

```
Dev Complete → In Review (human moves card)
  → System snapshots unresolved PR comment IDs at transition time
  → Runner fetches comment bodies from GitHub REST API via httpx when job runs
  → System context injected into REVISION prompt
  → New Claude Agent SDK session spawned — reuses existing worktree
  → Agent addresses all comments in snapshot
  → Agent pushes new commit to existing branch (never amends/force-pushes)
  → Agent outputs COMPLETED sentinel
  → Ticket → Dev Complete

In Review is fully locked to humans — no human transitions are permitted from this column.
Only the agent can move a ticket out of In Review (to Dev Complete or Blocked).
```

---

## Parallel Execution

Up to **3 tickets** run concurrently. A 4th ticket moved to In Progress enters **Queued** status and its asyncio task awaits the semaphore — automatically proceeding when a slot frees. An in-memory set prevents duplicate executions from rapid state changes.

---

## App Restart Recovery

On app startup, any executions left in IN_PROGRESS state (from a previous app crash or force quit) are automatically moved to BLOCKED with CRASHED reason. Engineers see the CRASHED indicator on the card and can restart from TODO.

---

## Session Viewer

A **Sessions** screen in the UI lets engineers observe agent executions in real time.

- Claude Agent SDK messages streamed via **Electron IPC events** to frontend
- Full log history available from SQLite on demand — late joiners see complete session
- Sessions screen lists all tickets with status and elapsed time
- Clicking a session opens the live log view
- Blocked sessions surface the failure reason prominently at the bottom of the log
- Session viewer is **read-only** for MVP — interactive terminal is post-MVP

---

## GitHub Integration

- Authentication via **Personal Access Token (PAT)**
- Required PAT scopes: `repo`, `pull_requests`
- PAT stored as host environment variable — never in SQLite or app config
- PAT embedded in remote URL for git push/pull authentication:
  `https://x-access-token:{GITHUB_TOKEN}@github.com/owner/repo.git`
- All GitHub API calls use `httpx` — `gh` CLI and `curl` are never used
- All GitHub API calls include retry logic with exponential backoff
- `owner` and `repo` parsed from `repo_url` at runtime — not stored separately

---

## Repository Workspace Strategy

The target repo is cloned **once per project** on the host machine. Git worktrees share the object store — no re-cloning per ticket. A per-repo asyncio Lock serializes git pull and worktree creation — parallel Claude Agent SDK sessions run freely once each has its own worktree.

```
~/felix-kanban/
  {repo-name}/
    repo-main/    ← single clone, always current, authenticated remote URL
    worktrees/
      ticket-101/ ← persists until DONE or TODO
      ticket-102/
```

---

## Environment Variables

Environment variables are set on the host machine and inherited by the Claude Agent SDK when invoked. They are never stored in SQLite or any config file.

```
GITHUB_TOKEN=ghp_xxxxxxxxxxxx        # PAT with repo + pull_requests scopes
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
```

---

## MVP Feature Scope

**Frontend (Vite + React + TypeScript):**
- Kanban board with six columns including Blocked
- Ticket creation and editing (all five fields including additional information)
- Transition rules enforced — humans can move forward from TODO, In Progress, Dev Complete, and Blocked only; In Review is fully locked to human interaction
- Blocked card indicators with reason icons and text (FAILED, NEEDS_HUMAN, PAUSED, CRASHED, GIT_ERROR)
- QUEUED badge on waiting tickets
- PR status and link on Dev Complete / In Review cards
- Sessions screen with real-time log viewer via Electron IPC events (read-only)
- Project settings: repo URL, default branch, agent runtime selection
- Startup setup screen if host prerequisites not met

**Electron Main Process (TypeScript):**
- Python backend process management (spawn, monitor, restart)
- IPC bridge between renderer and Python backend (JSON-RPC over stdio)
- BrowserWindow lifecycle management

**Python Backend:**
- IPC handlers for all CRUD and state transitions
- IPC events for real-time log streaming and status changes
- State machine with full transition validation (IN_REVIEW fully locked to humans)
- asyncio job queue with Semaphore concurrency and set deduplication
- SQLite via aiosqlite with versioned migrations
- Startup recovery for crashed executions
- repo_url and default_branch validation at project creation

**Runner (Python):**
- Per-repo asyncio Lock for safe concurrent worktree operations
- git pull failure detection → BLOCKED/GIT_ERROR
- Worktree bootstrap with branch collision handling
- Independent dependency installation per worktree (no node_modules sharing)
- Git authentication and identity via PAT embedded in remote URL
- `.agent/context/` cleared and recreated at start of every new session
- Execution mode determination via pr_exists flag (not comment count)
- Slash command and `.agent/context/` injection into worktree
- Prompt building — implementation or revision — with system context injection
- Claude Agent SDK invocation via `claude_agent_sdk.query()` (headless mode, `permission_mode='acceptEdits'`)
- SDK message streaming to SQLite logs and IPC events
- Agent inactivity timeout: BLOCKED/CRASHED if no SDK messages for 15 minutes
- Sentinel detection on last non-empty TextBlock — acted on after session completes
- Outcome routing via sentinel protocol
- Cancellation handling and full cleanup sequence

**Agent (Claude Agent SDK + Slash Commands):**
- Implementation prompt — full TDD workflow
- Revision prompt — comment cycle with system context
- `/explore` — codebase context → `.agent/context/explorer.md`
- `/write-tests` — failing tests → `.agent/context/test-files.md`
- `/implement` — implementation with self-correction loop
- `/review` — git diff quality gate → `.agent/context/review-result.md`
- `/git-commit` — staged commit to existing branch
- `/create-pr` — push and PR creation via httpx + GitHub REST API using default_branch
- AgentRuntime abstract class for future runtime support

---

## Future Enhancements (Post-MVP)

- Interactive terminal for agent sessions (PTY-based via node-pty)
- Additional agent runtimes (Codex CLI, Aider, local models via Ollama)
- Per-project slash command customization
- `ClaudeSDKClient` for interactive/multi-turn agent sessions
- Codebase context retrieval engine for smarter /explore
- Automatic task decomposition
- Dependency-aware task graphs
- CI/CD integration
- Automatic merge conflict resolution
- Team/server mode (web interface on top of same Python core)
- Enhanced observability and dashboards
