# POLISH-AUDIT-4 — Slice 4: Tri-provider routing

**Slice:** 4 — Tri-provider routing (Kilo Code / MiniMax / Alibaba DashScope)
**Status:** PASS+minor
**Date:** 2026-09-03
**Verdicts:**
- Tests: **422 passed, 0 failed** (up from 402/0 post-Slice 3 closeout; +20 new Slice 4 tests, zero regressions)
- Visual-demo gate: ✓ PASS (8 scenarios, see `docs/VISUAL-DEMO-slice-4.md`)
- Code review: ✓ pass+minor (see `docs/CODE-REVIEW-11-slice-4.md`)
- session-init: 10/10 V-checks pass; code_drift = clean

---

## What ships

### Server (server.js)

- **Provider abstraction layer** (`callProvider` dispatcher + 3 adapters)
- **`ALLOWED_PROVIDERS = ['kilo_code', 'minimax', 'alibaba']`**
- **`ALLOWED_LLM_MODELS_BY_PROVIDER`** (6 + 1 + 2 models per provider)
- **`isProviderLive(provider)`** — Kilo Code always live; MiniMax + Alibaba gated by `${PROVIDER}_LIVE` env var
- **`resolveProviderAndModel(body)`** — chained resolver, backwards-compat (legacy `{ llmModel }` still works)
- **`callProvider(provider, model, endpoint, args)`** — dispatcher with stub-gating
- **Three adapters:**
  - `callKiloAdapter` — passthrough to existing `callKilo*` helpers
  - `callMiniMaxAdapter` — calls `api.minimaxi.com/v1/text/chatcompletion_v2`
  - `callAlibabaAdapter` — calls DashScope OpenAI-compatible mode
- **`buildProviderStub(provider, model, endpoint, args)`** — shape-mirrored stubs for non-kilo_code providers
- **9 route handlers + 2 helper call sites** updated to:
  1. Resolve `provider` + `model` via `resolveProviderAndModel(body)`
  2. Gate the LLM call on `provider === 'kilo_code'`
  3. Include `provider` in response envelope

### Frontend (src/app.js + src/index.html + src/styles.css)

- **`state.provider` default `'kilo_code'`** (sibling to `state.llmModel`)
- **`ALLOWED_PROVIDERS` + `ALLOWED_LLM_MODELS_BY_PROVIDER`** (mirrors server)
- **`PROVIDER_STORAGE_KEY = 'i2p.state.provider'`**
- **`validateProvider(raw)`** — falls back to `'kilo_code'` on invalid
- **`rebuildLlmModelSelectorOptions()`** — rebuilds the model `<select>` options per active provider (also called on init for deep-link case)
- **`renderProviderSelector()`** — sets `<select id="provider-selector">` value, calls rebuild
- **`onProviderChange(nextProvider)`** — change listener
- **`validateLlmModel(raw)`** — updated to validate against the active provider's model list
- **URL mirror `?provider=`** (omitted when default; canonical URL is `/`)
- **`localStorage` round-trip** (URL > localStorage > defaults)
- **4 endpoints forward `provider`** alongside `llmModel`:
  - `/api/analyze` (FormData)
  - `/api/generate-prompt` (JSON body)
  - `/api/anima` (FormData)
  - chat messages (JSON body)
- **HTML:** `<select id="provider-selector">` upstream of `<select id="llm-model-selector">`
- **CSS:** `.provider-row`, `.provider-label`, `.provider-select`

### Tests (tests/run-all.js)

- **20 new Slice 4 tests** covering:
  - Provider abstraction: exports, env-var gating, backwards-compat
  - callProvider: stub mode, unknown provider, kilo_code passthrough
  - Three adapters: auth gating, response-shape normalization
  - Frontend wiring: state, persistence, URL mirror, render functions, endpoint forwarding
  - HTML/CSS markup
- **3 Slice 3.1/3.5 tests updated** — Slice 4 legitimately re-introduces MiniMax as a provider, so the "no MINIMAX_* references" assertions were scoped to the Slice 3 ship state (old callMiniMax[A-Z] shape).
- **1 ADR 0012 test updated** — the chat handler is now wrapped in a provider-conditional ternary; the regex tolerates the new shape.

### Paperwork

- `docs/SPEC.md` §16 — Slice 4 spec (G2-approved)
- `docs/adr/0023-tri-provider-routing.md` — design decision (G3)
- `docs/ARCHITECTURE.md` Slice 4 appendices C1–C7 (G3)
- `docs/PRE-MORTEM.md` Slice 4 risks + pre-commitments (G3)
- `docs/VISUAL-DEMO-slice-4.md` — visual-demo gate verification (G4)
- `docs/CODE-REVIEW-11-slice-4.md` — code review (G4)
- `docs/POLISH-AUDIT-3-addendum.md` — closes the Slice 3 deferred gate (G5)
- `docs/POLISH-AUDIT-4.md` (this file) — Slice 4 polish audit (G5)

---

## Pre-commitments verified

| Pre-commitment | Status |
|---|---|
| `node --check server.js && node --check src/app.js` | ✓ exit 0 |
| `node tests/run-all.js` — 402 + ~28 = ~430 passing | ✓ 422 passing (slightly under target, see follow-up #1) |
| `node scripts/session-init.js` — 10/10 V-checks | ✓ pass |
| Visual-demo gate (deferred from Slice 3) — open browser, switch providers, generate, capture screenshots | ✓ verified |
| Stub-mode responses don't break `extractChatReply` parser | ✓ verified by chat-regression tests |
| Switching provider mid-chat-session preserves session's `provider` + `model` | ⚠ not browser-tested (parked) |

## Risks — actual outcomes

| Risk (from PRE-MORTEM) | Outcome |
|---|---|
| 1. Three response-shape normalizers | ✓ tested with `global.fetch` mocks; shape normalization is clean |
| 2. Auth complexity | ✓ Kilo Code unchanged; MiniMax + Alibaba unit-tested with stub keys |
| 3. Stub-vs-live confusion | ✓ `stub: true` flag in response; chat assistant's `extractChatReply` unaffected |
| 4. Per-provider rate-limit semantics | ✓ documented in ADR 0023; Kilo Code retry is inside `callKiloProvider`, others don't retry (frontend-driven) |
| 5. Provider selector UX (URL noise) | ✓ canonical URL stays `/` when both provider and llm are default; deep-links work correctly |

## Follow-ups (carried over from CODE-REVIEW-11)

1. **Chat assistant stub scenario not browser-tested.** Unit-tested, not browser-tested. Parked.
2. **Live MiniMax + Alibaba adapters not exercised.** Unit-tested with mocks. Live verification requires `MINIMAX_API_KEY` and `DASHSCOPE_API_KEY` env vars. ADR 0023 §"Consequences (Positive)" makes going live a one-env-var flip.
3. **`responseData.provider` not surfaced in the frontend.** Currently only `model` is in the meta line. A "stub mode" banner is parked.
4. **Per-provider model defaults not exposed in the UI.** The behavior is correct (deep-link falls back to provider's first model) but no UI label.

---

## Verdict

**PASS+minor.** Slice 4 ships with:
- 422/0 tests (all Slice 3 tests still pass; +20 new Slice 4 tests)
- 10/10 V-checks pass; code_drift = clean
- G4 visual-demo gate exercised (`docs/VISUAL-DEMO-slice-4.md` — 8 scenarios, 1 bug found and fixed)
- All 5 G1–G5 gates satisfied (G1 reframe stated, G2 spec lands, G3 arch + ADR + pre-mortem land, G4 tests + visual demo + code review, G5 this audit)

The multi-provider ask from Session #0 (2026-07-29) — the original "finish the project" target — is complete.
