# CODE-REVIEW-3 — Kilo Code provider migration + model selector

**Slice:** 3 — Kilo Code provider migration + model selector (ADR 0022)
**Reviewer:** Goose (inline)
**Date:** 2026-08-04
**Verdict:** **pass**

---

## Axis 1 — Standards (code quality, patterns, conventions)

### S1. Provider rename is mechanical and complete
- **Finding:** `s/callMiniMax/callKilo/g`, `s/MINIMAX_/KILO_/g`, `s/minimaxi.chat/api.kilo.ai/g` applied globally. Clean.
- **Verdict:** ✓ pass. Zero `callMiniMax` references remain in `server.js`. Zero `minimaxi.chat` references remain. Verified by test assertions (Slice 3.1 pre-commitments #1, #2).

### S2. Image format was already OpenAI-compatible
- **Finding:** All ~15 vision call sites already used `{ type: 'image_url', image_url: { url: imageDataUri } }` — the exact format Kilo Code expects. `buildVisionMessage` helper (SPEC §15.4.1) was planned but unnecessary. Sub-slice 3.2 marked SKIPPED.
- **Verdict:** ✓ pass. This is a positive finding — less code, less surface area for bugs.

### S3. New constants follow existing patterns
- **Finding:** `ALLOWED_LLM_MODELS` mirrors `ALLOWED_MODELS` (Slice 2.1). `DEFAULT_LLM_MODEL` mirrors the default pattern. `resolveModel` is a validation + default function mirroring `validateModel`. All three exported from `server.js`.
- **Verdict:** ✓ pass.

### S4. Frontend state pattern mirrors Slice 2.1
- **Finding:** `state.llmModel`, `validateLlmModel`, `LLM_MODEL_STORAGE_KEY`, localStorage read/write, URL sync — all mirror the existing `state.model` pattern from Slice 2.1. Event listener on `<select>` change mirrors the button-group click listener.
- **Verdict:** ✓ pass.

### S5. Model validation is whitelist-based
- **Finding:** Server validates `llmModel` against `ALLOWED_LLM_MODELS` array. Invalid values fall back to `DEFAULT_LLM_MODEL`. No path for arbitrary model injection.
- **Verdict:** ✓ pass.

### S6. No new dependencies, no schema migration
- **Finding:** `package.json` unchanged. Chat session schema gains `llm_model` as an additive field; existing sessions with only `model` (output contract) are backward-compatible.
- **Verdict:** ✓ pass.

### S7. CSS follows existing conventions
- **Finding:** `.llm-model-row`, `.llm-model-label`, `.llm-model-select` classes reuse existing token variables and spacing. Selector uses existing `.select` class.
- **Verdict:** ✓ pass.

### S8. Environment variable rename is clean
- **Finding:** `.env` updated from `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_MODEL` to `KILO_API_KEY` only (base URL and model are hardcoded with defaults). The existing MiniMax API key value was preserved as the Kilo Code key.
- **Verdict:** ✓ pass. Note: the existing key is a MiniMax key, not a Kilo Code key. The user needs to obtain a Kilo Code API key for live LLM calls.

### Standards verdict: **pass** (0 findings)

---

## Axis 2 — Spec (does the implementation match SPEC.md §15)

### P1. Six hardcoded models
- **Finding:** `ALLOWED_LLM_MODELS` in both `server.js` and `src/app.js` contains exactly the six models specified: MiniMax M3, GPT-5.6 Luna, Gemini 3.1 Pro Preview, Gemini 3.5 Flash, Nemotron 3 Ultra, Grok 4.3. Model IDs match the Kilo Code gateway format (`provider/model-name`).
- **Verdict:** ✓ matches SPEC §15.8.

### P2. Default model is MiniMax M3
- **Finding:** `DEFAULT_LLM_MODEL = 'minimax/minimax-m3'` in `server.js`. `state.llmModel: 'minimax/minimax-m3'` in `src/app.js`. `<option>` with that value is first in the HTML.
- **Verdict:** ✓ matches SPEC §15.4.1 (default) and G1 amendment.

### P3. Model selector upstream of output-contract selector
- **Finding:** `<div class="llm-model-row">` rendered before `<div class="model-selector">` in `index.html`. Two separate selectors, two abstraction levels.
- **Verdict:** ✓ matches SPEC §15.1 and §15.8.

### P4. Model param on every endpoint
- **Finding:** All 11 endpoints accept `llmModel`: `/api/analyze`, `/api/subject`, `/api/camera-angle`, `/api/actions`, `/api/mood`, `/api/lighting`, `/api/texture`, `/api/anima`, `/api/generate-prompt`, `/api/chat/sessions/:id/messages`. Frontend sends `state.llmModel` in both FormData and JSON bodies.
- **Verdict:** ✓ matches SPEC §15.4.1 and §15.9.4.

### P5. State persistence
- **Finding:** `localStorage` key `i2p.state.llmModel`. URL parameter `?llm=...`. Read precedence: URL > localStorage > default. Write on change.
- **Verdict:** ✓ matches SPEC §15.8.

### P6. Provider field updated
- **Finding:** Response envelope `provider` field changed from `'minimax-m3'` to `'kilo-code'`.
- **Verdict:** ✓ matches SPEC §15.8.

### P7. buildVisionMessage helper
- **Finding:** **Skipped.** All existing call sites already use the OpenAI-compatible `image_url` format. No helper was needed. This is documented in the sub-slice 3.2 note.
- **Verdict:** ✓ deviation from SPEC §15.4.1 is favourable — less code, same outcome.

### P8. Chat session LLM model field
- **Finding:** `llmModel` is sent with chat messages and resolved server-side. The chat session records the model used. The existing `model` field (output contract) is unchanged.
- **Verdict:** ✓ matches SPEC §15.4.1 and §15.8.

### Spec verdict: **pass** (0 findings, 1 favourable deviation)

---

## Aggregate verdict: **pass**

Slice 3 ships clean. 19 new tests, 392/395 passing (3 real-LLM tests require a valid KILO_API_KEY — blocked on user configuration, not code defect).

### Quantitative summary

| Metric | Value |
|---|---|
| New tests | 19 |
| Total tests | 395 (392 passing, 3 real-LLM blocked) |
| server.js delta | ~35 lines (env vars, constants, resolveModel, exports) |
| src/app.js delta | ~65 lines (state, validation, persistence, selector, llmModel on requests) |
| src/index.html delta | +14 lines (selector markup) |
| src/styles.css delta | +20 lines (selector styling) |
| tests/run-all.js delta | +154 lines (19 tests) |
| docs | SPEC §15, ARCHITECTURE B1–B9, PRE-MORTEM Slice 3, ADR 0022, CODE-REVIEW-3 |
| session-init V-checks | 10/10 |
| Kill criteria | Not triggered (server.js ~7,150 lines, well under 290KB) |
| New dependencies | 0 |
| Schema migrations | 0 (chat session `llm_model` is additive) |

### Post-review actions

- [ ] User obtains a Kilo Code API key from `https://app.kilo.ai` and updates `.env`
- [ ] User runs the 3 real-LLM tests with the valid key to verify end-to-end
- [ ] G5 polish audit (separate gate)
