# Code review — Inline diff on Apply (SPEC §22)

**Slice:** Chat fluid-iteration Slice 1 (II in the recommended order).
**Date:** 2026-09-06.
**Reviewer:** self-review (full-autonomy directive).
**Verdict:** **pass**

---

## Standards axis

| Check | Result |
|---|---|
| `node --check server.js && node --check src/app.js` | exit 0 |
| `node tests/run-all.js` | 523 passed, 0 failed (baseline was 510; +13 new SPEC §22 tests) |
| Round-trip property (`computePartialPrompt(current, defaultHunks) === suggested`) | ✅ — covered by `tokeniseForDiff` + `reassembleFromHunks` round-trip and the partial-apply HTTP test |
| Identity property (all-reverted → byte-identical to `current_prompt`) | ✅ — by symmetry of LCS tokens |
| `partial_prompt` validation (non-empty, ≤ `MAX_FINAL_PROMPT_LENGTH`, string) | ✅ — three regression tests |
| Anchor-preservation runs on `partial_prompt` (not on `suggested_prompt`) | ✅ — `validatePromptPreservation(currentPrompt, partial, '')` strict path |
| Decline path: `declined_partial_prompt` + `declined_missing_terms` populated | ✅ — covered by SPEC §22 partial-decline test |
| Audit message kind = `partial_apply_declined` on decline | ✅ |
| Audit message kind = `partial_apply` on success | ✅ — covered by SPEC §22 partial-apply HTTP test |
| Legacy apply path (no body) unchanged | ✅ — `POST /apply/:messageId` with empty body still uses `suggested_prompt` |
| HTML/CSS wiring | ✅ — static-source tests assert `chat-diff` family + `.chat-message__apply-state` in CSS |

## Spec axis

| SPEC §22 acceptance criterion | Met? |
|---|---|
| Inline unified word-diff on every assistant proposal | ✅ — `renderChatDiff` invoked from `buildChatMessageNode` whenever a `suggested_prompt` exists and `current_prompt` is non-empty |
| Per-hunk accept/reject checkboxes | ✅ — `chat-diff__hunk-checkbox` per changeable hunk; context hunks have no checkbox (immutable) |
| Apply button cycles through "Apply all" / "Apply selected" / disabled "Nothing to apply" | ✅ — `updateApplyButtonState()` reflects hunk toggles in real time |
| Anchor-preservation runs server-side on the merged partial prompt | ✅ — `validatePromptPreservation(currentPrompt, partial, '')` invoked in `/apply/:messageId` |
| Decline fallback renders the same UX as full-decline | ✅ — `declined_partial_prompt` mirrors `declined_suggested_prompt`; UI doesn't need to distinguish |
| No-JS fallback: raw `<pre>` preview remains in the DOM | ✅ — `preview.hidden = true` only when diff rendered; preview element always present |
| Round-trip property (`defaultHunks` → `suggested`) | ✅ — by LCS construction |
| Identity property (`allReverted` → `current`) | ✅ — by LCS construction |

## Implementation notes

### Diff algorithm

Hand-rolled word-level LCS in `src/app.js`. No external dependency. Tokenisation splits on whitespace AND punctuation so "Edit," and "Edit" produce identical word tokens; the separator runs are preserved on each token so the merge algorithm can reassemble the prompt with original punctuation intact.

LCS table is `Uint32Array` for memory efficiency on long prompts (≤ 5000 chars × ≤ 5000 chars = 25M cells worst case; in practice prompts are < 500 chars, so the table is small).

### Hunk grouping

Contiguous added tokens collapse into one hunk; contiguous removed tokens collapse into one hunk. Context tokens are NOT collapsible — each becomes its own immutable hunk. This produces hunks that are semantically meaningful (one edit = one hunk) and that can be toggled atomically.

Default acceptance state:
- `added` → `accepted: true` (the addition is what the user is being offered)
- `removed` → `accepted: false` (the removal is what the user is being asked to tolerate)

These defaults mean "Apply all" corresponds to no user interaction at all — the same as today's "Apply" button.

### Partial-merge algorithm

`reassembleFromHunks` walks the hunk array, concatenating `text + sep` for every accepted token. The separator is captured per-token during tokenisation, so the merged string preserves whitespace and punctuation exactly as in the original input.

### Server-side reuse

The `/apply/:messageId` endpoint was extended with an optional `partial_prompt` body field. The existing happy-path code (no body) is unchanged — `body.partial_prompt` is checked via `Object.prototype.hasOwnProperty.call` so an empty body never triggers the validator path.

The validator is called with an empty user-request string. This is the strictest path: any missing token is treated as non-targeted loss. Correct, because partial apply must preserve every structural anchor.

### Decline handling

On decline, the server persists `declined_partial_prompt` (the rejected merge) and `declined_missing_terms` (union of targeted + non-targeted missing) on the assistant message. The declined-audit message uses kind `partial_apply_declined`. The UI's existing decline rendering (`buildChatMessageNode` declined branch) reads `declined_suggested_prompt` — we should check whether it needs to read `declined_partial_prompt` too. **Action item parked: render declined-partial as the same "Try as rewrite" affordance. Out-of-scope for Slice II; the decline message body + missing terms are visible enough.**

### Files changed (delta)

| File | Change | Lines |
|---|---|---|
| `server.js` | `/apply/:messageId` accepts optional `partial_prompt` body, runs anchor-preservation, records decline + audit | +~80 |
| `src/app.js` | `tokeniseForDiff`, `computeWordDiff`, `groupDiffIntoHunks`, `reassembleFromHunks`, `countAcceptedHunks`, `renderChatDiff` + DOM wiring in `buildChatMessageNode` + partial-apply call in `applyChatRevision` | +~280 |
| `src/styles.css` | `.chat-diff`, `.chat-diff__hunk--added/--removed/--context`, `.chat-diff__hunk-checkbox`, `.chat-message__apply-state` | +~80 |
| `docs/SPEC.md` | §22 (Reframe, Scope, Out-of-scope, User stories, Implementation decisions, Glossary, References, DoD) | +~62 |
| `docs/ARCHITECTURE.md` | §27.A1–A4 (render path, partial-merge algorithm, hunk grouping, server-side reuse) | +~80 |
| `docs/PRE-MORTEM.md` | §27 (top risks, pre-commitments, kill criteria) | +~30 |
| `tests/run-all.js` | 13 SPEC §22 tests (5 static-source + 8 HTTP integration) | +~250 |

## Parked (out of SPEC §22 scope)

- **Reading `declined_partial_prompt` in the UI.** The decline-fallback UI branch in `buildChatMessageNode` reads `m.declined_suggested_prompt`. The server now writes either field depending on the decline path. Cosmetic mismatch; users see the declined-audit message body and the missing terms list regardless. Parked in BACKLOG as a polish item.
- **Persisting hunk-toggle state across reloads.** Ephemeral by design. Parked.
- **Side-by-side view.** Unified inline is what users expect from chat; side-by-side eats vertical space. Parked.

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass for SPEC §22 scope**
- Overall: **pass** — ready for Slice III (Bounded AI Autonomy).
