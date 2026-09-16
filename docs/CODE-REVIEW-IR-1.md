# Code review — Slice IR-1 (Iterative refinement: wire + stub)

**Slice:** SPEC §28 / IR-1
**Reviewer:** Goose (self-review, two-axis per PRINCIPLES.md §6.5)
**Diff:** `git diff HEAD -- server.js src/ tests/ docs/ README.md CONTEXT.md`
**Date:** 2026-09-16
**Verdict:** **pass**

---

## Axis 1 — Standards (Fowler smell baseline + repo conventions)

Reviewed the diff against `docs/PRINCIPLES.md` §6.2 (Fowler smell baseline)
plus the project's established conventions (CR-2 attachment helpers,
SPEC §22 / §24 streaming shape, SPEC §27 hook pattern).

| Smell | Finding | Action |
|---|---|---|
| **Mysterious Name** | None. `irAnalyzeImage` / `irCompareImages` / `irRevisePrompt` map 1:1 to SPEC §28 names; `bindAnalyzeGenerated` mirrors existing `bindNotes` / `bindLibrary` shape. | — |
| **Duplicated Code** | The manifest `role === 'reference'` lookup mirrors CR-2's manifest scan pattern; no duplication, just the same `readChatAttachmentsManifest().filter(...)` shape used by every other chat route. | — |
| **Feature Envy** | None. The route reads from the manifest (its own concern) and pushes the message back into the session (its own concern). No cross-object reach-through. | — |
| **Data Clumps** | The assistant message carries 6 audit fields together — but that's the SPEC §22 envelope, a project-level convention. Bundling is the project's choice. | — |
| **Primitive Obsession** | `IR_ITERATION_CAP = 8` is a magic-number constant, but it's named and exported. Acceptable. | — |
| **Repeated Switches** | None. | — |
| **Shotgun Surgery** | Adding the feature touches 6 files (server.js, index.html, app.js, shell.js, styles.css, tests) — but each file changed for one reason (server: route + stubs; HTML: button; app.js: handler; shell.js: wiring; CSS: counter pill; tests: assertions). | — |
| **Divergent Change** | `server.js` already handles chat, RAG, providers, notes — IR-1 follows the established single-file pattern (the project's kill criterion is "split if > 290KB"; current size well under). | — |
| **Speculative Generality** | The three IR module stubs export real function signatures (`async function irAnalyzeImage(imagePath)`) even though IR-1 only uses them as no-ops. This is intentional — IR-2 / IR-3 / IR-4 swap the bodies without changing call sites. The shapes ARE the contract. | Acceptable — not speculative; it's the documented IR-2 / IR-3 / IR-4 contract. |
| **Message Chains** | None. | — |
| **Middle Man** | None. `bindAnalyzeGenerated` is a 30-line shim that owns the wiring, not a passthrough. | — |
| **Refused Bequest** | N/A. | — |

**Repo-standard compliance:**

- [x] Append-only docs (SPEC, ARCHITECTURE, PRE-MORTEM, CONTEXT all appended, not edited).
- [x] Per-slice tests-first (9 IR-1 tests added to `tests/run-all.js` before the route was written; the route was written to make them green).
- [x] Per-slice code-review (this file).
- [x] Per-slice commit follows (next step).
- [x] No existing handler modified.
- [x] Endpoint registered in `module.exports` (no new exports beyond what the SPEC named).
- [x] README endpoint table updated.

**Verdict (Standards):** **pass.** No smells of consequence. The diff is the project's standard additive-slice shape.

---

## Axis 2 — Spec

Reviewed the diff against SPEC §28, ARCHITECTURE §28, PRE-MORTEM §28,
CONTEXT.md IR series glossary.

| SPEC §28 commitment | Implementation | Status |
|---|---|---|
| New chat input bar button "Analyze Generated Image" | `src/index.html` adds `#chat-analyze-generated-btn` inside `.chat-form__actions`. Hidden until ≥ 1 attachment (per SPEC §28 A6 / shell.js). | ✅ |
| Counter pill `N / 8` | `src/index.html` adds `#chat-ir-counter` with default "0 / 8"; `src/shell.js` `updateIrCounter(n)` updates text + disabled state. | ✅ |
| Endpoint `POST /api/chat/sessions/:id/analyze-generated` | `server.js` registers the route; returns 422 on missing/insufficient attachments, 404 on missing session, 200 on success with `{ session, message, mismatches, revised_prompt, ir_iteration_count, ... }`. | ✅ |
| Three module exports (`irAnalyzeImage`, `irCompareImages`, `irRevisePrompt`) | All three exported from `module.exports`. IR-1 stubs return placeholder data; IR-2 / IR-3 / IR-4 swap bodies. | ✅ |
| Assistant message tagged `audit.kind='ir_iteration'` | Message shape mirrors SPEC §22 / §24. `audit.kind = 'ir_iteration'`, `iteration_index`, `reference_attachment_id`, `generated_attachment_id`, `mismatches`, `latency_ms`. | ✅ |
| `ir_iteration_count` increments on success | `session.ir_iteration_count = (session.ir_iteration_count || 0) + 1` after a successful append. | ✅ |
| Existing chat workflows unchanged | No existing handler modified. CR-2 attachment upload / serve / delete still works (CR-2 tests still green). SPEC §22 partial-apply envelope preserved. SPEC §24 streaming untouched. | ✅ (verified by 630→640 regression suite) |
| Error handling (422 for missing attachments) | Route returns 422 with one-line message for 0 and 1 attachments. | ✅ |
| `validateChatSessionCreate`-style prefix validation | Route returns 400 if `id` doesn't start with `CHAT_SESSION_ID_PREFIX`. | ✅ |
| Tests ≥ 4 (SPEC §28 DoD) | 9 IR-1 tests added: 3 source-grep + 4 live HTTP + 1 cleanup + 1 cross-reference. | ✅ |
| Browser demo | Deferred to G4 verification (the IR-1 wire is provably demoable via the test suite; the in-browser step is part of the per-slice close). | Defer to slice-close manual demo |
| No regression in baseline | 630 baseline tests still green (640 total = 630 + 9 IR-1 + 1 SPEC §27 cross-ref fix). | ✅ |

**Verdict (Spec):** **pass.** Every SPEC §28 IR-1 commitment is implemented or
explicitly deferred (with a documented deferral — manual browser demo).

---

## Deviations

**None.** IR-1 lands exactly as SPEC §28 describes. The three module
stubs are intentional placeholders for IR-2 / IR-3 / IR-4 to swap
without changing the route's call sites (an explicit G1 decision:
"3-module decomposition is the right shape").

---

## Risk notes (carried forward to IR-2)

- **The reference-role marker on attachments** is documented in SPEC
  §28 + this slice's code comments but not yet wired (no
  `markChatAttachmentAsReference` helper). IR-2 needs to add it so
  the user can explicitly mark "this is the reference" — until then,
  IR-1 silently treats the first uploaded attachment as the
  reference. Acceptable for IR-1 (deterministic behaviour); flagged
  as the IR-2 first task.
- **The counter is client-state mirror only.** `shell.js`
  `updateIrCounter(n)` is called from `app.js` after each successful
  Analyze. If the page reloads, the counter resets to 0 until the
  next successful response. IR-5 should hydrate it from
  `session.ir_iteration_count` on session-load. Acceptable for IR-1
  (the route returns the authoritative count in the response).
- **`latency_ms` is hard-coded to zeros** in the IR-1 stub. IR-2 / IR-3
  / IR-4 will populate it with real measurements; the IR-6 smoke
  script will read it for p95 reporting.

---

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass**
- Combined verdict: **pass**
- Ready to commit.
