# /reply-to-comments — Collect PR Comment Replies

## Role
Write your replies for every unresolved PR comment into `.agent/replies.json`.
The system posts the comments after your session ends — do NOT post them yourself.

## Input
The unresolved comment list from the REVISION prompt (comment ID, type, file, line, body).

## Task

Write a single Python script and run it with Bash to produce `.agent/replies.json`:

```python
import json, pathlib

replies = {
    # Inline review comments (type=review_comment)
    # Each entry: {"comment_id": <int>, "text": "<your reply>"}
    "review_comments": [
        {"comment_id": <comment_id>, "text": "<what you did or why no change needed>"},
        # … one entry per review_comment
    ],
    # PR-level conversation comments (type=issue_comment)
    # Each entry: {"text": "<your reply>"}
    "issue_comments": [
        {"text": "<what you did or why no change needed>"},
        # … one entry per issue_comment
    ],
}

out = pathlib.Path(".agent/replies.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(replies, indent=2))
print(f"Wrote {len(replies['review_comments'])} review + {len(replies['issue_comments'])} issue replies to {out}")
```

## Reply content (the "text" value — do NOT include "**Claude:**" yourself)

| Situation | text value |
|---|---|
| Code changed | `Done — [what changed and where]` |
| No change needed | `No change — [one sentence why]` |
| Question answered | `[direct answer]` |

## Constraints
- Include an entry for EVERY comment — no comment goes unanswered
- Do NOT post to GitHub yourself — write the file and stop
- Do NOT include `**Claude:**` in the text — the system prepends it automatically
- Never use `gh` CLI or `curl`

## Output
Tell the main agent: N review + M issue replies written to `.agent/replies.json`.
