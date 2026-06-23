# Deep-Dive: Insufficient Population of the `subject` Field

**Date:** 2026-06-22
**Status:** Investigation complete; top fix implemented; verification green.
**Scope adaptation:** This report was framed as "audit of user-submitted Subject
Field entries." The actual domain is an LLM-generated field — `subject` is one of
14 structured output fields produced by the MiniMax M3 vision model in Stage 1
of the image-to-prompt pipeline. "Insufficient population" therefore means the
LLM is returning a short `subject` value instead of the paragraph-length,
exhaustive description the contract requires. The 7 sections of the original
brief are mapped to the LLM-generation domain below.

---

## 1. Audit of `subject` Field outputs (the actual scope)

**Source of evidence:** `server.log` (the runtime scanner from
`scripts/session-init.js` parses it for length-violation patterns).

### What we have

| Run | Subject length | Violation count | Source |
|---|---|---|---|
| Live smoke run (logged 2026-06-22 07:25 UTC) | ~87 chars | 10 of 13 fields below `minLength` | `server.log` lines 3–4 |
| Historical smoke runs (ADR 0001 §Smoke test) | 87–109 chars (~15–19 words) | 9–12 of 12 fields | ADR 0001 §Smoke test methodology |

### Pattern

- **Single capture point:** The only `subject` values in the project come from
  `/api/analyze` → `callMiniMaxStage1` → parsed JSON. There is no `subject`
  store, no historical log of past runs, no analytics endpoint.
- **Stage 1.5 overwrites** `subject_orientation` and `actions` if those fields
  are selected; `subject` is never overwritten by a later stage.
- **Failure mode is uniform across presets:** the logged live run was against
  the `preset_alla_prima_oil` preset (13 fields). Of those, 10 returned values
  below `FIELD_INPUT_MIN_LENGTH` or the per-field hint. The `subject` field was
  one of the 10 failures.

### Categorisation of failures

| Category | Frequency in logged run | Why it happens |
|---|---|---|
| All textarea fields short (incl. `subject`) | 6/13 (`subject`, `subject_orientation`, `actions`, `mood`, `composition`, `texture`) | LLM distributes tokens across many fields; per-field targets not strictly enforced |
| All text fields short | 4/13 (`camera_angle`, `artistic_medium`, `depth_of_field`, `contrast`) | Same distribution issue |
| `subject` specifically under the 600-char hint floor | 1/13 (but the highest-impact failure) | The 600-char floor is ~6× the generic textarea floor; LLM doesn't have a strong enough in-prompt anchor |

**Bottom line:** the issue is systemic (most fields are short), but `subject` is
the highest-visibility failure because it has the highest floor (600 chars
vs 100 chars for the other textareas) and is the leading field of the
eventual Stage 2 prompt (per `stage2_system_prompt` §"SUBJECT (LEAD THE PROMPT)"
in `data/presets.json`).

---

## 2. Design and technical-spec review

### Constraints on `subject` (current state)

| Constraint | Source | What it does |
|---|---|---|
| `minLength: 600` chars on the JSON Schema property | `FIELD_FORMAT_HINTS.subject` (server.js:81-86) + `buildStage1Schema` (server.js:357-388) | Sent to the LLM as part of the schema; MiniMax M3 treats it as guidance, not hard enforcement (per ADR 0001 §Known limitations #1) |
| `description` text appended to system prompt | `buildFieldFormatOverridePrompt` (server.js:99-110) | ~750 chars of instruction: "Exhaustive paragraph-length... 120-200 words, 4-8 sentences. NEVER shorter than 100 words." |
| Server-side validation | `validateAnalysisLengths` (server.js:399-417) | Returns `{field, actual, required}` for any field below its floor |
| 2-attempt retry loop | `callMiniMaxStage1` (server.js:419-569) | First call uses the standard prompt; if validation fails, retry with a strengthened suffix |
| `max_tokens: 1500` for Stage 1 | `callMiniMaxStage1` request body | Caps the LLM's output. 1500 tokens ≈ 6000 chars — sufficient for a 600-char `subject` plus all other fields, so this is NOT the binding constraint |
| UI rows: 5 for `subject` | `src/app.js` `renderAnalysisEditor` `rowsByField` (line 437-444) | Per ADR 0003 amendment |

### Technical barriers to detailed `subject` output

| Barrier | Severity | Evidence |
|---|---|---|
| **The retry prompt suffix does not re-inject the per-field contract.** It lists only field names + char counts; the LLM has to recall the description from earlier in the (now ~4800-char) system prompt. | **HIGH** | server.js:429-432 (pre-fix); server.log:3-4 |
| **System prompt is ~4800 chars after the per-field override is appended.** LLM attention to instructions at the very end of a long prompt is reduced. | MEDIUM | server.js:550-551 |
| **Per-field `description` cannot live in the JSON Schema.** MiniMax M3 API rejects schema `description` > 200 chars with error code 2013 (live-verified 2026-06-22). The text has to live in the system prompt, which is the channel with the most attention dilution. | MEDIUM | ADR 0003 §Trade-offs (resolved 2026-06-22) |
| **`minLength` is guidance, not enforcement.** MiniMax treats it as a hint; the LLM is free to ignore it. The 2-attempt retry is the actual enforcement. | MEDIUM | ADR 0001 §Known limitations #1 |
| **`max_tokens: 1500` is sufficient but not generous.** With 13 fields and JSON overhead, the LLM has to choose where to spend tokens; subject's 600-char floor competes with 12 other fields for the budget. | LOW | server.js:451 |

---

## 3. Generation-workflow analysis (friction points)

```
upload image + preset → POST /api/analyze → callMiniMaxStage1
                                                  │
   ┌──────────────────────────────────────────────┘
   ▼
   performCall(fullSystemPrompt)
       fullSystemPrompt = stage1SystemPrompt + buildFieldFormatOverridePrompt(fieldNames)
                                                                       │
                                                                       ▼
                                                  ~4500 chars preset prompt
                                                  + ~750 chars per-field override (only subject has one)
                                                  + JSON Schema (no description, only minLength)
   ◄── parsed JSON
   validateAnalysisLengths(parsed, fieldNames)
       │
       └─ if violations.length > 0 →
            performCall(fullSystemPrompt + attemptPromptSuffix(violations))
            attemptPromptSuffix PRE-FIX:
              "- subject: 87 chars (need ≥600)"
              "- actions: 50 chars (need ≥100)"
              ... + generic "pad with adjacent observable detail"
            attemptPromptSuffix POST-FIX (this change):
              "- `subject` (currently 87 chars; need ≥600): <full FIELD_FORMAT_HINTS.subject.description>"
              "- actions: 50 chars (need ≥100)"  // fallback for non-hinted fields
              ... + "the contract is RE-STATED IN FULL below — comply with it exactly"
```

### Where the workflow fails

1. **First attempt:** the LLM gets the per-field override at the END of a long
   system prompt. It's there, but it's competing for attention with the
   description-first contract, the specialty focus, and the field-format block
   higher up. Result: short values, especially on `subject` where the floor is
   6× the generic floor.

2. **Retry:** the LLM is told "your previous was too short, expand." But:
   - The retry prompt doesn't re-inject the per-field contract for hinted
     fields. The LLM has to remember it from earlier in the prompt, where
     it's diluted by everything else.
   - The retry guidance ("pad with adjacent observable detail") is generic
     across all 10 failing fields. The LLM has no strong reason to focus on
     `subject` over the other 9.
   - The retry doesn't reference the per-field hint's `minLength` directly
     beyond the `≥600` count. There's no "120-200 words" reminder.

3. **Both attempts failed → result accepted:** per ADR 0001, if attempt 2
   still has violations, the server logs a warning and returns the result.
   The client gets a short `subject` and has no indication it's incomplete.

4. **Client has no recovery affordance:** the analysis editor shows the short
   value in a 5-row textarea (per ADR 0003 §4) but doesn't flag it as below
   the contract minimum. No progress bar, no "below target" indicator, no
   "re-analyze with stronger settings" button.

---

## 4. Clarity and accessibility of the `subject` contract

### What the LLM sees (current state)

The full text path the contract takes to reach the LLM:

1. **Preset's `stage1_system_prompt`** (`data/presets.json`): "PROSE FIELDS
   (textarea fields: subject, subject_orientation, actions, mood, composition,
   texture): MUST be at least 30 words. TARGET 50-100 words. 2-4 sentences
   of flowing prose." (Same envelope for `subject` as for the other 5
   textareas.)

2. **Per-field override block** (appended by `buildFieldFormatOverridePrompt`):
   "`subject` (min 600 chars): Exhaustive paragraph-length description of the
   image. Cover EVERY visible element... 120-200 words, 4-8 sentences. NEVER
   shorter than 100 words. NEVER invent details not visible in the image."

3. **JSON Schema** (built by `buildStage1Schema`): `subject` has
   `minLength: 600`. No `description` (would exceed 200-char API limit).

4. **Retry suffix** (built by `buildStage1RetrySuffix` — POST-FIX): for any
   failing `subject` call, the retry prompt contains the FULL `description`
   text from FIELD_FORMAT_HINTS.subject, framed as "comply with it exactly."

### Assessment

- **The contract is clear at the source.** `FIELD_FORMAT_HINTS.subject.description`
  is explicit about word count (120-200), sentence count (4-8), content scope
  (every visible element), and prohibitions (never invent).
- **The delivery channel is suboptimal.** The text is at the END of a
  ~4800-char prompt, where LLM attention is reduced.
- **The retry was previously lossy.** The pre-fix retry only listed `subject:
  87 chars (need ≥600)` — the LLM had to remember what 600 chars means and
  what content goes into it. Post-fix, the full contract is re-injected.
- **The contract is NOT visible to the end user.** `src/app.js`'s
  `renderAnalysisEditor` shows the field value but no target length, no
  example of a high-quality entry, no progress bar toward the floor. The
  user has no way to know that the value the LLM returned is "too short"
  per the internal contract.

---

## 5. Stakeholder evidence (from the codebase)

The codebase has no human moderators or content-submission pipeline, but the
ADRs, comments, and runtime logs surface the perspectives of the stakeholders
that exist:

### Perspective of the prompt author (per ADRs)

- **ADR 0001 (Context, lines 18–19):** "the LLM returned one-word answers for
  most fields, ignoring the prompt's '50-100 word' mandate for prose fields."
  → The author knew the LLM doesn't strictly honour length contracts.
- **ADR 0001 (Known limitations #1):** "LLM doesn't strictly honor `minLength`
  in JSON Schema. MiniMax M3 treats it as guidance."
  → The author built the retry mechanism BECAUSE the schema-level guardrail
  was insufficient.
- **ADR 0003 (Context, line 25-26):** "Result: `subject` is structurally
  capped at 100 chars minimum and 100 words target. That's a sentence or
  two — not a paragraph."
  → The author understood the field was under-served by the generic
  textarea envelope.
- **ADR 0003 (Trade-offs, lines 186-188):** "Longer `subject` will sometimes
  fail the retry. ADR 0001 caps the retry at 1 attempt; if the LLM still
  returns a short `subject` after the strengthened-prompt retry, the result
  is accepted with a warning log."
  → The author accepted that best-effort is the ceiling for some inputs
  (e.g., sparse images).

### Perspective of the LLM (inferred from runtime behaviour)

- **server.log line 3 (pre-fix run):** "Stage 1 attempt 1 failed length
  validation on 10 field(s); retrying with strengthened prompt" — the LLM
  produced 10 short fields on first attempt despite the prompt saying
  "MUST be at least 30 words."
- **server.log line 4 (pre-fix run):** "Stage 1 attempt 2 still has 10
  length violation(s): subject, subject_orientation, actions, mood,
  composition, camera_angle, texture, artistic_medium, depth_of_field,
  contrast — accepting result" — the strengthened-prompt retry did not
  change the LLM's behaviour. The retry guidance ("pad with adjacent
  observable detail") is too generic.

### Perspective of the end user (UI affordances)

- The user sees whatever the LLM produced. There's no indication that
  `subject` is below contract. There's no "expand" button or "needs more
  detail" hint.
- The user can re-analyze (re-runs Stage 1) but with the same prompt — so
  randomness may or may not yield a longer `subject`. No different
  "thorough" mode.

---

## 6. Structured report — root causes ranked by impact

| Rank | Root cause | Impact | Effort | Status |
|---|---|---|---|---|
| **1** | **Retry prompt suffix does not re-inject the per-field contract.** The LLM is told "your `subject` was 87 chars, need ≥600" but not reminded of "120-200 words, every visible element, never invent." With ~4800 chars of system prompt to recall from, the LLM often produces the same short answer. | **HIGH** — this is the proximate cause of the `subject` failure on the logged live run. Without this fix, the retry is largely wasted. | LOW (one function) | ✅ **Fixed in this session** |
| 2 | System prompt is ~4800 chars after the per-field override is appended; per-field contract text is at the very end where attention is reduced. | MEDIUM — affects every field, not just `subject`. Could be addressed by moving the per-field override earlier in the prompt, but that risks disrupting the preset's specialty focus. | MEDIUM | Out of scope for this session |
| 3 | `minLength` in JSON Schema is guidance, not enforcement. The MiniMax M3 API doesn't fail responses that violate `minLength`. | MEDIUM — fundamental API limitation; no client-side fix available. Per ADR 0001, the 2-attempt retry IS the enforcement. | N/A (API limit) | Documented in ADR 0001 §Known limitations |
| 4 | Best-effort acceptance after retry failure. When the retry also produces a short `subject`, the server logs a warning but returns the short value. The client has no indication. | MEDIUM — silently delivers incomplete data to Stage 2, which propagates into the final prompt. | MEDIUM | Out of scope for this session |
| 5 | `max_tokens: 1500` is sufficient but tight. With 13 fields and JSON overhead, the LLM faces a token-allocation problem. | LOW — 1500 tokens is enough for a 600-char `subject` + 12 other fields if the LLM prioritises correctly. Not the binding constraint. | LOW | Not changing |
| 6 | No client-side length indicator. The user has no way to see that `subject` is below the contract floor. | LOW — informative, but the LLM-level fix (rank 1) should make this a non-issue in most cases. | LOW | Out of scope for this session |
| 7 | Sparse images genuinely can't be padded to 600 chars without inventing details. The prompt correctly forbids inventing; the contract is unreachable for very simple images. | LOW — fundamental image-content limit. Best-effort is the right behaviour here. | N/A | Documented in ADR 0001 §Known limitations #3 |

---

## 6.1 Proposed and implemented solutions

### Implemented this session (top fix)

**Fix:** Extract `attemptPromptSuffix` from inside `callMiniMaxStage1` to a
top-level helper `buildStage1RetrySuffix` that re-injects the FULL
`FIELD_FORMAT_HINTS[field]?.description` text for any failing field that has a
hint. For non-hinted fields, fall back to the existing "field: actual chars
(need ≥required)" format.

**File changes:**
- `server.js`:
  - Added `buildStage1RetrySuffix` (top-level, alongside `buildFieldFormatOverridePrompt`).
  - Removed the inline `attemptPromptSuffix` closure from `callMiniMaxStage1`.
  - Added `require.main === module` guard around `app.listen` so tests can
    require the module without starting the listener.
  - Extended `module.exports` to include the helpers needed for tests.
- `tests/run-all.js`:
  - Added 4 tests covering the new helper and the require-ability of
    `server.js`.

**Why this is the top fix:**
1. **Proximate cause:** the live server.log failure shows the retry didn't
   change behaviour — same 10 violations, including `subject`. The retry
   prompt was the weakest link.
2. **Uses the same channel that already works:** `buildFieldFormatOverridePrompt`
   proves that the system-prompt-append channel reaches the LLM. Re-using it
   in the retry is the same mechanism applied at the moment of greatest need.
3. **DRY with existing infrastructure:** re-uses `FIELD_FORMAT_HINTS` — no new
   configuration surface, no prompt authoring needed.
4. **Backward compatible:** fields without hints still get the
   "field: actual (need ≥required)" format.
5. **Scalable:** if a future field needs a hint, it automatically gets the
   full contract in the retry. No additional code.

**Verification:**
- `node tests/run-all.js` → 13/13 passing (9 pre-existing + 4 new).
- `node scripts/session-init.js` → 10/10 validation checks passing.
- `require('./server.js')` in a Node REPL no longer starts the listener; all
  expected exports are present.

### Proposed (NOT implemented this session)

| Proposal | Why defer |
|---|---|
| Add a client-side length indicator next to each field (e.g., "87/600 chars — below target") | The LLM-level fix should eliminate most under-length outputs; UI work is best done after we have evidence the LLM fix works in production. |
| Cap `max_tokens` per-field-aware: explicitly request a longer completion when `subject` is in `stage1_fields` | Tightening the ceiling could force the LLM to choose. But this adds complexity and risks JSON truncation. Defer until we see post-fix production data. |
| Promote the per-field override block earlier in the prompt (right after the description-first contract, before the specialty focus) | Risks disrupting the specialty focus and the description-first contract, which ADR 0001 already balanced carefully. Defer until rank-1 fix is observed in production. |
| Allow user-initiated "force thorough re-analyze" that uses temperature=0.2 + the strengthened prompt from attempt 2 | Useful UX, but speculative until we know if the rank-1 fix is sufficient. |

---

## 7. Testing plan and success metric

### Pre-production verification (already done this session)

- [x] `node tests/run-all.js` — 13/13 pass, including 4 new tests for the
      `buildStage1RetrySuffix` helper.
- [x] `node scripts/session-init.js` — 10/10 validation checks pass.
- [x] Manual smoke in Node REPL: `require('./server.js')` returns the helpers
      without starting the listener.

### Live verification (per ADR 0003 §Verification)

- [ ] With a real `MINIMAX_API_KEY` and a real test image, run Stage 1
      against `preset_alla_prima_oil` and confirm `subject` ≥600 chars,
      1 cohesive paragraph, covering figures / objects / spatial positioning
      / clothing / expression.
- [ ] Repeat across all three built-in presets and at least 5 distinct test
      images (mix of simple, moderate, complex).

### Production monitoring (30-day metric)

**Success metric:** ≥90% of new `subject` field outputs meet the contract
minimum (≥600 chars AND ≥100 words AND single cohesive paragraph) within 30
days of deploying this fix.

**Measurement approach:**
- The runtime scanner in `scripts/session-init.js` already counts
  `Stage 1 attempt 2 still has N length violation(s)` occurrences in
  `server.log`. Extend that scanner to ALSO count `subject`-specific
  violations across all attempts (attempt 1 + attempt 2), and the
  total `subject`-field analysis count.
- Add a new V-check: `V11-subject-meets-contract`. Pass condition: across
  the 30-day rolling window, `subjects_meeting_contract / subjects_total
  ≥ 0.90`.
- Emit per-session, but the metric is computed across the full log.

**Backstop metric:** the existing runtime warning
("Stage 1 attempt 2 still has N length violation(s)") should decrease
for `subject`-related runs even before the 30-day window closes. If it
doesn't, the rank-1 fix isn't enough — proceed to rank-2/3 fixes.

### Regression test suite (proposed, not built this session)

Add a benchmark suite at `tests/subject-benchmark.js` that:
- Holds out 5–10 labelled test images with human-rated ideal `subject`
  outputs.
- Calls `/api/analyze` for each.
- Scores the returned `subject` against the ideal (length + content overlap).
- Threshold: average score ≥ 0.7 across the suite.
- Skipped automatically if `MINIMAX_API_KEY` is not set (so the CI gate
  isn't a hard requirement per ADR 0001's accuracy-contract decision).

This was explicitly out of scope per ADR 0001 ("No automated 90% accuracy
gate. Per Path A / best-effort decision, no benchmark dataset or CI
validation harness was built"). Recommend revisiting if the 30-day
production metric comes in below 90%.

---

## Summary

**Top fix (this session):** Strengthen the Stage 1 retry prompt to re-inject
the full per-field contract from `FIELD_FORMAT_HINTS` for any failing hinted
field. Implemented in `server.js` as `buildStage1RetrySuffix`. Verified via
13/13 unit tests and 10/10 session-init checks.

**Root cause:** The previous retry prompt listed only field names + char
counts; the LLM had to recall the per-field contract text from a ~4800-char
system prompt, where attention is reduced. Live evidence (`server.log`)
showed attempt 2 producing the same short `subject` as attempt 1.

**30-day success metric:** ≥90% of `subject` outputs ≥600 chars / ≥100 words
/ single cohesive paragraph, measured by extending the runtime scanner to
count per-field contract compliance.

**Out-of-scope for this session but on deck:** client-side length indicators,
per-field-aware `max_tokens`, promoting the per-field override earlier in the
prompt, user-initiated "force thorough" mode. All should be evaluated after
30 days of production data on the rank-1 fix.