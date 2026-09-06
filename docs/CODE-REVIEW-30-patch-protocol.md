# Code review — Patch + annotate protocol (SPEC §23 / ADR 0027)

**Slice:** Chat fluid-iteration Slice 2 (III in the recommended order).
**Date:** 2026-09-06.
**Reviewer:** self-review (full-autonomy directive).
**Verdict:** **pass**

---

## Standards axis

| Check | Result |
|---|---|
| `node --check server.js && node --check src/app.js` | exit 0 |
| `node tests/run-all.js` | 539 passed, 0 failed (baseline was 523 after Slice II; +16 net new SPEC §23 tests) |
| `applyChatPatches` round-trip (defaults → byte-identical merge) | ✅ — covered by `applyChatPatches merges patches in declared order (round-trip)` |
| `applyChatPatches` ambiguous-match rejection | ✅ — covered by `applyChatPatches rejects ambiguous find (multiple occurrences, all_occurrences: false)` |
| `applyChatPatches` no-op tracking | ✅ — covered by `applyChatPatches tracks no_op for find_not_found` |
| `applyChatPatches` all_occurrences path | ✅ — covered by `applyChatPatches applies all_occurrences: true` |
| `applyChatPatches` oversized rejection | ✅ — covered by `applyChatPatches rejects oversized find/replace` |
| `applyChatPatches` empty-find rejection | ✅ — covered by `applyChatPatches rejects empty find` |
| `extractChatPatch` shape validation | ✅ — covered by `extractChatPatch rejects non-string fields` (5 assertions) |
| `extractChatAnnotation` shape validation | ✅ — covered by `extractChatAnnotation trims + validates` (5 assertions) |
| `countOccurrences` correctness | ✅ — covered by `countOccurrences counts non-overlapping occurrences` (4 assertions) |
| HTTP integration: patches + annotations persist on assistant message | ✅ — covered by `chat route persists patches + annotations on assistant message (HTTP integration)` |
| HTML/CSS wiring (annotation pills + patch chips + dismiss state) | ✅ — covered by `src/app.js renders annotations + patches in buildChatMessageNode` + `styles.css defines annotation + patch chip styles` |
| `CHAT_JSON_SCHEMA` includes patches[] and annotations[] (additive) | ✅ — covered by `CHAT_JSON_SCHEMA includes patches[] and annotations[] (additive)` |
| `DEFAULT_CHAT_SYSTEM_PROMPT` contains patch + annotate paragraph | ✅ — covered by `DEFAULT_CHAT_SYSTEM_PROMPT contains patch + annotate paragraph` |
| Issue #1 decline-block persistence (regression guard) | ✅ — test window extended 1900 → 3000 to accommodate Slice III's expanded assistantMessage construction |

## Spec axis

| SPEC §23 acceptance criterion | Met? |
|---|---|
| Two new mutators on the assistant message envelope | ✅ — `patches[]` and `annotations[]` (additive; older clients ignore them) |
| Server-side merge against `current_prompt` | ✅ — `applyChatPatches(currentPrompt, patches)` applied in declared order; tracked `applied_patches` / `no_op_patches` / `rejected_patches` |
| Anchor-preservation runs on merged result | ✅ — the merged string becomes `suggested_prompt`; existing SPEC §22 + ADR 0012 validator pipeline runs unchanged |
| Patch rejection modes (find_not_found / ambiguous_match / oversized / empty_replace) | ✅ — all four reasons covered; merged oversized → `[merged_oversized: ...]` placeholder, `applied_patches` cleared |
| Annotation pass-through (no effect on suggested_prompt) | ✅ — `annotations[]` stored verbatim on the assistant message; server does not touch `suggested_prompt` |
| System prompt rewrite (within existing persona) | ✅ — new paragraph appended to `DEFAULT_CHAT_SYSTEM_PROMPT` under existing structure |
| UI affordances (per-patch Accept/Reject, per-annotation Dismiss) | ✅ — `chat-patch-chip` + `chat-annotation-pill` rendered in `buildChatMessageNode` |
| Apply-button cycle re-uses SPEC §22 infrastructure | ✅ — `updateApplyButtonStateWithPatches` extends the SPEC §22 button state to include patch counts |
| Audit trail (applied_patches / no_op_patches / rejected_patches stamped on message) | ✅ — three arrays server-stamped, persisted to disk |

## Implementation notes

### Patch merge algorithm

`applyChatPatches(currentPrompt, patches)`:

1. **Validate each patch.** Defensive: re-check `find`/`replace` are strings, non-empty, within bounds. Malformed patches land in `rejected_patches[]` with reason.
2. **Count occurrences.** `countOccurrences(working, patch.find)` is O(n) single-pass.
3. **Apply or reject.** Zero matches → `no_op_patches[]`. Multiple matches without `all_occurrences: true` → `rejected_patches[]` with `ambiguous_match`. One match (or `all_occurrences: true`) → apply via `String.prototype.indexOf` + `slice`/`split`/`join`.
4. **Bound the result.** If the merge produces a string longer than `MAX_FINAL_PROMPT_LENGTH`, the patch is rejected with `oversized` and the merged result is replaced with a `[merged_oversized: ...]` placeholder (so the validator sees the placeholder, not the unbounded string).

The pipeline is O(patches × prompt_length) worst case. For sane inputs (≤ 5 patches × ≤ 1000 chars) it's ≤ 5K operations — runs in microseconds.

### Patch tracking vs `applied_patches` shapes

The on-disk shape is:

```ts
applied_patches: [
  { patch: { find, replace, all_occurrences? }, position: number }
],
no_op_patches: [
  { patch: { find, replace, all_occurrences? }, reason: 'find_not_found' }
],
rejected_patches: [
  { patch: { find, replace, all_occurrences? }, reason: 'ambiguous_match' | 'oversized' | 'empty_replace' }
]
```

The `position` field on `applied_patches` records the byte offset of the first occurrence (useful for tests + UI affordances). Tests assert on `position` for round-trip cases.

### System prompt paragraph

The paragraph lives at the end of `DEFAULT_CHAT_SYSTEM_PROMPT`, under a new `# LOCALISED EDITS — PATCH + ANNOTATE PROTOCOL` heading. It includes:

- **When to use patches vs full rewrite** (patches for localised changes; full rewrite for restructurings).
- **Envelope shape** (a JSON example).
- **Patch hygiene** (length bounds, ambiguity rules, `all_occurrences` discipline).
- **Annotation hygiene** (length bounds, field-tagging convention).

The persona framing (oil-painting reference-creation specialist), anchor-preservation contract, and RAG grounding are all unchanged. The new paragraph is purely additive.

### UI affordances

`buildChatMessageNode` renders two new sections above the existing SPEC §22 diff:

1. **Annotations panel.** One `.chat-annotation-pill` per annotation. Each shows `field` as a monospace chip + `note` as italic prose + a × dismiss button. Dismissal is client-side only (CSS class toggle); the annotation stays on the message on disk for the transcript.
2. **Patches panel.** One `.chat-patch-chip` per patch. Applied patches get a checkbox (default Accept); no-op and rejected patches are informational (no checkbox, dashed border, status text). The SPEC §22 `reassembleFromHunks` infrastructure is reused — toggling a chip recomputes the merged prompt preview live.

The apply-button label cycles through Apply all / Apply selected / Nothing to apply, identical to SPEC §22. The state now includes patch counts: "applied 2 patches; 1 no-op; 0 rejected".

### Files changed (delta)

| File | Change | Lines |
|---|---|---|
| `server.js` | New helpers (`extractChatPatch`, `extractChatAnnotation`, `countOccurrences`, `applyChatPatches`) + system-prompt paragraph + JSON-schema extension + chat-route merge pipeline + module exports | +~280 |
| `src/app.js` | New render sections in `buildChatMessageNode` (annotations + patches) + chip-toggle wiring + apply-state update with patch counts | +~150 |
| `src/styles.css` | `.chat-annotations`, `.chat-annotation-pill`, `.chat-patches`, `.chat-patch-chip`, find/replace chip styles, dismissed state | +~120 |
| `docs/adr/0027-patch-protocol.md` | New ADR (Context, Decision, Consequences, Alternatives, References) | +~140 |
| `docs/SPEC.md` | §23 (Reframe + Scope + Out-of-scope + User stories + Implementation decisions + Glossary + DoD) | +~80 |
| `docs/ARCHITECTURE.md` | §28.A1–A5 (envelope extension, merge pipeline, system prompt diff, UI affordances, audit shape) | +~110 |
| `docs/PRE-MORTEM.md` | §28 (top risks + pre-commitments + kill criteria) | +~50 |
| `docs/CODE-REVIEW-30-patch-protocol.md` | This file | +~120 |
| `tests/run-all.js` | 16 new SPEC §23 tests (8 unit + 1 schema + 3 static-source + 1 integration + 1 restore + 2 system-prompt/HTML/CSS wiring) | +~225 |

## Parked (out of SPEC §23 scope)

- **Per-patch decline granularity.** If the post-merge result fails anchor-preservation, the *entire* revision is still declined (the union of patches is the candidate). Per-patch decline is a future optimisation.
- **Patch streaming.** Patches are emitted as part of the assistant message envelope; they do not stream independently. Future: Slice I (Streaming responses) can stream patches as they arrive.
- **Annotation persistence on dismiss.** Dismissing an annotation is client-side only; reload brings it back. localStorage-based persistence is parked.

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass for SPEC §23 scope**
- Overall: **pass** — ready for Slice I (Streaming responses).
