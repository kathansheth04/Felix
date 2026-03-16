"""
Agent prompt builders for PLANNING, IMPLEMENTATION, and REVISION modes.
"""
from __future__ import annotations

from typing import Any

from backend.user_style import load_profile


def _prepend_style_profile(prompt: str) -> str:
    """Prepend the user style profile so Claude reads it before the ticket."""
    profile = load_profile()
    if not profile:
        return prompt
    preamble = (
        "# Developer style profile\n"
        "The following describes how this developer prefers to work. "
        "Apply this throughout the session without being told explicitly.\n\n"
        f"{profile}\n\n"
        "---\n\n"
    )
    return preamble + prompt


def build_planning_prompt(ticket: dict[str, Any], conversation_history: list[dict] | None = None) -> str:
    title = ticket.get("title", "")
    description = ticket.get("description") or "(no description)"
    acceptance_criteria = ticket.get("acceptance_criteria") or "(no acceptance criteria)"
    test_commands = ticket.get("test_commands") or "(no test commands provided)"
    additional_info = ticket.get("additional_information") or "(none)"

    conversation_block = ""
    if conversation_history:
        lines: list[str] = []
        for msg in conversation_history:
            role = msg.get("role", "human")
            content = msg.get("content", "")
            if role == "agent":
                lines.append(f"[Agent Plan]\n{content}")
            else:
                lines.append(f"[Human Feedback]\n{content}")
        conversation_block = f"""

CONVERSATION HISTORY (previous plan iterations):
{"---".join(lines)}

Revise your plan based on the latest human feedback above. Keep what was approved, address what was questioned.

REVISION: Reuse the previous plan structure. Only explore codebase areas that the feedback explicitly requires you to reconsider — avoid redundant Read/Grep/Glob for unchanged sections."""

    return f"""MODE: PLANNING
You are in plan mode with read-only codebase access. Explore the codebase and produce a structured implementation plan for the ticket below. Do NOT write or modify any files.

TICKET:
Title: {title}
Description: {description}
Acceptance Criteria: {acceptance_criteria}
Test Commands: {test_commands}

ADDITIONAL INFORMATION:
{additional_info}
{conversation_block}

INSTRUCTIONS:
1. Explore the codebase using Read, Grep, and Glob to understand the architecture, patterns, and relevant files
2. Produce a structured implementation plan in markdown with these sections:

## Approach
High-level strategy (2-3 sentences)

## Files to Modify
- `path/to/file.ext` — what changes and why

## Files to Create
- `path/to/new/file.ext` — purpose

## Implementation Steps
1. Step-by-step ordered list of what the agent will do

## Testing Strategy
- What tests to write and how they map to acceptance criteria
- How to run: {test_commands}

## Risks & Open Questions
- Anything the human should weigh in on before implementation begins — phrase clearly (e.g. "Question: should we use X or Y?") so the human can reply in the feedback box

Do NOT use the AskUserQuestion tool — it is disabled. If you have clarifying questions (e.g. multiple valid approaches, missing requirements), record them in the "Risks & Open Questions" section at the end of your plan. Do not guess — list them clearly. The human will see them when reviewing the plan and can provide feedback before implementation.

CONSTRAINTS:
- Be specific: name exact files, functions, and patterns you found in the codebase
- Use markdown tables when comparing options or listing file mappings — they render clearly. For flowcharts or architecture diagrams, use mermaid code blocks (```mermaid ... ```)
- Keep the plan concise but actionable — the implementation agent will follow it verbatim
- If you find genuine blockers (missing dependencies, contradictory requirements), flag them in Risks

OUTPUT FORMAT:
- Output ONLY the structured plan. No exploratory commentary, meta-commentary, or phrases like "Let me explore...", "I'll look at...", or "Here's my plan...".
- Your response must begin directly with the plan (e.g. ## Approach)."""


def build_implementation_prompt(ticket: dict[str, Any], default_branch: str = "main") -> str:
    title = ticket.get("title", "")
    description = ticket.get("description") or "(no description)"
    acceptance_criteria = ticket.get("acceptance_criteria") or "(no acceptance criteria)"
    test_commands = ticket.get("test_commands") or "(no test commands provided)"
    additional_info = ticket.get("additional_information") or "(none)"

    has_plan = bool(ticket.get("plan"))
    plan_instruction = ""
    if has_plan:
        plan_instruction = """
APPROVED PLAN:
Before starting, read .agent/context/plan.md — this is the human-approved implementation plan. Follow it.
"""

    base = f"""MODE: IMPLEMENTATION
Implement the ticket using slash commands. The system handles git, push, and PR creation automatically after you signal done — do not do any of those yourself.

TICKET:
Title: {title}
Description: {description}
Acceptance Criteria: {acceptance_criteria}
Test Commands: {test_commands}

ADDITIONAL INFORMATION:
{additional_info}
{plan_instruction}
WORKFLOW:
1. If .agent/context/explorer.md and .agent/context/test-context.md exist, use them — skip /explore.
   Otherwise run /explore to map the codebase and create those files.
2. /code {test_commands} — implement, write tests, run tests, self-correct until passing, signal done

CONSTRAINTS:
- Do not commit, push, or create PRs — the system handles this after /code writes outcome.json
- Signal NEEDS_HUMAN immediately for genuine blockers (contradictory criteria, missing dependencies, architectural scope issues)
- Do not proceed past step 2 until /code has written .agent/outcome.json

REQUIRED FINAL ACTION — must be the very last Bash command in every session, no exceptions:
If /code already wrote .agent/outcome.json, your session ends there — stop immediately and write nothing more.
If for any reason outcome.json was NOT written, write it now before stopping:
  printf '{{"status":"COMPLETED"}}' > .agent/outcome.json
Do NOT output any prose summary after writing outcome.json. The file write is your exit signal."""
    return _prepend_style_profile(base)


def build_revision_prompt(ticket: dict[str, Any], pr_comments: list[dict]) -> str:
    title = ticket.get("title", "")
    description = ticket.get("description") or "(no description)"
    acceptance_criteria = ticket.get("acceptance_criteria") or "(no acceptance criteria)"
    test_commands = ticket.get("test_commands") or "(no test commands provided)"
    additional_info = ticket.get("additional_information") or "(none)"
    branch_name = ticket.get("branch_name", "")
    pr_number = ticket.get("pr_number", "")
    pr_url = ticket.get("pr_url", "")

    # Format unresolved comments — include full thread history so the agent
    # understands what was already tried before writing its reply.
    formatted_comments = ""
    for c in pr_comments:
        comment_id = c.get("id", "")
        body = c.get("body", "").strip()
        comment_type = c.get("comment_type", "review")
        history: list[dict] = c.get("thread_history", [])

        # Build thread context block (only present when there is prior exchange)
        context_str = ""
        if history:
            lines = []
            for msg in history:
                author = msg.get("author", "human")
                msg_body = msg.get("body", "").strip()
                lines.append(f"      [{author}] \"{msg_body}\"")
            context_str = "\n" + "\n".join(lines) + "\n    "

        if comment_type == "issue":
            if context_str:
                formatted_comments += (
                    f"  - [{comment_id}] type=issue_comment (PR-level):\n"
                    f"{context_str}[NEEDS REPLY] \"{body}\"\n"
                )
            else:
                formatted_comments += f"  - [{comment_id}] type=issue_comment (PR-level): \"{body}\"\n"
        else:
            file_path = c.get("path", "unknown file")
            line = c.get("line") or c.get("original_line", "?")
            if context_str:
                formatted_comments += (
                    f"  - [{comment_id}] type=review_comment {file_path} line {line}:\n"
                    f"{context_str}[NEEDS REPLY] \"{body}\"\n"
                )
            else:
                formatted_comments += f"  - [{comment_id}] type=review_comment {file_path} line {line}: \"{body}\"\n"

    if not formatted_comments:
        formatted_comments = "  (no unresolved comments found)\n"

    base = f"""MODE: REVISION
Address PR review comments on the existing branch. The system handles git commit, push, and routing automatically after you signal done — do not do any of those yourself.

TICKET:
Title: {title}
Description: {description}
Acceptance Criteria: {acceptance_criteria}
Test Commands: {test_commands}

SYSTEM CONTEXT:
Branch: {branch_name}
PR Number: {pr_number}
PR URL: {pr_url}
Unresolved Comments:
{formatted_comments}

ADDITIONAL INFORMATION:
{additional_info}

WORKFLOW:
1. /explore — explorer.md exists from IMPLEMENTATION: use fast path (read only files in comments). Missing: run full exploration.
2. Address each comment with targeted code changes
3. Run {test_commands} — confirm all tests still pass
4. Write replies to .agent/replies.json (see WRITING REPLIES below)
5. Write outcome signal and stop:
   printf '{{"status":"COMPLETED"}}' > .agent/outcome.json

WRITING REPLIES:
The system posts the comments on your behalf after the session ends — do NOT call any GitHub API yourself.
Write a Python script and run it with Bash to produce .agent/replies.json:

  import json, pathlib
  replies = {{
      "review_comments": [
          # one dict per type=review_comment above
          {{"comment_id": <id>, "text": "<your reply>"}},
      ],
      "issue_comments": [
          # one dict per type=issue_comment above
          {{"text": "<your reply>"}},
      ],
  }}
  out = pathlib.Path(".agent/replies.json")
  out.parent.mkdir(parents=True, exist_ok=True)
  out.write_text(json.dumps(replies, indent=2))

- Include every comment — no comment goes without a reply
- "text" is your reply content only — do NOT include "**Claude:**" (the system prepends it)
- Do NOT post to GitHub yourself — writing the file is the only required action

CONSTRAINTS:
- Do not use AskUserQuestion (planning-only). If you need to ask the reviewer something, put it in your reply text in .agent/replies.json and end the revision — the reply will be posted to the PR.
- Unit tests only — no integration or E2E
- Never create a new PR or push to a new branch
- Do not commit, push, or call any GitHub API — the system handles all of that after outcome.json is written
- 3-attempt limit if tests won't pass: write FAILED outcome and stop

REQUIRED FINAL ACTION — must be the very last Bash command in every session, no exceptions:
Step 5 above writes outcome.json — stop immediately after that and write nothing more.
If for any reason you reach the end of your work without having written outcome.json, write it now:
  printf '{{"status":"COMPLETED"}}' > .agent/outcome.json
Do NOT output any prose summary after writing outcome.json. The file write is your exit signal."""
    return _prepend_style_profile(base)
