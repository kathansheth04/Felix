# Lessons

## 2026-03-16 — Splash screens
- Keep splash **purely cosmetic**: it should never block clicks or alter view/state; use a fixed overlay with `pointer-events-none`.
- Honor `prefers-reduced-motion` by removing scale transforms and relying on opacity (or no animation).
- If startup is slow, show a minimal hint only after a delay (avoid “loading UI” unless needed).
- Prefer a brief variant on subsequent launches to reduce perceived friction for frequent users.

