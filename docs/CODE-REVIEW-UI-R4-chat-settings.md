# CODE-REVIEW — Slice UI-R4 (Chat + Settings)

**Verdict:** pass
**Scope:** `src/index.html` (Chat/Settings views), `src/shell.js` §7–8.

## Standards axis
- Chat content moved verbatim into a first-class view; app.js owns its behavior unchanged (same endpoints, same session model).
- Settings writes the same localStorage keys app.js reads (`i2p.state.*`), then syncs live controls through app.js's own change handlers — no reload needed.
- Subject-prompt editor opened from Settings loads current content first (no blank-overwrite hazard).

## Spec axis
- §4.3 chat promotion; §4.5 settings scope (defaults + system prompts; resists accretion).

## Deviations
- Session rail rendered as the existing conversation select bar (functionally equivalent; full rail parked in BACKLOG).
