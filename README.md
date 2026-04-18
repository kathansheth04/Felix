# Felix

![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Claude](https://img.shields.io/badge/Claude_Agent_SDK-D97757?style=for-the-badge&logo=anthropic&logoColor=white)

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

You stay in control of what runs, what gets merged, and what gets prioritized.

---

## Key Features

### Plan-First Agent Support

Every ticket can be optionally toggled to start with a dedicated `/explore` phase, a focused subagent that reads the codebase, maps relationships, and writes its findings to a context file before a single line of implementation is written. This means the agent understands your project's patterns, naming conventions, and architecture before acting. Agent will provide an implementation plan that it will strictly follow, which can be improved by providing feedback. 

### Context Management and Cross-Agent Handoff

Each subagent in the pipeline writes its findings to a dedicated context directory (`.agent/context/`) inside the ticket's worktree. These files persist across subagent boundaries:

| File | Written by | Read by |
|---|---|---|
| `explorer.md` | `/explore` | `/write-tests`, `/implement` |
| `test-files.md` | `/write-tests` | `/implement` |
| `review-result.md` | `/review` | main agent |

This file-based handoff means each subagent receives full context from the previous stage — not a truncated prompt summary. Large codebase analyses, full test suites, and detailed review feedback are passed between agents without compression or loss. This allows for re-use of codebase information, feedback, analysis, and other context to allow an efficient pipeline.

### Adaptive Learning

Felix's revision cycle is where the system learns from you. When you leave comments on a pull request and move the ticket to **In Review**, the runner:

1. Snapshots the exact set of unresolved comment IDs at transition time
2. Fetches the full comment bodies from the GitHub REST API
3. Adapts to them as structured system context into the agent's memory

The agent receives every unresolved comment with file path, line number, and body, and addresses them as a coherent set. After revision, it pushes to the same branch, and the cycle repeats until you're satisfied.

Over multiple tickets, anytime you provide feedback or give it guidance (eg. constraints, known quirks, architectural preferences, links to prior decisions) is injected into the agent's context. The agent reads and respects it if it can be reused in future tickets. This is the primary mechanism for teaching the agent about your patterns to improve execution of tickets over time.

### Real-Time Sessions Viewer

A dedicated **Sessions** screen streams every agent action live (tool calls, file reads and writes, bash commands, test output, the agent's reasoning). Blocked sessions surface the exact failure reason at the bottom of the log.

### Parallel Execution with Smart Queuing

Felix runs up to **3 tickets concurrently**. Each ticket executes in its own isolated Git worktree, no shared state, no `node_modules` collisions. A 4th ticket moved to **In Progress** enters a **Queued** state and starts automatically the moment a slot opens, no manual intervention needed. Semaphores, Worktrees, and other isolation mechanisms ensure merge conflicts are avoided between concurrent tickets for a clean work history.

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
3. Agent runs: explores → plans (if enabled) → writes tests → implements → reviews → commits → opens PR
4. Ticket moves to Dev Complete automatically
5. You review the PR on GitHub
6. If changes are needed: leave comments, move ticket to In Review
7. Agent reads your comments, pushes a revision to the same branch, and moves it back to Dev Complete.
8. Agent responds to your comments by replying directly on the PR.
8. Repeat until satisfied, then merge the PR and move to Done
```

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
