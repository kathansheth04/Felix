"""
Ticket state machine — validates all status transitions.

Human transitions: initiated by the user via move_ticket IPC call.
Agent transitions: set directly by the runner after sentinel detection.

Plan review lives under IN_PROGRESS — when planning completes, ticket stays
IN_PROGRESS (plan populated). Approve/reject/feedback use dedicated IPC handlers.
"""
from __future__ import annotations

# ─── Valid human-initiated transitions ────────────────────────────────────────
#
# IN_REVIEW is fully locked to humans — only the agent exits IN_REVIEW.
# Any move to TODO triggers the cancellation + cleanup sequence.

HUMAN_TRANSITIONS: dict[str, list[str]] = {
    "BACKLOG": ["TODO"],       # Promote to board
    "TODO": ["IN_PROGRESS", "BACKLOG"],
    "IN_PROGRESS": ["TODO"],
    "QUEUED": ["TODO"],
    "DEV_COMPLETE": ["IN_REVIEW", "DONE", "TODO"],
    "BLOCKED": ["TODO", "DEV_COMPLETE", "BACKLOG"],  # DEV_COMPLETE retry; BACKLOG send back
    # IN_REVIEW → (agent only)
    # DONE → (terminal)
}

# ─── Valid agent-initiated transitions ────────────────────────────────────────

AGENT_TRANSITIONS: dict[str, list[str]] = {
    "IN_PROGRESS": ["DEV_COMPLETE", "BLOCKED"],
    "QUEUED": ["IN_PROGRESS"],  # semaphore slot available
    "TODO": ["QUEUED"],         # concurrency slot unavailable at enqueue time
    "IN_REVIEW": ["DEV_COMPLETE", "BLOCKED"],
}


class StateMachineError(ValueError):
    pass


class StateMachine:
    def validate_human_transition(self, current_status: str, new_status: str) -> str:
        allowed = HUMAN_TRANSITIONS.get(current_status, [])
        if new_status not in allowed:
            raise StateMachineError(
                f"Human cannot move ticket from {current_status!r} to {new_status!r}. "
                f"Allowed: {allowed or 'none'}"
            )
        return new_status

    def validate_agent_transition(self, current_status: str, new_status: str) -> str:
        allowed = AGENT_TRANSITIONS.get(current_status, [])
        if new_status not in allowed:
            raise StateMachineError(
                f"Agent cannot move ticket from {current_status!r} to {new_status!r}. "
                f"Allowed: {allowed or 'none'}"
            )
        return new_status

    def can_human_transition(self, current_status: str, new_status: str) -> bool:
        return new_status in HUMAN_TRANSITIONS.get(current_status, [])
