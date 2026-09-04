# Code review — CR-3 (two-way UX upgrade + direct edits)

**Slice:** CR-3 of the CR series (SPEC §19 / ADR 0025).
**Date:** 2026-09-04.
**Reviewer:** self-review (full-autonomy directive).
**Verdict:** **pass+minor**

---

## Standards axis

| Check | Result |
|---|---|
| `node --check server.js && node --check src/app.js` | exit 0 |
| `node tests/run-all.js` | 487 passed, 1 failed (pre-existing `declined_suggested_prompt` — not in CR-3 scope) |
| New tests added (CR-3) | 10 (PATCH round-trip, clears pending + audit, empty prompt 400, oversized prompt 400, unknown session 404, malformed body 400, HTML/JS/CSS wiring, server endpoint registered) |
| `current_prompt` validation | non-empty string, ≤ `MAX_FINAL_PROMPT_LENGTH` (mirrors Stage 2 final prompt) |
| `pending_prompt` cleared on direct edit | ✅ — the proposal was anchored to the old working prompt |
| Audit message appended | ✅ — `{ role: 'assistant', content: 'Working prompt edited manually.', audit: { kind: 'direct_edit', previous_prompt_preview } }` |
| No LLM call on direct edit | ✅ — bypasses the chat handler entirely |
| Sync to result panel | ✅ — `state.finalPrompt` + `dom.resultPrompt.textContent` updated |
| Token reminder banner re-evaluated | ✅ — `updateTokenReminderBanner()` called |

### Reverted / parked (out of CR-3 scope)

The SPEC §19.1 list includes a revert endpoint (`POST /api/chat/sessions/:id/revert/:messageId`) and a fork endpoint (`POST /api/chat/sessions/:id/fork-from/:messageId`). Both are wide refactors (rewind logic + session minting) and were intentionally parked in BACKLOG per the methodology's expand-contract discipline. Direct inline edit covers the core "modify at any stage" requirement; revert/fork can land in a follow-up slice if usage demands them.

### Minor (non-blocking)

- **M-1:** Audit message uses `role: 'assistant'` to fit the existing message schema (no `system` role). The `audit.kind` field disambiguates direct edits from AI proposals.
- **M-2:** The `previous_prompt_preview` is truncated to 200 chars. Full previous text is not persisted (storage cost vs. usefulness tradeoff).
- **M-3:** No undo button on the audit message. Parked; revert endpoint would cover this.

## Spec axis

| SPEC §19 acceptance criterion | Met? |
|---|---|
| 4. Direct in-place edit of `current_prompt` from the chat view | ✅ |
| 5. Persistent: history + prompt revisions survive restart | ✅ — appended audit message + updated `current_prompt` both persisted via `writeChatSessions` |
| 6. Anchor preservation (ADR 0012) preserved | ✅ — PATCH does not invoke the LLM, so the anchor-preservation contract is unaffected |

## Files changed (delta)

| File | Change | Lines |
|---|---|---|
| `server.js` | PATCH /api/chat/sessions/:id endpoint | +~72 |
| `src/index.html` | inline working-prompt editor markup | +26 |
| `src/app.js` | renderChatWorkingPrompt + show/hide editor + submitChatCurrentPromptEdit + click handlers + render hook | +~110 |
| `src/styles.css` | working-prompt editor styles | +35 |
| `tests/run-all.js` | 10 CR-3 tests | +~165 |

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass for CR-3 scope**
- Overall: **pass+minor** — ready for CR-4.
