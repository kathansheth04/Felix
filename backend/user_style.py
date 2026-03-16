"""
Meta-learning: user style profile.

A silent, self-organizing profile that accumulates understanding of how the
developer thinks and works — derived from ticket content and PR review comments.
Read at the start of every IMPLEMENTATION and REVISION session.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Single shared profile file — user-level, not project-level
PROFILE_PATH = Path(__file__).parent.parent / "agent" / "context" / "user_style.md"

# Token budget for the profile when injected into a session prompt.
# At ~4 chars/token this is ~6000 chars — enough for rich style guidance
# without crowding the ticket context.
MAX_PROFILE_TOKENS = 1500

# App root — used as cwd for SDK reflection call (SDK requires cwd)
_APP_ROOT = Path(__file__).parent.parent


def load_profile() -> Optional[str]:
    """
    Load the user style profile for injection into a session prompt.
    Returns None if no profile exists yet (first run).
    Truncates to MAX_PROFILE_TOKENS worth of content if the file has grown large.
    """
    if not PROFILE_PATH.exists():
        return None

    content = PROFILE_PATH.read_text().strip()
    if not content:
        return None

    # Rough token estimate: 4 chars per token
    max_chars = MAX_PROFILE_TOKENS * 4
    if len(content) > max_chars:
        # Truncate from the top (oldest content) — recent observations are more
        # relevant. Leave a note so Claude knows it's partial.
        truncated = content[-max_chars:]
        # Don't cut mid-line
        first_newline = truncated.find("\n")
        if first_newline > 0:
            truncated = truncated[first_newline + 1 :]
        content = f"[Profile truncated — showing most recent observations]\n\n{truncated}"

    return content


def _write_profile(content: str) -> None:
    """Write the full profile to disk, creating parent dirs if needed."""
    PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_PATH.write_text(content)


def _norm_comment(c: dict[str, Any]) -> dict[str, str]:
    """Normalize comment dict to have file_path, line, body."""
    return {
        "file_path": c.get("path") or c.get("file_path") or "unknown",
        "line": str(c.get("line") or c.get("original_line") or "?"),
        "body": c.get("body", ""),
    }


async def reflect_on_implementation(
    ticket_title: str,
    ticket_description: str,
    acceptance_criteria: str,
    execution_id: str,
) -> None:
    """
    Reflect on a completed IMPLEMENTATION execution.
    Signal: the ticket the user wrote — reveals how they think about problems,
    name things, define acceptance criteria, and scope work.

    Called as a fire-and-forget task after COMPLETED sentinel. Never raises —
    failures are logged and swallowed so the main pipeline is unaffected.
    """
    try:
        await _run_reflection(
            signal_type="implementation",
            signal_content=f"""Ticket title: {ticket_title}

Ticket description:
{ticket_description}

Acceptance criteria:
{acceptance_criteria}""",
            execution_id=execution_id,
        )
    except Exception:
        logger.exception(
            "reflect_on_implementation failed for execution %s — skipping",
            execution_id,
        )


async def reflect_on_planning(
    user_feedback: str,
    ticket_title: str,
    context_id: str,
) -> None:
    """
    Reflect on planning completion — user feedback on a plan, including answers
    to questions from the plan's Risks & Open Questions section.

    Called as a fire-and-forget task when the user approves a plan (with feedback)
    or submits plan feedback. Never raises.
    """
    if not user_feedback or not user_feedback.strip():
        return

    try:
        await _run_reflection(
            signal_type="planning",
            signal_content=f"""Ticket: {ticket_title}

Developer's feedback (including answers to plan questions):
{user_feedback.strip()}""",
            execution_id=context_id,
        )
    except Exception:
        logger.exception(
            "reflect_on_planning failed for %s — skipping",
            context_id,
        )


async def reflect_on_revision(
    pr_comments: list[dict[str, Any]],
    execution_id: str,
) -> None:
    """
    Reflect on a completed REVISION execution.
    Signal: the PR review comments the human left on the agent's code —
    reveals what they push back on, care about, and want done differently.

    pr_comments is the same list already fetched by the runner:
    [{"path": ..., "line": ..., "body": ...}, ...] or equivalent keys.

    Called as a fire-and-forget task after COMPLETED sentinel. Never raises.
    """
    if not pr_comments:
        return

    try:
        formatted = "\n".join(
            f"- {n['file_path']} line {n['line']}: {n['body']}"
            for n in (_norm_comment(c) for c in pr_comments)
        )
        await _run_reflection(
            signal_type="revision",
            signal_content=f"PR review comments left by the developer:\n{formatted}",
            execution_id=execution_id,
        )
    except Exception:
        logger.exception(
            "reflect_on_revision failed for execution %s — skipping",
            execution_id,
        )


async def _run_reflection(
    signal_type: str,
    signal_content: str,
    execution_id: str,
) -> None:
    """
    Core reflection logic. Calls Claude to decide whether to append or rewrite
    the profile based on the new signal.
    """
    existing_profile = load_profile()
    profile_section = (
        f"Current user style profile:\n{existing_profile}"
        if existing_profile
        else "Current user style profile: (empty — this will be the first entry)"
    )

    source_description = {
        "implementation": "a ticket the developer wrote (title, description, acceptance criteria)",
        "revision": "PR review comments the developer left on code written by an AI agent",
        "planning": "feedback the developer provided when reviewing an implementation plan (including answers to questions in the plan)",
    }.get(signal_type, "developer feedback")

    prompt = f"""You are maintaining a concise, freeform profile of a software developer's
working style and preferences. The profile is injected into an AI coding agent's
context at the start of every session so the agent can match the developer's style
without being told explicitly each time.

The profile should capture things like:
- How they structure and name things (functions, files, variables, components)
- Backend patterns they prefer (error handling style, layering, validation approach)
- Frontend patterns they prefer (component structure, state management, styling)
- Testing philosophy (what they test, how they name tests, what they mock)
- Code style instincts (verbosity vs conciseness, explicit vs implicit, etc.)
- What they push back on in code review (what earns a comment)
- How they scope and define work in tickets

Do NOT include:
- Project-specific facts (repo names, file paths, dependencies)
- One-off observations that may not reflect general preference
- Anything that reads like a rule or constraint — this is a style profile, not a linter

---

New signal ({source_description}):
{signal_content}

---

{profile_section}

---

Instructions:
1. Decide if the new signal reveals anything genuinely new or reinforces existing
   observations about this developer's style.
2. If there is a conflict between the new signal and the existing profile, rewrite
   only the conflicting section(s) with the new signal taking precedence.
3. If the new signal adds something not yet in the profile, append it naturally —
   you may reorganize headings if it improves clarity.
4. If the new signal reveals nothing new, respond with exactly: NO_UPDATE
5. If updating, respond with the COMPLETE updated profile (not a diff).
   Use clean markdown with ## headings for each style dimension.
   Keep the total profile under 1200 tokens.

Respond with either NO_UPDATE or the full updated profile. Nothing else."""

    from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, TextBlock

    options = ClaudeAgentOptions(
        cwd=str(_APP_ROOT),
        permission_mode="plan",
        allowed_tools=[],  # Reflection is text-only, no tools
    )

    text_blocks: list[str] = []
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock) and block.text.strip():
                    text_blocks.append(block.text.strip())

    result = text_blocks[-1] if text_blocks else ""

    if result == "NO_UPDATE":
        logger.debug(
            "reflection(%s, execution=%s): no update", signal_type, execution_id
        )
        return

    _write_profile(result)
    logger.info(
        "reflection(%s, execution=%s): profile updated", signal_type, execution_id
    )
