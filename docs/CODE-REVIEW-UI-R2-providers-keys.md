# CODE-REVIEW — Slice UI-R2 (Providers & keys)

**Verdict:** pass
**Scope:** `server.js` (key store, resolution order, 4 endpoints, redaction), `docs/adr/0024-provider-key-storage.md`, `src/shell.js` §4–5, `scripts/smoke/provider-key-store.smoke.js`, README endpoint table.

## Standards axis
- Keys never serialized to the browser (mask only) — asserted in smoke + run-all.
- File mode 0600 verified on disk; `.gitignore` entry added.
- Env precedence + 409-on-env-DELETE + 404-on-unknown verified via smoke.
- Full lifecycle exercised in a real browser: save → badge/dot update → remove.
- 21 legacy kilo guards untouched; module-level creds re-synced from store (ADR 0024).

## Spec axis
- §6.1–6.5 fully covered, including inline Create warning with `Add key →` deep link + `return=create` (verified live: warning appears at the provider control, never as a distant toast).

## Notes
- `isProviderLive` arms MiniMax/Alibaba when a credential exists — stored keys are functional, not decorative.
