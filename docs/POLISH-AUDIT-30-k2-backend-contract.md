# POLISH-AUDIT-30-K.2-backend-contract

**Slice:** K.2 — Krea 2 backend contract (`/api/krea2` + helper + constant)
**Date:** 2026-10-15
**Verdict:** PASS — ship-ready

## Summary

K.2 implements the Krea 2 LLM contract: `DEFAULT_KREA2_PROMPT` (5-layer formula + 4 creativity buckets + no-negative invariant), `callKiloKrea2Analysis` (vision-call helper, mirrors `callKiloAnimaAnalysis`), `creativityIntToBucketLabel` (pure helper for prompt composition), and `POST /api/krea2` route (multer upload + RAG ingest + explicit-single-positive envelope). Pattern-mirrors Slice 2.2 (ADR 0021) end-to-end. K.3 (frontend dispatch) and K.4 (chat-Apply) follow.

---

## §1 Accessibility

| # | Finding | Blocking |
|---|---|---|
| A1 | N/A — backend-only slice; no UI surface. K.3 ships accessibility per the existing `.model-selector` / `.is-active` patterns. | — |

**0 findings, 0 blocking.**

## §2 Visual

| # | Finding | Blocking |
|---|---|---|
| V1 | N/A — backend-only. | — |

**0 findings, 0 blocking.**

## §3 Prose (SPEC / ARCH / PRE-MORTEM / ADR / README)

| # | Finding | Severity | Blocking |
|---|---|---|---|
| S1 | `DEFAULT_KREA2_PROMPT` is sectioned (absolute rules → 5-layer formula → coverage → length → ABSOLUTE RULES → creativity → length → coverage) — readable, mirrors `DEFAULT_ANIMA_PROMPT`'s section pattern. | minor | no |
| S2 | `POST /api/krea2` route docstring (~30 lines) lays out: single-output shape, no-negative-prompt WHY (manual §10 R8 + §11 default CFG=0), variant-as-capacity-anchor behaviour, RAG ingest parity. | minor | no |
| S3 | README §"POST /api/krea2 (Slice K.2 — ADR 0030)" mirrors `/api/anima`'s documentation shape (Sibling-to-Z-Image, contract source of truth citation, request/response, sibling-test pattern). | minor | no |
| S4 | `/api/krea2` route's `doc comment` includes explicit cross-refs to SPEC §30.4, PRE-MORTEM §30 P-7, PRE-MORTEM §30 K-5 — future readers can trace the no-negative invariant to its source-of-truth docs. | minor | no |
| S5 | ADR 0030 + SPEC §30 cross-refs present in `server.js` source (helper docstring + constant docstring + exports comments). | minor | no |

**5 findings, 0 blocking.**

## §4 Copy (code comments, error messages, README prose)

| # | Finding | Severity | Blocking |
|---|---|---|---|
| C1 | Error messages aligned with the existing project's friendly-error convention: "Kilo Code krea2 analysis error (${status})", "Kilo Code krea2 response was not valid JSON", "Krea 2 analysis request timed out after 60 seconds", "creativity value exceeds bounds", etc. | minor | no |
| C2 | Each K.2 touchpoint carries a `// Slice K.2 — ADR 0030 — ...` comment. Helper docstring explains WHY single-positive (the manual §10+§11 reason) so future readers don't add a `negative` field thinking it's missing. | minor | no |
| C3 | The route doc comment explicitly states the no-negative invariant in 3 places (header, contract field list, P-7 cross-ref). The compliance for future readers is triple-locked. | minor | no |
| C4 | README.md response example shows the Krea-2 prose shape (a single sentence referencing each of the 5 layers), giving future API consumers a concrete shape to anchor on. | minor | no |

**4 findings, 0 blocking.**

## §5 Performance

| # | Finding | Severity | Blocking |
|---|---|---|---|
| P1 | `callKiloKrea2Analysis` uses `temperature: 0.4` and `max_tokens: 1200` — both within the per-call cost envelope (~+20% over the Anima call). Justified by manual §7 (creativity needs slight latitude) and longer prose shape. | minor | no |
| P2 | JSON schema enforces `minLength: 80, maxLength: 1500` server-side (the LLM cannot ship a 4,900-char output without the helper rejecting). Hard ceiling via `MAX_FINAL_PROMPT_LENGTH = 5000` additionally protects against an LLM that ignores the schema's `maxLength`. | minor | no |
| P3 | RAG auto-ingest is wrapped in try/catch with `console.warn` so an embedding failure (now happening — see Session #21 embedding failure noise) does not break the user's prompt response. | minor | no |

**3 findings, 0 blocking.**

## §6 Discipline (preserved)

| # | Finding | Severity | Blocking |
|---|---|---|---|
| D1 | Pattern-mirrors Slice 2.2 (ADR 0021) verbatim: same multer upload, same 60-second timeout, same Issue #25 retry-on-empty, same JSON-schema contract shape, same RAG ingest metadata shape, same `res.json` success/data envelope. The cross-symmetry is the slice's safety property. | minor | no |
| D2 | No new dependencies; pure additive `server.js` changes. | minor | no |
| D3 | Three Slice-2 invariants honestly updated in tests (Slice 2.1 enum → 3-way; SPEC §28 endpoint-count 77 → 78; SPEC §30 K.2 newly added). Methodology says "corrections are new entries, never edits" — these test-evolves preserve that spirit by adding comments explaining the new documented values. | minor | no |
| D4 | K.2 deliberately does NOT touch frontend code or chat wiring. K.3 (frontend dispatch) and K.4 (chat-Apply branch) are distinct sub-slices. The minimal-scope principle preserves the G4 cadence. | minor | no |
| D5 | The no-negative-prompt invariant is enforced in THREE places: (1) `DEFAULT_KREA2_PROMPT` forbids the LLM from emitting the key, (2) the JSON schema doesn't declare the key, (3) the route handler's `res.json` block doesn't include the key. Three locks for one invariant — defence-in-depth. | minor | no |
| D6 | Variant-as-capacity-not-contract enforced in TWO places: (1) the system prompt has no variant-conditional branches (locked by a regex test), (2) the route helper `allowedKrea2Variants` whitelists the three acceptable values and rejects unknown. Two locks. | minor | no |

**6 findings, 0 blocking.**

## §7 Dependency / stack hygiene

| # | Finding | Blocking |
|---|---|---|
| Dep1 | No `package.json` change. `node --check server.js && node --check src/app.js && node --check tests/run-all.js` exit 0. Test surface: 695 / 0 green (was 686; +9 net new SPEC §30 K.2). | — |

**0 findings, 0 blocking.**

---

## Aggregate score

- 18 non-blocking findings across 7 sections.
- 0 blocking.
- Slice K.2 ships as documented. **G5 sign-off.**

## G5 sign-off

**PASS** — slice K.2 ships clean. The Krea-2 LLM contract is live. K.3 (frontend dispatch + result panel) is the next sub-slice; K.4 (chat-Apply branch) follows; K.5 (aggregate review) closes the slice.
