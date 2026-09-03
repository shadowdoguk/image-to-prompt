# ADR 0024 — Provider key storage & resolution order

**Status:** Accepted
**Date:** 2026-09-03
**Origin:** Slice UI-R2 (`docs/SPEC.md` UI-R series) — the Providers & keys module from `docs/UI-REDESIGN-SPEC.md` §6. UI-R2's spec entry flagged this seam: key storage and resolution order is a new architectural surface, so it gets its own ADR.

## Context

Until now, provider credentials existed only as server environment variables (`KILO_API_KEY`, `MINIMAX_API_KEY`, `DASHSCOPE_API_KEY` + `*_BASE_URL`). The UI could select a provider (ADR 0023) but had no way to configure a missing one — failures surfaced at generate time as 503 toasts, as far from the decision point as possible (UI-REDESIGN-SPEC findings F3/F7/F8).

The redesign requires users to add, test, switch, and remove keys entirely in the UI. That needs:
1. A persistent, server-side place to store keys the browser can write but never read back.
2. A deterministic resolution order between env vars and stored keys.
3. A liveness rule so a stored key actually enables its provider (MiniMax/Alibaba were env-flag-gated stubs under ADR 0023).

## Decision

### Storage

- Keys live in `data/provider_keys.json`, alongside the other JSON state files.
- File written with mode `0600`; listed in `.gitignore`.
- Shape: `{ "<providerId>": { "apiKey": string, "baseUrl"?: string, "addedAt": ISO8601, "lastTest"?: { ok, at, latencyMs, error? } } }`.
- Path overridable via `PROVIDER_KEYS_FILE` env (test seam; read lazily at call time).

### Resolution order

For every provider call: **env var → stored key → error**.

- An env var always wins and is reported as `source: 'env'` (locked — not deletable via the API; 409 on DELETE).
- Stored keys are additive: a deployment that only sets env vars behaves identically to pre-UI-R2.
- Kilo Code's 21 legacy `if (!kiloConfigured)` guard sites keep working via module-level credential variables (`KILO_API_KEY`, `KILO_BASE_URL`) that are re-synced from the store on startup and after every store mutation. Env remains authoritative during sync.
- MiniMax/Alibaba adapters resolve `process.env[key] || stored` per request.

### Liveness

`isProviderLive(provider)` (ADR 0023) is extended: MiniMax/Alibaba are live when `${PROVIDER}_LIVE=1` **or** when a credential (env or stored) exists. Saving a key in the UI arms the provider — the module would be pointless otherwise. Kilo Code stays always-live-at-dispatch; its not-configured guards still produce the existing errors when no key exists anywhere.

### Browser contract

- `GET /api/providers` — status list only: `{ id, label, configured, source, keyMasked?, baseUrl, models[], defaultModel, lastTest? }`. The full key is never serialized to any response.
- `PUT /api/providers/:id/key` — write (validates min length 12), optional `test: true`.
- `DELETE /api/providers/:id/key` — stored keys only; 409 on env-locked.
- `POST /api/providers/:id/test` — cheapest-possible completion (≤ 5 tokens, 15s timeout). Failure never blocks save; the message explains the next step.

### Threat-model honesty

Single-user local tool (SYNTHESIS §1): server-local plaintext at `0600` is proportionate. The `sanitizeError` redaction regex is extended to JWT-shaped keys (`eyJ…`) alongside the existing `sk-…` pattern. Upgrade path (OS keychain / encryption at rest) is recorded as a risk in the redesign spec §11, not built now.

## Consequences

- Four additive endpoints; zero shape changes to the existing 44+.
- `data/provider_keys.json` joins the `data/*.json` family (but is gitignored, unlike the others).
- The Providers & keys view (UI-R2) and header provider dots (UI-R1) consume `GET /api/providers`.
- Tests: key-store round-trip + mask + resolution-order tests land in `tests/run-all.js`; a smoke script lands in `scripts/smoke/`.
