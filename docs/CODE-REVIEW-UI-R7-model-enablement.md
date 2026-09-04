# CODE-REVIEW — Slice UI-R7 (Model enablement manager)

**Verdict:** pass
**Scope:** `server.js` (model-config store, `GET /api/models`, `PUT /api/providers/:id/models`, `resolveProviderAndModel` enforcement, `buildProviderStatusList`), `src/app.js` (dropdown source), `src/shell.js` (`renderModelsView` / `wireModelManager` / `refreshModelDropdowns`), `src/index.html` (nav tab + view), `src/styles.css`, `tests/run-all.js` (6 new UI-R7 tests + 1 augmented UI-R1 view-container assertion), `README.md` (two new endpoint rows).
**Directive:** direct user instruction, 2026-09-04 — dedicated model management screen, add/remove UI, persistent configuration, dropdown enforcement, end-to-end verification, last-model guard with clear error feedback.

## Standards axis
- **Single source of truth:** `getEnabledModels(id)` is the only model allowlist consulted by `resolveProviderAndModel` and `buildProviderStatusList`; `ALLOWED_LLM_MODELS_BY_PROVIDER` is now only the catalog (built-in default). When the stored config is empty, the catalog is the default enabled set, preserving Slice 3/4 wire compatibility (all 6 Kilo models, `MiniMax-M1`, `qwen-vl-max`+`qwen-vl-plus`).
- **No data-loss for tampered/missing config:** `loadModelConfig` falls back to `{}` on read error or corrupt JSON, same pattern as `loadProviderKeys`. Corrupt entries inside a provider block are filtered out; an empty `enabled` array reverts to the universe (parity with the 409 guard's intent: never leave the app broken on disk).
- **Front-end ↔ server atomicity:** the manager renders one card per provider from `GET /api/models`; every mutation round-trips through `PUT /api/providers/:id/models` and the view is re-rendered from the server's response. Optimistic UI flips are reverted by re-render if the server rejects — verified in the browser.
- **Dropdown propagation:** `refreshModelDropdowns()` writes the global `window.__i2pEnabledModelsByProvider`, then rebuilds `#llm-model-selector` (Create) and `#settings-llm-model` (Settings). `app.js`'s `validateLlmModel` / `rebuildLlmModelSelectorOptions` now read the same global; the static `ALLOWED_LLM_MODELS_BY_PROVIDER` is kept as the boot-time fallback so the dropdowns work before the first fetch resolves.
- **Security:** no API keys or model secrets touch this surface; custom-model IDs are bounded to 120 chars and validated as strings; `escapeHtml` covers every interpolated attribute (data-model, badge label, etc.).
- **File safety:** store written 0600 (`saveModelConfig` mirrors `saveProviderKeys`), test seam via `MODEL_CONFIG_FILE` env var (mirrors `PROVIDER_KEYS_FILE`).
- **No new dependencies, no stack changes, no symbol renames.** Pure additive slice.

## Spec axis (user directive)
1. **Dedicated configuration screen with categorization by provider** — `#/models` renders one card per provider (Kilo Code / MiniMax direct / Alibaba DashScope) using the `buildProviderStatusList` labels; nav tab added with focus-trap & tablist semantics; title `view-sub` makes the constraint explicit.
2. **Intuitive controls** — every built-in and custom model is a checkbox (`<input type="checkbox" class="model-toggle">`) with its ID shown as `<code>` and a `custom` badge for non-catalog entries; the per-card "Add a custom model" input + button adds custom IDs; each custom row gets a `Remove` button. ARIA: `aria-live="polite"` status slot per card; live region announce on save.
3. **Persistent storage** — `data/model_config.json`, shape `{ [providerId]: { enabled, custom } }`. Disk content confirmed across the E2E (mutate → `readFileSync` → assert).
4. **Dropdown enforcement** — `resolveProviderAndModel` now filters against the enabled set; `/api/providers` returns only enabled models; Create + Settings dropdowns rebuilt from the same set on every change. Tampered `llmModel` falls back to `effectiveDefaultModel` (which itself falls back to first enabled).
5. **End-to-end** — four browser scenarios confirmed (disable / add custom / remove custom / last-model guard) plus dropdown rebuild across both views.
6. **Last-model guard with clear feedback** — `PUT` returns `409` with message `"<Provider label> needs at least one enabled model — disabling the last model would break generation with this provider."`; UI surfaces it in the per-card status slot, then reverts the toggle from the server's response. Verified live: the message rendered verbatim and the toggle visually rolled back to `checked`.

## Test suite
- **6 new UI-R7 tests, all green:**
  - `GET /api/models exposes catalog, custom, enabled, defaultModel per provider`
  - `HTTP: enable/disable persists to disk and drives /api/providers`
  - `HTTP: custom models add, enable, remove; validation errors are clear` (catalog collision, empty ID, duplicate all rejected)
  - `HTTP: last-model guard refuses to disable the final model (409)` — config unchanged after refused request
  - `HTTP: default falls back to first enabled when hardcoded default is disabled`
  - `static: Models view wired into nav, shell, and app.js dropdown source`
- Augmented `UI-R1` view-container test from 5 → 6 containers (`view-models`).
- Final run: **435 passed, 4 failed.** Three failures are the pre-existing live-LLM/`generate-prompt` flakes (clean baseline the same day had 9 of the same class — no regression). The fourth was the `README documents endpoints…` test failing because the two new endpoints weren't listed — fixed by adding `GET /api/models` and `PUT /api/providers/:id/models` rows.

## E2E evidence (browser, 2026-09-04)
1. Initial DOM audit: 3/3 cards present (Kilo 6 toggles, MiniMax 1, Alibaba 2); every toggle enabled; add-custom input + button on each; counts read `6 of 6` / `1 of 1` / `2 of 2`; `nav-models` tab present; `view-models` shown.
2. **Disable Grok on Kilo:** toggle off → server PUT → Create `#llm-model-selector` rebuilt without `x-ai/grok-4.3`; Settings dropdown rebuilt on `settings-provider` change to show MiniMax's single model; card count drops to `5 of 6`.
3. **Add custom to MiniMax:** `custom/MiniMax-Flash-Test` → card row appears with `custom` badge + `Remove` button, auto-enabled, count reads `2 of 2`.
4. **Remove custom:** click `Remove` → row gone, customs 1 → 0, count back to `1 of 1`.
5. **Last-model guard:** uncheck MiniMax's only model → status slot displays the clear error message; server rejects with 409; UI re-renders from server response so the toggle visually rolls back.
6. **Cleanup:** re-enable Grok; `GET /api/models` shows restored defaults (6/1/2 enabled, 0 customs); console clean.
7. **Settings provider swap:** changing `settings-provider` triggers `refreshModelDropdowns()`, so Settings dropdown is rebuilt from the active enabled set on every change.

## Notes
- ADR criteria (PRINCIPLES §8) reviewed — the per-provider last-model guard is a hard-to-reverse rule and the user-facing rejection is genuinely surprising (a setting that "would break the app" is exactly the kind of ADR-worthy fact that the next developer would wonder about). ADR to be filed under `docs/adr/0025-…` as a follow-up; for this slice the decision is documented inline in `docs/SPEC.md` and the code review.
- `window.__i2pEnabledModelsByProvider` is intentionally a plain global: it survives the `shell.js` → `app.js` ordering and doesn't require a new event bus. If a third caller appears, the right refactor is a shared `state` module, not a fourth ad-hoc global.
- The static-HTML `<option>` list in `index.html` (Create) and the static `ALLOWED_LLM_MODELS` array in `app.js` are now redundant with the enabled-models config; they're kept as the boot-time fallback (before the first `/api/models` fetch resolves) and will be removed in a later slice.
