# Felix — Design System

Design tokens and visual language. All styling must reference these values — no hardcoded colors, spacing, or sizes.

---

## Typography

| Token | Value | Usage |
|-------|-------|-------|
| `font-sans` | Plus Jakarta Sans, system-ui | Body, headings, UI |
| `font-mono` | JetBrains Mono, ui-monospace | Code, IDs, URLs |
| `text-xs` | 12px | Secondary labels, badges |
| `text-sm` | 14px | Body, form labels |
| `text-base` | 16px | Emphasized body |
| `text-lg` | 18px | Section headings |
| `text-xl` | 20px | Page titles |
| `text-2xl` | 24px | Hero/empty states |
| `font-medium` | 500 | Labels, active states |
| `font-semibold` | 600 | Headings |
| `font-bold` | 700 | Strong emphasis |
| `tracking-tight` | -0.025em | Headlines |
| `letter-spacing` | -0.01em | Body (base) |

---

## Iconography

| Size | Value | Usage |
|------|-------|-------|
| Primary | h-4 w-4 (16px) | Nav items, buttons, headings |
| Secondary | h-3.5 w-3.5 (14px) | Inline icons, badges, compact UI |

---

## Spacing (8px base)

| Token | Value | Usage |
|-------|-------|-------|
| Screen header | h-10 px-5 | All screen headers |
| Content | p-8 or px-6 py-6 | Settings, list content |
| Sections | space-y-6 | Between form sections |
| `space-1` | 4px | Tight gaps |
| `space-2` | 8px | Inline gaps |
| `space-3` | 12px | Small padding |
| `space-4` | 16px | Standard padding |
| `space-5` | 20px | Section spacing |
| `space-6` | 24px | Large gaps |
| `space-8` | 32px | Section separation |
| `space-10` | 40px | Page padding |

---

## Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | 8px (0.5rem) | Base radius (inputs, badges, cards) |
| `rounded-sm` | calc(var(--radius) - 4px) | Tight corners |
| `rounded-md` | calc(var(--radius) - 2px) | Buttons sm |
| `rounded-lg` | var(--radius) | Cards, buttons, inputs |
| `rounded-xl` | 12px | Cards, dialogs |
| `rounded-2xl` | 16px | Dialog content |

---

## Colors (HSL, dark theme — Vercel-inspired)

### Base (near black + white)
- `--background`: 0 0% 2% — Near black
- `--foreground`: 0 0% 100% — White
- `--card`: 0 0% 4% — Elevated surface
- `--border`: 0 0% 11% — Subtle divider

### Primary (muted blue + white)
- `--primary`: 214 50% 52% — Muted Vercel blue
- `--primary-foreground`: 0 0% 100%

### Semantic
- `--destructive`: 0 72% 51%
- `--success`: 168 76% 42%
- `--warning`: 38 92% 50% — In review, amber
- `--muted`: 222 20% 16%
- `--muted-foreground`: 215 16% 50%

### Accent (phase colors)
- `--violet`: 263 70% 58% — Planning
- `--teal`: 173 80% 40% — Implementing

---

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | 0 1px 2px rgba(0,0,0,0.3) | Cards, inputs |
| `shadow-md` | 0 4px 6px rgba(0,0,0,0.4) | Hover cards |
| `shadow-glow-sm` | 0 0 16px -4px hsl(213 94% 58% / 0.15) | Primary button |
| `shadow-glow` | 0 0 24px -6px hsl(213 94% 58% / 0.2) | Primary hover |

---

## Animations

| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `animate-fade-in` | 300ms | ease-out | Overlays |
| `animate-fade-in-up` | 500ms | cubic-bezier(0.16,1,0.3,1) | Empty states |
| `animate-scale-in` | 250ms | cubic-bezier(0.16,1,0.3,1) | Dialogs |
| `animate-status-pulse` | 1.5s | cubic-bezier(0.4,0,0.6,1) | Running/queued |
| `transition-colors` | 150–200ms | default | Buttons, hovers |
| `hover:-translate-y-0.5` | — | — | Card lift (2px) |
| `hover:shadow-lift` | — | — | Card depth on hover |
| `animate-page-enter` | 180ms | cubic-bezier(0.16,1,0.3,1) | Screen transitions (Board, Backlog, etc.) |
| `animate-rail-enter` | 180ms | cubic-bezier(0.16,1,0.3,1) | Sidebar on project view |
| `animate-overlay-enter` | 150ms | ease-out | Modal overlays (API & Credentials) |

---

## Component Tokens

### Kanban column
- Width: 288px (w-72)
- Header bar: 4px accent
- Card gap: 8px (space-y-2)

### Ticket card
- Padding: 12px (p-3)
- Border: 1px border-border/50
- Hover: border-border, shadow-md

### Sidebar / Project Rail
- Width: 240px (w-60)
- Nav item: px-3 py-2, rounded-lg

### Sessions sidebar
- Width: 288px (w-72)
- Search: pl-7 for icon, py-2

### EmptyState
- Variants: `hero` (page-level), `default`, `minimal`
- Props: icon (optional), headline, description (optional), action (optional)

### Field (forms)
- Shared form field: label, hint (optional), required (optional), children
- Used in TicketDialog, CreateProjectDialog, GlobalSettings, ProjectSettings

### ErrorBlock
- Consistent error block: message, optional action, optional className
- Props: message, action?, className?
- Used for form errors, token validation, setup screen (SetupItem uses destructive styling)
