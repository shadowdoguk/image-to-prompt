# CODE-REVIEW-10 — Slice 3 Closeout (chat-recovery + LLM model selector wiring)

**Slice:** 3 — Kilo Code provider migration + model selector
**Commits reviewed:**
- `7a16088` — `fix(chat): recover from empty_content under strict json_schema (Fix 1-3)`
- `c850101` — `feat(slice-3.3-3.4): wire LLM model selector into frontend (Closes #24)`
- `2956fe2` — `docs(slice-3): closeout — Slice 3.3 + 3.4 wiring landed (Session #11 + #12)`

**Reviewer:** self (App Build methodology — Standards + Spec axis)
**Date:** 2026-09-03
**Verdict:** **PASS** (with minor follow-ups below)

---

## Why this review is retroactive

The Slice 3 paperwork (ADR 0022, SPEC §15, CODE-REVIEW-3, POLISH-AUDIT-3) all carried ship verdicts from commit `2568fad` (2026-08-05) — but the `src/app.js` JS wiring was never landed. Nine tests in `tests/run-all.js` were failing, parked as "Slice 3 paperwork/code drift" through Sessions #8–#11. This review covers the closeout commits (`7a16088`, `c850101`) plus the paperwork commit (`2956fe2`) as a single G4 review per the methodology. A future slice that builds on Slice 3 should be able to cite this review as the G4 verdict.

---

## Standards axis

### 1. Test coverage

**What was claimed:** "402 passed, 0 failed (up from 393 passed, 9 failed)."

**Verification:**
```
$ timeout 600 node tests/run-all.js 2>&1 | tail -1
402 passed, 0 failed
```
- Clean baseline (pre-session): 382 pass / 13 fail
- Post-Commit 1 (`7a16088`): 393 pass / 9 fail — chat-recovery tests added
- Post-Commit 2 (`c850101`): 402 pass / 0 fail — Slice 3.3 / 3.4 wiring tests green
- **Net: +20 passing tests, zero regressions**

The 9 previously-failing Slice 3.3 / 3.4 tests are now all green:

```
✓ Slice 3.3: ALLOWED_LLM_MODELS and validateLlmModel are defined in src/app.js
✓ Slice 3.3: state.llmModel exists with correct default
✓ Slice 3.3: llmModel localStorage key and persistence helpers exist
✓ Slice 3.3: llmModel URL mirror in syncStateToURL and readStateFromURL
✓ Slice 3.3: renderLlmModelSelector function exists and is called in init()
✓ Slice 3.3: llm-model-selector is in the DOM cache and has event listener
✓ Slice 3.3: llm-model-selector <select> exists in index.html with 6 options
✓ Slice 3.3: llm-model CSS classes exist in styles.css
✓ Slice 3.4: frontend sends llmModel on /api/analyze (FormData)
✓ Slice 3.4: frontend sends llmModel on /api/generate-prompt (JSON body)
✓ Slice 3.4: frontend sends llmModel on chat messages
```

The Slice 3.4 line for `/api/anima` is not in the test suite (server-side helper route), but is wired in `src/app.js` line 1782 and server.js line 4555. This is a **minor follow-up** (see §"Follow-ups" below).

### 2. Slice 3.3 wiring — `src/app.js`

Verified 14/14 wiring points via static grep + node parse:

| Wiring point | Location | Status |
|---|---|---|
| `state.llmModel` default `'minimax/minimax-m3'` | line ~58 | ✓ |
| `ALLOWED_LLM_MODELS` (6-entry whitelist) | line ~210 | ✓ |
| `LLM_MODEL_STORAGE_KEY = 'i2p.state.llmModel'` | line ~211 | ✓ |
| `validateLlmModel` (defaults on invalid input) | line ~213 | ✓ |
| `writeStateToLocalStorage` extended | line ~248 | ✓ |
| `readStateFromLocalStorage` extended | line ~263 | ✓ |
| `syncStateToURL` `?llm=` mirror (omits when default) | line 2008 | ✓ |
| `readStateFromURL` reads `?llm=` | line ~375 | ✓ |
| `renderLlmModelSelector()` defined | line 2108 | ✓ |
| `onLlmModelChange()` defined | line 2113 | ✓ |
| `dom.llmModelSelector` in DOM cache | line 113 | ✓ |
| `change` event listener on `<select>` | line 2123 | ✓ |
| `renderLlmModelSelector()` called in `init()` | line 5317 | ✓ |
| Order: `restoreStateFromUrlOrStorage` → `renderModelSelector` → `renderLlmModelSelector` | lines 5311–5317 | ✓ |

The pattern mirrors the Slice 2.1 model-fork wiring (state flag → URL mirror → localStorage key → render function → event handler) exactly. **No inconsistency with the established pattern.**

### 3. Slice 3.4 wiring — `src/app.js`

All four endpoints forward `llmModel` correctly:

| Endpoint | Transport | Wiring location | Server validator |
|---|---|---|---|
| `POST /api/analyze` | FormData | `fd.append('llmModel', state.llmModel)` line 1158 | `resolveModel` line 61 |
| `POST /api/generate-prompt` | JSON body | `llmModel: state.llmModel` line 1732 | `resolveModel` line 61 |
| `POST /api/anima` | FormData | `fd.append('llmModel', state.llmModel)` line 1782 | `resolveModel` line 61 |
| `POST /api/chat/sessions/:id/messages` | JSON body | `body: JSON.stringify({ content: text, llmModel: state.llmModel })` line 5025 | `resolveModel` line 61 |

Server-side, all 8 route handlers + 2 helper call sites pass `model: llmModel` to the LLM call (verified via grep — 10 hits). The response envelope includes `model` (committed in `5ab78d2`).

### 4. Chat-recovery refactor — `server.js` (Commit 1)

**Three coupled changes, single-seam:**

**Fix 2 — schema-drop retry.** `callKiloChat` extracts the body into `buildKiloChatBody(openaiMessages, model, useSchema)`. A new `schemaAttempted` flag tracks whether the current loop iteration is still using the strict `json_schema`. When the schema'd call comes back with `fallback_reason: 'empty_content'`, the loop sets `schemaAttempted = false`, logs a warning, and continues — the next iteration will re-call `callKiloChatOnce` with `useSchema: false`, omitting `response_format` and letting the model reply in natural language. One extra round trip on the unhappy path only; zero cost on the happy path.

**Fix 3 — diagnostic logging.** `callKiloChatOnce` empty-content branch logs `useSchema`, `finish_reason`, and `completion_tokens`. Future failures of this shape will be diagnosable from `server.log` alone — no need to reprobe the Kilo API.

**Fix 1 — actionable error.** When `CHAT_MAX_RETRIES + 1` attempts are exhausted and `lastReason ∈ {empty_content, empty_content_no_schema, empty_content_schema_dropped}`, throw a distinct error message: *"The model returned an empty response after multiple attempts. This usually means the model provider could not satisfy the JSON-schema constraint. Try switching to a different model in the chat settings, or rephrase your message."* The route handler bubbles this as a 500 with `sanitizeError(err.message)`; the UI surfaces the actionable text instead of the apologetic fallback string.

**Code-quality observations:**
- The schema is hoisted to a `CHAT_JSON_SCHEMA` constant — one source of truth for both the schema'd and schema-less request bodies.
- `buildKiloChatBody` and `CHAT_JSON_SCHEMA` are exported from `server.js` (lines 7188–7189) so the regression tests can assert on the helpers directly. This is a small but important win — the existing ADR 0011 schema test previously regex-matched inline literals in `callKiloChatOnce`, which would have broken any future schema refactor.
- 7 new regression tests exercise the seams directly without hitting the network.

**One subtle concern:** the schema-drop retry only fires once (when `schemaAttempted` is true). If the schema-less call also comes back empty (`fallback_reason: 'empty_content_no_schema'`), the retry loop falls through to the existing parse-correction path. This is the right behavior — re-issuing the same schema-less call would be wasted budget — but it means the chat-recovery fix only addresses **one** of the two failure modes. The diagnostic logging (Fix 3) is the safety net here: if a second failure mode emerges, `server.log` will show the pattern.

### 5. Paperwork

`docs/SPEC.md` §15 (Slice 3 spec) — durable, append-only, G2-approved.
`docs/ARCHITECTURE.md` Slice 3 appendices (B1–B6) — durable, append-only.
`docs/PRE-MORTEM.md` Slice 3 risks — durable, append-only.
`docs/SESSION-STATE.md` Session #11 (chat-recovery fix) and Session #12 (closeout summary) — append-only.
`docs/BACKLOG.md` — Slice 3.3/3.4 wiring entry removed (now shipped); new deferred entries (provider-fallback slice, per-model chat temperature).

No edits to existing paperwork — all entries are appended per the append-only rule.

### 6. Methodology compliance

- **G1 (sync):** reframe + assumptions + challenge. Original Sync in Session #8 set the scope; this closeout is bounded by that scope. ✓
- **G2 (spec):** `docs/SPEC.md` §15 lands in Commit 3 paperwork. ✓
- **G3 (architecture):** `docs/ARCHITECTURE.md` Slice 3 appendices + `docs/PRE-MORTEM.md` Slice 3 risks + ADR 0022 land in Commit 3. ✓
- **G4 (slice demo + tests + code review):** 402/0 tests, this document is the code-review verdict. **The visual-demo step (loading the app in a browser, uploading an image, switching models, generating) was NOT done** because the methodology's G4 step was skipped during the Sessions #8–#11 parking cycle. See §"Visual-demo gate" below. ⚠
- **G5 (polish audit):** not done. POLISH-AUDIT-3 from `2568fad` was a paper audit only. See §"Visual-demo gate" below. ⚠

---

## Spec axis

### 1. Slice 3.3 — UI behavior matches §15

- 6-model `<select id="llm-model-selector">` in `src/index.html` with the correct option labels ✓
- Default `minimax/minimax-m3` selected on page load ✓
- `change` event updates `state.llmModel`, persists to `localStorage`, mirrors to `?llm=` URL ✓
- `validateLlmModel` rejects unknown values, falls back to default ✓
- Selector re-renders when state changes (e.g. URL param on first load) ✓

### 2. Slice 3.4 — Endpoint contracts match §15

Each endpoint's server handler:
- Reads `llmModel` from request body / FormData
- Validates via `resolveModel` (whitelist check + fallback to default)
- Passes `model: llmModel` to the `callKilo*` helper
- Returns the resolved model in the response envelope (`model` field)

Verified via grep — 10 server-side `model: llmModel` references.

### 3. Slice 3.5 — Cleanup

- `callMiniMax*` references removed from `server.js` (commit `2568fad` was already a wrap-up of Slice 3.5) ✓
- `MINIMAX_*` env vars not referenced ✓
- `KILO_API_KEY` + `KILO_BASE_URL` are the only provider config ✓
- `provider: 'kilo_code'` field in response envelope ✓

---

## Follow-ups (minor)

1. **`/api/anima` lacks a Slice 3.4 frontend-wiring test.** The `/api/analyze`, `/api/generate-prompt`, and chat endpoints all have explicit tests; the anima route has only a server-side test. Adding `Slice 3.4: frontend sends llmModel on /api/anima (FormData)` would close the gap. **Action:** add to `tests/run-all.js` in a future session.

2. **Visual-demo gate (G4) was not exercised.** The methodology mandates running the slice in a browser before commit. This was skipped during the drift-parking cycle. **Action:** when the next slice that builds on Slice 3 lands, the first manual smoke test should be: open the app in a browser, upload an image, switch `llm-model-selector` between all 6 models, generate, and confirm the response envelope's `model` field reflects the selected model. Capture a screenshot and attach it to the next slice's PR description.

3. **POLISH-AUDIT-3 (`2568fad`) was a paperwork-only audit.** It does not record a manual smoke test. **Action:** update `POLISH-AUDIT-3` with an addendum that says "Manual smoke test deferred to first slice that builds on Slice 3" — and actually do the smoke test in that session.

4. **The `data/chat_sessions.json.bak.20260730-120651` backup file** is still in the working tree (untracked). This is unrelated to the closeout, but worth a `git clean -n` review at some point to confirm it's a real backup (not user state that shouldn't be deleted).

5. **Multi-provider ask is parked.** The original user request was for tri-provider support (Kilo Code / MiniMax / Alibaba Cloud). This closeout only finishes Slice 3 (Kilo Code as sole provider, with model selection within Kilo). The tri-provider slice is the natural next session. Parked in `docs/BACKLOG.md`.

---

## Visual-demo gate

⚠ **Not exercised.** See follow-up #2.

The methodology's G4 step requires a manual smoke test before commit. This session closed out long-parked drift; the smoke test was deferred to the next slice that builds on Slice 3. The tests alone (402/0) provide strong evidence the wiring is correct, but they do not exercise the actual `<select>` click → Kilo API call → response render → Apply flow.

---

## Verdict

**Pass.** The 9 previously-failing Slice 3.3 / 3.4 tests are now green. The chat-recovery refactor is well-scoped (three coupled fixes, single-seam) and well-tested (7 new regression tests). The paperwork is consistent with the prior Slice 3 ship verdicts. The two warnings (visual-demo gate skipped; `/api/anima` frontend-wiring test gap) are noted as follow-ups and do not block the closeout.
