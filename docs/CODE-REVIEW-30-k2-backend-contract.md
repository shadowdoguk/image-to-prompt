# CODE-REVIEW-30-K.2-backend-contract

**Slice:** K.2 — Krea 2 backend contract (`/api/krea2` route + helper + LLM-facing prompt constant)
**Date:** 2026-10-15
**Verdict:** pass

## Two-axis verdict summary

| Axis | Verdict | Note |
|---|---|---|
| Standards | pass | Pattern-mirrors Slice 2.2 (ADR 0021) for the vision call + route + RAG ingest end-to-end. Three new exports. Two modules follow the existing project's single-attempt + retry-on-empty pattern (Issue #25). |
| Spec | pass | All 9 SPEC §30 K.2 acceptance points exercised (5-layer formula + bucket labels + no-negative invariant + creativity clamp + variant-in-prompt-disabled + RAG metadata + exports + route registration + SPEC/ADR cross-refs). 695/0 tests green. |

## Reviewer

Inline review (goose direct), same precedent as Slice 1, Slice 27, IR-1…IR-7, H1, K.1.

## Standards axis — findings

### S1 — `DEFAULT_KREA2_PROMPT` is comprehensive and cites the manual

The constant covers all five layers (Subject / Setting / Lighting / Style / Composition), encodes the four creativity bucket labels verbatim per manual §4, explicitly forbids a `negative` key, forbids meta-references, forbids Anima's forbidden vocabulary, and supplies operational defaults for the photographic / digital / document case-splits. ~70 lines of careful prompting. Pattern-mirrors `DEFAULT_ANIMA_PROMPT`'s structure (sections, length rules, forbidden vocabulary, coverage category enumeration). **Pass.**

### S2 — `callKiloKrea2Analysis` mirrors `callKiloAnimaAnalysis` shape

Single-attempt LLM call (with the Issue #25 retry-on-empty pattern preserved for parity), 60-second AbortController timeout, schema-enforced JSON envelope (`prompt: { minLength: 80, maxLength: 1500 }`), 429 / 401-403 / 5xx / empty / invalid-JSON / missing-field / AbortError paths identical to the Anima pattern. **Pass.**

### S3 — Creativity integer is clamped server-side

`Math.max(0, Math.min(100, Math.round(n)))` on Number coercion, falling back to 50 on NaN. Both the helper and the route clamp independently (route is the canonical pipeline; helper is the fallback). Matches the project's "forgiving defaults" convention. **Pass.**

### S4 — Variant is recorded, not threaded

`callKiloKrea2Analysis` records variant on the response envelope. The system prompt has zero `if variant === ...` branches — variant is capacity, not contract, per manual §2 + ADR 0030 decision #2. The route helper `allowedKrea2Variants` rejects unknown values (falls through to 'medium' canonical safe, NOT silent acceptance). Both invariants are tested. **Pass.**

### S5 — `creativityIntToBucketLabel` is pure + exhaustive

The helper is a pure function with documented mappings (Raw 0-20 / Low 21-45 / Medium 46-65 / High 66-100) plus NaN/undefined/garbage fallback to Medium. Boundaries (20/21, 45/46, 65/66) are explicitly tested. **Pass.**

### S6 — `POST /api/krea2` route mirrors `/api/anima`

multer single upload, validation (variant + creativity), `callKiloKrea2Analysis` dispatch (with `buildProviderStub` fallback for non-kilo_code providers, mirroring `/api/anima`'s Slice-26 wiring), `ragIngest.ingestStage2Output` (with single-positive metadata per SPEC §30.7 — no `negative`), explicit `res.json` envelope with NO `negative` key. 500 catch + multer cleanup identical. **Pass.**

### S7 — Exports clean

`DEFAULT_KREA2_PROMPT` + `callKiloKrea2Analysis` + `creativityIntToBucketLabel` are all in the existing `module.exports = { ... }` block, each with a `// Slice K.2 — ADR 0030` comment. **Pass.**

### S8 — No new dependencies

Zero `package.json` changes. Pure additions to existing infrastructure. **Pass.**

### S9 — Temperature tightened (per manual §7)

`callKiloKrea2Analysis` uses `temperature: 0.4` (vs Anima's `0.3`). Manual §7 calls for slightly less constraint than Anima's tag shape. Documented inline. **Pass.**

### S10 — `max_tokens: 1200` (vs Anima's `1000`)

Longer prose warrants longer output budget. Manual §4.1 length ceilings still cap the result via the JSON schema's `maxLength: 1500`. **Pass.**

### S11 — `ragIngest` metadata single-positive

Krea-2 ingest omits the `negative` metadata field that Anima's ingest carries. Documented inline: "single-positive (no negative field to preserve)" — manual §10 R8 + §11 contract. **Pass.**

## Spec axis — findings

### Sp1 — All 9 SPEC §30 K.2 acceptance points covered

| Acceptance point                                            | Test                                                            |
|-------------------------------------------------------------|-----------------------------------------------------------------|
| Helper + constant + route export                            | K.2 × 3 tests (export, exports-lock, route-registered)          |
| 5-layer formula present                                     | "DEFAULT_KREA2_PROMPT" → checks all 5 layer names               |
| 4 creativity bucket labels verbatim                         | same → checks Raw/Low/Medium/High                               |
| No-negative-prompt invariant                                | "no negative field (P-7 + K-5)" + "DEFAULT_KREA2_PROMPT forbids negative key" |
| Creativity integer clamp                                    | "creativity clamped to [0, 100]" route + helper tests            |
| Variant capacity not contract                               | "variant is ACCEPTED but not threaded into system prompt"       |
| RAG ingest metadata single-positive                         | "ingest uses single-positive prompt (no negative metadata)"     |
| SPEC §30 + ADR 0030 cross-refs                              | "SPEC §30 + ADR 0030 cross-references"                          |
| Helper exported                                             | "callKiloKrea2Analysis signature-locked"                         |

**Pass** — 9/9 acceptance points covered; 695/0 tests green.

### Sp2 — README documents the new endpoint

`docs/README.md` adds a `POST /api/krea2 (Slice K.2 — ADR 0030)` section mirroring the `/api/anima` documentation pattern. Creativity, variant, response shape, and the no-negative invariant are spelled out. **Pass.**

### Sp3 — Endpoint count invariant honestly updated

The legacy "expected 77 endpoints after SPEC §28 IR-1" test was updated to **78** with explanatory comment ("SPEC §30 / Slice K.2 adds 1 more (POST /api/krea2)"). The README-endpoint-sync test (`README documents endpoints that the server actually exposes`) now picks up `/api/krea2` from the documented section. **Pass.**

### Sp4 — No regressions in the 686 baseline

`node tests/run-all.js` exit code 0: 695 / 0 (was 686; +9 net new SPEC §30 K.2 tests, 1 Slice 2.1 cross-effort invariant updated honestly, 1 endpoint-count invariant updated honestly). **Pass.**

### Sp5 — No-negative envelope invariant locked in code

The route handler's `res.json(...)` explicitly includes `prompt`, `variant`, `creativity`, `provider`, `model` and does NOT include `negative`. The "no-negative-field" test does a 4500-char-window source-grep against the route body — sufficient to cover the entire route. **Pass.**

### Sp6 — 5-layer coverage invariant locked

The `DEFAULT_KREA2_PROMPT` constant explicitly references all five layers verbatim ("Subject and action" / "Setting and environment" / "Lighting and mood" / "Style reference" / "Composition notes"). The contract template makes the rule explicit: "All five layers must be present and covered in this order. Missing layers are a bug." Mirrors ADR 0021's 2026-08-04 lesson for the Anima contract. **Pass.**

### Sp7 — RAG ingest parity preserved

The /api/krea2 route's RAG auto-ingest mirrors `/api/anima`'s shape. Krea-2 metadata carries `provider` + `variant` + `creativity` (single-positive — no negative). Failure of the RAG call is non-blocking (try/catch with console.warn). **Pass.**

## Final verdict

**pass** (Standards + Spec). Slice K.2 ships. The Krea-2 contract is live in `server.js`. The frontend (K.3) and chat-Apply branch (K.4) follow.

## Files reviewed

- `server.js` — +~270 LOC (constant + helper + bucket helper + route + exports update). Now ~12.0k lines.
- `tests/run-all.js` — +9 SPEC §30 K.2 tests, 2 cross-effort invariants updated honestly (Slice 2.1 enum + endpoint-count).
- `README.md` — +60 LOC endpoint documentation section.
