"""
asyncio JSON-RPC server over stdio.

Electron main process spawns this as:
  python -m backend.server

Protocol:
  Request  (stdin):  {"id": "uuid", "method": "...", "params": {...}}
  Response (stdout): {"id": "uuid", "result": {...}} | {"id": "uuid", "error": {"code": int, "message": str}}
  Event    (stdout): {"event": "...", ...fields}  (no id field)
"""
from __future__ import annotations

import asyncio
import json
import sys
import os
from typing import Any, Callable

from backend.db.database import Database
from backend.state_machine import StateMachine
from backend.runner import RunnerService
from backend import user_style


class IPCServer:
    def __init__(self) -> None:
        self.db = Database()
        self.state_machine = StateMachine()
        self.runner = RunnerService(self.db, self._emit_event)
        self._handlers: dict[str, Callable[..., Any]] = {
            "create_project": self._create_project,
            "list_projects": self._list_projects,
            "update_project": self._update_project,
            "delete_project": self._delete_project,
            "create_ticket": self._create_ticket,
            "update_ticket": self._update_ticket,
            "move_ticket": self._move_ticket,
            "list_tickets": self._list_tickets,
            "get_ticket": self._get_ticket,
            "get_execution_logs": self._get_execution_logs,
            "list_executions": self._list_executions,
            "cancel_execution": self._cancel_execution,
            "delete_ticket": self._delete_ticket,
            "check_dependencies": self._check_dependencies,
            "approve_plan": self._approve_plan,
            "submit_plan_feedback": self._submit_plan_feedback,
            "submit_plan_answer": self._submit_plan_answer,
            "reject_plan": self._reject_plan,
            "get_plan_messages": self._get_plan_messages,
        }

    # ─── Event emission ───────────────────────────────────────────────────────

    def _emit_event(self, payload: dict[str, Any]) -> None:
        """Write a push event to stdout."""
        _write_line(json.dumps(payload))

    # ─── Request dispatch ─────────────────────────────────────────────────────

    async def _dispatch(self, request: dict[str, Any]) -> dict[str, Any]:
        req_id = request.get("id")
        method = request.get("method", "")
        params = request.get("params", {})

        handler = self._handlers.get(method)
        if handler is None:
            return {"id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}

        try:
            result = await handler(**params)
            return {"id": req_id, "result": result}
        except Exception as exc:
            return {"id": req_id, "error": {"code": -1, "message": str(exc)}}

    # ─── Handlers ─────────────────────────────────────────────────────────────

    async def _create_project(self, name: str, repo_url: str, default_branch: str = "main", agent_runtime: str = "claude-agent-sdk") -> dict:
        return await self.db.create_project(name=name, repo_url=repo_url, default_branch=default_branch, agent_runtime=agent_runtime)

    async def _list_projects(self) -> list[dict]:
        return await self.db.list_projects()

    async def _update_project(self, project_id: str, **fields: Any) -> dict:
        return await self.db.update_project(project_id, **fields)

    async def _delete_project(self, project_id: str) -> dict:
        project = await self.db.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id!r} not found")
        # Cancel any running executions for tickets in this project
        tickets = await self.db.list_tickets(project_id)
        for ticket in tickets:
            if ticket.get("status") in ("IN_PROGRESS", "QUEUED", "IN_REVIEW"):
                await self.runner.stop_task(ticket["id"])
        # Remove cloned repo and all worktrees from disk
        try:
            await self.runner.delete_project_disk(project["repo_url"])
        except Exception as exc:
            print(f"[server] delete_project disk cleanup (non-fatal): {exc}", flush=True)
        await self.db.delete_project(project_id)
        return {"deleted": project_id}

    async def _create_ticket(self, project_id: str, title: str, **fields: Any) -> dict:
        return await self.db.create_ticket(project_id=project_id, title=title, **fields)

    async def _update_ticket(self, ticket_id: str, **fields: Any) -> dict:
        return await self.db.update_ticket(ticket_id, **fields)

    async def _move_ticket(self, ticket_id: str, new_status: str) -> dict:
        ticket = await self.db.get_ticket(ticket_id)
        validated_status = self.state_machine.validate_human_transition(ticket["status"], new_status)
        updated = await self.db.move_ticket(ticket_id, validated_status)

        # Trigger agent execution when moved to IN_PROGRESS or IN_REVIEW
        if validated_status in ("IN_PROGRESS", "IN_REVIEW"):
            await self.runner.enqueue(ticket_id)

        # Trigger cancellation cleanup when moved back to TODO (only if ticket was active/had work)
        if validated_status == "TODO" and ticket["status"] in ("IN_PROGRESS", "QUEUED", "IN_REVIEW", "DEV_COMPLETE", "PLAN_REVIEW"):
            asyncio.create_task(self.runner.cancel(ticket_id))

        # Remove local worktree + branch when ticket is marked DONE
        if validated_status == "DONE":
            asyncio.create_task(self.runner.cleanup_on_done(ticket_id))

        # Cleanup worktree when moving BLOCKED → TODO or BACKLOG
        if ticket["status"] == "BLOCKED" and validated_status in ("TODO", "BACKLOG"):
            asyncio.create_task(self.runner.cleanup_for_backlog(ticket_id))

        return updated

    async def _list_tickets(self, project_id: str) -> list[dict]:
        return await self.db.list_tickets(project_id)

    async def _get_ticket(self, ticket_id: str) -> dict:
        return await self.db.get_ticket(ticket_id)

    async def _get_execution_logs(self, execution_id: str) -> list[dict]:
        return await self.db.get_execution_logs(execution_id)

    async def _list_executions(self, project_id: str | None = None, ticket_id: str | None = None) -> list[dict]:
        return await self.db.list_executions(project_id=project_id, ticket_id=ticket_id)

    async def _cancel_execution(self, ticket_id: str) -> None:
        await self.runner.cancel(ticket_id)

    async def _delete_ticket(self, ticket_id: str) -> dict:
        ticket = await self.db.get_ticket(ticket_id)
        if not ticket:
            raise ValueError(f"Ticket {ticket_id!r} not found")

        # Kill any in-flight task without touching GitHub or DB
        await self.runner.stop_task(ticket_id)

        # Clean up local worktree + branch if one exists (non-fatal)
        if ticket.get("branch_name"):
            await self.runner.cleanup_on_done(ticket_id)

        # Delete row — cascades to executions + execution_logs
        await self.db.delete_ticket(ticket_id)
        return {"deleted": ticket_id}

    async def _approve_plan(self, ticket_id: str, approval_feedback: str | None = None) -> dict:
        ticket = await self.db.get_ticket(ticket_id)
        if ticket["status"] not in ("IN_PROGRESS", "PLAN_REVIEW") or not ticket.get("plan"):
            raise ValueError("Cannot approve plan: ticket must be In Progress with a plan ready for review")
        if ticket["status"] == "PLAN_REVIEW":
            await self.db.move_ticket(ticket_id, "IN_PROGRESS")
        if approval_feedback and approval_feedback.strip():
            updated_plan = (ticket.get("plan") or "") + "\n\n## Reviewer Notes (before implementation)\n\n" + approval_feedback.strip()
            await self.db.update_ticket(ticket_id, plan=updated_plan)
            # Meta-learning: reflect on approval feedback (fire-and-forget)
            asyncio.create_task(
                user_style.reflect_on_planning(
                    user_feedback=approval_feedback.strip(),
                    ticket_title=ticket.get("title", ""),
                    context_id=ticket_id,
                )
            )
        await self.runner.enqueue(ticket_id, from_plan_approval=True)
        return await self.db.get_ticket(ticket_id)

    async def _submit_plan_feedback(self, ticket_id: str, message: str) -> dict:
        ticket = await self.db.get_ticket(ticket_id)
        if ticket["status"] not in ("IN_PROGRESS", "PLAN_REVIEW") or not ticket.get("plan"):
            raise ValueError("Cannot submit plan feedback: ticket must be In Progress with a plan")
        plan_msg = await self.db.insert_plan_message(ticket_id, role="human", content=message)
        self._emit_event({
            "event": "plan-message",
            "ticket_id": ticket_id,
            "message": plan_msg,
        })
        # Meta-learning: reflect on plan feedback, including answers to plan questions (fire-and-forget)
        asyncio.create_task(
            user_style.reflect_on_planning(
                user_feedback=message,
                ticket_title=ticket.get("title", ""),
                context_id=ticket_id,
            )
        )
        await self.runner.enqueue_plan_feedback(ticket_id)
        return plan_msg

    async def _submit_plan_answer(self, ticket_id: str, answers: dict[str, str]) -> dict:
        """Submit user's answers to Claude's AskUserQuestion — unblocks planning session."""
        self.runner.submit_plan_answer(ticket_id, answers)
        # Meta-learning: reflect on answers to plan questions (fire-and-forget)
        if answers:
            ticket = await self.db.get_ticket(ticket_id)
            formatted = "\n".join(f"- {q}: {a}" for q, a in answers.items())
            asyncio.create_task(
                user_style.reflect_on_planning(
                    user_feedback=f"Answers to plan questions:\n{formatted}",
                    ticket_title=ticket.get("title", ""),
                    context_id=ticket_id,
                )
            )
        return {"ok": True}

    async def _reject_plan(self, ticket_id: str) -> dict:
        ticket = await self.db.get_ticket(ticket_id)
        if ticket["status"] not in ("IN_PROGRESS", "PLAN_REVIEW") or not ticket.get("plan"):
            raise ValueError("Cannot reject plan: ticket must be In Progress with a plan")
        await self.db.update_ticket(ticket_id, plan=None)
        await self.db.delete_plan_messages(ticket_id)
        asyncio.create_task(self.runner.cancel(ticket_id))
        return await self.db.get_ticket(ticket_id)

    async def _get_plan_messages(self, ticket_id: str) -> list[dict]:
        return await self.db.get_plan_messages(ticket_id)

    async def _check_dependencies(self) -> dict[str, bool]:
        import shutil
        import subprocess

        python_ok = sys.version_info >= (3, 11)

        claude_ok = False
        try:
            import claude_agent_sdk  # noqa: F401
            claude_ok = True
        except ImportError:
            pass

        git_ok = shutil.which("git") is not None
        if git_ok:
            try:
                result = subprocess.run(["git", "--version"], capture_output=True, text=True, timeout=5)
                git_ok = result.returncode == 0
            except Exception:
                git_ok = False

        return {"python": python_ok, "claude_agent_sdk": claude_ok, "git": git_ok}

    # ─── Main loop ────────────────────────────────────────────────────────────

    async def run(self) -> None:
        await self.db.initialize()
        await self.runner.recover_crashed_executions()

        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        while True:
            line_bytes = await reader.readline()
            if not line_bytes:
                break
            line = line_bytes.decode().strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                _write_line(json.dumps({"id": None, "error": {"code": -32700, "message": f"Parse error: {exc}"}}))
                continue

            # Handle each request as an independent task so long-running calls
            # don't block the read loop
            asyncio.create_task(self._handle_and_respond(request))

    async def _handle_and_respond(self, request: dict[str, Any]) -> None:
        response = await self._dispatch(request)
        _write_line(json.dumps(response))


def _write_line(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main() -> None:
    server = IPCServer()
    asyncio.run(server.run())


if __name__ == "__main__":
    main()
