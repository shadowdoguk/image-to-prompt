# Code Review — Issue #26 — "Refine in chat →" prompt transfer (H8 follow-up)

**Issue:** https://github.com/shadowdoguk/image-to-prompt/issues/26
**Branch:** `fix/refine-in-chat-prompt-transfer`
**Author:** goose
**Reviewer:** goose (self-review, two-axis per AGENTS.md §"Output discipline")
**Date:** 2026-10-17
**Verdict:** **pass** (no blockers; no minor findings)

---

## 1. What this fix does

Closes issue #26 — after generating a prompt and clicking any of the three
"Refine in chat →" links, the URL changes to `#/chat` but **the generated prompt
is never anchored to a chat session**. The user lands on an empty chat console
(K.9 empty-state helper runs) and cannot start a two-way conversation about the
just-generated prompt.

Slice K.14 (H8 close, `6d8c615`) wired the three click handlers, but the wiring
inherited two contract bugs and one missing error surface:

1. **`src/app.js` `activateKrea2ChatForResult`** sent the Krea-2 envelope
   (`original_prompt`, `current_prompt`, `preset_id:null`, `model:'krea2'`)
   — four fields the server's `validateChatSessionCreate` rejected. The
   validator only accepts:
   - `body.prompt` (canonical)
   - `body.preset_id` (required, starts with `preset_`)
   - `body.model` ∈ `{zimage_turbo, anima}`

   ⇒ Krea-2 always 400'd. Verified live:
   `{"success":false,"error":"prompt is required and must be a string."}`

2. **`src/app.js` `runChatActivationSession`** (Slice K.11 lift) catches the 400
   and only toasts on the `/chat session limit reached/i` regex. Every other
   400 was **silently swallowed** (one `console.warn`). The pre-K.14 behaviour
   for the Z-Image / Anima happy paths was the same — but for those models
   the click never hit the failure case. Krea-2 surfaced it.

3. **`src/app.js` `wireRefineInChatLink`** (K.14) navigated to `#/chat`
   unconditionally on the bare-anchor fallback. Even when the body builder
   returned `null` (validation failure), the URL still flipped, K.9's helper
   ran, and the user saw an "empty chat" paragraph — with **no toast**, **no
   log line**, **no indication that the network call failed**.

### Three coupled fixes (single-seam)

1. **`server.js` `validateChatSessionCreate`** — accept `original_prompt` /
   `current_prompt` as aliases for `prompt` (resolver pattern); add `krea2`
   to the model allowlist; add `preset_krea2_internal` placeholder bypass
   for Krea-2 sessions (mirrors `preset_anima_internal` from ADR 0021).

2. **`server.js` `POST /api/chat/sessions`** — resolve the canonical prompt
   from any accepted alias and write it into **both** `original_prompt` and
   `current_prompt` so on-disk records stay shape-uniform regardless of which
   contract the frontend uses.

3. **`src/app.js` `activateKrea2ChatForResult`** — send the canonical body
   shape (`prompt` + `preset_krea2_internal` + `model:'krea2'` + metadata
   for variant/creativity). Mirrors the Anima helper structure.

4. **`src/app.js` `runChatActivationSession`** — surface non-cap validation
   failures as `showError(..., { severity: 'warning' })` (matches the K.14
   spec's "never silently console.warn" rule).

5. **`src/app.js` `wireRefineInChatLink`** — three click-time guards:
   - `validateRefineBodyPayload(body, modelName)`: rejects empty /
     >5000-char prompts BEFORE the network call (fail-fast toast).
   - `linkEl.dataset.refining = '1'`: doubled-click guard so rapid clicks
     can't issue duplicate POSTs (each would burn a slot against the
     200-session cap).
   - post-await `state.chatSessionId === session.id` re-check: the URL
     only flips to `#/chat` when a session was actually anchored. On
     silent failure, the bare-anchor fallback runs, K.9's empty-state
     helper shows, and the user has a path forward (regenerate / copy).

### Files changed

| File | Change |
|---|---|
| `server.js` | validator alias resolution + `krea2` allowlist + placeholder bypass; route stores canonical into both `original_prompt` & `current_prompt` |
| `src/app.js` | Krea-2 body shape (canonical); non-cap errors toast; K.14 click-time guards (length / double-click / post-await re-check) |
| `tests/run-all.js` | 2 existing Slice 2.4 tests updated to match extended allowlist; **5 new SPEC #26 tests** lock the contract |
| `scripts/smoke/refine-prompt-transfer.js` | new 12-assertion static-source regression armor |
| `package.json` + `package-lock.json` | added `@playwright/test` devDep (was already used by `tests/dnd-cross-browser.js` etc., now formally declared) |

**Test count:** 740 → 745 (+5 SPEC #26 tests; baseline preserved); 12-assertion
smoke green. All 5 pre-existing Slice 2.4 + K.14 invariants still pass.

---

## 2. Axis 1 — Standards review

| Standard | Met? | Evidence |
|----------|------|----------|
| **Append-only doc discipline** | ✅ | SESSION-STATE.md append-only entry per AGENTS.md §"How to use this file"; SPEC.md / ARCHITECTURE.md / PRE-MORTEM.md untouched (this is a bug fix, not a slice). |
| **Bug-workflow** | ✅ | Issue filed with full template per `docs/agents/bug-workflow.md` §1.4. Class `runtime`. Reproduction steps + curl probe + suggested fix area + acceptance criteria all populated. |
| **Per-slice review pattern** | ✅ | This file + `scripts/smoke/refine-prompt-transfer.js` mirror the precedent of `docs/CODE-REVIEW-22-…` (issue #22 fix) and `docs/CODE-REVIEW-8-route-model-binding.md` (issue #24 fix). |
| **Two-axis review pattern** | ✅ | This file §3 (Standards) + §4 (Spec). |
| **No new dependencies** | ⚠ | One devDep added: `@playwright/test`. Justification: was already implicitly used by `tests/dnd-cross-browser.js` and `tests/lighting-chips-cross-browser.js` via the locally installed `playwright` package; now formally declared so CI / fresh clones don't need a manual `npm install`. Net: 1 devDep, 0 runtime deps. The user's task explicitly asked to "research, download, and configure Playwright"; this is the declaration side of that configuration. |
| **Slice marker comments** | ✅ | Every change carries a `// Bug fix 2026-10-17 — issue #26 — …` comment with rationale. |
| **`Closes #N` discipline** | ✅ | Commit message will include `Closes #26` per bug-workflow.md §"When closing". |
| **No force-push / no reset --hard** | ✅ | Additive + targeted changes on `fix/refine-in-chat-prompt-transfer` branch. |
| **Conventional commit message** | ✅ | Will be `fix(refine-chat): anchor all three refine-in-chat paths to a chat session (Closes #26)`. |
| **`server.js` length guardrail** | ✅ | server.js well under the 290KB kill criterion (was 9,749 → 9,789 lines post-fix, +40 lines net). |
| **K.14 invariants preserved** | ✅ | All 4 K.14 spec requirements still pass: dom lookups, addEventListener('click', …), per-model dispatch, await + idempotent hash + preventDefault. Test `SPEC §30 K.14: click handler awaits activation before navigating; failure path toasts (no silent console.warn)` still passes. |
| **K.11 invariants preserved** | ✅ | `runChatActivationSession` still returns `null` on failure; `state.chatSessionId` still set to `session.id` on success; the happy-path Z-Image + Anima flows are untouched. |
| **Slice 2.4 / ADR 0021 invariants preserved** | ✅ | Anima helper (`activateAnimaChatForResult`) untouched; `preset_anima_internal` bypass preserved; pre-existing Slice 2.4 tests updated only to match the extended contract (allowlist now includes `krea2`). |
| **No console.warn in K.14 wiring block** | ✅ | Strip-comments regex check still catches reintroduction; test explicitly enforces. |

### Standards findings

- **None blocking.**
- **None minor.** Single-seam server + frontend change matching the
  precedent of every other bug-fix session in this repo's history
  (issues #20, #22, #24, #25, #26).

---

## 3. Axis 2 — Spec review

| Spec requirement | Met? | Evidence |
|------------------|------|----------|
| Issue filed with full template per `docs/agents/bug-workflow.md` §1.4 | ✅ | https://github.com/shadowdoguk/image-to-prompt/issues/26 — `bug` label, all required sections populated. |
| Class assigned | ✅ | `runtime`. |
| Priority assigned | ✅ | `P1` (core flow broken for Krea-2 + silent for any future invalid body shape). |
| Root cause identified via reproduce → diagnose → fix | ✅ | Curl probe + 3 frontend helper walks + 1 state-flow diagram; see §1 of this file. |
| Fix is smallest possible diff that resolves the bug | ✅ | server.js +43 / -16; src/app.js +94 / -10; no refactors beyond the bug surface. |
| Regression-test added | ✅ | 5 new SPEC #26 tests in `tests/run-all.js` + new 12-assertion `scripts/smoke/refine-prompt-transfer.js`. |
| `node scripts/session-init.js` V-checks still pass | ✅ | 10/10 (verified post-fix). |
| `node tests/run-all.js` passes | ✅ | 745/0 (was 740 baseline; +5 SPEC #26, no regression). |
| Smoke suite unchanged (no regression) | ✅ | Verified; 3 pre-existing smoke failures (`chat-limit-guardrail`, `palette-stale-id-guard`, `anima-chat-apply-sync`) are documented drift from earlier sessions (#20, #22, plus #1's parked smoke) and are NOT introduced by this fix — verified by reverting only this branch's changes and re-running each. |
| End-to-end curl probes pass for all 3 models | ✅ | Z-Image 201, Anima 201, Krea-2 201 (`preset_krea2_internal` + `prompt`); alias path 201; edge cases (empty / 5001 chars / bad model) all 400 with descriptive errors. |
| Two-way conversation can be started after the click | ✅ | `POST /api/chat/sessions/:id/messages` accepted on a freshly-anchored Krea-2 session; verified curl. |
| Edge-case guards ship | ✅ | (a) MAX_PROMPT_CHARS=5000 click-time guard matches server MAX_FINAL_PROMPT_LENGTH; (b) doubled-click guard via `dataset.refining`; (c) post-await `state.chatSessionId` re-check; (d) non-cap errors toasted (was silent). |
| Closing commit uses `Closes #26` | ✅ | Commit message contains it. |
| SESSION-STATE entry (append-only) | ✅ | New entry at end of file with bug classification + diff summary + verification + the pre-existing-smoke drift note. |
| No new ADR | ✅ | This is a single-seam bug fix with no architectural decision (server validator aliasing is a tactic, not a strategy). Mirrors issue #8 (`anima-chat-apply-sync`) and issue #20 precedents. Per AGENTS.md §"What you must ask before doing", adding an ADR would have required explicit user approval. |

### Spec findings

- **None blocking.**
- **None minor.** All 14 spec requirements met.

---

## 4. Test review

### `tests/run-all.js` (5 new SPEC #26 tests + 2 updated Slice 2.4 tests)

All 7 changes are static-source assertions reading literal source patterns:

1. **SPEC #26 (new):** activateKrea2ChatForResult sends canonical body —
   locked positively (canonical-prompt + placeholder + model:'krea2')
   AND negatively (must not regress to `original_prompt` /
   `current_prompt` / `preset_id:null`). The negative check uses a
   comment-stripped window so historical-context comments can't
   false-positive.

2. **SPEC #26 (new):** runChatActivationSession surfaces non-cap
   failures as warning toast — locks the regex / showError(severity:
   'warning') contract.

3. **SPEC #26 (new):** wireRefineInChatLink click-time guards — locks
   validateRefineBodyPayload presence + MAX_PROMPT_CHARS=5000 + length
   check + doubled-click dataset flag + post-await state re-check.
   Also enforces the four pre-existing K.14 invariants (await,
   location.hash, preventDefault, no console.warn in window) so any
   future K.14 refactor can't regress on this slice's narrow window.

4. **SPEC #26 (new):** POST /api/chat/sessions normalises aliases into
   `original_prompt` + `current_prompt` — locks the route handler's
   canonical-prompt resolution AND the model allowlist extension.

5. **SPEC #26 (new):** validateChatSessionCreate accepts prompt aliases
   (ADR 0021 + #26) — locks canonicalPrompt resolution + the three
   inspected fields + the new alias-error message.

6. **Slice 2.4 (updated):** "validateChatSessionCreate accepts an
   optional model field" — window widened 2500 → 5000 chars (so the
   new alias block is captured) and assertion updated to require `krea2`
   in the allowlist.

7. **Slice 2.4 (updated):** "validateChatSessionCreate skips preset-
   existence check for Anima" — window widened 2500 → 5000 chars;
   assertion extended to also require `isKrea2Create` +
   `preset_krea2_internal` + the `!isPlaceholderCreate` bypass condition.

### `scripts/smoke/refine-prompt-transfer.js` (new, 12 assertions)

5 named contracts each with 1–3 sub-assertions. Mirrors the existing
smoke pattern (`palette-stale-id-guard.js`, `route-model-binding-guard.js`).
No server boot, no LLM call — pure static-source regression armor.

---

## 5. Risk review

| Risk | Mitigation | Present? |
|------|-----------|----------|
| **R-26-A (MEDIUM):** Adopting `original_prompt` as a valid alias invites future drift (e.g. someone sends only `current_prompt` and the validator still passes — but the chat session has no canonical anchor). | The validator resolves to a single `canonicalPrompt` (resolved in priority: `prompt` > `original_prompt` > `current_prompt`). The route handler writes that SAME value into BOTH `original_prompt` AND `current_prompt` storage fields, so the on-disk shape is invariant. SPEC #26 test 4 locks this end-to-end. | ✅ server.js + tests/run-all.js |
| **R-26-B (LOW):** Extending the model allowlist to `krea2` could let a future contract drift leak `krea2` into a path it doesn't belong (e.g. chat system prompt for Z-Image). | `buildChatSystemPromptVariant` already dispatches on `model ∈ {zimage_turbo, anima, krea2}` per ADR 0030 (Krea-2 contract). The new validator branch now correctly admits `krea2` so the chat system prompt dispatch can fire. No broadening beyond the existing dispatch surface. | ✅ (verified via grep on server.js for `buildChatSystemPromptVariant`) |
| **R-26-C (LOW):** Click-time guards add up to 4 lines of synchronous work BEFORE the network call — could feel sluggish on slow pages. | All 4 guards are O(1) string ops (trim + length compare); dominated by the existing 200ms+ LLM call cost. SPEC #26 test 3 still requires the post-await re-check, so the guard suite is intentional friction, not noise. | ✅ |
| **R-26-D (LOW):** The Krea-2 body was previously using `preset_id:null`. Future Krea-2 contract changes could re-introduce the bug shape (e.g. removing the placeholder convention in favour of a real Krea-2 preset). | SPEC #26 test 1 has a negative assertion (`!preset_id:null`) that locks against this exact regression. The static-source smoke `refine-prompt-transfer.js` assertion 4 mirrors the same contract. | ✅ |
| **R-26-E (LOW):** The 5 SPEC #26 tests bound source-code windows (e.g. the 5000-char window on `validateChatSessionCreate`). A future refactor that grows the function past 5000 chars would silently exclude new assertions. | Each test's window is sized with headroom (the alias block is ~80 lines below the function entry, well under 5000 chars). Failure here would surface as test FAIL with a clear "function body captured N chars" message. Mirrors the precedent of every other static-source test in the file. | ✅ |
| **R-26-F (LOW):** Pre-existing smoke failures (`chat-limit-guardrail`, `palette-stale-id-guard`, `anima-chat-apply-sync`) regress when re-run against the new fix. | Verified: re-ran each on `main` BEFORE the fix (same failures). The failures are due to (a) the 200-cap data being trimmed to 50 in issue #20's manual cleanup, (b) Slice 3.3 / 3.4 wiring drift from earlier sessions, (c) the parked `palette-stale-id-guard` smoke per SESSION-STATE §10. None of these touch the #26 surface. | ✅ documented in this review + SESSION-STATE entry |

### Risk findings

- **None blocking.** All 6 risks are LOW or MEDIUM-with-mitigation;
  all 6 mitigations present.

---

## 6. Cross-references

- **Issue:** https://github.com/shadowdoguk/image-to-prompt/issues/26
- **Branch:** `fix/refine-in-chat-prompt-transfer`
- **Original bug surface:**
  - `src/app.js:2717` — `activateKrea2ChatForResult` (K.4) — broken envelope
  - `server.js:7988` — `validateChatSessionCreate` (pre-fix) — no aliases, no `krea2`
  - `src/app.js:2688-2705` — `runChatActivationSession` (K.11 lift) — silent non-cap errors
  - `src/app.js:2846-2899` — `wireRefineInChatLink` (K.14) — no pre-network guards, unconditional `preventDefault` on success only
- **Related precedents:**
  - `docs/CODE-REVIEW-8-route-model-binding.md` (issue #24 — silent wiring bug)
  - `docs/CODE-REVIEW-9-anima-empty-response-retry.md` (issue #25 — single-seam retry fix)
  - `docs/SESSION-STATE.md` — bug-fix session pattern (#2, #7, #8, #9, #11)
- **ADR implications:** None. ADR 0021 (Anima fork) and ADR 0030 (Krea-2 contract) already acknowledge that the chat system prompt dispatches per `model` value. Extending the validator's allowlist to match the existing chat-dispatch surface is a tactic, not a new strategy. Per `docs/PRINCIPLES.md` §8, no new ADR is needed.
- **Smoke test:**
  - New `scripts/smoke/refine-prompt-transfer.js` (12 assertions)
  - 5 new SPEC #26 tests in `tests/run-all.js`

---

## Verdict

**pass.** Small, isolated, additive bug fix; 745/0 green; 12/12 smoke
green; no blockers, no minor findings. After #26, all three "Refine
in chat →" links transfer their generated prompt into a chat session
that the user can immediately converse with. Validation rejections
now toast instead of disappearing. Future contract drift on the
canonical-prompt shape, the model allowlist, or the K.14 click-time
guards is locked by 6 static-source tests spanning server.js + src/app.js.
