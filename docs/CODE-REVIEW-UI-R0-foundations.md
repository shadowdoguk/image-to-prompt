# CODE-REVIEW — Slice UI-R0 (Foundations)

**Verdict:** pass
**Scope:** `src/shell.js` (router, focus-trap, live-region, announcer), `src/styles.css` (`--focus` token, `prefers-reduced-motion`), `scripts/smoke/router.smoke.js`.

## Standards axis
- Zero behavior change to the existing single-page flow: shell.js loads after app.js, integrates via ids/REST/hashchange only.
- Focus trap implements AX4 (Tab cycling, Escape dismiss, focus return to invoker).
- Reduced-motion media query closes POLISH-AUDIT A1; `--focus` ring closes WCAG 2.4.7.
- Tests: `UI-R0` static test + `router.smoke.js` green.

## Spec axis
- Matches UI-REDESIGN-SPEC §9 Phase 0 and §8 AX4/AX7/AX10.

## Notes
- Announcer uses a 40ms clear-then-set so repeated identical messages re-announce.
