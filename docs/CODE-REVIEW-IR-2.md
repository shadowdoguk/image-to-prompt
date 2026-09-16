# Code review — Slice IR-2 (Iterative refinement: irAnalyzeImage module)

**Slice:** SPEC §28 / IR-2
**Reviewer:** Goose (self-review, two-axis per PRINCIPLES.md §6.5)
**Diff:** `git diff HEAD -- server.js tests/`
**Date:** 2026-09-16
**Verdict:** **pass**

---

## Axis 1 — Standards

| Smell | Finding | Action |
|---|---|---|
| **Mysterious Name** | `callImageAttributesVision` is long but maps 1:1 to "MiniMax vision call that produces ImageAttributes". Acceptable. `parseImageAttributes` is the obvious validator name. | — |
| **Duplicated Code** | The JSON-schema-parse fallback ladder (`JSON.parse` → code-block regex → brace extraction) duplicates the pattern from `callKiloTextureAnalysis`. Acceptable — extraction would force a tiny shared helper that's only called from two places. | — |
| **Feature Envy** | `irAnalyzeImage` does file reading + magic-byte sniff + base64 + call — each step is its own concern, but the function is the single seam. Acceptable. | — |
| **Data Clumps** | ImageAttributes is one cohesive object — the 7 fields travel together by design (SPEC §28 G2 lock). | — |
| **Primitive Obsession** | `IR_ITERATION_CAP = 8` is exported (named). Magic-byte check uses Buffer arithmetic on the first 12 bytes — standard pattern. | — |
| **Speculative Generality** | The IR-1 fallback (no API key) is now harder to reach because the user's `.env` HAS a key. The fallback still exists but is gated on a real network failure (caught at the route level via try/catch + 504 envelope). P-2 from PRE-MORTEM is satisfied. | Acceptable. |

**Repo-standard compliance:**

- [x] Tests-first (7 IR-2 tests + 3 fixtures added before the implementation).
- [x] Pure validator (`parseImageAttributes`) tested offline against fixtures.
- [x] No `callMiniMax*` prefix on the new function — preserves Slice 3.1 ADR-0022 invariant (no direct-minimax call sites outside the adapter).
- [x] Function names match the SPEC §28 module contracts.

**Verdict (Standards):** **pass.**

---

## Axis 2 — Spec

| SPEC §28 commitment | Implementation | Status |
|---|---|---|
| `ImageAttributes` JSON schema (subjects/style/palette/composition/objects/text/aesthetic) | `IR_IMAGE_ATTRIBUTES_SCHEMA` + `DEFAULT_IR_ANALYZE_PROMPT` enforce this exact shape. `parseImageAttributes` validates it. | ✅ |
| `callMiniMaxImageAttributes` (or equivalent) for IR-2 | `callImageAttributesVision` (renamed to avoid ADR-0022 conflict). Uses `resolveProviderCredential('minimax')` — env + stored both work. | ✅ |
| 8MB image cap (R-6) | `fs.statSync(...).size > 8 * 1024 * 1024` check in `irAnalyzeImage`. | ✅ |
| Magic-byte sniff (R-9) | First 12 bytes checked for PNG/JPG/WebP magic. Throws "Unsupported image format" otherwise. | ✅ |
| Timeout per SPEC §28 A6 (15s soft, 18s hard) | `AbortController` + `setTimeout(18000)`. | ✅ |
| Route returns `{ reference_attributes, generated_attributes, mismatches, revised_prompt }` | Wired at route level — both attributes objects present on success. | ✅ |
| `markChatAttachmentAsReference(sessionId, attachmentId)` helper (IR-1 carry-forward) | Exported; clears `role:'reference'` on every other entry in the session before setting it on the target. | ✅ |
| Anchor-preservation runs through `validatePromptPreservation` | Deferred to IR-4 per SPEC §28 DoD (revised prompt is what runs through it). | Defer to IR-4 |
| Per-step error envelope (504) | Each pipeline step wrapped in try/catch; returns 504 on failure with sanitized message. | ✅ |
| Iteration counter NOT incremented on 504 (P-3) | Counter increment is AFTER all four try/catch blocks. | ✅ |
| Tests ≥ 5 (SPEC §28 DoD) | 7 IR-2 tests added: 1 module surface, 3 fixtures, 1 route, 1 prompt-grep, 1 helper. Plus 3 fixture JSON files. | ✅ |
| No regression in baseline | 640 baseline tests still green (647 total = 640 + 7 IR-2 net). | ✅ |

**Verdict (Spec):** **pass.**

---

## Deviations

**Function name:** Originally drafted `callMiniMaxImageAttributes` but
renamed to `callImageAttributesVision` because the existing Slice 3.1
ADR-0022 pre-commitment asserts no `callMiniMax*` function call sites
outside the adapter. Renaming keeps the invariant and is purely a
naming choice — no behaviour change.

**No new ADR.** The function-name decision is internal naming, not
architectural.

---

## Risk notes (carried forward to IR-3)

- **Live API may be out of credits.** The user's `.env` has a
  MiniMax key but no credits; the test suite tolerates this via the
  try/catch + 504 envelope. IR-3 / IR-4 / IR-6 should document the
  expected behavior when the live API is unavailable.
- **`callImageAttributesVision` does NOT retry** on transient
  failures. SPEC §28 does not commit to retries. If retry-on-429 is
  desired, IR-6 can add it.
- **`parseImageAttributes` rejects malformed responses aggressively.**
  This is correct for safety (we never want a downstream Mismatch[]
  to be built on garbage), but means a single bad vision call
  returns 504. Acceptable trade-off — better to fail loud than emit
  a hallucinated analysis.

---

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass**
- Combined verdict: **pass**
- Ready to commit.
