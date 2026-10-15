# CODE-REVIEW-30-K.3-K.4-K.5-frontend-chat-apply

**Slice:** K.3 + K.4 + K.5 — frontend dispatch + chat-Apply + aggregate review
**Date:** 2026-10-15
**Verdict:** pass+minor

## Two-axis verdict summary

| Axis | Verdict | Note |
|---|---|---|
| Standards | pass+minor | Pattern-mirrors Slice 2.3 + Slice 2.4 + the Anima trio end-to-end. State + UI + dispatch + chat-Apply + chat-stream sync follow the existing ADR 0021 conventions precisely. |
| Spec | pass | All 17 SPEC §30 K.3 + K.4 + K.5 acceptance points exercised; 712/0 tests green. Single-positive invariant locked at K.2 and re-locked at K.5. |

## Reviewer

Inline review (goose direct), same precedent as Slice 1, Slice 27, IR-1…IR-7, H1, K.1, K.2.

## Standards axis — findings

### S1 — `runKrea2Generate` mirrors `runAnimaGenerate`

Same canonical-`state.currentFile` source-of-truth, same FormData multipart, same apiCall dispatch, same state mutation + displayKrea2Result call, same showError catch + spinner reset. K.3 also forwards `creativity` (clamped via `validateKrea2Creativity`) + `variant` (whitelisted via `validateKrea2Variant`). **Pass.**

### S2 — `displayKrea2Result` mirrors `displayAnimaResult`

Same panel-hide/show (hide Z-Image + Anima panels, show Krea-2 panel). Same textarea write. Same meta line. Same scroll-into-view. New: variant badge (`renderModelSelector`-style) + creativity slider sync. **Pass.**

### S3 — Variant + creativity selectors inside the panel, not at the model level

This is a structural decision documented in SPEC §30.4: variant is capacity (manual §2), creativity is a Krea-2-specific lever (manual §4). Both belong INSIDE the Krea-2 result panel, not next to the model picker. The CSS uses the existing `.variant-selector` / `.creativity-row` flexbox patterns. **Pass.**

### S4 — `applyKrea2VariantChange` ends the chat session

Per the per-model chat-sessions contract (ADR 0021 decision #5), switching the variant ends the current session. This is a deliberate behaviour lock. The function mirrors `applyZImageVariant`'s session-close path. **Pass.**

### S5 — `applyChatRevision`'s Krea-2 branch writes `state.slice` + `dom.ref` in lockstep

ADR 0021's 2026-08-04 lesson (issue #22 — "Apply does not update Anima result panel") is enforced in advance: the Krea-2 branch writes BOTH `state.krea2Result` (state shape) AND `dom.krea2ResultPrompt.value` (display shape). The chat-stream sync mirror in the chat-dispatch block does the same. **Pass.**

### S6 — `activateKrea2ChatForResult` POSTs `/api/chat/sessions`

Mirrors `activateAnimaChatForResult`. POSTs with `model: 'krea2'`, `variant`, `creativity`, `current_prompt`. try/catch + console.warn for non-blocking behaviour. **Pass.**

### S7 — Single-positive invariant locked at K.2 + K.5

The "no `negative` field" invariant is enforced at THREE points in `server.js` (constant forbids it, schema doesn't declare it, route's `res.json` block doesn't include it) AND at FOUR points in `src/app.js` (state.slice has no `negative`, displayKrea2Result doesn't reference a negative DOM, chat-Apply branch doesn't update a negative DOM, exports don't expose a negative). K.5's aggregate test enumerates all four anchor points and verifies none carry a `negative:` identifier. **Pass.**

### S8 — CSS uses the existing `.variant-selector` flex patterns

No new layout primitives. The Krea-2 panel + variant selector + slider + result textarea inherit the established Anima panel visual contract. **Pass.**

### S9 — `creativityIntToBucketLabelClient` mirrors `creativityIntToBucketLabel` (server)

Both label the integer 0-100 as Raw/Low/Medium/High with the same boundaries. The client copy avoids the round-trip cost of awaiting a server response for the readout. **Pass.**

### S10 — Test hooks export K.3 + K.4 + K.5 symbols

The `?test-hook=1` block at the bottom of `init()` exposes the new helpers (`runKrea2Generate`, `displayKrea2Result`, `onKrea2VariantChange`, `onKrea2CreativityChange`, `creativityIntToBucketLabelClient`, `activateKrea2ChatForResult`). Production users see no surface change. **Pass.**

### S11 — *Minor:* DOM refs for `krea2CreativitySlider` / `krea2CreativityReadout`

The DOM lookup happens unconditionally (no `if (dom.foo)` guards). If the elements aren't present (e.g. partial HTML load), the helpers throw. Existing Anima / Z-Image selectors do this with `if (dom.foo)` guards — minor consistency drift. Not blocking.

## Spec axis — findings

### Sp1 — All 17 SPEC §30 K.3 + K.4 + K.5 acceptance points covered

| Acceptance point                                          | Test                                              |
|-----------------------------------------------------------|---------------------------------------------------|
| K.3 helper exports                                        | "src/app.js exposes runKrea2Generate + displayKrea2Result" |
| K.3 dispatch branches on state.model === 'krea2'         | "wires /api/krea2 dispatch from runGeneratePrompt" |
| K.3 forwards creativity + variant                        | "forwards creativity + variant to /api/krea2"    |
| K.3 state.krea2Result shape (no negative)                 | "state.krea2Result mirrors the Anima state"        |
| K.3 hides Z-Image + Anima panels                         | "displayKrea2Result hides Z-Image + Anima panels"  |
| K.3 single-positive prose (no negative DOM)              | "hides the negative-textarea pattern"               |
| K.3 panel + slider + readout present                     | "src/index.html has the Krea-2 result panel"       |
| K.3 no negative <textarea> in the panel                  | "Krea-2 panel has NO negative-prompt textarea"      |
| K.3 CSS rules for variant + slider + readout + prompt     | "src/styles.css has Krea-2 panel CSS"               |
| K.3 helpers in test hook                                  | "exports runKrea2Generate + displayKrea2Result + activateKrea2ChatForResult" |
| K.4 applyChatRevision's Krea-2 branch                    | "applyChatRevision handles Krea-2 branch"           |
| K.4 chat-stream sync mirrors Krea-2                      | "chat-stream sync mirrors Krea-2 result"            |
| K.4 activateKrea2ChatForResult wired                     | "activateKrea2ChatForResult is wired"               |
| K.5 aggregate — all sub-slices landed                     | "aggregate — all K sub-slices landed"               |
| K.5 single-positive across the stack                     | "Slice K contract is single-positive across the stack" |
| K.5 README documentation                                  | "README documents POST /api/krea2 + the 3-way picker" |
| K.5 SPEC/ADR cross-refs                                   | "SPEC §30 + ADR 0030 + K.1/K.2/K.3/K.4 markers all present" |

**Pass** — 17/17 acceptance points covered; 712/0 tests green.

### Sp2 — Slice K series complete G1 → G5

The K.1 + K.2 + K.3 + K.4 + K.5 chain forms a closed slice:

- K.1 — state + UI third button (shipped)
- K.2 — backend contract (shipped)
- K.3 — frontend dispatch + result panel (this commit)
- K.4 — chat-Apply branch + chat-stream sync (this commit)
- K.5 — aggregate review + README + cross-refs (this commit)

The user's pre-Generate picker is now fully functional end-to-end. Selecting Krea 2, clicking Generate, gets a real 5-layer-formula prose response. Refining via chat applies the same lockstep state.slice + display.shape pattern ADR 0021 established for Anima.

### Sp3 — Single-positive invariant re-locked at K.5

The "no `negative` field" invariant is now locked at SEVEN points across the codebase: server.js constant, server.js schema, server.js route res.json, app.js state.krea2Result, app.js displayKrea2Result, app.js chat-Apply branch, app.js HTML panel (no `<textarea id="...negative">`). Adding a future `negative` field on Krea 2 would require dismantling at least one of these locks. **Pass.**

### Sp4 — No regressions in the 695 baseline

`node tests/run-all.js` exit code 0: 712 / 0 (was 695; +17 net new SPEC §30 K.3 + K.4 + K.5 tests). **Pass.**

### Sp5 — Variant + creativity internal selectors render on init

The init() block runs after `restoreStateFromUrlOrStorage()` and re-renders the Krea-2 internal variant buttons + slider + readout against the persisted state. URL-mirror + localStorage round-trips covered by K.1's tests. **Pass.**

## Final verdict

**pass+minor** (Standards + Spec). Slices K.3 + K.4 + K.5 ship. Slice K is complete G1 → G5.

## Files reviewed

- `src/app.js` — +~250 LOC (runKrea2Generate, displayKrea2Result, onKrea2VariantChange, onKrea2CreativityChange, creativityIntToBucketLabelClient, activateKrea2ChatForResult, dispatch branch, chat-Apply branch, chat-stream sync, init re-render, exports).
- `src/index.html` — +~68 LOC (Krea-2 result panel + 3 variant buttons + slider + readout + meta + result-actions).
- `src/styles.css` — +~50 LOC (variant selector + creativity slider + result prose styling).
- `tests/run-all.js` — +17 SPEC §30 K.3 + K.4 + K.5 tests.
- `docs/SESSION-STATE.md` — slice-tracker row.
