# CODE-REVIEW — Slice UI-R6 (Provider settings: full editability + always-on test buttons)

**Verdict:** pass
**Scope:** `server.js` (PUT/DELETE key handlers, `buildProviderStatusList`), `src/shell.js` §5 (Providers & keys view), `src/styles.css`, `tests/run-all.js` (5 new UI-R6 tests).
**Directive:** direct user instruction, 2026-09-04 — full field editability in every provider state + functional test button per provider, verified end-to-end.

## Standards axis
- Keys still never serialized to the browser: mask only, key input always renders empty (`placeholder` signals "saved key active"). Asserted by existing ADR 0024 tests, unchanged and passing.
- `buildProviderStatusList` additive only: `defaultBaseUrl`, `envVar`, `hasStoredKey` added; no field removed (wire-compatible).
- PUT semantics hardened: `baseUrl` undefined/null keeps stored endpoint, `''` resets to default, non-http(s) rejected 400; omitted `apiKey` with a stored key preserves credentials (endpoint-only update), without one rejects 400. All four paths covered by the UI-R6 HTTP test.
- **Deliberate behavior change vs ADR 0024:** DELETE no longer returns 409 for env-sourced providers. The route only ever touches the local store, so a shadowed stored key is always removable from the UI; the env var itself is never modified by this route. Recorded here because UI-R2's review documented the 409.
- File mode 0600 + `.gitignore` protections untouched.
- `escapeHtml` covers every interpolated attribute (baseUrl value/placeholder, envVar note) — no injection surface introduced.

## Spec axis (user directive)
- All provider/key fields (API key, base URL/endpoint) editable in **every** state: env-configured, stored, unconfigured. Verified via DOM audit (`disabled:false, readOnly:false` on all 6 inputs across 3 cards).
- Test button present and functional on every card in every state. Verified live: kilo_code (env) test hit the real gateway and surfaced the provider's rate-limit message with timestamp; minimax/alibaba (stored) tests executed the validation workflow and surfaced `fetch failed` gracefully against dummy endpoints; unconfigured test returns `No key configured` without erroring.
- API modifications save: key + custom endpoint round-tripped on disk (`data/provider_keys.json`), endpoint-only edit preserved the stored key and `addedAt`.
- Remove restores unconfigured state; empty-key save on an unconfigured provider shows an inline guard, never a request.

## E2E evidence (browser, 2026-09-04)
1. DOM audit: 3/3 providers × (key input + baseUrl input + Save + Test) present and enabled.
2. kilo_code env card: badge no longer says "(locked)"; precedence note names `KILO_API_KEY`; Test → gateway responded (rate-limited) → result rendered with latency/timestamp.
3. minimax unconfigured → saved `eyJ…` key + custom endpoint → badge flipped to `● Key saved here · eyJ…3456`, disk confirmed.
4. minimax configured → endpoint-only update (key field empty) → endpoint changed, key mask + `addedAt` unchanged on disk.
5. Test buttons in configured state → validation ran, error surfaced, button restored.
6. alibaba save → test → remove; minimax remove; both badges back to `○ No key`; data file restored to `{}`.
7. Console: zero errors/warnings across the session.

## Test suite
- 430 passed / 3 failed. The 3 failures are the pre-existing live-LLM `generate-prompt` tests hitting the currently rate-limited Kilo gateway — a clean `HEAD` worktree baseline the same day produced **9** failures of the same class. No regression introduced; 5 new UI-R6 tests all pass.
- `provider-key-store` smoke passes (no 409 dependency).

## Notes
- Env precedence is preserved end-to-end (`resolveProviderCredential` untouched): saved values on an env-active provider are held ready and the UI says so, instead of locking the user out.
- `badge--locked` CSS class retained as styling-only for env cards; wording purged.
