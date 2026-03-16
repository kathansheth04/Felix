# Felix — Agent Instructions

This file is read automatically by Claude Code and the Claude Agent SDK when operating inside this repository. All agent sessions — whether invoked directly or via a slash command — must treat the documents below as authoritative.

---

## Specification Documents

| Document | Purpose |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | MVP feature scope, ticket structure, board columns, state machine, sentinel protocol, execution modes, GitHub integration |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagram, component responsibilities, IPC protocol, database schema, agent prompts, slash commands, architectural rules |

**Read both documents before making any change.** Do not implement anything that contradicts them.

---

## Project Structure

```
felix/
  electron/main/        ← Electron main process (TypeScript)
    index.ts            ← BrowserWindow setup, Python process lifecycle
    ipc-bridge.ts       ← JSON-RPC over stdio, IPC handler registration
    preload.ts          ← contextBridge API (window.api)
  src/                  ← React renderer (TypeScript + Vite)
    types/index.ts      ← All domain types, enums, transition tables
    components/
      kanban/           ← KanbanBoard, KanbanColumn, TicketCard
      sessions/         ← SessionsScreen, LogViewer
      tickets/          ← TicketDialog
      projects/         ← ProjectSettings
      ui/               ← shadcn/ui primitives
  backend/              ← Python asyncio backend
    server.py           ← JSON-RPC over stdio entry point
    state_machine.py    ← Ticket transition validation
    runner.py           ← Claude Agent SDK session lifecycle
    git.py              ← Git worktree operations
    github.py           ← GitHub REST API via httpx
    prompts.py          ← Implementation + revision prompt builders
    db/database.py      ← SQLite via aiosqlite (projects, tickets, executions, logs)
    migrations/         ← Versioned .sql migration files
  agent/commands/       ← Slash commands injected into every worktree
    explore.md          ← /explore subagent
    write-tests.md      ← /write-tests subagent
    implement.md        ← /implement subagent
    review.md           ← /review quality gate
    git-commit.md       ← /git-commit
    create-pr.md        ← /create-pr via httpx
  docs/
    SPEC.md             ← MVP specification (source of truth)
    ARCHITECTURE.md     ← System architecture (source of truth)
```

---

## Tech Stack

**Frontend:** Vite + React + TypeScript + TailwindCSS + shadcn/ui + @dnd-kit + Electron IPC (contextBridge)

**Electron main:** TypeScript, Node.js child_process, IPC bridge (JSON-RPC over stdio)

**Backend:** Python 3.11+, asyncio, aiosqlite, httpx, claude-agent-sdk

**Database:** SQLite — stored at `~/Library/Application Support/felix/db.sqlite`

---

## Architectural Rules (non-negotiable)

These rules are copied from `docs/ARCHITECTURE.md` §15 for fast reference. The full canonical list is in that file.

- The Python backend owns all state — the frontend is display-only
- All frontend → backend communication goes through Electron IPC (invoke)
- All backend → frontend push goes through IPC events (send/on)
- `IN_REVIEW` is fully locked to humans — only the agent can exit `IN_REVIEW`
- Any move to `TODO` triggers the full cancellation + cleanup sequence, no exceptions
- Sentinel is detected in the **last non-empty TextBlock** only, after the SDK session fully completes
- `BLOCKED` is the single destination for all non-cancellation failure modes
- Worktrees persist for the lifetime of a ticket — created on first `IN_PROGRESS`, deleted on `DONE` or `TODO`
- All GitHub API calls use `httpx` with `GITHUB_TOKEN` — the `gh` CLI and `curl` are never used
- `additional_information` is human-written only — the system never writes to it
- Credentials are set via app Settings UI, stored in userData — never stored in SQLite or config files
- Max 3 concurrent executions enforced by asyncio Semaphore

---

## IPC Protocol

**Request (Electron → Python):**
```json
{"id": "uuid", "method": "move_ticket", "params": {"ticket_id": "...", "new_status": "IN_PROGRESS"}}
```

**Response (Python → Electron):**
```json
{"id": "uuid", "result": {...}}
{"id": "uuid", "error": {"code": -1, "message": "..."}}
```

**Event (Python → Electron, push):**
```json
{"event": "execution-log", "execution_id": "...", "ticket_id": "...", "message": "...", "timestamp": "..."}
{"event": "ticket-status-changed", "ticket_id": "...", "new_status": "...", "blocked_reason": "..."}
```

---

## Agent Sentinel Protocol

The Claude Agent SDK session outputs exactly one JSON line as its final TextBlock:

```json
{"status": "COMPLETED", "pr_url": "https://github.com/org/repo/pull/123", "pr_number": 123, "branch": "{ticket_id}"}
{"status": "FAILED", "reason": "Could not satisfy tests after 3 implement/review cycles"}
{"status": "NEEDS_HUMAN", "reason": "Acceptance criteria are contradictory"}
```

| Sentinel | Ticket destination |
|---|---|
| `COMPLETED` | `DEV_COMPLETE` — `pr_url`, `pr_number`, `branch_name` written to ticket |
| `FAILED` | `BLOCKED` (blocked_reason = `FAILED`) |
| `NEEDS_HUMAN` | `BLOCKED` (blocked_reason = `NEEDS_HUMAN`) |
| No sentinel + usage limit detected | `BLOCKED` (blocked_reason = `PAUSED`) |
| No sentinel + unexpected exit | `BLOCKED` (blocked_reason = `CRASHED`) |

---

## Development Commands

```bash
# Start in dev mode (hot-reload renderer + electron)
npm run dev

# Build for production
npm run build

# TypeScript type check
npm run typecheck

# Install Python dependencies
pip install -r requirements.txt
```

**Credentials:** Configure in app Settings (gear icon). Stored in userData; passed to Python backend when it spawns.
