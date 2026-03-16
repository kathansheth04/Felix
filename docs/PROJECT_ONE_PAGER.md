# Felix — Project Highlights

**One-pager for interviews & resume**

---

## Elevator Pitch

**Desktop app that turns a Kanban board into an autonomous coding pipeline.** Move a ticket to "In Progress" → the system spawns an AI agent that explores the codebase, writes tests, implements the feature, runs a self-review quality gate, commits, and opens a PR—all via strict TDD. Humans stay in control of prioritization and PR review; agents handle the execution loop.

*Why it matters:* Automates the implementation phase of software development—the part where engineers spend time executing well-defined tasks—while keeping humans in the loop for decisions.

---

## What Makes It Impressive

### 1. **Full-stack polyglot architecture**
- **Electron + TypeScript + Python** — Electron main process manages a long-lived Python backend as a child process
- **JSON-RPC over stdio** — custom IPC bridge between React frontend and Python backend (no HTTP server)
- **Real-time streaming** — agent output streams live to the UI via IPC events; SQLite stores full history for late joiners
- **47+ source files** across frontend (React/Vite), Electron main, Python backend, and agent prompts

### 2. **AI agent orchestration**
- **Claude Agent SDK** in headless mode — native Python async integration, no subprocess spawning or shell piping
- **Multi-step TDD workflow** via slash commands: `/explore` → `/write-tests` → `/implement` → `/review` → `/git-commit` → `/create-pr`
- **Subagent handoff** — slash commands communicate via `.agent/context/` files (not prompt args) to avoid token limits on large outputs
- **Sentinel protocol** — agent outputs structured JSON as final output (`COMPLETED` / `FAILED` / `NEEDS_HUMAN`); runner parses only after session completes
- **Two execution modes** — IMPLEMENTATION (full TDD from scratch) vs REVISION (address PR review comments, reuse existing worktree)

### 3. **Production-grade concurrency & state**
- **asyncio Semaphore** — max 3 concurrent agent sessions; 4th ticket enters QUEUED automatically
- **Per-repo asyncio Lock** — serializes git pull + worktree creation to avoid conflicts; parallel sessions run freely once worktrees exist
- **Explicit state machine** — human vs agent transitions validated; `IN_REVIEW` fully locked to humans (only agent can exit)
- **Full cancellation sequence** — move to TODO triggers: cancel task → close PR via GitHub API → delete remote branch → remove worktree → delete local branch → reset ticket

### 4. **Git & GitHub integration**
- **Git worktrees** — one clone per project; worktrees share object store; each ticket gets isolated workspace
- **Worktree lifecycle** — created on first IN_PROGRESS; persists through revision cycles; deleted only on DONE or TODO
- **GitHub REST API via httpx** — PR creation, comment fetch, branch delete, PR close; retry with exponential backoff; no `gh` CLI or `curl`
- **PAT-based auth** — embedded in remote URL; credentials from host env (never stored in SQLite)

### 5. **Resilience & observability**
- **Startup recovery** — any IN_PROGRESS execution from a crashed app → BLOCKED (CRASHED)
- **Inactivity timeout** — 15 min without SDK messages → cancel and BLOCKED (CRASHED)
- **Blocked reason taxonomy** — FAILED, NEEDS_HUMAN, PAUSED, CRASHED, GIT_ERROR with distinct UI indicators
- **Versioned SQLite migrations** — projects, tickets, executions, logs; aiosqlite for async access

---

## Tech Stack Summary

| Layer       | Tech                                                                 |
|-------------|----------------------------------------------------------------------|
| Frontend    | Vite, React 18, TypeScript, TailwindCSS, shadcn/ui, @dnd-kit         |
| Desktop     | Electron 29, contextBridge + preload                                 |
| Backend     | Python 3.11+, asyncio, aiosqlite, httpx                              |
| Agent       | claude-agent-sdk (headless, `permission_mode='acceptEdits'`)         |
| Data        | SQLite (embedded, single file)                                      |

---

## Interview Talking Points

1. **"How did you handle the frontend–backend boundary?"**  
   Custom JSON-RPC over stdio. Electron spawns `python -m backend.server`; requests go stdin → Python parses, dispatches, writes response JSON to stdout; events (logs, status) pushed via same channel. No HTTP, no port binding.

2. **"How does the agent know when it's done?"**  
   Sentinel protocol: agent outputs exactly one JSON line as its last TextBlock (`COMPLETED` / `FAILED` / `NEEDS_HUMAN`). Runner inspects only the *last non-empty* TextBlock *after* the SDK session completes—never mid-stream.

3. **"How do you avoid git conflicts with parallel tickets?"**  
   Per-repo Lock around git pull + worktree creation. Once each ticket has its own worktree, they're isolated. Max 3 concurrent sessions via Semaphore; 4th waits in QUEUED.

4. **"What happens if the user cancels mid-run?"**  
   move_ticket → TODO triggers full cleanup: cancel asyncio task, close PR, delete remote branch, remove worktree, delete local branch. Cleanup runs between pipeline steps—never mid-git-operation.

5. **"Why desktop over web?"**  
   Local git worktrees, Claude Agent SDK as in-process async call, local test runs. No Docker, no volume mounts—install app, set two env vars, run.

---

## Resume Bullet Suggestions

- Architected a **desktop Kanban app** that orchestrates autonomous AI agents (Claude Agent SDK) to implement tickets via TDD, commit changes, and open PRs—with **Electron + React + Python** polyglot stack and JSON-RPC IPC
- Designed **concurrent agent execution** (asyncio Semaphore, per-repo Lock) and **sentinel-based outcome routing** for deterministic state transitions; implemented full **cancellation cleanup** (PR close, branch delete, worktree removal)
- Built **Git worktree management** and **GitHub REST API integration** (httpx) for multi-ticket parallel development; worktrees persist across implementation and revision cycles

---

*Last updated: March 2025*
