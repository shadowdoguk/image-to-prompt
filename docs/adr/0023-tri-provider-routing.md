# ADR 0023 — Tri-provider routing (Kilo Code / MiniMax / Alibaba DashScope)

**Status:** Accepted
**Date:** 2026-09-03
**Origin:** Slice 4 (`docs/SPEC.md` §16) — original multi-provider ask from Session #0 (2026-07-29), deferred through Slice 3 closeout (Sessions #8–#12), now landing.

---

## Context

Slice 3 (ADR 0022) shipped Kilo Code as the sole LLM provider with model selection within Kilo's 6-model catalog. The user's original ask (Session #0) was for **multi-provider routing** — the ability to pick the underlying vendor (Kilo Code's aggregator vs. direct MiniMax vs. Alibaba's DashScope) and the model within that vendor. The Slice 3 closeout prioritized drift resolution over feature expansion; Slice 4 lands the multi-provider dimension.

The three providers differ in:
1. **Request format** — Kilo Code is OpenAI-compat (`/chat/completions`). MiniMax has a custom `/text/chatcompletion_v2` shape. Alibaba DashScope is OpenAI-compat (`/compatible-mode/v1/chat/completions`) but with a different base URL.
2. **Auth header** — All three use `Authorization: Bearer ${API_KEY}`, but the keys come from different env vars (`KILO_API_KEY`, `MINIMAX_API_KEY`, `DASHSCOPE_API_KEY`).
3. **Response envelope** — Kilo Code: `{ choices: [{ message: { content } }] }`. MiniMax: `{ reply }`. DashScope: `{ output: { choices: [{ message: { content: [...] } }] } }` where content is an array of `{ text }` parts.
4. **Rate limits** — Per-provider, surfaced as 429.
5. **Pricing** — Per-provider, surfaced as response metadata.

Without a provider abstraction, route handlers would need `if (provider === 'kilo_code') … else if …` branches scattered across 10 call sites.

## Decision

Introduce a thin **provider abstraction layer** in `server.js`:

```javascript
// Three adapters, each owns its own request shape + auth + response parsing.
const callKiloProvider = (model, messages, options) => { /* OpenAI-compat */ };
const callMiniMaxProvider = (model, messages, options) => { /* MiniMax shape */ };
const callAlibabaProvider = (model, messages, options) => { /* DashScope shape */ };

// Dispatcher — normalizes all three into one shape.
const callProvider = async (provider, model, messages, options = {}) => {
  const adapter = { kilo_code: callKiloProvider, minimax: callMiniMaxProvider, alibaba: callAlibabaProvider }[provider];
  if (!adapter) return { ok: false, error: `Unknown provider: ${provider}` };
  return adapter(model, messages, options);
};
```

**Provider allowlist** is the source of truth for both the dispatcher and the frontend:

```javascript
const ALLOWED_PROVIDERS = ['kilo_code', 'minimax', 'alibaba'];
const ALLOWED_LLM_MODELS_BY_PROVIDER = {
  kilo_code: ['minimax/minimax-m3', 'openai/gpt-5.6-luna', 'google/gemini-3.1-pro-preview', 'google/gemini-3.5-flash', 'nvidia/nemotron-3-ultra-550b-a55b', 'x-ai/grok-4.3'],
  minimax: ['MiniMax-M1'],
  alibaba: ['qwen-vl-max', 'qwen-vl-plus']
};
```

**Resolver** is chained, mirroring Slice 3.3's `resolveModel`:

```javascript
const resolveProviderAndModel = (body) => {
  const rawProvider = typeof body.provider === 'string' ? body.provider : 'kilo_code';
  const rawModel = typeof body.model === 'string' ? body.model : (typeof body.llmModel === 'string' ? body.llmModel : 'minimax/minimax-m3');
  // Backwards compat: requests with no provider default to kilo_code (preserves Slice 3 wire shape).
  const provider = ALLOWED_PROVIDERS.includes(rawProvider) ? rawProvider : 'kilo_code';
  const allowed = ALLOWED_LLM_MODELS_BY_PROVIDER[provider] || [];
  const model = allowed.includes(rawModel) ? rawModel : allowed[0];
  return { provider, model };
};
```

**Stub gating** for testability + safe defaults:

```javascript
const isProviderLive = (provider) => {
  if (provider === 'kilo_code') return true; // Kilo Code is always live (Slice 3 ship state).
  const envVar = `${provider.toUpperCase()}_LIVE`;
  return process.env[envVar] === '1';
};
```

When `isProviderLive(provider)` returns false, the adapter returns a **deterministic stub** with the correct shape but canned content. This:
- Keeps the architecture provably correct via tests without burning API budget.
- Lets the user deploy with Kilo Code only and add MiniMax/Alibaba by setting one env var each.
- Avoids the "the third provider is a half-implementation" risk that haunts optional integrations.

## Alternatives considered

### A. Hardcode three independent call paths (no abstraction)
**Rejected.** Doubles the route-handler complexity for every endpoint (10 call sites × 2 conditional branches = 20 paths to maintain). Violates the per-field / single-source-of-truth pattern established by ADR 0018 and ADR 0021.

### B. Use a third-party LLM-routing library (e.g. LiteLLM, Portkey)
**Rejected.** Adds a dependency for a feature that's three adapters and a dispatcher. The abstraction is simple enough that a library is more surface than value. Re-evaluate if Slice 5+ adds a fourth provider.

### C. Only add the provider selector UI; keep Kilo Code as the only backend
**Rejected.** Defeats the purpose. The whole point is to route to MiniMax direct (cost optimization) and Alibaba (Qwen models). UI without backend routing is decorative.

### D. Provider-as-flag on each route handler (no dispatcher)
**Rejected.** Spreads provider logic across 10 call sites. Same as A but worse — no central allowlist, no central stub gating, no central retry policy.

## Consequences

### Positive
- **Route handlers stay clean.** They call `callProvider(provider, model, …)` and consume the normalized `{ ok, content, raw, error }` shape.
- **Frontend can swap providers without backend changes.** Adding a fourth provider is one new adapter + one new entry in `ALLOWED_PROVIDERS` + one new set of `<option>` tags.
- **Test budget is bounded.** Stub gating means new provider tests don't hit the network.
- **BYOK (bring-your-own-key) is trivially supported later.** The `apiKey` param to `callProvider` could come from the user session instead of `process.env`.

### Negative
- **Three response shapes to maintain in the codebase.** Each adapter has its own parser. Risk: parser drift if a provider changes their response format.
- **Auth complexity.** Three different env vars. Risk: a key rotated in one provider's console but not in the env file goes silently live as a 401.
- **Stub-vs-live distinction in error messages.** A stub returns a `provider_not_live` error; a live call returns the actual provider's error. The frontend needs to distinguish (e.g. `error.code === 'stub'` → show a "set env var" message).

### Neutral
- **Code churn.** 10 call sites change from `model: llmModel` to `model: model, provider: provider`. Mechanical, but visible in the diff.

## Verification

Verification commands (to be run post-implementation):

- `node tests/run-all.js` — 402 + ~28 = ~430 passing, 0 failing.
- `node scripts/session-init.js` — 10/10 V-checks pass.
- `node --check server.js && node --check src/app.js` — exit 0.
- `grep -n "provider === 'kilo_code'" server.js` — only inside `callKiloProvider` (no scattered conditionals).
- `grep -n "ALLOWED_PROVIDERS" server.js` — defined once, referenced by `resolveProviderAndModel` + dispatcher.
- Manual demo: open the app in a browser, switch provider from `kilo_code` to `minimax`, verify the model `<select>` swaps to one option, generate, verify the response envelope `provider` field reads `minimax`.
- Manual demo: repeat with `alibaba`. Capture screenshots.
- Manual demo: with `MINIMAX_LIVE` unset, generate using `minimax` provider; verify the response indicates stub mode.
- Code review: `docs/CODE-REVIEW-11-slice-4.md` verdict: `pass` or `pass+minor`.

## References

- `docs/SPEC.md` §16 — Slice 4 spec (G2 approved)
- `docs/adr/0022-kilo-code-provider.md` — Slice 3 (predecessor; Kilo Code is now one of three providers, not the only one)
- `docs/adr/0021-anima-fork.md` — the fork pattern this slice parallels (selector upstream of contract)
- `docs/adr/0018-populate-with-ai-actions-mood-lighting.md` — the per-field pattern
- `docs/CODE-REVIEW-10-slice-3-closeout.md` follow-up #2 — visual-demo gate deferred to this slice per BACKLOG pre-commitment
- `docs/BACKLOG.md` — Slice 4 entry, pre-committed in Session #12
- MiniMax API docs: `https://platform.minimaxi.com` (chat-completion-v2 endpoint)
- Alibaba DashScope docs: `https://help.aliyun.com/zh/model-studio` (OpenAI-compatible mode)
