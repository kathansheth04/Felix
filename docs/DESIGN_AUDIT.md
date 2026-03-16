# Design Audit — Felix

Conducted per ui-master.mdc Design Audit Protocol. **No changes implemented.** Awaiting phase approval before execution.

---

## DESIGN AUDIT RESULTS

### Overall Assessment

The app has a solid foundation: dark slate palette, semantic tokens, Plus Jakarta Sans + JetBrains Mono, and shadcn/ui consistency. It feels professional but utilitarian. Hierarchy is sometimes diluted by competing elements, hardcoded colors break the token system, and several screens lack the breathing room and inevitability that make premium apps feel effortless.

---

## PHASE 1 — Critical

(Visual hierarchy, usability, responsiveness, or consistency issues that actively hurt the experience)

### 1. TicketCard — Quick actions hidden until hover
- **What's wrong:** "Details", "Approve", "Add to board" / transition buttons use `opacity-0 group-hover:opacity-100`. Users must discover hover by accident.
- **What it should be:** Quick actions always visible with reduced opacity (e.g. 70%) or a clear affordance (e.g. subtle chevron/overflow icon). Primary actions must not depend on hover discovery.
- **Why this matters:** Core workflow: users need to approve plans, add to board, move tickets. Hidden actions create friction and support burden.

### 2. TicketCard — Hardcoded colors (zinc, red) instead of tokens
- **What's wrong:** `text-zinc-400`, `text-red-400`, `bg-zinc-700`, `border-red-500/30` etc. scattered in TicketCard, LogViewer, SessionsScreen. Violates DESIGN_SYSTEM — tokens must be source of truth.
- **What it should be:** Replace with `text-muted-foreground`, `text-destructive` or semantic variants, `bg-muted`, `border-destructive/30`.
- **Why this matters:** Inconsistent theming, future dark/light mode, maintenance burden.

### 3. Kanban column — Identity too subtle
- **What's wrong:** Column identity is a 4px colored bar (`h-1`) — barely perceivable. All columns read similarly at a glance.
- **What it should be:** Stronger visual anchor: slightly taller accent bar (6–8px) or subtle header background tint. User should instantly distinguish To Do vs In Progress vs Blocked.
- **Why this matters:** Kanban is the primary view. Column recognition drives workflow speed.

### 4. Global Settings overlay — No clear hierarchy
- **What's wrong:** Full-screen overlay with "Back" and dense form. No page-level title or structure. Feels like a modal, not a dedicated screen.
- **What it should be:** Clear "API & Credentials" section title at top, consistent spacing with other settings screens (ProjectSettings, CreateProjectDialog). Primary action (Save) should be unmissable.
- **Why this matters:** Credentials are critical; unclear UI increases setup errors.

### 5. Empty states — Inconsistent treatment
- **What's wrong:** Home "No projects yet" has centered CTA; Backlog has dashed border + CTA; Sessions "No sessions yet" and LogViewer "Select a session" are plain text. No shared empty-state pattern.
- **What it should be:** Single EmptyState component: icon (optional), headline, short description, primary CTA. Apply across Home, Backlog, Sessions, LogViewer, Kanban columns.
- **Why this matters:** Blank screens feel broken without intent. Consistency signals quality.

### 6. Responsiveness — Fixed widths may break on small windows
- **What's wrong:** ProjectRail 240px, Sessions sidebar 288px, Kanban columns 288px. On narrow windows (< 1024px), horizontal scroll or cramped layout.
- **What it should be:** Collapsible rail (icon-only mode) at ~768px; Kanban columns allow min-width with horizontal scroll and clear scroll cue; Sessions sidebar collapsible or resizable.
- **Why this matters:** Desktop app still runs on laptops and smaller monitors. Layout should adapt gracefully.

**Review:** Phase 1 items address discoverability (TicketCard actions), token compliance (hardcoded colors), visual hierarchy (columns, settings), consistency (empty states), and layout resilience. These directly affect daily use.

---

## PHASE 2 — Refinement

(Spacing, typography, color, alignment, iconography adjustments that elevate the experience)

### 7. Spacing rhythm — Inconsistent padding
- **What's wrong:** Header bars vary: `px-4 py-2.5` (Kanban), `h-10 px-4` (Backlog, Home), `px-5 py-3` (LogViewer). Section padding: `p-8`, `px-8 py-10`, `max-w-lg mx-auto p-8`. No clear rhythm.
- **What it should be:** Standardize: screen header `h-10 px-4` or `px-5 py-3` (pick one); content `px-6 py-6` or `p-8`; sections `space-y-6`. Document in DESIGN_SYSTEM.
- **Why this matters:** Rhythmic spacing feels intentional; random values feel slapped together.

### 8. Typography — Fragmented type scale
- **What's wrong:** `text-[10px]`, `text-[11px]` used for badges, timestamps, issue keys. Outside Tailwind scale; creates visual noise.
- **What it should be:** Use `text-xs` (12px) as minimum for UI; reserve smaller sizes only for monospace IDs if necessary. Establish clear hierarchy: page title → section → body → caption.
- **Why this matters:** Too many sizes compete; hierarchy blurs.

### 9. Column accent colors — Mix of Tailwind and tokens
- **What's wrong:** `COLUMN_ACCENT` uses `bg-amber-400/70`, `bg-orange-500/70`, `bg-emerald-500/60` — raw Tailwind. DESIGN_SYSTEM has `--primary`, `--warning`, `--success`, `--destructive`.
- **What it should be:** Map columns to semantic tokens: TODO → muted; IN_PROGRESS → primary or teal; DEV_COMPLETE → primary; IN_REVIEW → warning; DONE → success; BLOCKED → destructive.
- **Why this matters:** Single source of truth for palette; future theme changes propagate correctly.

### 10. Icon sizing — No system
- **What's wrong:** Icons: `h-3 w-3`, `h-3.5 w-3.5`, `h-4 w-4` mixed. Search icon in Sessions is very small (`h-3 w-3`).
- **What it should be:** Standard: `h-4 w-4` (16px) for primary UI; `h-3.5 w-3.5` (14px) for inline/secondary. Document in DESIGN_SYSTEM.
- **Why this matters:** Cohesive iconography reads as one system.

### 11. CreateProjectDialog — Inconsistent with TicketDialog
- **What's wrong:** CreateProjectDialog uses raw `Label` + `space-y-2`; TicketDialog uses `Field` component with optional `hint` and `required`. Different patterns for similar form screens.
- **What it should be:** Use shared `Field` (or equivalent) for CreateProjectDialog. Same label/hint/error treatment.
- **Why this matters:** Forms should behave and look identical; reduces cognitive load.

### 12. LogViewer — Tool color mapping duplicated
- **What's wrong:** `TOOL_COLOR` and `TOOL_BG` in LogViewer use raw Tailwind (`text-sky-400`, `bg-emerald-400`, etc.). Not tokens.
- **What it should be:** Create semantic tool colors or extend DESIGN_SYSTEM with `--tool-read`, `--tool-write`, etc., or use muted primary palette variants.
- **Why this matters:** Token compliance + future theming.

**Review:** Phase 2 tightens spacing, typography, and iconography; aligns forms and colors to tokens. Cumulative effect: app feels designed, not assembled.

---

## PHASE 3 — Polish

(Micro-interactions, transitions, empty states, loading states, error states, and subtle details)

### 13. Loading states — Plain text only
- **What's wrong:** "Starting up…", "loading…", "Loading…" — no skeleton, no animation. Feels frozen.
- **What it should be:** Subtle pulse/skeleton for lists (Sessions, Backlog, Kanban columns); keep text but add `animate-pulse` or minimal skeleton bars.
- **Why this matters:** Waiting feels shorter when something is visibly loading.

### 14. Error states — Inconsistent treatment
- **What's wrong:** Form errors: `text-destructive` inline. Toast: `variant: 'destructive'`. Setup screen: list of missing deps. No shared error block component.
- **What it should be:** Consistent error block: icon (optional) + message + optional action. Use for form errors, setup screen, token validation.
- **Why this matters:** Errors are stressful; consistent treatment reassures.

### 15. Focus states — Keyboard navigation
- **What's wrong:** Buttons have `focus-visible:ring-2`; many interactive elements (list rows, ticket cards) may not have clear focus indicators for keyboard users.
- **What it should be:** Audit tab order and focus visibility on Backlog rows, Sessions list, Kanban columns. Ensure `:focus-visible` ring on all interactive elements.
- **Why this matters:** Accessibility; power users rely on keyboard.

### 16. Motion — Stagger on lists
- **What's wrong:** Lists (projects, tickets, sessions) appear instantly. No sense of order or reveal.
- **What it should be:** Optional subtle stagger (`animation-delay-100`, `animation-delay-200`) on initial load for Home project list, Backlog, Sessions. Keep minimal to avoid feeling sluggish.
- **Why this matters:** Delight without distraction.

### 17. Dialog transitions — Slight refinement
- **What's wrong:** `zoom-in-95` + `slide-in-from-top` — fine but generic. Overlay `backdrop-blur-md` is good.
- **What it should be:** Consider slightly slower (300ms) or softer curve for larger dialogs (TicketDialog, PlanReviewDialog). Optional.
- **Why this matters:** Large dialogs deserve a bit more presence.

### 18. Canvas background — Subtle gradient
- **What's wrong:** `bg-canvas` has radial gradients (blue, violet) — already present. Could be more refined.
- **What it should be:** Ensure gradient is subtle enough not to compete with content. If needed, reduce opacity further (e.g. 0.02–0.03).
- **Why this matters:** Background supports; it should not dominate.

**Review:** Phase 3 adds polish: loading feedback, error consistency, accessibility, and subtle motion. Expected impact: app feels premium and trustworthy.

---

## DESIGN_SYSTEM UPDATES REQUIRED

- Add `--tool-*` semantic colors for LogViewer (or document Tailwind mapping as exception)
- Add spacing tokens for headers/content (Section "Spacing" updates)
- Add icon size tokens (Section "Component Tokens" or new "Iconography")
- Add EmptyState component spec (icon, headline, description, CTA)
- Add ErrorBlock component spec

---

## IMPLEMENTATION NOTES FOR BUILD AGENT

(Exact file, component, property, old value → new value)

**Phase 1, Item 1 (TicketCard quick actions):**
- `TicketCard.tsx`: Remove `opacity-0 group-hover:opacity-100` from quick action container. Use `opacity-70 group-hover:opacity-100` or always-visible with `hover:bg-primary/20` on buttons.

**Phase 1, Item 2 (Hardcoded colors):**
- `TicketCard.tsx`: `text-zinc-400` → `text-muted-foreground`; `text-red-400` → `text-destructive`; `bg-zinc-700` → `bg-muted`; `border-red-500/30` → `border-destructive/30`.
- `LogViewer.tsx`: Map `TOOL_COLOR`/`TOOL_BG` to token-based classes or new semantic tokens.
- `SessionsScreen.tsx`: `text-zinc-400`, `text-zinc-500` → `text-muted-foreground` or appropriate token.

**Phase 1, Item 3 (Column accent):**
- `KanbanColumn.tsx`: `h-1` → `h-1.5` or `h-2` (6–8px); optionally add `bg-{accent}/10` to header row for stronger identity.

**Phase 2, Item 7 (Spacing):**
- Standardize: `HomePage.tsx`, `BacklogScreen.tsx`, `KanbanBoard.tsx` header to `h-10 px-4` or `px-5 py-3`.
- Content areas: `max-w-3xl mx-auto px-6 py-6` or `p-8` consistently.

**Phase 2, Item 10 (Icons):**
- `SessionsScreen.tsx`: Search icon `h-3 w-3` → `h-3.5 w-3.5` or `h-4 w-4`.
- Audit all `h-3 w-3` → `h-3.5 w-3.5` minimum for interactive icons.

---

## APPROVAL WORKFLOW

Per ui-master protocol:
1. **Do not implement** until the user reviews and approves each phase.
2. User may reorder, cut, or modify any recommendation.
3. Once a phase is approved, execute surgically — change only what was approved.
4. After each phase, present the result for review before moving to the next phase.
5. If the result doesn't feel right, propose refinement before continuing.

---

---

## Phase 1 Implementation — Complete ✓

Implemented 2025-03-15:
1. **TicketCard** — Quick actions now opacity-80 by default (Details, Approve, transitions)
2. **Token compliance** — Replaced hardcoded zinc/red/emerald in TicketCard, LogViewer, SessionsScreen with semantic tokens
3. **KanbanColumn** — Accent bar h-1 → h-2
4. **Global Settings** — Page title in overlay header, consistent spacing
5. **EmptyState** — New shared component (hero, default, minimal variants), applied to Home, Backlog, Sessions, LogViewer, Kanban columns
6. **Responsiveness** — ProjectRail collapses to icon-only below 768px; Kanban board has right-edge gradient scroll cue

---

## Phase 2 Implementation — Complete ✓

Implemented:
7. **Spacing rhythm** — Screen headers standardized to h-10 px-5; content to px-6 py-6 / p-8; sections space-y-6
8. **Typography** — text-[10px] and text-[11px] replaced with text-xs across TicketCard, Backlog, Sessions, LogViewer, HomePage, ProjectRail, empty-state
9. **Column accents** — COLUMN_ACCENT now uses semantic tokens: primary, warning, success, destructive
10. **Icon sizing** — h-3 w-3 updated to h-3.5 w-3.5 for secondary; primary stays h-4 w-4. Documented in DESIGN_SYSTEM
11. **CreateProjectDialog** — Now uses shared Field component with label/hint (matches TicketDialog)
12. **LogViewer tool colors** — TOOL_COLOR and TOOL_BG map to semantic tokens: primary, success, warning, violet, teal

---

## Phase 3 Implementation — Complete ✓

Implemented:
13. **Loading states** — Added `animate-pulse` to Starting up…, Loading…, loading… across App, LogViewer, SessionsScreen, KanbanBoard, BacklogScreen
14. **Error states** — Created ErrorBlock component; used in CreateProjectDialog, TicketDialog, GlobalSettings, ProjectSettings, token validation; SetupItem uses destructive border/background
15. **Focus states** — Global focus-visible ring for button, [role="button"], a, [tabindex="0"]
16. **Motion** — Stagger (75ms × index, capped at 4) on Home project list, Backlog tickets, Sessions group headers
17. **Dialog transitions** — duration-200 → duration-300
18. **Canvas background** — Reduced gradient opacity 0.04/0.03 → 0.02

*Design audit complete. All three phases implemented.*
