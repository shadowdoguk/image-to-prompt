# ADR 0022 — Kilo Code provider migration: replace direct MiniMax API with Kilo AI Gateway

## Status

Accepted. Implemented 2026-08-04 (Slice 3 of the App Build methodology).

## Context

The image-to-prompt app was built on a **direct MiniMax M3 API integration**. Every LLM call — Stage 1 vision analysis, six per-field re-analysis endpoints, Stage 2 prompt synthesis, and post-generation chat — calls `api.minimaxi.chat/v1/chat/completions` with `Bearer $MINIMAX_API_KEY` and model `MiniMax-Text-01`. The provider is hardcoded; there is no abstraction layer.

Two forces converged to make a provider migration the right next step:

1. **Access to more models.** The user wants to experiment with different LLMs for prompt generation — GPT-5.6 Luna, Gemini 3.1 Pro Preview, Gemini 3.5 Flash, Nemotron 3 Ultra, and Grok 4.3 — alongside the familiar MiniMax M3. Directly integrating six separate provider APIs would require six different auth mechanisms, six different request shapes, and six different response parsers. That's a maintenance nightmare.

2. **Kilo AI Gateway exists.** `api.kilo.ai` is an OpenAI-compatible API gateway to 500+ models from multiple providers (Anthropic, Google, OpenAI, NVIDIA, xAI, MiniMax, and more). It accepts a single `Bearer $KILO_API_KEY` JWT token and speaks OpenAI-compatible `/chat/completions`. The model is specified as `provider/model-name` (e.g., `minimax/minimax-m3`, `openai/gpt-5.6-luna`). This single-provider-single-API-shape design collapses the multi-provider integration problem into one API.

The user's request was explicit: "only have kilocode with a model selector" — single provider, multiple models. They provided a hardcoded list of six models with MiniMax M3 as the default.

The Slice 3 SPEC (`docs/SPEC.md` §15) and the Slice 3 architecture (`docs/ARCHITECTURE.md` B1–B9) capture the slice in detail. This ADR captures the strategic decision itself.

## Decision

**Replace the direct MiniMax M3 API integration with the Kilo AI Gateway as the sole LLM provider**, and add a model selector dropdown with six hardcoded models. MiniMax M3 remains the default.

1. **Single provider, single API shape.** All LLM calls go through `https://api.kilo.ai/api/gateway/chat/completions`. Auth is `Bearer $KILO_API_KEY`. The request shape is OpenAI-compatible. The response shape is OpenAI-compatible (`choices[0].message.content`). This eliminates ~15 duplicate fetch constructions and creates a single point of change for future API migrations.

2. **Model selector upstream of output contract.** A new `<select>` dropdown sits above the existing output-contract selector (Z-Image Turbo / Anima). The user picks the LLM model first, then the output format. Two selectors, two abstraction levels. The LLM model selector defaults to MiniMax M3 (`minimax/minimax-m3`).

3. **Six hardcoded models.** No dynamic fetch from `GET /models`. The list is curated and static:

   | Display Name       | Model ID                              |
   |--------------------|---------------------------------------|
   | MiniMax M3         | `minimax/minimax-m3`                  |
   | GPT-5.6 Luna       | `openai/gpt-5.6-luna`                 |
   | Gemini 3.1 Pro Preview | `google/gemini-3.1-pro-preview`   |
   | Gemini 3.5 Flash   | `google/gemini-3.5-flash`            |
   | Nemotron 3 Ultra   | `nvidia/nemotron-3-ultra-550b-a55b`  |
   | Grok 4.3           | `x-ai/grok-4.3`                       |

4. **`buildVisionMessage` helper.** The image format changes from MiniMax's inline base64 data URI to OpenAI-compatible `image_url` content parts. A single helper function constructs the correct shape and is used by all ~15 vision call sites. The helper is the expand-contract pattern: introduce once, migrate call sites, delete old inline pattern.

5. **Mechanical rename: `callMiniMax*` → `callKilo*`.** No functional change — same JSON Schema construction, same response parsing, same error handling. Only the fetch target changes (URL, auth header, model param).

6. **Model param on every endpoint.** Every endpoint accepts `llmModel` in its request body, validates against the six allowed IDs, and passes it to the helper. The frontend sends `state.llmModel` with every request. Chat sessions record `llm_model`.

7. **State: `state.llmModel`.** Persisted in `localStorage` (`image-to-prompt.state.llmModel`), mirrored in URL (`?llm=...`), validated on read, default `'minimax/minimax-m3'`. Distinct from `state.model` (the output contract — Z-Image/Anima).

8. **No fallback provider.** Single-provider by design. If Kilo Code is down, the app is down. This is an accepted risk. Error messages are per-status-code (401/402/429/502/503) to guide the user.

## Consequences

- **One API to maintain.** Every LLM call uses the same URL, same auth, same request shape, same response parser. Adding a seventh model is a one-line change to the hardcoded list. Adding a second provider in the future would require a provider-abstraction refactor, but that's a separate slice.

- **Image format is centralised.** `buildVisionMessage` is the single source of truth for vision message construction. If Kilo Code changes its vision format, one function changes. If MiniMax changes its format, we don't care — we're not calling MiniMax directly.

- **Model selection is explicit and persistent.** The user picks a model once and it sticks. The URL mirror enables sharing ("here's the prompt I got from GPT-5.6 Luna with this image"). The chat session records which LLM model was used, enabling comparison.

- **`server.js` grows by ~100 lines.** One helper + model validation + route handler changes. Well under the 290KB kill criterion (~7,100 lines currently).

- **The `callMiniMax*` → `callKilo*` rename is mechanical but wide.** ~15 function renames across `server.js` and `tests/run-all.js`. The risk is missing a reference — mitigated by a mandatory grep check and a test assertion.

- **`state.model` naming collision.** The output-contract selector uses `state.model` (Z-Image/Anima). The LLM model selector uses `state.llmModel`. The chat session schema uses `llm_model` for the LLM model and `contract` for the output contract (renamed from `model` to avoid collision). This is an expand-contract rename within the chat session schema, not a wide refactor.

- **No provider abstraction yet.** Slice 3 is single-provider. If a future slice needs multi-provider, the `buildVisionMessage` helper and the `callKilo*` helpers will need an abstraction layer. That's a separate ADR.

## Rejected alternatives

1. **Keep MiniMax direct + add Kilo Code as a second provider.** Rejected by the user — "only have kilocode." Multi-provider would require a provider selector, two sets of env vars, two image formats, and two response parsers. Single-provider is simpler and the user explicitly chose it.

2. **Dynamic model list from `GET /models`.** Rejected. Adds startup latency, requires network at boot, exposes 346 models (most irrelevant to prompt engineering). A curated list is more intentional and user-friendly.

3. **Keep `callMiniMax*` names.** Rejected. The helpers no longer call MiniMax directly. Renaming them to `callKilo*` is honest about what they do. Keeping the old names would be misleading and make grepping for MiniMax references ambiguous.

4. **`state.model` for the LLM model (reusing the existing field).** Rejected. `state.model` already means "output contract" (Z-Image/Anima). Overloading it would break the Anima fork. Two separate fields (`state.llmModel` + `state.model`) keep the concerns separate.

5. **Model-specific system prompts.** Rejected. The system prompts (Stage 1, per-field, Stage 2, chat) are model-agnostic prompt engineering. They work with any competent LLM. Making them model-specific would create a combinatorial explosion (6 models × 2 contracts × N prompts).

## Verification

Verification commands (to be run post-implementation):

- **`node tests/run-all.js`** — all existing + new tests pass.
- **`node scripts/session-init.js`** — 10/10 V-checks pass.
- **`node --check server.js && node --check src/app.js`** — exit 0.
- **`grep -n "callMiniMax" server.js`** — returns zero results.
- **`grep -n "minimaxi.chat" server.js`** — returns zero results.
- **`grep -n "MINIMAX_API_KEY\|MINIMAX_BASE_URL\|MINIMAX_MODEL" server.js`** — returns zero results (only `KILO_*` env vars remain).
- **Manual demo:** upload one image, run through all six models, verify Stage 1 output is recognisable for each.
- **Manual demo:** generate a prompt with MiniMax M3 through Kilo Code, compare to a saved prompt from the direct MiniMax era.
- **Code review** — `docs/CODE-REVIEW-3-kilo-code-provider.md` per-sub-slice verdict: `pass` or `pass+minor`.

## References

- `docs/SPEC.md` §15 — Slice 3 spec (G2 approved)
- `docs/ARCHITECTURE.md` B1–B9 — Slice 3 architecture (G3)
- `docs/PRE-MORTEM.md` Slice 3 entry — failure modes and pre-commitments (G3)
- `https://kilo.ai/docs/gateway/api-reference` — Kilo Code API contract
- `https://kilo.ai/docs/gateway/authentication` — Kilo Code auth mechanism
- `docs/adr/0021-anima-fork.md` — the fork pattern this slice parallels (selector upstream of contract)
- `docs/adr/0018-populate-with-ai-actions-mood-lighting.md` — the per-field pattern that the `buildVisionMessage` helper consolidates

---

## Closeout (2026-09-03 — Session #12)

### Status
**Accepted → Implemented.** All Slice 3 sub-slices (3.1 server-side migration, 3.2 helper consolidation, 3.3 frontend model selector, 3.4 endpoint wiring, 3.5 cleanup) are shipped.

### Implementation history
- `2568fad` (2026-08-05): paperwork land + drift-discovery note (server-side wiring only; frontend unwired)
- `5ab78d2` (2026-08-04): server-side `model: llmModel` binding in 8 route handlers
- `7a16088` (2026-09-03): chat-recovery refactor (Fix 1–3) — server-side, `buildKiloChatBody`, schema-drop retry
- `c850101` (2026-09-03): frontend wiring — `state.llmModel`, `ALLOWED_LLM_MODELS`, persistence, URL mirror, `renderLlmModelSelector`, 4-endpoint forwarding
- `2956fe2` (2026-09-03): paperwork closeout — §15 spec, ARCHITECTURE appendices, PRE-MORTEM, SESSION-STATE #11 + #12

### Verification (post-implementation)
- `tests/run-all.js`: **402 passed, 0 failed** (was 382/13 pre-Session #11; was 393/9 post-`7a16088`)
- `scripts/session-init.js`: **10/10 V-checks pass**
- `node --check server.js && node --check src/app.js`: exit 0
- `grep -n "callMiniMax" server.js`: 0 results ✓
- `grep -n "minimaxi.chat" server.js`: 0 results ✓
- `grep -n "MINIMAX_.*=" server.js`: 0 results ✓
- **Manual demo (deferred):** see `docs/CODE-REVIEW-10-slice-3-closeout.md` follow-up #2 — visual smoke test deferred to next slice that builds on Slice 3
- **Code review:** See `docs/CODE-REVIEW-10-slice-3-closeout.md` — verdict: **PASS** (with minor follow-ups)

### Drift-discovery retrospective
The Slice 3 paperwork was landed in `2568fad` with ship verdicts (Accepted / pass / PASS) but the `src/app.js` JS wiring was missing — a paperwork/code drift that persisted across Sessions #8–#11. The drift was surfaced by `tests/run-all.js` (9 failing Slice 3.3 / 3.4 tests) and persisted by parking the wiring as "background drift" rather than scheduling it as its own sub-slice.

**Lesson:** Slice 3 was too big to be one paper artifact. The five sub-slices (3.1–3.5) should each have had their own G4 review and commit cycle. Future slices with ≥3 sub-seams should consider sub-slice G4 gates.

### What's parked (next session)
- **Multi-provider slice** (the original user request): tri-provider routing across Kilo Code / MiniMax / Alibaba Cloud. Parked in `docs/BACKLOG.md`. ADR 0023 candidate.
- **Visual-demo gate** (manual smoke test) — deferred to next slice that builds on Slice 3 per `CODE-REVIEW-10` follow-up #2.
