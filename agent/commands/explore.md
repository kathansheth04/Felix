# /explore — Codebase Explorer

## Role
Understand the repository and produce two focused context files for downstream agents.

## REVISION Fast Path
If `.agent/context/explorer.md` already exists and is non-empty, **skip the full exploration**. Instead:
1. Read the existing `.agent/context/explorer.md` for baseline context
2. Re-read only the specific files mentioned in the PR comments
3. Append a `## REVISION Update` section to `.agent/context/explorer.md` with any new findings
4. Stop — do not run the Tasks below

## Plan-based Fast Path (IMPLEMENTATION)
If `.agent/context/plan.md` exists, read its **Files to Modify** and **Files to Create** sections first. Use those paths as your primary targets — skip broad directory mapping. Focus Tasks 1, 4, and 5 (tech stack, one pattern file, test structure). Do not re-discover file locations the plan already identified.

## Input
Ticket context from the main agent's system prompt (title, description, acceptance criteria).

## Tasks

1. Identify the tech stack — read package.json, requirements.txt, pyproject.toml, or equivalent
2. Map relevant directories — list top-level and key subdirectories
3. Locate files to read or modify for this ticket
4. Read **one** representative file similar to what this ticket requires — focus on import style, naming, and structure (20 lines max)
5. Find where tests live, what test runner is used, and how an existing test is structured (read one test file, 15 lines max)

## Output

Write two files:

### File 1: `.agent/context/explorer.md`
Full exploration report. **Keep under 500 words.**

```markdown
# Codebase Exploration

## Tech Stack
- [frameworks, languages, test runners — bullet list only]

## Directory Structure
[2–5 line map of relevant directories]

## Files to Read or Modify
- `path/to/file.ts` — [why relevant]

## Existing Patterns
[one code snippet, import style + naming, 20 lines max]

## Test Structure
- Runner: [jest/pytest/vitest/etc]
- Location: [where tests live]
- Command: [how to run]
- Naming: [file naming convention, e.g. *.test.ts or test_*.py]

## Key Observations
[2–4 bullets max — anything that affects implementation or testing]
```

### File 2: `.agent/context/test-context.md`
Focused slice for the `/write-tests` agent. **Keep under 150 words.**

```markdown
# Test Context

- Runner: [jest/pytest/vitest/etc]
- Location: [exact directory where test files go]
- Command: [exact test command]
- File naming: [e.g. `ComponentName.test.ts` or `test_module_name.py`]
- Import style: [e.g. `import { render } from '@testing-library/react'`]
- Mock pattern: [how mocks are declared — 3 lines max]

## Example test structure:
[10–15 line excerpt from one existing test file — the minimum needed to understand structure]
```
