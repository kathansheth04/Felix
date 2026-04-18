# Felix

Felix is a desktop application that turns a Kanban board into an autonomous software development pipeline. You create tickets describing engineering tasks, move them to **In Progress**, and an AI coding agent takes over — writing tests, implementing the code, committing the changes, and opening a pull request on GitHub. You come back to review the PR.

Built with Electron, React, and Python, Felix runs entirely on your local machine with direct access to your filesystem and Git repositories.

---

## What Does It Do?

When you move a ticket to **In Progress**, Felix:

1. Creates a Git worktree (an isolated branch) for the ticket
2. Launches an autonomous Claude Agent that follows test-driven development:
   - Explores the codebase to understand context
   - Writes failing tests derived from the ticket's acceptance criteria
   - Implements code until all tests pass
   - Runs a self-review quality gate
   - Commits the changes and opens a GitHub pull request
3. Moves the ticket to **Dev Complete** once the PR is open
4. Streams all agent activity live so you can watch what it's doing

If you leave review comments on the PR, you move the ticket to **In Review** and the agent addresses the comments on the same branch automatically.

You stay in control of what runs, what gets merged, and what gets prioritized. The agent only executes work after you trigger it.

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

Cards show status badges, PR links, and — when blocked — a reason explaining why the agent stopped (e.g., contradictory acceptance criteria, test failures after 3 attempts, usage limit reached).

---

## A Typical Workflow

```
1. Create a ticket with a title, description, and acceptance criteria
2. Move it from Backlog → To Do → In Progress
3. Agent runs: explores → writes tests → implements → reviews → commits → opens PR
4. Ticket moves to Dev Complete automatically
5. You review the PR on GitHub
6. If changes are needed: leave comments, move ticket to In Review
7. Agent picks up the comments and pushes a revision to the same branch
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
| **Additional Information** | No | Your optional notes, constraints, or guidance |

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

---

## Parallel Execution

Felix can run up to **3 tickets concurrently**. A 4th ticket moved to In Progress will show a **Queued** badge and start automatically when a slot opens.

---

## Sessions Viewer

A dedicated **Sessions** screen lets you watch agent activity in real time — every tool use, file edit, and test run is streamed live. You can also replay the full log for completed or blocked sessions.

---

## Prerequisites

Before running Felix, you need:

| Requirement | Notes |
|---|---|
| **Python 3.11+** | Required to run the backend |
| **claude-agent-sdk** | `pip install claude-agent-sdk` — the AI agent runtime |
| **Git 2.5+** | Required for git worktree support |
| **Anthropic API Key** | Powers the Claude coding agent |
| **GitHub Personal Access Token** | Required scopes: `repo`, `pull_requests` |

Felix checks for these on startup and shows a setup screen if anything is missing.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/kathansheth04/felix.git
cd felix
```

### 2. Install Node dependencies

```bash
npm install
```

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 4. Install the Claude Agent SDK

```bash
pip install claude-agent-sdk
```

### 5. Start the app

```bash
npm run dev
```

### 6. Configure credentials

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

## How the Agent Works

Felix uses the **Claude Agent SDK** in headless mode — no GUI, no subprocess piping. The agent is orchestrated by a set of focused subagents (slash commands) that communicate through files:

```
/explore      → understands the codebase, writes context to .agent/context/explorer.md
/write-tests  → writes failing tests from acceptance criteria
/implement    → writes implementation to make tests pass (up to 3 cycles)
/review       → quality gate — checks the git diff before committing
/git-commit   → commits approved changes
/create-pr    → pushes the branch and opens a GitHub pull request
```

The agent follows strict TDD rules: tests must fail before implementation starts, and tests must pass before anything is committed. If the agent cannot satisfy the requirements after 3 implementation cycles, the ticket moves to **Blocked** with a `FAILED` reason.

### Failure Modes

| Indicator | Meaning |
|---|---|
| ⚠️ **FAILED** | Agent exhausted 3 implement/review cycles |
| ❓ **NEEDS_HUMAN** | Acceptance criteria are contradictory or the ticket requires clarification |
| ⏸️ **PAUSED** | Claude usage limit was reached |
| ⚠️ **CRASHED** | Unexpected agent exit or 15-minute inactivity timeout |
| ⚠️ **GIT_ERROR** | Git pull failed during setup |

All blocked tickets can be refined and retried — move back to **To Do** after updating the ticket.

---

## Cancellation

Moving any **In Progress** or **Dev Complete** ticket back to **To Do** triggers a full cleanup:

- Running agent session is cancelled
- Open PR is closed on GitHub
- Remote branch is deleted
- Local worktree and branch are removed

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

## Development Commands

```bash
# Start dev mode (hot-reload renderer + Electron)
npm run dev

# Build for production
npm run build

# TypeScript type check
npm run typecheck
```

---

## What Felix Is Not

- **Not a code review tool** — Felix writes code for you to review, it does not review your code
- **Not a chatbot** — there is no conversational interface; you communicate with the agent through ticket fields
- **Not a CI/CD system** — Felix runs tests locally in the worktree, not in a CI pipeline (post-MVP feature)
- **Not a team tool (yet)** — Felix is a single-user desktop app; multi-user server mode is a planned future enhancement

---

## Future Roadmap

- Interactive terminal for watching agent sessions in real time (PTY-based)
- Support for additional agent runtimes (Codex CLI, Aider, local models via Ollama)
- Automatic task decomposition from high-level goals
- Dependency-aware task graphs
- CI/CD pipeline integration
- Team/server mode with a web interface
- Per-project slash command customization
