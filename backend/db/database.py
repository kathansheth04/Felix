"""
SQLite database layer using aiosqlite.

Location: ~/Library/Application Support/felix/db.sqlite (macOS)
          ~/.config/felix/db.sqlite                     (Linux)
          %APPDATA%/felix/db.sqlite                     (Windows)
"""
from __future__ import annotations

import os
import platform
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite


def _db_path() -> Path:
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    elif system == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))

    db_dir = base / "felix"
    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir / "db.sqlite"


MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


class Database:
    def __init__(self) -> None:
        self._path = _db_path()
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(str(self._path))
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._run_migrations()

    async def _run_migrations(self) -> None:
        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        await self._conn.commit()

        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            row = await (await self._conn.execute(
                "SELECT filename FROM _migrations WHERE filename = ?", (sql_file.name,)
            )).fetchone()
            if row:
                continue
            sql = sql_file.read_text()
            await self._conn.executescript(sql)
            await self._conn.execute(
                "INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)",
                (sql_file.name, _now()),
            )
            await self._conn.commit()

    def _row_to_dict(self, row) -> dict[str, Any]:
        return dict(row) if row else {}

    # ─── Projects ─────────────────────────────────────────────────────────────

    async def create_project(self, name: str, repo_url: str, default_branch: str = "main", agent_runtime: str = "claude-agent-sdk") -> dict:
        project_id = str(uuid.uuid4())
        now = _now()
        await self._conn.execute(
            "INSERT INTO projects (id, name, repo_url, default_branch, agent_runtime, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (project_id, name, repo_url, default_branch, agent_runtime, now),
        )
        await self._conn.commit()
        return await self.get_project(project_id)

    async def list_projects(self) -> list[dict]:
        rows = await (await self._conn.execute("SELECT * FROM projects ORDER BY created_at")).fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def get_project(self, project_id: str) -> dict:
        row = await (await self._conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,))).fetchone()
        return self._row_to_dict(row)

    async def delete_project(self, project_id: str) -> None:
        """Delete a project and cascade to tickets, executions, and logs."""
        await self._conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await self._conn.commit()

    async def update_project(self, project_id: str, **fields: Any) -> dict:
        allowed = {"name", "repo_url", "default_branch", "agent_runtime"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            await self._conn.execute(
                f"UPDATE projects SET {set_clause} WHERE id = ?",
                (*updates.values(), project_id),
            )
            await self._conn.commit()
        return await self.get_project(project_id)

    # ─── Tickets ──────────────────────────────────────────────────────────────

    async def create_ticket(self, project_id: str, title: str, **fields: Any) -> dict:
        ticket_id = str(uuid.uuid4())
        now = _now()
        allowed = {"description", "acceptance_criteria", "test_commands", "additional_information", "require_plan_review"}
        extra = {k: v for k, v in fields.items() if k in allowed}

        cols = ["id", "project_id", "title", "status", "created_at", "updated_at"] + list(extra.keys())
        vals = [ticket_id, project_id, title, "BACKLOG", now, now] + list(extra.values())

        await self._conn.execute(
            f"INSERT INTO tickets ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            vals,
        )
        await self._conn.commit()
        return await self.get_ticket(ticket_id)

    async def get_ticket(self, ticket_id: str) -> dict:
        row = await (await self._conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,))).fetchone()
        return self._row_to_dict(row)

    async def list_tickets(self, project_id: str) -> list[dict]:
        rows = await (await self._conn.execute(
            "SELECT * FROM tickets WHERE project_id = ? ORDER BY created_at DESC", (project_id,)
        )).fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def update_ticket(self, ticket_id: str, **fields: Any) -> dict:
        allowed = {
            "title", "description", "acceptance_criteria", "test_commands",
            "additional_information", "branch_name", "pr_url", "pr_number",
            "plan", "require_plan_review",
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        if updates:
            updates["updated_at"] = _now()
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            await self._conn.execute(
                f"UPDATE tickets SET {set_clause} WHERE id = ?",
                (*updates.values(), ticket_id),
            )
            await self._conn.commit()
        return await self.get_ticket(ticket_id)

    async def move_ticket(self, ticket_id: str, new_status: str, blocked_reason: str | None = None) -> dict:
        now = _now()
        if blocked_reason is not None:
            await self._conn.execute(
                "UPDATE tickets SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?",
                (new_status, blocked_reason, now, ticket_id),
            )
        else:
            # Clear blocked_reason when moving out of BLOCKED
            clear_reason = new_status != "BLOCKED"
            if clear_reason:
                await self._conn.execute(
                    "UPDATE tickets SET status = ?, blocked_reason = NULL, updated_at = ? WHERE id = ?",
                    (new_status, now, ticket_id),
                )
            else:
                await self._conn.execute(
                    "UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
                    (new_status, now, ticket_id),
                )
        await self._conn.commit()
        return await self.get_ticket(ticket_id)

    # ─── Executions ───────────────────────────────────────────────────────────

    async def create_execution(self, id: str, ticket_id: str, mode: str, current_step: str) -> dict:
        now = _now()
        await self._conn.execute(
            "INSERT INTO executions (id, ticket_id, mode, status, current_step, retry_count, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (id, ticket_id, mode, "IN_PROGRESS", current_step, 0, now),
        )
        await self._conn.commit()
        return await self.get_execution(id)

    async def get_execution(self, execution_id: str) -> dict:
        row = await (await self._conn.execute("SELECT * FROM executions WHERE id = ?", (execution_id,))).fetchone()
        return self._row_to_dict(row)

    async def list_executions(self, project_id: str | None = None, ticket_id: str | None = None) -> list[dict]:
        if ticket_id:
            rows = await (await self._conn.execute(
                "SELECT * FROM executions WHERE ticket_id = ? ORDER BY started_at DESC", (ticket_id,)
            )).fetchall()
        elif project_id:
            rows = await (await self._conn.execute(
                """SELECT e.* FROM executions e
                   JOIN tickets t ON t.id = e.ticket_id
                   WHERE t.project_id = ?
                   ORDER BY e.started_at DESC""",
                (project_id,),
            )).fetchall()
        else:
            rows = await (await self._conn.execute("SELECT * FROM executions ORDER BY started_at DESC")).fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def update_execution_step(self, execution_id: str, current_step: str) -> None:
        await self._conn.execute(
            "UPDATE executions SET current_step = ? WHERE id = ?", (current_step, execution_id)
        )
        await self._conn.commit()

    async def complete_execution(self, execution_id: str) -> None:
        await self._conn.execute(
            "UPDATE executions SET status = 'COMPLETED', completed_at = ? WHERE id = ?",
            (_now(), execution_id),
        )
        await self._conn.commit()

    async def fail_execution(self, execution_id: str, reason: str) -> None:
        await self._conn.execute(
            "UPDATE executions SET status = 'FAILED', completed_at = ? WHERE id = ?",
            (_now(), execution_id),
        )
        await self._conn.commit()

    async def mark_execution_cancelled(self, execution_id: str) -> None:
        await self._conn.execute(
            "UPDATE executions SET status = 'CANCELLED', completed_at = ? WHERE id = ?",
            (_now(), execution_id),
        )
        await self._conn.commit()

    async def mark_execution_crashed(self, execution_id: str) -> None:
        await self._conn.execute(
            "UPDATE executions SET status = 'CRASHED', completed_at = ? WHERE id = ?",
            (_now(), execution_id),
        )
        await self._conn.commit()

    async def get_stuck_executions(self) -> list[dict]:
        """Return executions still marked IN_PROGRESS from a previous app run."""
        rows = await (await self._conn.execute(
            "SELECT * FROM executions WHERE status = 'IN_PROGRESS'"
        )).fetchall()
        return [self._row_to_dict(r) for r in rows]

    # ─── Logs ─────────────────────────────────────────────────────────────────

    async def insert_log(self, execution_id: str, message: str, timestamp: str, step: str | None = None) -> None:
        log_id = str(uuid.uuid4())
        await self._conn.execute(
            "INSERT INTO execution_logs (id, execution_id, step, message, timestamp) VALUES (?, ?, ?, ?, ?)",
            (log_id, execution_id, step, message, timestamp),
        )
        await self._conn.commit()

    async def delete_ticket(self, ticket_id: str) -> None:
        """Delete a ticket and cascade to executions + logs."""
        await self._conn.execute("DELETE FROM tickets WHERE id = ?", (ticket_id,))
        await self._conn.commit()

    async def get_execution_logs(self, execution_id: str) -> list[dict]:
        rows = await (await self._conn.execute(
            "SELECT * FROM execution_logs WHERE execution_id = ? ORDER BY timestamp", (execution_id,)
        )).fetchall()
        return [self._row_to_dict(r) for r in rows]


    # ─── Plan Messages ─────────────────────────────────────────────────────

    async def insert_plan_message(self, ticket_id: str, role: str, content: str) -> dict:
        msg_id = str(uuid.uuid4())
        now = _now()
        await self._conn.execute(
            "INSERT INTO plan_messages (id, ticket_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (msg_id, ticket_id, role, content, now),
        )
        await self._conn.commit()
        row = await (await self._conn.execute("SELECT * FROM plan_messages WHERE id = ?", (msg_id,))).fetchone()
        return self._row_to_dict(row)

    async def get_plan_messages(self, ticket_id: str) -> list[dict]:
        rows = await (await self._conn.execute(
            "SELECT * FROM plan_messages WHERE ticket_id = ? ORDER BY created_at", (ticket_id,)
        )).fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def delete_plan_messages(self, ticket_id: str) -> None:
        await self._conn.execute("DELETE FROM plan_messages WHERE ticket_id = ?", (ticket_id,))
        await self._conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
