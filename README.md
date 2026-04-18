# Felix

Felix is a desktop application that turns a Kanban board into an autonomous software development pipeline. You create tickets describing engineering tasks, move them to **In Progress**, and an AI coding agent takes over. It plans, writes tests, implements the code, commits the changes, and opens a pull request on GitHub. You come back to review the PR.

Built with Electron, React, and Python, Felix runs entirely on your local machine with direct access to your filesystem and Git repositories.

---

## What Does It Do?

When you move a ticket to **In Progress**, Felix:

1. Creates a worktree (an isolated branch) for the ticket
2. Launches an autonomous Claude Agent that follows a structured plan-first workflow:
   - **Explores** the codebase to build deep contextual understanding
   - **Plans** and writes comprehensive tests derived from the ticket's acceptance criteria
   - **Implements** code until all tests pass (up to 3 self-correcting cycles)
   - **Reviews** the full git diff against a quality gate before committing
   - **Commits** the changes and opens a GitHub pull request
3. Moves the ticket to **Dev Complete** once the PR is open
4. Streams all agent activity live so you can watch every tool call, file edit, and test run in real time

If you leave review comments on the PR, you move the ticket to **In Review** and the agent reads your comments, addresses them, and pushes a revision to the same branch automatically.

You stay in control of what runs, what gets merged, and what gets prioritized. The agent only executes work after you trigger it.

---

## Key Features

### Plan-First Agent Architecture

Felix doesn't just throw code at a problem. Every session starts with a dedicated `/explore` phase — a focused subagent that reads the codebase, maps relationships, and writes its findings to a context file before a single line of implementation is written. This means the agent understands your project's patterns, naming conventions, and architecture before acting.

The full pipeline runs in strict order:

```
/explore → /write-tests → confirm red → /implement → confirm green → /review → /git-commit → /create-pr
```

The agent cannot skip steps. Tests must fail before implementation starts. Tests must pass before a review runs. The review must approve before anything is committed. This is TDD enforced at the orchestration level, not just as a suggestion.

### Context Management and Cross-Agent Handoff

Each subagent in the pipeline writes its findings to a dedicated context directory (`.agent/context/`) inside the ticket's worktree. These files persist across subagent boundaries:

| File | Written by | Read by |
|---|---|---|
| `explorer.md` | `/explore` | `/write-tests`, `/implement` |
| `test-files.md` | `/write-tests` | `/implement` |
| `review-result.md` | `/review` | main agent |

This file-based handoff means each subagent receives full context from the previous stage — not a truncated prompt summary. Large codebase analyses, full test suites, and detailed review feedback are passed between agents without compression or loss. The context directory is cleared at the start of every new session so there's no bleed-through from prior runs.

### Adaptive Revision Cycles — The Agent Learns From Your Feedback

Felix's revision cycle is where the system learns from you. When you leave comments on a pull request and move the ticket to **In Review**, the runner:

1. Snapshots the exact set of unresolved comment IDs at transition time
2. Fetches the full comment bodies from the GitHub REST API
3. Injects them as structured system context into the agent's revision prompt

The agent receives every unresolved comment with file path, line number, and body — and addresses them as a coherent set, not one at a time. After revision, it pushes to the same branch (never a new PR), and the cycle repeats until you're satisfied.

Over multiple tickets and revision cycles, the `Additional Information` field on each ticket acts as a direct channel: anything you write there — constraints, known quirks, architectural preferences, links to prior decisions — is injected verbatim into the agent's context. The agent reads and respects it. This is the primary mechanism for teaching the agent about patterns specific to your codebase or team.

### Real-Time Sessions Viewer

A dedicated **Sessions** screen streams every agent action live — tool calls, file reads and writes, bash commands, test output, and the agent's reasoning. Late joiners see the complete session history from SQLite; there's no need to be watching from the start. Blocked sessions surface the exact failure reason at the bottom of the log.

### Parallel Execution with Smart Queuing

Felix runs up to **3 tickets concurrently**. Each ticket executes in its own isolated Git worktree — no shared state, no `node_modules` collisions. A 4th ticket moved to **In Progress** enters a **Queued** state and starts automatically the moment a slot opens, no manual intervention needed.

### Resilient by Design

- **Crash recovery:** On startup, any execution left in a running state from a prior app crash is immediately detected and marked **Blocked** with a `CRASHED` reason. You see exactly what happened without losing track of work in flight.
- **Inactivity timeout:** If the agent goes silent for 15 minutes with no output, the session is cancelled and the ticket moves to **Blocked** automatically.
- **Stale branch handling:** If a worktree or branch from a previously crashed run still exists when a ticket re-enters **In Progress**, Felix detects and cleans it up before starting fresh.
- **Cancellation cleanup:** Moving any active ticket back to **To Do** triggers a complete cleanup sequence — running session cancelled, open PR closed on GitHub, remote branch deleted, local worktree removed — with no manual steps required.

---

## The Board

Felix uses a Kanban board with these columns:

| Column | What it means | Who moves cards here |
|---|---|---|
| **Backlog** | Tickets not yet on the board | You |
| **To Do** | Ready to work, not started | You |
| **In Progress** | Agent actively working | You (triggers the agent) |
| **Dev Complete** | PR open, waiting for your review | Agent (on success) |
| **In Review** | Agent addressing your PR comments | You |
| **Done** | PR merged, task complete | You |
| **Blocked** | Needs human attention | Agent (on failure) |

Cards show status badges and PR links. When blocked, it shows a reason explaining why the agent stopped (e.g., contradictory acceptance criteria, test failures after 3 attempts, usage limit reached).

---

## A Typical Workflow

```
1. Create a ticket with a title, description, and acceptance criteria
2. Move it from Backlog → To Do → In Progress
3. Agent runs: explores → writes tests → implements → reviews → commits → opens PR
4. Ticket moves to Dev Complete automatically
5. You review the PR on GitHub
6. If changes are needed: leave comments, move ticket to In Review
7. Agent reads your comments and pushes a revision to the same branch
8. Repeat until satisfied, then merge the PR and move to Done
```

---

## Ticket Fields

Each ticket has five fields:

| Field | Required | Purpose |
|---|---|---|
| **Title** | Yes | Short description of the task |
| **Description** | Yes | What needs to be built |
| **Acceptance Criteria** | Yes | The agent derives tests directly from this — be specific |
| **Test Commands** | Yes | Commands the agent runs to validate its work (e.g. `npm run test`) |
| **Additional Information** | No | Your notes, constraints, or guidance — injected directly into agent context |

The `Additional Information` field is human-written only. The system never writes to it. Use it to share architectural constraints, link to related PRs, call out known quirks in the codebase, or set preferences the agent should follow. The agent treats this as authoritative guidance.

**Example ticket:**

> **Title:** Add collapsible sidebar navigation
>
> **Description:** Add a sidebar to the dashboard with navigation links that can collapse and expand.
>
> **Acceptance Criteria:**
> - Sidebar appears on the dashboard page
> - Navigation links: Dashboard, Tasks, Settings
> - Sidebar can collapse and expand via a toggle button
> - Collapse state persists across page reloads
>
> **Test Commands:**
> ```
> npm install
> npm run test -- --testPathPattern=sidebar
> ```
>
> **Additional Information:**
> We use Zustand for all client state — persist collapse state there, not localStorage directly. Follow the pattern in `src/store/uiStore.ts`.

---

## Parallel Execution

Felix can run up to **3 tickets concurrently**. A 4th ticket moved to In Progress will show a **Queued** badge and start automatically when a slot opens.

---

## Sessions Viewer

A dedicated **Sessions** screen lets you watch agent activity in real time. Every tool use, file edit, and test run is streamed live as it happens. You can also replay the full log for completed or blocked sessions — late joiners see the full history from the beginning.

---

## How the Agent Works

Felix uses the **Claude Agent SDK** in headless mode — no GUI, no subprocess piping. The agent is orchestrated by a set of focused subagents (slash commands) that communicate through context files:

```
/explore      → understands the codebase, writes context to .agent/context/explorer.md
/write-tests  → writes failing tests from acceptance criteria, reads explorer context
/implement    → writes implementation to make tests pass (up to 3 self-correcting cycles)
/review       → quality gate — checks the full git diff before committing
/git-commit   → commits approved changes
/create-pr    → pushes the branch and opens a GitHub pull request
```

The subagents communicate through files in `.agent/context/` — not prompt arguments — so large outputs like full codebase analyses and test suites transfer between stages without truncation.

The agent enforces strict TDD: tests must fail before implementation starts, and tests must pass before anything is committed. If the agent cannot satisfy the requirements after 3 implementation cycles, the ticket moves to **Blocked** with a `FAILED` reason.

### Execution Modes

| Mode | When | What happens |
|---|---|---|
| **Implementation** | First run, no existing PR | Full TDD workflow from scratch |
| **Revision** | Dev Complete → In Review | Agent reads your PR comments and addresses them on the existing branch |

### Failure Modes

| Indicator | Meaning |
|---|---|
| **FAILED** | Agent exhausted 3 implement/review cycles |
| **NEEDS_HUMAN** | Acceptance criteria are contradictory or the ticket requires clarification |
| **PAUSED** | Claude usage limit was reached |
| **CRASHED** | Unexpected agent exit or 15-minute inactivity timeout |
| **GIT_ERROR** | Git pull failed during setup |

---

## Cancellation

Moving any **In Progress** or **Dev Complete** ticket back to **To Do** triggers a full cleanup:

- Running agent session is cancelled
- Open PR is closed on GitHub
- Remote branch is deleted
- Local worktree and branch are removed

---

## Prerequisites

Before running Felix, you need:

| Requirement | Notes |
|---|---|
| **Anthropic API Key** | Powers the Claude coding agent |
| **GitHub Personal Access Token** | Required scopes: `repo`, `pull_requests` |

Felix checks for these on startup and shows a setup screen if any are missing.

---

## Installation

### 1. Download the latest release build for MacOS


### 2. Configure credentials

Open **Settings** (gear icon) and enter your:
- **Anthropic API Key** — from [console.anthropic.com](https://console.anthropic.com)
- **GitHub Personal Access Token** — from GitHub → Settings → Developer settings → Personal access tokens

Credentials are stored in your OS app data directory with restricted permissions. They are never written to the database or any config file.

---

## Project Setup

Once the app is running:

1. Click **New Project**
2. Enter a name and your GitHub repository URL (e.g. `https://github.com/you/your-repo`)
3. Set the default branch (defaults to `main`)
4. Felix clones the repository once to `~/felix-kanban/{repo-name}/repo-main/`

Each ticket gets its own Git worktree (`~/felix-kanban/{repo-name}/worktrees/{ticket-id}/`) that persists for the life of the ticket and is cleaned up when the ticket is done or cancelled.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Frontend | React + TypeScript + Vite + TailwindCSS + shadcn/ui |
| Drag and drop | @dnd-kit |
| Backend | Python 3.11+ with asyncio |
| Database | SQLite (embedded, stored in app data) |
| Agent runtime | Claude Agent SDK (`claude-agent-sdk`) |
| GitHub API | httpx (no `gh` CLI dependency) |
| IPC | JSON-RPC over stdio between Electron and Python |

---

## Future Roadmap

- Interactive terminal for watching agent sessions in real time (PTY-based)
- Support for additional agent runtimes (Codex CLI, Aider, local models via Ollama)
- Automatic task decomposition from high-level goals
- Dependency-aware task graphs
- CI/CD pipeline integration
- Team/server mode with a web interface
- Per-project slash command customization
