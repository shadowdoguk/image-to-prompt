# ADR 0027 — Chat patch + annotate protocol (bounded AI autonomy)

**Status:** Accepted
**Date:** 2026-09-06
**Origin:** Session #13 investigation ("fluid two-way chat + AI more freedom to edit"). Slice III in the recommended order. Wide enough to warrant an ADR (long-term consequence for the chat contract + reversibility cost of a protocol change) per PRINCIPLES.md §8.

## Context

The chat system prompt today returns a single `suggested_prompt` field (ADR 0012 / CR-1 RAG schema). The model is constrained to a *whole-prompt rewrite* on every turn. Two consequences:

1. **No localised edit affordance.** When the artist asks "make the lighting more dramatic", the model rewrites the entire prompt — the user has no way to see or accept just the lighting change. Slice II (SPEC §22) added an inline diff view + per-hunk accept/reject, but the model still emits one big string; the granularity is post-hoc.
2. **The anchor-preservation contract (ADR 0012) is binary.** If the model's whole-prompt rewrite drops below the keyword/bigram threshold, the *entire* revision is declined. There's no partial credit. The user is told "too much of the original context would have been lost", even if the model's intent was sound and the loss was local (e.g. dropping one modifier).

These two consequences together produce a transactional feel: input → full rewrite → apply-or-decline → repeat. The investigation in Session #13 (BACKLOG 2026-09-06 entry) called out "give the AI more freedom to edit and manipulate the prompt" as the headline ask. The freedom needs shape, or it collapses into either (a) more wholesale rewrites that trip the validator, or (b) a system-prompt rewrite that lowers the bar and erodes the safety rail.

The shape that keeps the safety rail *and* gives the AI room: a small, well-typed set of mutators the model can emit instead of (or in addition to) a full `suggested_prompt`. The model picks the smallest unit of change that satisfies the artist's request; the validator runs on the merged result; the UI shows what each mutator did.

## Decision

### 1. Two new mutators on the assistant message envelope

The chat system prompt instructs the model to emit, alongside the existing `{ reply, suggested_prompt }`:

```json
{
  "reply": "I warmed the palette and shortened the subject line as you asked.",
  "suggested_prompt": "<merged result, computed by the server>",
  "patches": [
    { "find": "cool blue", "replace": "warm amber", "all_occurrences": false },
    { "find": "with three red apples", "replace": "with three apples" }
  ],
  "annotations": [
    { "field": "lighting", "note": "Consider whether 'soft natural' would read warmer than 'cool daylight' for the focal area." }
  ]
}
```

The envelope is fully additive: older clients that only read `reply` and `suggested_prompt` are unaffected; the new fields are dropped on the floor. The server computes `suggested_prompt` from `patches` applied in declared order against `current_prompt`, then runs anchor-preservation on the merged result. The model is told it can either:
- Emit `patches` only (localised edit — preferred for small changes),
- Emit `suggested_prompt` only (wholesale rewrite — required for large restructurings),
- Emit both (rare; usually means the model wants to provide a backup full rewrite plus the precise localised change).

### 2. Patch semantics

A `patch` is `{ find: string, replace: string, all_occurrences?: boolean }`. The server applies patches in declared order against `current_prompt`:

1. If `all_occurrences` is true (default false), replace every occurrence of `find` with `replace`.
2. If `all_occurrences` is false (default) and exactly one occurrence exists, replace it.
3. If `all_occurrences` is false and zero occurrences exist, the patch is a no-op (logged on the assistant message as `applied_patches` / `no_op_patches` for transparency).
4. If `all_occurrences` is false and multiple occurrences exist, the patch is rejected at parse time (added to `rejected_patches` with reason `'ambiguous_match'`) — the model is told to disambiguate by lengthening `find`.

Patches do not overlap by definition (the server does not attempt to coordinate patches against each other; if two patches target overlapping text, the second operates on the result of the first — natural composition order, declared in the array).

### 3. Annotation semantics

An `annotation` is `{ field: string, note: string }`. `field` is one of the 14 structured-prompt field names (subject, palette, composition, lighting, mood, actions, focus, depth_of_field, lens, style, era, texture, camera, render) or any free-form short tag. The server does not validate `field` (it's a UI affordance); it stores the annotation on the assistant message under `annotations[]`. The UI renders annotations as dismissible info-pills above the patch list. Annotations do not affect `suggested_prompt` and do not run through anchor-preservation.

### 4. Server-side merge + validation pipeline

```
1. Read raw assistant JSON { reply, suggested_prompt?, patches?, annotations? }.
2. If patches[] present:
   a. For each patch, attempt merge against current_prompt in declared order.
   b. Track applied / no-op / rejected (with reason) on the assistant message.
   c. The merged prompt is the new pending_prompt candidate.
3. If patches[] absent AND suggested_prompt present, use suggested_prompt directly.
4. If both absent, set pending_prompt = null (pure discussion turn).
5. Run anchor-preservation on the candidate (current_prompt → candidate):
   a. Preserve: store as message.suggested_prompt; clear declined_*.
   b. Decline: store declined_suggested_prompt + declined_missing_terms; mark decline in audit.
6. Stamp retrieval_ids (CR-1 unchanged).
```

The validator still measures *what actually changed* — the strictness is identical to the whole-prompt path. Patches that drop anchor terms still get declined.

### 5. UI affordances

Each patch renders as a chip showing `find → replace` with its own Accept/Reject toggle. The default state of every chip is Accept (matching the "Apply all" default of Slice II). Rejecting a patch toggles its `applied` flag in the merged-prompt preview; the preview is recomputed live (same algorithm as Slice II's `reassembleFromHunks`).

Each annotation renders as a passive info-pill with a Dismiss button. Dismissing an annotation removes it from the chip list (client-side only; the annotation remains on the message on disk for the transcript).

The Apply button cycles through Apply all / Apply selected / Nothing to apply, identical to Slice II's affordance. The "Apply selected" body is computed by the UI from the user's chip toggles; the server treats it like a SPEC §22 partial apply.

### 6. System prompt rewrite (within the existing persona)

The persona (the oil-painting reference-creation specialist from CR-1) gains one new paragraph under the existing "REFINEMENT RULES" section:

> **Localised edits.** When the artist's request maps to a specific token, phrase, or field of the working prompt, prefer `patches[]` over a full `suggested_prompt` rewrite. Patches are deterministic, auditable, and let the user accept or reject individual changes. Reserve `suggested_prompt` for genuine restructurings (reordering, tag-style conversion, scene relocation) where patches would be ambiguous. When you're uncertain which way to go, emit an `annotation[]` instead of guessing — annotations surface your hesitation to the artist without committing to a change.

This is *additive* — it does not relax any existing constraint (anchor-preservation, JSON schema, RAG grounding, persona) and it does not change the model's task framing. The model is still the oil-painting specialist producing a reference image prompt; it just has a more precise tool.

## Consequences

### Positive

- **Bounded freedom with explicit shape.** The model emits typed mutators, not free-form prose. The UI can reason about each mutator individually; the server can validate, log, and audit each one.
- **Reduced decline rate.** Many current declines are whole-prompt rewrites that drop a single term. Patches targeting the same change have a much higher preservation rate (the validator measures what changed, not what stayed the same).
- **Trust granularity.** The user can accept the patches they like and reject the ones they don't, without losing the AI's other ideas.
- **Annotation channel.** The model has a place to surface uncertainty and recommendations without forcing a commitment. This shifts the conversation from "guess and ship" to "consult and iterate".

### Negative

- **Two new fields to test.** `patches[]` and `annotations[]` are additive but they need their own validation, their own UI affordances, and their own decline path. The test surface grows by ~15 slots.
- **System prompt drift risk.** The persona gains a paragraph; future model swaps might re-interpret it. Mitigation: the system prompt is shipped from `DEFAULT_CHAT_SYSTEM_PROMPT` (a code constant), not from a config file, so the source of truth is version-controlled.
- **Patch ambiguity.** Multiple occurrences of `find` with `all_occurrences: false` is rejected at parse time. The model must disambiguate by lengthening `find`. This is correct behaviour but it adds a failure mode the model has to learn. Mitigation: persona prompt + tests + RAG grounding + the explicit "prefer patches when unambiguous" rule.

### Neutral

- **Per-model sessions (ADR 0021) unchanged.** Switching model ends the session as before; the new envelope is per-message, not per-session.
- **RAG grounding (ADR 0025) unchanged.** Retrieval happens before the model emits; the model decides whether to use patches or full rewrite based on its own reasoning. The retrieval block is identical.
- **Direct edit (CR-3) unchanged.** `PATCH /api/chat/sessions/:id` still bypasses the LLM; it sets `current_prompt` directly. Patches are an LLM-driven affordance; the user can still hand-edit.

## Alternatives considered

### Alternative A — Loosen the anchor-preservation threshold (ADR 0012)

Lower the keyword/bigram retention threshold so the current whole-prompt rewrite is less likely to be declined. Rejected: ADR 0012 §"Rejection-rate hazard" already documented this risk — lowering the bar erodes the safety rail. The patches+annotate protocol keeps the bar and gives the model a more precise tool.

### Alternative B — Switch to a free-form `edits: string` markdown field

Let the model emit a markdown document describing its changes ("Change 'cool blue' to 'warm amber' in the palette section"). Rejected: the UI would have to parse markdown to render changes, the server would have to LLM-parse the markdown to apply them, and the audit trail would be ambiguous. Typed mutators are strictly better.

### Alternative C — Two-message turns (one discussion, one revision)

Have the model emit a "discussion" message first and a separate "revision" message after the user confirms. Rejected: this doubles the turn count and breaks the ChatGPT-style "one reply, one revision" UX the user expects. Patches+annotations live inside the same message envelope.

### Alternative D — Direct access to the 14 structured fields

Let the model emit `{ field: 'palette', value: { ... } }` updates and let the server reconcile them into a prompt. Rejected: this is a wider refactor (the structured fields are owned by the analysis pipeline, not the chat), it would couple the chat to the field schema, and it would lose the model's prose-style prose for free-form refinements. Patches are a layer below — they target text, not fields.

## References

- SPEC §23 (Slice III — bounded AI autonomy).
- ARCH §28.A1–A5 (envelope extension, merge pipeline, system prompt diff, UI affordances, audit shape).
- PRE-MORTEM §28 (top risks + pre-commitments + kill criteria).
- docs/CODE-REVIEW-30-patch-protocol.md (verdict pass).
- ADR 0012 (anchor-preservation contract — the safety rail this ADR cooperates with).
- ADR 0025 (RAG grounding — unchanged by this ADR).
- ADR 0021 (per-model sessions — unchanged by this ADR).
- SPEC §22 (Slice II — the inline-diff-on-Apply affordance this ADR layers on top of).
