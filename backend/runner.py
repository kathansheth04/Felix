"""
Runner — owns the Claude Agent SDK session lifecycle.

Responsibilities:
- Determine execution mode (IMPLEMENTATION vs REVISION) from pr_exists flag
- Acquire per-repo asyncio Lock before git pull + worktree operations
- Bootstrap worktree (create if not exists, handle stale branch collision)
- Inject .claude/commands/ and .agent/context/ into worktree
- Build implementation or revision prompt
- Invoke claude_agent_sdk.query() in headless mode
- Stream SDK messages → SQLite logs + IPC events
- Detect sentinel in last non-empty TextBlock
- Handle cancellation → full cleanup sequence
- Route outcome via sentinel protocol
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
import uuid

from backend.db.database import Database
from backend.git import GitManager
from backend.github import GitHubClient
from backend.prompts import build_implementation_prompt, build_revision_prompt, build_planning_prompt
from backend import user_style


# ─── Constants ────────────────────────────────────────────────────────────────

MAX_CONCURRENT_EXECUTIONS = 3
INACTIVITY_TIMEOUT_SECONDS = 15 * 60  # 15 minutes

# Commands directory bundled with the app (injected into each worktree)
COMMANDS_DIR = Path(__file__).parent.parent / "agent" / "commands"


def _extract_plan_from_output(raw: str) -> str:
    """Extract the structured plan, discarding preamble like 'Let me explore...'."""
    text = raw.strip()
    if not text:
        return ""
    # Plan starts at first ## heading (Approach, Files to Modify, etc.)
    if text.startswith("##"):
        return text
    match = re.search(r"\n##\s+", text)
    if match:
        return text[match.start() + 1 :].strip()  # +1 to skip leading newline
    return text


# ─── Runtime interface ────────────────────────────────────────────────────────

class AgentRuntime:
    """Abstract base — only ClaudeAgentSDKRuntime is implemented for MVP."""

    @property
    def name(self) -> str:
        raise NotImplementedError

    async def run(self, prompt: str, worktree_path: Path):
        """Async generator yielding text chunks from the agent."""
        raise NotImplementedError

    async def run_plan(
        self,
        prompt: str,
        worktree_path: Path,
        *,
        can_use_tool: Callable[..., Any] | None = None,
    ):
        """Async generator for planning sessions. If can_use_tool is provided, AskUserQuestion is enabled."""
        raise NotImplementedError

    def detect_usage_limit_error(self, output: str) -> bool:
        raise NotImplementedError

    def parse_sentinel(self, text: str) -> dict | None:
        raise NotImplementedError


def _format_tool_use(name: str, input_: dict) -> str:
    """Format a tool-use block into a human-readable [tool: X] line."""
    if name == "Read":
        path = input_.get("file_path") or input_.get("path", "?")
        offset = input_.get("offset")
        limit = input_.get("limit")
        suffix = f"  lines {offset}–{int(offset) + int(limit)}" if offset is not None and limit is not None else ""
        return f"[tool: Read] {path}{suffix}"

    if name == "Write":
        path = input_.get("file_path") or input_.get("path", "?")
        content = input_.get("content", "")
        lines = len(str(content).splitlines()) if content else 0
        return f"[tool: Write] {path}  ({lines} lines)"

    if name in ("Bash", "mcp__bash"):
        cmd = str(input_.get("command", "?"))
        desc = input_.get("description", "")
        cmd_display = cmd if len(cmd) <= 120 else cmd[:117] + "…"
        if desc:
            return f"[tool: Bash] {desc}\n  $ {cmd_display}"
        return f"[tool: Bash] $ {cmd_display}"

    if name == "Grep":
        pattern = input_.get("pattern", "?")
        path = input_.get("path") or input_.get("include", "")
        location = f"  in {path}" if path else ""
        return f"[tool: Grep] {pattern!r}{location}"

    if name == "Glob":
        pattern = input_.get("pattern") or input_.get("glob", "?")
        path = input_.get("path") or input_.get("directory", "")
        location = f"  in {path}" if path else ""
        return f"[tool: Glob] {pattern}{location}"

    if name == "StrReplace":
        path = input_.get("path", "?")
        old_snip = str(input_.get("old_string", ""))[:60].replace("\n", "↵")
        return f"[tool: StrReplace] {path}  ← {old_snip!r}"

    if name == "Edit":
        path = input_.get("file_path") or input_.get("path", "?")
        return f"[tool: Edit] {path}"

    # Generic fallback: show first two string values
    parts = [str(v)[:60] for v in list(input_.values())[:2] if isinstance(v, (str, int, float))]
    suffix = "  " + " · ".join(parts) if parts else ""
    return f"[tool: {name}]{suffix}"


def _format_tool_result(name: str, content: "str | list | None", is_error: bool | None) -> str | None:
    """Format a tool result into a concise [result: X] line. Returns None to suppress."""
    if is_error:
        text = str(content or "")[:300]
        return f"[result: error] {text}"

    if name == "Bash":
        if not content:
            return "[result: Bash] (no output)"
        text = str(content)
        lines = text.splitlines()
        if len(lines) <= 8:
            indented = "\n".join(f"  {ln}" for ln in lines)
            return f"[result: Bash]\n{indented}"
        preview = "\n".join(f"  {ln}" for ln in lines[:8])
        return f"[result: Bash]  ({len(lines)} lines)\n{preview}\n  …"

    if name == "Write":
        return "[result: Write] ✓"

    if name == "Read":
        if not content:
            return None
        lines = str(content).splitlines()
        return f"[result: Read]  ({len(lines)} lines)"

    if name in ("Grep", "Glob"):
        if not content:
            return f"[result: {name}]  (no matches)"
        matches = str(content).splitlines()
        return f"[result: {name}]  ({len(matches)} match{'es' if len(matches) != 1 else ''})"

    return None  # suppress other results


class ClaudeAgentSDKRuntime(AgentRuntime):
    @property
    def name(self) -> str:
        return "claude-agent-sdk"

    async def run(self, prompt: str, worktree_path: Path):
        from claude_agent_sdk import (  # type: ignore
            query, ClaudeAgentOptions,
            AssistantMessage, UserMessage,
            TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
        )

        options = ClaudeAgentOptions(
            cwd=str(worktree_path),
            permission_mode="acceptEdits",
            allowed_tools=["Read", "Write", "Bash", "Grep", "Glob"],
        )

        # Map tool_use_id → name so results can be labelled correctly
        tool_registry: dict[str, str] = {}
        # Accumulated token usage across all messages in this session
        total_input_tokens: int = 0
        total_output_tokens: int = 0
        total_cache_read_tokens: int = 0

        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                # Accumulate token usage if the SDK exposes it on the message
                usage = getattr(message, "usage", None)
                if usage is not None:
                    total_input_tokens += getattr(usage, "input_tokens", 0) or 0
                    total_output_tokens += getattr(usage, "output_tokens", 0) or 0
                    total_cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0

                for block in message.content:
                    if isinstance(block, TextBlock) and block.text.strip():
                        yield False, block.text

                    elif isinstance(block, ToolUseBlock):
                        tool_registry[block.id] = block.name
                        yield True, _format_tool_use(block.name, block.input)

                    elif isinstance(block, ThinkingBlock) and block.thinking.strip():
                        thinking = block.thinking
                        preview = thinking if len(thinking) <= 400 else thinking[:397] + "…"
                        yield True, f"[thinking] {preview}"

            elif isinstance(message, UserMessage):
                content = message.content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, ToolResultBlock):
                            tool_name = tool_registry.get(block.tool_use_id, "?")
                            result_line = _format_tool_result(tool_name, block.content, block.is_error)
                            if result_line:
                                yield True, result_line

        # Emit a usage summary after the session ends (only if the SDK provided data)
        if total_input_tokens or total_output_tokens:
            # Approximate cost using claude-sonnet-4-6 pricing ($3/Mtok in, $15/Mtok out)
            estimated_cost = (
                (total_input_tokens / 1_000_000) * 3.0
                + (total_output_tokens / 1_000_000) * 15.0
                - (total_cache_read_tokens / 1_000_000) * 2.7  # cache discount ~$0.30/Mtok
            )
            cache_note = f"  cache_read={total_cache_read_tokens:,}" if total_cache_read_tokens else ""
            yield False, (
                f"[usage] input={total_input_tokens:,}  output={total_output_tokens:,}"
                f"{cache_note}  est_cost=${estimated_cost:.4f}"
            )

    async def run_plan(
        self,
        prompt: str,
        worktree_path: Path,
        *,
        can_use_tool: Callable[..., Any] | None = None,
    ):
        """Run a planning session with read-only tools and plan permission mode.
        When can_use_tool is provided, enables AskUserQuestion for human-in-the-loop."""
        from claude_agent_sdk import (  # type: ignore
            query, ClaudeAgentOptions,
            AssistantMessage, UserMessage,
            TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
        )

        allowed_tools: list[str] = ["Read", "Grep", "Glob"]
        opts_kw: dict[str, Any] = {
            "cwd": str(worktree_path),
            "permission_mode": "plan",
        }
        if can_use_tool:
            allowed_tools.append("AskUserQuestion")
            opts_kw["allowed_tools"] = allowed_tools
            opts_kw["can_use_tool"] = can_use_tool
            # Streaming mode + PreToolUse hook required for can_use_tool (SDK docs)
            try:
                from claude_agent_sdk.types import HookMatcher  # type: ignore
            except ImportError:
                from claude_agent_sdk import HookMatcher  # type: ignore

            async def _dummy_hook(_input_data: Any, _tool_use_id: str, _context: Any) -> dict:
                return {"continue_": True}

            opts_kw["hooks"] = {"PreToolUse": [HookMatcher(matcher=None, hooks=[_dummy_hook])]}
        else:
            opts_kw["allowed_tools"] = allowed_tools
            # Explicitly disallow AskUserQuestion — plan mode may expose it by default.
            # Questions go in the plan's "Risks & Open Questions" section instead.
            opts_kw["disallowed_tools"] = ["AskUserQuestion"]

        options = ClaudeAgentOptions(**opts_kw)

        tool_registry: dict[str, str] = {}
        total_input_tokens: int = 0
        total_output_tokens: int = 0
        total_cache_read_tokens: int = 0

        # Use streaming prompt when can_use_tool is set (SDK requirement)
        if can_use_tool:
            async def _prompt_stream():
                yield {"type": "user", "message": {"role": "user", "content": prompt}}

            query_prompt: str | Any = _prompt_stream()
        else:
            query_prompt = prompt

        async for message in query(prompt=query_prompt, options=options):
            if isinstance(message, AssistantMessage):
                usage = getattr(message, "usage", None)
                if usage is not None:
                    total_input_tokens += getattr(usage, "input_tokens", 0) or 0
                    total_output_tokens += getattr(usage, "output_tokens", 0) or 0
                    total_cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0

                for block in message.content:
                    if isinstance(block, TextBlock) and block.text.strip():
                        yield False, block.text

                    elif isinstance(block, ToolUseBlock):
                        tool_registry[block.id] = block.name
                        yield True, _format_tool_use(block.name, block.input)

                    elif isinstance(block, ThinkingBlock) and block.thinking.strip():
                        thinking = block.thinking
                        preview = thinking if len(thinking) <= 400 else thinking[:397] + "…"
                        yield True, f"[thinking] {preview}"

            elif isinstance(message, UserMessage):
                content = message.content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, ToolResultBlock):
                            tool_name = tool_registry.get(block.tool_use_id, "?")
                            result_line = _format_tool_result(tool_name, block.content, block.is_error)
                            if result_line:
                                yield True, result_line

        if total_input_tokens or total_output_tokens:
            estimated_cost = (
                (total_input_tokens / 1_000_000) * 3.0
                + (total_output_tokens / 1_000_000) * 15.0
                - (total_cache_read_tokens / 1_000_000) * 2.7
            )
            cache_note = f"  cache_read={total_cache_read_tokens:,}" if total_cache_read_tokens else ""
            yield False, (
                f"[usage] input={total_input_tokens:,}  output={total_output_tokens:,}"
                f"{cache_note}  est_cost=${estimated_cost:.4f}"
            )

    def detect_usage_limit_error(self, output: str) -> bool:
        return "usage limit" in output.lower()

    def parse_sentinel(self, text: str) -> dict | None:
        # First try: whole block is JSON
        try:
            value = json.loads(text.strip())
            if isinstance(value, dict) and value.get("status") in ("COMPLETED", "FAILED", "NEEDS_HUMAN"):
                return value
        except (json.JSONDecodeError, AttributeError):
            pass
        # Second try: scan each line for an embedded sentinel JSON object
        for line in reversed(text.splitlines()):
            stripped = line.strip()
            if not stripped.startswith("{"):
                continue
            try:
                value = json.loads(stripped)
                if isinstance(value, dict) and value.get("status") in ("COMPLETED", "FAILED", "NEEDS_HUMAN"):
                    return value
            except (json.JSONDecodeError, AttributeError):
                pass
        return None

    def read_outcome_file(self, worktree_path: Path) -> dict | None:
        """
        Tier-0 sentinel: read .agent/outcome.json written by the /report-outcome
        slash command. File I/O is unambiguous — this is the primary detection path.
        """
        outcome_file = worktree_path / ".agent" / "outcome.json"
        try:
            text = outcome_file.read_text().strip()
            value = json.loads(text)
            if isinstance(value, dict) and value.get("status") in ("COMPLETED", "FAILED", "NEEDS_HUMAN"):
                return value
        except Exception:
            pass
        return None

    def classify_output_via_patterns(
        self,
        full_output: str,
        branch_name: str,
        existing_pr_url: str,
        existing_pr_number: int | None,
    ) -> dict | None:
        """
        Zero-cost sentinel inference via regex pattern matching on the tail of the
        agent's output. Called only when no explicit sentinel was found.

        Strategy:
        - Inspect the last 2000 chars (the "tail") — this is where the agent's
          final summary lives. Intermediate errors earlier in the session are
          intentionally excluded so they don't create false negatives.
        - Hard failure patterns in the tail → return None (fall through to CRASHED)
        - Success patterns in the tail → return COMPLETED with existing ticket data
        - Nothing matched → return None
        """
        tail = full_output[-2000:]

        # Hard failure signals — if any appear in the tail the run did not succeed.
        # We check the tail only so that a fixed intermediate error doesn't count.
        _FAIL = [
            re.compile(r"\btraceback\s+\(most recent call last\)", re.IGNORECASE),
            re.compile(r"\bsyntaxerror\b", re.IGNORECASE),
            re.compile(r"\d+\s+failed,", re.IGNORECASE),           # "3 failed, 10 passed"
            re.compile(r"\btest suite failed\b", re.IGNORECASE),
            re.compile(r"\bunhandled\s+(?:exception|error)\b", re.IGNORECASE),
        ]
        for pattern in _FAIL:
            if pattern.search(tail):
                return None

        # Success signals — any one is sufficient to infer COMPLETED.
        _SUCCESS = [
            re.compile(r"\ball\s+\d+\s+tests?\s+(?:pass|passed)\b", re.IGNORECASE),
            re.compile(r"\d+\s+tests?\s+(?:pass|passed)\b", re.IGNORECASE),
            re.compile(r"\btests?\s+(?:pass|passed|passing)\b", re.IGNORECASE),
            re.compile(r"\bno\s+(?:test\s+)?failures?\b", re.IGNORECASE),
            re.compile(r"\d+\s+files?\s+changed", re.IGNORECASE),   # git commit output
            re.compile(r"^(?:feat|fix|refactor|chore|docs|test|style)(?:\(.+?\))?:", re.MULTILINE),  # conventional commit
            re.compile(r"\breplied?\s+to\s+\d+", re.IGNORECASE),    # /reply-to-comments output
            re.compile(r"reply\s+posted", re.IGNORECASE),
            # Natural-language completion summaries (agent bypassed /code but finished work)
            re.compile(r"summary\s+of\s+what\s+was\s+(?:done|completed)", re.IGNORECASE),
            re.compile(r"✅"),                                        # checkmark used in completion summaries
            re.compile(r"^Done[!.]", re.MULTILINE),                  # "Done!" / "Done." at line start
            re.compile(r"\ball\s+(?:changes?|tasks?|files?)\s+(?:have\s+been\s+)?(?:complete|applied|updated|renamed|done)\b", re.IGNORECASE),
            re.compile(r"\bsuccessfully\s+(?:complete|updated|renamed|refactored|implemented|applied)\b", re.IGNORECASE),
            re.compile(r"\bimplementation\s+(?:is\s+)?(?:complete|done)\b", re.IGNORECASE),
        ]
        for pattern in _SUCCESS:
            if pattern.search(tail):
                return {
                    "status": "COMPLETED",
                    "pr_url": existing_pr_url,
                    "pr_number": existing_pr_number or 0,
                    "branch": branch_name,
                }

        return None


def _is_bot_account(comment: dict) -> bool:
    """True if the comment was posted by a bot (Vercel, GitHub Actions, etc.)."""
    user = comment.get("user") or {}
    if user.get("type", "").lower() == "bot":
        return True
    login = user.get("login", "")
    return login.endswith("[bot]") or login.endswith("-bot")


def _is_claude_comment(comment: dict) -> bool:
    """True if this comment was posted by Claude.

    Matches **Claude:** prefix with lenient casing so deduplication is robust
    to minor markdown drift across runs.
    """
    body = comment.get("body", "").strip().lower()
    return body.startswith("**claude:**") or body.startswith("claude:")


def _filter_already_replied(
    review_comments: list[dict],
    issue_comments: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Return only comments that still need a reply, with full thread context.

    For inline review threads:
      - Groups comments into threads by their root id.
      - A thread needs attention when the last non-bot comment is from a human.
      - The returned item is that last human comment, enriched with a
        'thread_history' list showing the earlier exchange (for agent context).

    For PR-level issue comments:
      - Finds the last Claude reply (if any) and surfaces only human comments
        posted after it, each enriched with 'thread_history' of the prior
        conversation.
      - Bots are excluded throughout.
    """
    # ── Inline review comment threads ─────────────────────────────────────
    threads: dict[int, list[dict]] = {}
    for c in review_comments:
        root_id = c.get("in_reply_to_id") or c["id"]
        threads.setdefault(root_id, []).append(c)

    filtered_review: list[dict] = []
    for thread in threads.values():
        thread.sort(key=lambda x: x.get("created_at", ""))
        non_bot = [c for c in thread if not _is_bot_account(c)]
        if not non_bot:
            continue
        last = non_bot[-1]
        if _is_claude_comment(last):
            # Last word is already from Claude — thread is resolved
            continue
        result = dict(last)
        result["comment_type"] = "review"
        result["thread_history"] = [
            {"author": "Claude" if _is_claude_comment(c) else "human", "body": c.get("body", "")}
            for c in non_bot[:-1]
        ]
        filtered_review.append(result)

    # ── PR-level issue comments ────────────────────────────────────────────
    non_bot_issues = sorted(
        [c for c in issue_comments if not _is_bot_account(c)],
        key=lambda x: x.get("created_at", ""),
    )

    # Find the index of the last Claude reply
    last_claude_idx = -1
    for i, c in enumerate(non_bot_issues):
        if _is_claude_comment(c):
            last_claude_idx = i

    conversation_context = [
        {"author": "Claude" if _is_claude_comment(c) else "human", "body": c.get("body", "")}
        for c in non_bot_issues[: last_claude_idx + 1]
    ]

    filtered_issue: list[dict] = []
    for c in non_bot_issues[last_claude_idx + 1 :]:
        if _is_claude_comment(c):
            continue
        result = dict(c)
        result["comment_type"] = "issue"
        result["thread_history"] = conversation_context
        filtered_issue.append(result)

    return filtered_review, filtered_issue


def _build_pr_body(ticket: dict[str, Any]) -> str:
    """Construct a PR description from ticket fields."""
    parts: list[str] = []
    description = (ticket.get("description") or "").strip()
    ac = (ticket.get("acceptance_criteria") or "").strip()
    if description:
        parts.append(description)
    if ac:
        parts.append(f"**Acceptance Criteria:**\n{ac}")
    return "\n\n".join(parts)


# ─── Runner service ───────────────────────────────────────────────────────────

class RunnerService:
    def __init__(self, db: Database, emit_event: Callable[[dict[str, Any]], None]) -> None:
        self.db = db
        self.emit_event = emit_event
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXECUTIONS)
        self._active_executions: set[str] = set()
        self._active_lock = asyncio.Lock()
        self._active_tasks: dict[str, asyncio.Task] = {}
        # Per-repo asyncio Locks to serialize git pull + worktree creation
        self._repo_locks: dict[str, asyncio.Lock] = {}
        # Pending plan answers: ticket_id -> Future that completes with user's answers
        self._pending_plan_answers: dict[str, asyncio.Future] = {}
        self._git = GitManager()
        self._github = GitHubClient()

    def _get_repo_lock(self, repo_url: str) -> asyncio.Lock:
        if repo_url not in self._repo_locks:
            self._repo_locks[repo_url] = asyncio.Lock()
        return self._repo_locks[repo_url]

    def _get_runtime(self, agent_runtime: str) -> AgentRuntime:
        if agent_runtime == "claude-agent-sdk":
            return ClaudeAgentSDKRuntime()
        raise ValueError(f"Unknown agent runtime: {agent_runtime}")

    def _make_plan_can_use_tool(self, ticket_id: str):
        """Build can_use_tool callback for planning: pauses on AskUserQuestion, awaits user answer."""

        async def can_use_tool(tool_name: str, input_data: dict, context: Any) -> Any:
            try:
                from claude_agent_sdk.types import PermissionResultAllow  # type: ignore
            except ImportError:
                from claude_agent_sdk import PermissionResultAllow  # type: ignore

            if tool_name != "AskUserQuestion":
                return PermissionResultAllow(updated_input=input_data)

            questions = input_data.get("questions", [])
            self.emit_event({
                "event": "plan-question",
                "ticket_id": ticket_id,
                "questions": questions,
            })

            future = asyncio.get_event_loop().create_future()
            self._pending_plan_answers[ticket_id] = future
            try:
                answers: dict[str, str] = await future
            finally:
                self._pending_plan_answers.pop(ticket_id, None)

            return PermissionResultAllow(
                updated_input={
                    "questions": input_data.get("questions", []),
                    "answers": answers,
                },
            )

        return can_use_tool

    def submit_plan_answer(self, ticket_id: str, answers: dict[str, str]) -> None:
        """Complete a pending AskUserQuestion future with the user's answers."""
        future = self._pending_plan_answers.get(ticket_id)
        if future and not future.done():
            future.set_result(answers)

    async def enqueue(self, ticket_id: str, from_plan_approval: bool = False) -> None:
        async with self._active_lock:
            if ticket_id in self._active_executions:
                return
            self._active_executions.add(ticket_id)

        task = asyncio.create_task(self._run_with_semaphore(ticket_id, from_plan_approval=from_plan_approval))
        self._active_tasks[ticket_id] = task

        def on_done(t: asyncio.Task):
            self._active_tasks.pop(ticket_id, None)
            asyncio.create_task(self._remove_active(ticket_id))

        task.add_done_callback(on_done)

    async def enqueue_plan_feedback(self, ticket_id: str) -> None:
        """Trigger a new PLANNING execution to revise the plan after human feedback."""
        async with self._active_lock:
            if ticket_id in self._active_executions:
                return
            self._active_executions.add(ticket_id)

        task = asyncio.create_task(self._run_plan_revision(ticket_id))
        self._active_tasks[ticket_id] = task

        def on_done(t: asyncio.Task):
            self._active_tasks.pop(ticket_id, None)
            asyncio.create_task(self._remove_active(ticket_id))

        task.add_done_callback(on_done)

    async def _run_plan_revision(self, ticket_id: str) -> None:
        """Run a plan revision while the ticket stays in IN_PROGRESS."""
        async with self._semaphore:
            await self._execute(ticket_id, from_plan_feedback=True)

    async def _remove_active(self, ticket_id: str) -> None:
        async with self._active_lock:
            self._active_executions.discard(ticket_id)

    async def _run_with_semaphore(self, ticket_id: str, from_plan_approval: bool = False) -> None:
        ticket = await self.db.get_ticket(ticket_id)
        is_review = ticket["status"] == "IN_REVIEW"

        slot_available = self._semaphore._value > 0  # noqa: SLF001
        if not slot_available and not is_review:
            await self.db.move_ticket(ticket_id, "QUEUED")
            self.emit_event({"event": "ticket-status-changed", "ticket_id": ticket_id, "new_status": "QUEUED"})

        async with self._semaphore:
            if not is_review:
                await self.db.move_ticket(ticket_id, "IN_PROGRESS")
                self.emit_event({"event": "ticket-status-changed", "ticket_id": ticket_id, "new_status": "IN_PROGRESS"})
            await self._execute(ticket_id, from_plan_approval=from_plan_approval)

    async def stop_task(self, ticket_id: str) -> None:
        """Cancel the in-flight asyncio task only — no DB writes, no GitHub calls."""
        task = self._active_tasks.get(ticket_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        async with self._active_lock:
            self._active_executions.discard(ticket_id)

    async def cancel(self, ticket_id: str) -> None:
        task = self._active_tasks.get(ticket_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # Full cleanup sequence
        ticket = await self.db.get_ticket(ticket_id)
        project = await self.db.get_project(ticket["project_id"])

        try:
            if ticket.get("pr_number") and ticket.get("pr_url"):
                owner, repo = self._github.parse_repo_url(project["repo_url"])
                await self._github.close_pr(owner, repo, ticket["pr_number"])
                await self._github.delete_branch(owner, repo, ticket["branch_name"])
        except Exception as exc:
            print(f"[runner] cleanup GitHub error (non-fatal): {exc}", flush=True)

        try:
            worktree_path = self._git.worktree_path(project["repo_url"], ticket_id)
            repo_main = self._git.repo_main_path(project["repo_url"])
            if worktree_path.exists():
                await self._git.remove_worktree(repo_main, worktree_path)
            if ticket.get("branch_name"):
                await self._git.delete_local_branch(repo_main, ticket["branch_name"])
        except Exception as exc:
            print(f"[runner] cleanup git error (non-fatal): {exc}", flush=True)

        await self.db.update_ticket(ticket_id, branch_name=None, plan=None)
        await self.db.delete_plan_messages(ticket_id)
        await self.db.move_ticket(ticket_id, "TODO")
        self.emit_event({"event": "ticket-status-changed", "ticket_id": ticket_id, "new_status": "TODO"})

    async def cleanup_for_backlog(self, ticket_id: str) -> None:
        """Remove worktree, close PR, delete branches when a ticket is moved from BLOCKED to BACKLOG."""
        task = self._active_tasks.get(ticket_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        ticket = await self.db.get_ticket(ticket_id)
        project = await self.db.get_project(ticket["project_id"])

        try:
            if ticket.get("pr_number") and ticket.get("pr_url"):
                owner, repo = self._github.parse_repo_url(project["repo_url"])
                await self._github.close_pr(owner, repo, ticket["pr_number"])
                await self._github.delete_branch(owner, repo, ticket["branch_name"])
        except Exception as exc:
            print(f"[runner] cleanup_for_backlog GitHub error (non-fatal): {exc}", flush=True)

        try:
            worktree_path = self._git.worktree_path(project["repo_url"], ticket_id)
            repo_main = self._git.repo_main_path(project["repo_url"])
            if worktree_path.exists():
                await self._git.remove_worktree(repo_main, worktree_path)
            if ticket.get("branch_name"):
                await self._git.delete_local_branch(repo_main, ticket["branch_name"])
        except Exception as exc:
            print(f"[runner] cleanup_for_backlog git error (non-fatal): {exc}", flush=True)

        await self.db.update_ticket(
            ticket_id, branch_name=None, pr_url=None, pr_number=None, plan=None
        )
        await self.db.delete_plan_messages(ticket_id)

    async def cleanup_on_done(self, ticket_id: str) -> None:
        """Remove the local worktree and branch when a ticket is moved to DONE."""
        try:
            ticket = await self.db.get_ticket(ticket_id)
            project = await self.db.get_project(ticket["project_id"])
            if not ticket.get("branch_name"):
                return
            worktree_path = self._git.worktree_path(project["repo_url"], ticket_id)
            repo_main = self._git.repo_main_path(project["repo_url"])
            if worktree_path.exists():
                await self._git.remove_worktree(repo_main, worktree_path)
            await self._git.delete_local_branch(repo_main, ticket["branch_name"])
            await self.db.update_ticket(ticket_id, branch_name=None)
        except Exception as exc:
            print(f"[runner] cleanup_on_done error (non-fatal): {exc}", flush=True)

    async def delete_project_disk(self, repo_url: str) -> None:
        """Remove the cloned repo and all worktrees from disk (used when deleting a project)."""
        await self._git.delete_repo_directory(repo_url)

    async def recover_crashed_executions(self) -> None:
        """On startup: any IN_PROGRESS executions from a previous crash → BLOCKED/CRASHED."""
        stuck = await self.db.get_stuck_executions()
        for execution in stuck:
            await self.db.mark_execution_crashed(execution["id"])
            await self.db.move_ticket(execution["ticket_id"], "BLOCKED", blocked_reason="CRASHED")
            self.emit_event({
                "event": "ticket-status-changed",
                "ticket_id": execution["ticket_id"],
                "new_status": "BLOCKED",
                "blocked_reason": "CRASHED",
            })

    # ─── Core execution ───────────────────────────────────────────────────────

    def _determine_mode(
        self,
        ticket: dict[str, Any],
        from_plan_approval: bool = False,
        from_plan_feedback: bool = False,
    ) -> str:
        if from_plan_feedback:
            return "PLANNING"
        if ticket.get("pr_url"):
            return "REVISION"
        if from_plan_approval or not ticket.get("require_plan_review", 1):
            return "IMPLEMENTATION"
        if not ticket.get("plan"):
            return "PLANNING"
        return "IMPLEMENTATION"

    async def _execute(
        self,
        ticket_id: str,
        from_plan_approval: bool = False,
        from_plan_feedback: bool = False,
    ) -> None:
        ticket = await self.db.get_ticket(ticket_id)
        project = await self.db.get_project(ticket["project_id"])

        execution_id = str(uuid.uuid4())
        mode = self._determine_mode(ticket, from_plan_approval=from_plan_approval, from_plan_feedback=from_plan_feedback)

        await self.db.create_execution(
            id=execution_id,
            ticket_id=ticket_id,
            mode=mode,
            current_step="bootstrap",
        )

        try:
            await self._log(ticket_id, execution_id, f"[system] Starting {mode} run")

            # ── Bootstrap worktree ─────────────────────────────────────────
            repo_lock = self._get_repo_lock(project["repo_url"])
            async with repo_lock:
                try:
                    await self._log(ticket_id, execution_id, f"[system] Pulling {project['default_branch']}…")
                    repo_main = await self._git.ensure_repo_main(project["repo_url"])
                    await self._git.pull_repo_main(repo_main, project["default_branch"])
                except Exception as exc:
                    await self._fail(ticket_id, execution_id, "BLOCKED", "GIT_ERROR", str(exc))
                    return

                branch_name = ticket.get("branch_name") or ticket_id
                worktree_path = self._git.worktree_path(project["repo_url"], ticket_id)
                await self._log(ticket_id, execution_id, f"[system] Setting up worktree — branch: {branch_name}")
                await self._git.ensure_worktree(repo_main, worktree_path, branch_name, project["default_branch"])
                await self.db.update_ticket(ticket_id, branch_name=branch_name)
                await self._log(ticket_id, execution_id, f"[system] Worktree ready at {worktree_path}")

            # ── Inject slash commands + context dir ───────────────────────
            if mode != "PLANNING":
                self._inject_commands(worktree_path)
            plan_content = ticket.get("plan") if mode == "IMPLEMENTATION" else None
            self._reset_context_dir(worktree_path, mode=mode, plan_content=plan_content)
            if mode != "PLANNING":
                await self._log(ticket_id, execution_id, "[system] Slash commands injected")

            # ── Build prompt ──────────────────────────────────────────────
            comments: list[dict[str, Any]] = []
            if mode == "PLANNING":
                conversation_history = await self.db.get_plan_messages(ticket_id)
                prompt = build_planning_prompt(ticket, conversation_history or None)
            elif mode == "REVISION":
                owner, repo = self._github.parse_repo_url(project["repo_url"])

                # Recover pr_number from the stored pr_url if it is missing.
                pr_number = ticket.get("pr_number")
                if not pr_number and ticket.get("pr_url"):
                    m = re.search(r"/pull/(\d+)", ticket["pr_url"])
                    if m:
                        pr_number = int(m.group(1))
                        await self.db.update_ticket(ticket_id, pr_number=pr_number)
                        await self._log(ticket_id, execution_id, f"[system] Recovered pr_number {pr_number} from pr_url")

                if not pr_number:
                    await self._fail(ticket_id, execution_id, "BLOCKED", "CRASHED",
                                     "REVISION mode but pr_number is missing and could not be recovered from pr_url")
                    return

                await self._log(ticket_id, execution_id, f"[system] Fetching PR #{pr_number} comments…")
                try:
                    review_comments = await self._github.get_pr_review_comments(owner, repo, pr_number)
                    for c in review_comments:
                        c["comment_type"] = "review"

                    issue_comments = await self._github.get_pr_issue_comments(owner, repo, pr_number)
                    for c in issue_comments:
                        c["comment_type"] = "issue"

                    review_comments, issue_comments = _filter_already_replied(review_comments, issue_comments)
                    comments = review_comments + issue_comments
                    await self._log(
                        ticket_id, execution_id,
                        f"[system] Unaddressed: {len(review_comments)} inline review comment(s) + {len(issue_comments)} PR-level comment(s)",
                    )
                except Exception as exc:
                    await self._log(ticket_id, execution_id, f"[system] Warning: could not fetch PR comments ({exc}) — proceeding with empty list")
                    comments = []

                # Keep the ticket's pr_number in sync
                ticket = {**ticket, "pr_number": pr_number}
                prompt = build_revision_prompt(ticket, comments)
            else:
                prompt = build_implementation_prompt(ticket, default_branch=project["default_branch"])

            await self.db.update_execution_step(execution_id, "agent_running")
            await self._log(ticket_id, execution_id, "[system] Agent session starting…")

            if mode == "PLANNING":
                self.emit_event({"event": "planning-started", "ticket_id": ticket_id})
            elif mode in ("IMPLEMENTATION", "REVISION"):
                self.emit_event({"event": "implementation-started", "ticket_id": ticket_id})

            # ── Run agent session ─────────────────────────────────────────
            runtime = self._get_runtime(project["agent_runtime"])
            text_blocks: list[str] = []
            all_output: list[str] = []
            inactivity_deadline = asyncio.get_event_loop().time() + INACTIVITY_TIMEOUT_SECONDS

            if mode == "PLANNING":
                # No AskUserQuestion — agent records questions in Risks & Open Questions at end of plan
                run_iter = runtime.run_plan(prompt, worktree_path)
            else:
                run_iter = runtime.run(prompt, worktree_path)

            async for is_tool_use, chunk in run_iter:
                inactivity_deadline = asyncio.get_event_loop().time() + INACTIVITY_TIMEOUT_SECONDS

                if asyncio.get_event_loop().time() > inactivity_deadline:
                    await self._fail(ticket_id, execution_id, "BLOCKED", "CRASHED", "Agent inactive for 15 minutes")
                    return

                ts = datetime.now(timezone.utc).isoformat()
                await self.db.insert_log(execution_id=execution_id, message=chunk, timestamp=ts)
                self.emit_event({
                    "event": "execution-log",
                    "execution_id": execution_id,
                    "ticket_id": ticket_id,
                    "message": chunk,
                    "timestamp": ts,
                })

                stripped = chunk.strip()
                if stripped and not is_tool_use:
                    text_blocks.append(stripped)
                all_output.append(chunk)

            # ── PLANNING mode: extract plan from TextBlocks ───────────────
            if mode == "PLANNING":
                await self._log(ticket_id, execution_id, "[system] Planning session complete — extracting plan…")
                raw_plan = "\n\n".join(text_blocks)
                plan_text = _extract_plan_from_output(raw_plan)
                if not plan_text.strip():
                    self.emit_event({"event": "planning-ended", "ticket_id": ticket_id})
                    await self._fail(ticket_id, execution_id, "BLOCKED", "CRASHED", "Planning session produced no plan output")
                    return

                # Write plan to worktree and DB
                plan_file = worktree_path / ".agent" / "context" / "plan.md"
                plan_file.parent.mkdir(parents=True, exist_ok=True)
                plan_file.write_text(plan_text)

                await self.db.update_ticket(ticket_id, plan=plan_text)
                plan_msg = await self.db.insert_plan_message(ticket_id, role="agent", content=plan_text)
                await self.db.complete_execution(execution_id)
                self.emit_event({
                    "event": "ticket-status-changed",
                    "ticket_id": ticket_id,
                    "new_status": "IN_PROGRESS",
                })
                self.emit_event({
                    "event": "plan-updated",
                    "ticket_id": ticket_id,
                    "plan": plan_text,
                })
                self.emit_event({
                    "event": "plan-message",
                    "ticket_id": ticket_id,
                    "message": plan_msg,
                })
                await self._log(ticket_id, execution_id, "[system] Plan saved — plan ready for review")
                self.emit_event({"event": "planning-ended", "ticket_id": ticket_id})
                return

            # ── IMPLEMENTATION / REVISION: sentinel-based outcome ─────────
            await self._log(ticket_id, execution_id, "[system] Agent session complete — reading outcome…")

            last_text_block = text_blocks[-1] if text_blocks else ""
            full_output = "\n".join(all_output)

            sentinel = runtime.read_outcome_file(worktree_path)
            if sentinel:
                await self._log(ticket_id, execution_id, "[system] Outcome read from .agent/outcome.json")

            if not sentinel:
                for block in reversed(text_blocks):
                    sentinel = runtime.parse_sentinel(block)
                    if sentinel:
                        break

            if not sentinel:
                sentinel = runtime.classify_output_via_patterns(
                    full_output=full_output,
                    branch_name=branch_name,
                    existing_pr_url=ticket.get("pr_url") or "",
                    existing_pr_number=ticket.get("pr_number"),
                )
                if sentinel:
                    await self._log(ticket_id, execution_id, "[system] No explicit sentinel — inferred outcome from output patterns")

            if sentinel:
                status = sentinel["status"]
                await self._log(ticket_id, execution_id, f"[system] Sentinel: {status}")
                if status == "COMPLETED":
                    pr_comments_for_reflection = comments if mode == "REVISION" else []
                    await self._post_agent_complete(
                        ticket_id=ticket_id,
                        execution_id=execution_id,
                        ticket=ticket,
                        project=project,
                        worktree_path=worktree_path,
                        branch_name=branch_name,
                        mode=mode,
                        pr_comments=pr_comments_for_reflection,
                    )
                elif status == "FAILED":
                    await self._fail(ticket_id, execution_id, "BLOCKED", "FAILED", sentinel.get("reason", ""))
                elif status == "NEEDS_HUMAN":
                    await self._fail(ticket_id, execution_id, "BLOCKED", "NEEDS_HUMAN", sentinel.get("reason", ""))
            else:
                if runtime.detect_usage_limit_error(full_output):
                    await self._fail(ticket_id, execution_id, "BLOCKED", "PAUSED", "Claude usage limit reached")
                else:
                    await self._fail(
                        ticket_id, execution_id, "BLOCKED", "CRASHED",
                        f"No sentinel in agent output. Last TextBlock: {last_text_block!r:.200}"
                    )

        except asyncio.CancelledError:
            await self.db.mark_execution_cancelled(execution_id)
            if mode == "PLANNING":
                self.emit_event({"event": "planning-ended", "ticket_id": ticket_id})
            elif mode in ("IMPLEMENTATION", "REVISION"):
                self.emit_event({"event": "implementation-ended", "ticket_id": ticket_id})
            raise
        except Exception as exc:
            await self._fail(ticket_id, execution_id, "BLOCKED", "CRASHED", str(exc))

    async def _post_agent_complete(
        self,
        ticket_id: str,
        execution_id: str,
        ticket: dict[str, Any],
        project: dict[str, Any],
        worktree_path: Path,
        branch_name: str,
        mode: str,
        pr_comments: list[dict[str, Any]] | None = None,
    ) -> None:
        """Programmatically commit, push, and (for IMPLEMENTATION) create the PR.

        This runs after the agent signals COMPLETED via outcome.json. The agent
        is responsible only for writing code — all git and GitHub operations are
        owned here, not by the agent.
        """
        try:
            if mode == "IMPLEMENTATION":
                # Commit
                commit_msg = f"feat: {ticket.get('title', 'implement ticket')}"
                committed = await self._git.commit_all(worktree_path, commit_msg)
                if committed:
                    await self._log(ticket_id, execution_id, f"[system] Committed: {commit_msg}")
                else:
                    await self._log(ticket_id, execution_id, "[system] Warning: nothing to commit after agent completion")

                # Push
                await self._git.push_branch(worktree_path, branch_name)
                await self._log(ticket_id, execution_id, f"[system] Pushed branch {branch_name}")

                # Create PR via GitHub API
                owner, repo = self._github.parse_repo_url(project["repo_url"])
                pr = await self._github.create_pr(
                    owner=owner,
                    repo=repo,
                    title=ticket.get("title", ""),
                    body=_build_pr_body(ticket),
                    head=branch_name,
                    base=project["default_branch"],
                )
                pr_url = pr["html_url"]
                pr_number = pr["number"]
                await self._log(ticket_id, execution_id, f"[system] PR created: {pr_url}")

                await self.db.update_ticket(ticket_id, pr_url=pr_url, pr_number=pr_number, branch_name=branch_name)

            else:  # REVISION
                # Commit only if code changed — reply-to-comments may be the only action
                committed = await self._git.commit_all(worktree_path, "fix: address PR review comments")

                # Always push — there may be unpushed commits from a previous run
                # (e.g. conflict resolution made locally but never sent to remote).
                # A push with no new commits is a no-op and returns successfully.
                await self._git.push_branch(worktree_path, branch_name)

                if committed:
                    await self._log(ticket_id, execution_id, "[system] Revision changes committed and pushed")
                else:
                    await self._log(ticket_id, execution_id, "[system] No new code changes — pushed any pending commits to remote")

                # Post PR comment replies written by the agent to .agent/replies.json
                owner, repo = self._github.parse_repo_url(project["repo_url"])
                pr_number = ticket.get("pr_number")
                if pr_number:
                    await self._post_agent_replies(ticket_id, execution_id, worktree_path, owner, repo, pr_number)

            await self.db.complete_execution(execution_id)
            self.emit_event({"event": "implementation-ended", "ticket_id": ticket_id})
            await self.db.move_ticket(ticket_id, "DEV_COMPLETE")
            self.emit_event({"event": "ticket-status-changed", "ticket_id": ticket_id, "new_status": "DEV_COMPLETE"})

            # Meta-learning: fire-and-forget reflection (never blocks)
            if mode == "IMPLEMENTATION":
                asyncio.create_task(
                    user_style.reflect_on_implementation(
                        ticket_title=ticket.get("title", ""),
                        ticket_description=ticket.get("description") or "",
                        acceptance_criteria=ticket.get("acceptance_criteria") or "",
                        execution_id=execution_id,
                    )
                )
            elif mode == "REVISION" and pr_comments:
                asyncio.create_task(
                    user_style.reflect_on_revision(
                        pr_comments=pr_comments,
                        execution_id=execution_id,
                    )
                )

        except Exception as exc:
            await self._fail(ticket_id, execution_id, "BLOCKED", "CRASHED", f"Post-agent step failed: {exc}")

    async def _post_agent_replies(
        self,
        ticket_id: str,
        execution_id: str,
        worktree_path: Path,
        owner: str,
        repo: str,
        pr_number: int,
    ) -> None:
        """Read .agent/replies.json written by /reply-to-comments and post each reply
        via the GitHub API.  Uses CLAUDE_GITHUB_TOKEN when available so that comments
        appear authored by the Claude bot account rather than the repo owner.
        """
        replies_file = worktree_path / ".agent" / "replies.json"
        if not replies_file.exists():
            await self._log(ticket_id, execution_id, "[system] No replies.json found — skipping comment posting")
            return

        try:
            data = json.loads(replies_file.read_text())
        except Exception as exc:
            await self._log(ticket_id, execution_id, f"[system] Warning: could not parse replies.json ({exc}) — skipping comment posting")
            return

        # Swap to the Claude bot token for posting so comments show the right author.
        # Fall back to the standard token if CLAUDE_GITHUB_TOKEN is not set.
        import os as _os
        claude_token = _os.environ.get("CLAUDE_GITHUB_TOKEN", "")
        original_token = _os.environ.get("GITHUB_TOKEN", "")
        if claude_token:
            _os.environ["GITHUB_TOKEN"] = claude_token

        try:
            review_replies: list[dict] = data.get("review_comments", [])
            issue_replies: list[dict] = data.get("issue_comments", [])
            posted_review = 0
            posted_issue = 0

            for entry in review_replies:
                comment_id = entry.get("comment_id")
                text = (entry.get("text") or "").strip()
                if not comment_id or not text:
                    continue
                try:
                    await self._github.reply_to_pr_comment(
                        owner, repo, pr_number, comment_id,
                        body=f"**Claude:** {text}",
                    )
                    posted_review += 1
                except Exception as exc:
                    await self._log(ticket_id, execution_id, f"[system] Warning: failed to post review reply for comment {comment_id}: {exc}")

            for entry in issue_replies:
                text = (entry.get("text") or "").strip()
                if not text:
                    continue
                try:
                    await self._github.create_issue_comment(
                        owner, repo, pr_number,
                        body=f"**Claude:** {text}",
                    )
                    posted_issue += 1
                except Exception as exc:
                    await self._log(ticket_id, execution_id, f"[system] Warning: failed to post issue reply: {exc}")

            await self._log(
                ticket_id, execution_id,
                f"[system] Posted {posted_review} review reply(s) + {posted_issue} PR-level reply(s) as Claude",
            )
        finally:
            # Always restore the original token regardless of success/failure
            if claude_token:
                _os.environ["GITHUB_TOKEN"] = original_token

    async def _log(self, ticket_id: str, execution_id: str, message: str) -> None:
        """Emit a system-level log entry to both the DB and the IPC event stream."""
        ts = datetime.now(timezone.utc).isoformat()
        await self.db.insert_log(execution_id=execution_id, message=message, timestamp=ts)
        self.emit_event({
            "event": "execution-log",
            "execution_id": execution_id,
            "ticket_id": ticket_id,
            "message": message,
            "timestamp": ts,
        })

    async def _fail(
        self,
        ticket_id: str,
        execution_id: str,
        new_status: str,
        blocked_reason: str,
        reason: str,
    ) -> None:
        try:
            ex = await self.db.get_execution(execution_id)
            m = ex.get("mode")
            if m == "PLANNING":
                self.emit_event({"event": "planning-ended", "ticket_id": ticket_id})
            elif m in ("IMPLEMENTATION", "REVISION"):
                self.emit_event({"event": "implementation-ended", "ticket_id": ticket_id})
        except Exception:
            pass
        ts = datetime.now(timezone.utc).isoformat()
        await self.db.insert_log(
            execution_id=execution_id,
            message=f"[runner] {blocked_reason}: {reason}",
            timestamp=ts,
        )
        self.emit_event({
            "event": "execution-log",
            "execution_id": execution_id,
            "ticket_id": ticket_id,
            "message": f"[runner] {blocked_reason}: {reason}",
            "timestamp": ts,
        })
        await self.db.fail_execution(execution_id, blocked_reason)
        await self.db.move_ticket(ticket_id, new_status, blocked_reason=blocked_reason)
        self.emit_event({
            "event": "ticket-status-changed",
            "ticket_id": ticket_id,
            "new_status": new_status,
            "blocked_reason": blocked_reason,
        })

    # ─── Helpers ──────────────────────────────────────────────────────────────

    def _inject_commands(self, worktree_path: Path) -> None:
        dest = worktree_path / ".claude" / "commands"
        dest.mkdir(parents=True, exist_ok=True)
        if COMMANDS_DIR.exists():
            for cmd_file in COMMANDS_DIR.glob("*.md"):
                shutil.copy2(cmd_file, dest / cmd_file.name)

    def _reset_context_dir(
        self, worktree_path: Path, mode: str = "IMPLEMENTATION", plan_content: str | None = None
    ) -> None:
        context_dir = worktree_path / ".agent" / "context"
        # Preserve exploration context across runs to avoid redundant /explore
        saved_explorer: str | None = None
        saved_test_context: str | None = None
        saved_plan: str | None = None
        explorer_file = context_dir / "explorer.md"
        test_context_file = context_dir / "test-context.md"
        plan_file = context_dir / "plan.md"
        if mode in ("IMPLEMENTATION", "REVISION") and explorer_file.exists():
            saved_explorer = explorer_file.read_text()
        if mode in ("IMPLEMENTATION", "REVISION") and test_context_file.exists():
            saved_test_context = test_context_file.read_text()
        # For IMPLEMENTATION, prefer ticket.plan (DB) so approval feedback is included
        if mode == "IMPLEMENTATION" and plan_content:
            saved_plan = plan_content
        elif mode in ("IMPLEMENTATION", "REVISION") and plan_file.exists():
            saved_plan = plan_file.read_text()
        if mode != "PLANNING" and context_dir.exists():
            shutil.rmtree(context_dir)
        context_dir.mkdir(parents=True, exist_ok=True)
        if saved_explorer:
            (context_dir / "explorer.md").write_text(saved_explorer)
        if saved_test_context:
            (context_dir / "test-context.md").write_text(saved_test_context)
        if saved_plan:
            (context_dir / "plan.md").write_text(saved_plan)
        # Clear stale outcome file from any previous run so we never read old results
        outcome_file = worktree_path / ".agent" / "outcome.json"
        if outcome_file.exists():
            outcome_file.unlink()
