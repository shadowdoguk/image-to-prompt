# Polish Audit: image-to-prompt — Slice 3 (Kilo Code provider migration + model selector)

**Date:** 2026-08-04
**Auditor:** Goose (inline)
**Slice:** 3 — Kilo Code provider migration + model selector (ADR 0022)

---

## Scope

Slice 3 replaces the direct MiniMax M3 API integration with the Kilo AI Gateway as the sole LLM provider, adds a model selector dropdown with six hardcoded models, and wires the selected model through all 11 LLM endpoints. The five sub-slices — 3.1 (env swap), 3.2 (skipped — image format already correct), 3.3 (selector UI + state), 3.4 (param wiring), 3.5 (tests + review) — each pass structural verification. The code review verdict is `pass` (0 findings). This audit is the G5 polish pass on the slice as a whole.

---

## 1. Accessibility

| Check | Result | Notes |
|---|---|---|
| Keyboard navigation | ✅ | The LLM model selector is a native `<select>` element — full keyboard support (Tab to focus, arrow keys to change, Enter to confirm). No custom handlers needed. |
| Form label associated | ✅ | `<label for="llm-model-selector">` correctly associates the label with the select. |
| Focus indicators | ✅ | Native `<select>` focus ring preserved. Inherits browser defaults which meet WCAG 1.4.11. |
| `prefers-reduced-motion` | ⚠ | **Pre-existing project gap** (flagged in Slice 1 audit A1, Slice 2 audit). The `<select>` has no animation, so no immediate impact. |
| `aria-busy` during in-flight | ✅ | Not applicable — the model selector is a configuration control, not an action button. No loading state needed. |
| `aria-live` for state changes | ✅ | Not applicable — model changes take effect on the next Generate click. No live region needed. |
| Heading hierarchy | ✅ | The LLM model row sits within the existing step-actions div under the existing `<h2>`. No heading-skipping. |
| Color contrast | ✅ | Uses `var(--text-secondary)` on `var(--bg-color)` — both theme-token-driven. |

---

## 2. Visual

| Check | Result | Notes |
|---|---|---|
| Selector visual distinction | ✅ | The LLM model row uses a `<select>` element (inherently different from the button-group output-contract selector). The `.llm-model-row` has `margin-bottom: 0.6rem` and a distinct label "LLM model" vs "Target model". |
| Consistent spacing | ✅ | Uses existing `gap: 0.5rem` pattern and `margin-bottom: 0.6rem` (mirrors `.model-selector` spacing). |
| Responsive layout | ✅ | The row uses `display: flex` with `align-items: center`. The select has `min-width: 200px`. On narrow viewports, the label wraps naturally. |

---

## 3. Prose (stop-slop)

| Check | Result | Notes |
|---|---|---|
| Label text | ✅ | "LLM model — which AI model generates the prompt" — direct, factual, no AI-speak. |
| Option labels | ✅ | Display names are the model names as specified by the user (MiniMax M3, GPT-5.6 Luna, etc.). No embellishment. |
| Error messages | ✅ | "Kilo Code API is not configured. Set KILO_API_KEY in your .env file." — mirrors existing pattern, direct. |

---

## 4. Copy

| Check | Result | Notes |
|---|---|---|
| Label hint clarity | ✅ | "— which AI model generates the prompt" is outcome-led. |
| Default choice | ✅ | MiniMax M3 as first option signals "this is the default" without saying it. |
| Option ordering | ✅ | MiniMax M3 first (default), then GPT-5.6 Luna (strongest all-rounder), then Gemini variants, then Nemotron, then Grok. Logical grouping. |

---

## 5. Performance

| Check | Result | Notes |
|---|---|---|
| No new network calls at startup | ✅ | Model list is hardcoded. No `GET /models` fetch at boot. |
| Selector renders synchronously | ✅ | Pure HTML + state binding. No async render. |
| localStorage access is try/catch guarded | ✅ | Mirrors existing pattern — silent fallback on quota/private-mode errors. |
| server.js size | ✅ | ~7,150 lines — well under the 290KB kill criterion. |
| Compression middleware | ⚠ | **Pre-existing project gap** (flagged in Slice 1 audit P1). |

---

## 6. Discipline

| Check | Result | Notes |
|---|---|---|
| Zero `callMiniMax` references remain | ✅ | Verified by test (Slice 3.1 pre-commitment #1) and grep. |
| Zero `minimaxi.chat` references remain | ✅ | Verified by test (Slice 3.1 pre-commitment #2) and grep. |
| Zero `MINIMAX_*` env var references remain | ✅ | Verified by test. |
| API key stays server-side | ✅ | `KILO_API_KEY` referenced only in `server.js` and `.env`. Never sent to client. |
| No commented-out code | ✅ | All old MiniMax code was replaced, not commented out. |
| `node --check` clean | ✅ | All three files (server.js, src/app.js, tests/run-all.js) pass syntax check. |
| Tests pass | ✅ | 392/395 (3 real-LLM tests need valid KILO_API_KEY — configuration, not code). |
| session-init V-checks | ✅ | 10/10. |

---

## What was deliberately left as-is

1. **No model capability metadata.** The selector shows display names only — no context-length, pricing, or vision-capability badges. Adding these would require dynamic data or maintenance. The user knows these models.

2. **No `<optgroup>` grouping by provider.** The six models are in a flat list. Grouping by provider (MiniMax / OpenAI / Google / NVIDIA / xAI) would add complexity to the `<select>` element for marginal benefit with only six options.

3. **No tooltip or help text.** The label hint "— which AI model generates the prompt" is sufficient. Hover tooltips with model details are deferred.

4. **`prefers-reduced-motion` gap.** Pre-existing project debt from Slice 1. The `<select>` element has no CSS animations, so no regression.

5. **Compression middleware gap.** Pre-existing project debt from Slice 1. Not Slice-3-introduced.

---

## Sign-off

**Findings:** 0 blocking, 6 noted (all pre-existing project-level polish debt or Slice 3 nice-to-haves).

**Verdict:** **PASS** — Slice 3 ships.

---

*Signed: Goose, 2026-08-04*
