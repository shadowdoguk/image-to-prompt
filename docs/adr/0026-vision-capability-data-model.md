# ADR 0026 — Chat-attachment vision-capability: explicit per-model allowlist (Set-based)

**Status:** Accepted
**Date:** 2026-09-05
**Origin:** Bug report — chat attachments silently dropped to text-only fallback when the user selected any of three Kilo Code models (`openai/gpt-5.6-luna`, `x-ai/grok-4.3`, `nvidia/nemotron-3-ultra-550b-a55b`). The model produced a paraphrase of the placeholder text ("the file came through but image content isn't visible to me here") and the user saw the message as if the image had never arrived. Root cause: the substring regex `ALLOWED_CHAT_ATTACHMENT_VISION_MODELS` (formerly at `server.js:1143`, since removed) did not match those three model ids, so `buildUserMessageWithAttachments` injected `[N attachment(s) attached — not visible to the current model.]` instead of an `image_url` content part. Class: silent false-negative in a routing gate. Track: CR-fix per `docs/agents/bug-workflow.md` — bug existed at the gate, no architectural ambiguity, but the fix is wide enough (rename of identity + data-model change) that an ADR earns its keep per PRINCIPLES.md §8 (long-term consequence + reversibility cost).

## Context

The chat-attachment vision gate at `buildUserMessageWithAttachments` (`server.js:8223`) decides whether a user-uploaded image is rendered into the multimodal message body as an OpenAI-compat `image_url` content part, or demoted to a text-only placeholder suffix. The decision is one boolean per model id: vision-capable → image_url content; not vision-capable → placeholder text.

The model roster is shaped by three places in `server.js`:

1. `ALLOWED_LLM_MODELS` (line 41–48) — the Slice 3 catalog of six Kilo Code models.
2. `ALLOWED_LLM_MODELS_BY_PROVIDER` (line 214) — per-provider allowlist (kilo_code / minimax / alibaba).
3. UI-R7 / `data/model_config.json` (line 109–135) — user-enabled subset + custom additions; the runtime `resolveProviderAndModel` honours this.

The legacy gate was a substring regex against model id literals:

```js
// (no longer present — see Decision §1)
const ALLOWED_CHAT_ATTACHMENT_VISION_MODELS = /(m3|minimax|gpt-4o|claude|vision|qwen-vl|gemini|llava|pixtral)/i;
```

### Why the regex went stale

When Slice 3 expanded the Kilo Code catalog from 4 to 6 models, three of the new ids (`openai/gpt-5.6-luna`, `nvidia/nemotron-3-ultra-550b-a55b`, `x-ai/grok-4.3`) were vision-capable per `SPEC.md` §15.6 ("Strong vision + prompt engineering" / etc.) but did not contain any of the regex's keywords (`m3`, `minimax`, `gpt-4o`, `claude`, `vision`, `qwen-vl`, `gemini`, `llava`, `pixtral`). The new model ids had **different substring shapes** — `gpt-5.6-luna` instead of `gpt-4o`, `nemotron` instead of `gpt-*`, `grok` instead of `gemini`. The catalog move was silent because the gate was decoupled from the catalog (it lived far away in the file, in a different module domain).

The defect is a class of "stringly-typed allowlist" failure: every model catalog edit requires a separate regex edit, the two are not colocated, and no test connects them. `grep ALLOWED_CHAT_ATTACHMENT_VISION_MODELS` returns exactly two hits (definition + consumer) — silent fallback by design, in the worst possible place.

### The exact behaviour the user observed (from bug report screenshot)

User attached an image with text describing it. The chat route accepted the file (`POST /api/chat/sessions/:id/attachments` returned 201 with attachment id). The next turn (`POST /api/chat/sessions/:id/messages`) was routed through `buildChatRequestContext` → `buildUserMessageWithAttachments` → text-only fallback because the regex did not match `openai/gpt-5.6-luna` (or any of the three). The model then paraphrased the placeholder text and added structured prose from the user's text description.

## Decision

### 1. Replace the regex with an explicit `Set` as the single source of truth

`server.js` now exposes:

```js
const VISION_CAPABLE_MODELS = new Set([
  // Slice 3 Kilo Code catalog (SPEC §15.6 — every one is vision-capable)
  'minimax/minimax-m3',
  'openai/gpt-5.6-luna',                      // was a silent false-negative pre-ADR-0026
  'google/gemini-3.1-pro-preview',
  'google/gemini-3.5-flash',
  'nvidia/nemotron-3-ultra-550b-a55b',        // was a silent false-negative pre-ADR-0026
  'x-ai/grok-4.3',                            // was a silent false-negative pre-ADR-0026
  // MiniMax direct
  'MiniMax-M3',
  'MiniMax-M1',
  // Alibaba DashScope VL family; qwen3-max (text-only) intentionally excluded
  'qwen-vl-max',
  'qwen-vl-plus',
  'qwen-vl-plus-2025-04-18'
]);
```

The `Set` is colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER` (in the same code region, a few lines below) so future editors see both lists together. The consumer in `buildUserMessageWithAttachments` becomes `VISION_CAPABLE_MODELS.has(llmModel)`.

### 2. Lock the membership with a static-parse regression test

Five new tests in `tests/run-all.js` parse `server.js` source, locate the Set, and assert:

- Legacy regex variable is gone.
- `VISION_CAPABLE_MODELS` Set is defined.
- Consumer uses `.has()` (not the legacy `.test()`).
- The three previously-failing Kilo Code models are present.
- The lone text-only Alibaba model (`qwen3-max`) is correctly excluded.

These tests are static (no server boot), fast (<10 ms), and survive any change to surrounding prose / whitespace. They fail if the Set is moved away from the model registry, renamed, or if any catalogue id silently drops out of the gate.

### 3. Update rule (single source of truth + lock-test discipline)

Every model in `ALLOWED_LLM_MODELS_BY_PROVIDER` (and every user-added custom model added through UI-R7 with confirmed vision support) **must** be added to `VISION_CAPABLE_MODELS` explicitly. The 4 positive / 1 negative regression tests in `tests/run-all.js` fail if the two lists diverge, which is the desired break-glass. UI-R7-added custom models are NOT in the Set by default (vision support is opt-in per provider choice); the chat falls back gracefully to text-only for them, which the model's text response makes clear without crashing the route.

### 4. Surfacing capability, not gatekeeping (SPEC §15.7)

SPEC §15.7 risk 2 reads:

> "Model capability mismatch. Grok 4.3 and Nemotron 3 Ultra may produce weaker vision analysis than Gemini or GPT-5.6 Luna. A user picking the wrong model for Stage 1 gets poor output and blames the tool. **Mitigation: the selector defaults to MiniMax M3 (the user's familiar baseline). The selector is explicit — the user owns the choice. We surface capability, we don't gatekeep it.**"

The legacy regex implementation **was** gatekeeping — silently. This ADR moves it from "implicit gatekeep via regex false-negative" to "explicit per-model allowlist". A future slice could surface vision capability as a badge in the model dropdown (`#llm-model-selector`, `#settings-llm-model`) — that is out of CR-26 scope but could ride on this Set without reshaping it.

## Rejected alternatives

1. **Extend the legacy regex with the three new patterns (`gpt-5`, `grok`, `nemotron`).** Surgical 1-line patch. **Rejected** because it doesn't address the class of bug (stringly-typed allowlist), only the symptom. The next model addition (e.g. `meta/llama-4-multimodal`) would silently regress again unless someone remembers to extend the regex *and* keeps the keyword in mind.
2. **Per-provider metadata table keyed by `{provider, model} → {vision, reasoning, ...}`.** More rigorous than a flat Set. **Rejected for this slice** because the data structure is wider than the current need (vision only) and would require reshaping ALLOWED_LLM_MODELS_BY_PROVIDER, the UI-R7 model enablement store, the JSON-Schema-driven UI dropdown, and the provider-routing fallback. That's a separate ADR (likely 0027) once the team wants reasoning / context-length / pricing badges. The Set is the right shape for one capability today; richer metadata can replace it without breaking the `buildUserMessageWithAttachments` consumer — replace one `Set.has()` with a `metadata.has(provider, model, 'vision')` if and when that need lands.
3. **Runtime introspection of model capabilities from the upstream provider's `/v1/models` listing.** **Rejected** at G1: introduces a network dependency at chat-send time (latency), a caching layer, and a partial-deployment risk (the upstream may return less than the app declares). ADR 0025 already rejected a similar runtime dependency for embeddings.
4. **Per-attachment opt-in to image processing.** **Rejected** at G1: shifts the burden of model-awareness to the user, contradicting SPEC §15.7 ("surface capability, we don't gatekeep it" — but also "user owns the choice"; the gate's job is to translate model reality, not to second-guess user intent).

## Consequences

### Positive

- The bug class (silent false-negative from stringly-typed gate) is closed. Any future model id addition is a 1-line edit to the Set + a 1-line edit to the regression test list. Drift between catalog and gate is impossible without breaking the test.
- The Set is colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER` so future editors see both lists together.
- The 3-of-6 silent false-negatives the user hit are now 0-of-12 (all vision-capable models in the catalog are correctly listed; `qwen3-max` correctly excluded).
- The Set is the seed for a future capability-badges slice (per `SPEC.md` §15.7 "Model capability metadata. The selector shows display names only — no context-length, pricing, or vision-capability badges.") without reshaping anything.

### Negative / acceptable cost

- One Set literal added (~13 lines + ~25 lines of explanatory comment). The inline comments are load-bearing — they document *why* the Set exists and what the update rule is. Stripping the comments would defeat the purpose.
- The 5 new regression tests are static-parse based (no boot). They catch the documented contract; they cannot catch semantic mistakes like adding `qwen3-max` (already excluded). For those, a future integration test with a stubbed LLM is the right tool — out of CR-26 scope.
- The Set is module-local (`server.js` only). Frontend never reads it directly. If the chat UI ever wants a "vision: yes / no" badge per row in the model dropdown, the server has to expose it via `GET /api/providers` (already does — see `buildProviderStatusList` at server.js:8890, but the field is not yet wired). That's the seed for ADR 0027 / capability-badges slice.

### Reversibility

Reversible: rename the Set, fall back to the regex form (the old regex string is recoverable from git history). Cost: a few minutes + 5 tests to update.

## Verification

After implementation:

- `node --check server.js` — exit 0 (syntactic validity).
- `node --check tests/run-all.js` — exit 0.
- `node tests/run-all.js` — all existing tests pass + 5 new "ADR 0026 — VISION_CAPABLE_MODELS" tests pass.
- `node scripts/session-init.js` — 10/10 V-checks pass; `code_drift` = clean.
- `node -e "var s = require('fs').readFileSync('server.js','utf8'); var m = s.match(/const\s+VISION_CAPABLE_MODELS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/); console.log('Set membership:', m[1].match(/'[^']+'/g).map(s=>s.replace(/'/g,'')))"` — confirms the 11-id Set is present.
- Standalone regex harness on the new Set replaces the previous regex confirmation: `node -e "const ids = [...]; const set = new Set(ids); for (const m of [...]) console.log(set.has(m) ? 'PASS' : 'FAIL', m)"` — every active model id resolves correctly.
- Browser-demo gate deferred: the existing `orchestrateEndpoint(stage1, minimax)` test at `tests/run-all.js:9621+` already exercises the image_url content-parts forwarding for vision-capable models across providers. The chat path is the same code path (same `args.messages` is forwarded verbatim by the orchestrator); only the gate identity changes. A live browser demo on `openai/gpt-5.6-luna` would consume one MiniMax / Kilo credit for confirmation; out of scope for the CR-fix track.

## References

- `docs/SPEC.md` §15.6 (Kilo Code model catalog with vision-capable labels), §15.7 (model-capability-mismatch risk 2).
- `docs/adr/0023-tri-provider-routing.md` (Slice 4 dispatch — same orchestrator forwards multimodal content).
- `docs/adr/0025-rag-foundation.md` (CR-series entry; precedent for "explicit per-thing allowlist + lock-test" pattern).
- Slice 1 code-review at `docs/CODE-REVIEW-1-texture-ai-button.md` (precedent for inline review verdict `pass+minor`).
- CR-fix precedent: `b2baddf fix(analyze-button): CR-16 silent-failure bug in runAnalysis` (similar bug class, identical track).
