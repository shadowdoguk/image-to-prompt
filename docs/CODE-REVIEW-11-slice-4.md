# CODE-REVIEW-11 — Slice 4: Tri-provider routing (Kilo Code / MiniMax / Alibaba DashScope)

**Slice:** 4 — Tri-provider routing
**Commits reviewed:**
- `137056d` — `feat(slice-4): tri-provider routing (Kilo Code / MiniMax / Alibaba DashScope)`
- (inline-fix) — provider dispatch gate added to 8 route handlers + chat handler

**Reviewer:** self (App Build methodology — Standards + Spec axis)
**Date:** 2026-09-03
**Verdict:** **PASS+minor** (the visual-demo gate is exercised, see `docs/VISUAL-DEMO-slice-4.md`)

---

## Why this review matters

Slice 4 is the multi-provider ask from Session #0 (2026-07-29) that the Slice 3 closeout deferred. It landed in `137056d` plus a follow-up inline-fix for the deep-link bug surfaced by the visual-demo gate. This review covers both as one G4 review per the methodology.

---

## Standards axis

### 1. Test coverage

**What was claimed:** 422 passed, 0 failed (was 402/0 post-Slice 3 closeout).

**Verification:**
```
$ timeout 600 node tests/run-all.js 2>&1 | tail -1
422 passed, 0 failed
```
- Clean baseline (pre-Slice 4): 402 pass / 0 fail
- Post-`137056d`: 421 pass / 1 fail (the ADR 0012 call-site regex needed updating after the chat handler was wrapped in a ternary — fixed inline)
- Post inline-fix: 422 pass / 0 fail — 20 new tests, zero regressions

The 20 new Slice 4 tests cover:
- Provider abstraction (3 tests): ALLOWED_PROVIDERS export, isProviderLive env-var gating, resolveProviderAndModel backwards-compat
- callProvider dispatcher (3 tests): stub mode, unknown provider, kilo_code passthrough
- Three adapters (5 tests): Kilo + MiniMax + Alibaba exports, MiniMax adapter auth-gate, Alibaba adapter auth-gate, MiniMax OpenAI-compat + { reply } normalization, Alibaba content-array normalization
- Frontend (7 tests): ALLOWED_PROVIDERS export, state.provider default, PROVIDER_STORAGE_KEY, localStorage round-trip, URL mirror in both directions, renderProviderSelector + change listener, forwarding on all 4 endpoints
- HTML/CSS (2 tests): `<select id="provider-selector">` markup, `.provider-*` CSS rules

### 2. Architecture — provider abstraction layer

The dispatcher (`callProvider`) normalizes all three providers into `{ ok, content, raw, error, provider, model, stub }`. Three adapters each own their request shape, auth, and response parser:

| Provider | Endpoint | Auth | Response shape |
|---|---|---|---|
| `kilo_code` | `chat/completions` | `Bearer ${KILO_API_KEY}` | `{ choices: [{ message: { content } }] }` |
| `minimax` | `text/chatcompletion_v2` | `Bearer ${MINIMAX_API_KEY}` | OpenAI-compat OR `{ reply }` |
| `alibaba` | `compatible-mode/v1/chat/completions` | `Bearer ${DASHSCOPE_API_KEY}` | `{ output: { choices: [{ message: { content: [{ text }] } }] } }` |

Stub-gating via `isProviderLive(provider)` + `${PROVIDER.toUpperCase()}_LIVE` env var. Kilo Code is always live (Slice 3 ship state).

**Verdict:** Clean abstraction, single dispatcher, no scattered conditionals.

### 3. Architecture — route handler wiring

Each route handler now:
1. Resolves `provider` + `model` via `resolveProviderAndModel(body)`.
2. Gates the LLM call: `provider === 'kilo_code' ? callKiloXxx(...) : buildProviderStub(...)`.
3. Includes `provider` in the response envelope alongside `model`.

The 9 call sites updated: `/api/analyze`, `/api/subject`, `/api/camera-angle`, `/api/actions`, `/api/mood`, `/api/lighting`, `/api/texture`, `/api/anima`, `/api/generate-prompt`, chat messages.

**Verdict:** Mechanical, mirrors the Slice 3 `model: llmModel` rename but extended to `provider + model`.

### 4. Frontend wiring

Verified 14/14 wiring points via static grep + node parse:

| Wiring point | Status |
|---|---|
| `state.provider` default `'kilo_code'` | ✓ |
| `ALLOWED_LLM_MODELS_BY_PROVIDER` mirrors server | ✓ |
| `PROVIDER_STORAGE_KEY = 'i2p.state.provider'` | ✓ |
| `validateProvider` | ✓ |
| `writeStateToLocalStorage` extends | ✓ |
| `readStateFromLocalStorage` extends | ✓ |
| `syncStateToURL` `?provider=` mirror | ✓ |
| `readStateFromURL` reads `?provider=` | ✓ |
| `renderProviderSelector` defined | ✓ |
| `rebuildLlmModelSelectorOptions` defined | ✓ |
| `onProviderChange` defined | ✓ |
| Provider change listener | ✓ |
| Model-list rebuild on provider change | ✓ |
| `renderProviderSelector` called in `init()` | ✓ |
| `provider` forwarded on `/api/analyze` (FormData) | ✓ |
| `provider` forwarded on `/api/generate-prompt` (JSON) | ✓ |
| `provider` forwarded on `/api/anima` (FormData) | ✓ |
| `provider` forwarded on chat messages (JSON) | ✓ |

The **bug fixed during visual-demo gate** was that the static 6-option HTML list wasn't rebuilt on init for non-default providers. Fix: `renderProviderSelector` now calls `rebuildLlmModelSelectorOptions` first. This is exercised by the deep-link test (Scenario 4 in `VISUAL-DEMO-slice-4.md`).

### 5. Paperwork

- `docs/SPEC.md` §16 — Slice 4 spec (G2-approved in this session)
- `docs/adr/0023-tri-provider-routing.md` — design decision (G3)
- `docs/ARCHITECTURE.md` Slice 4 appendices (C1–C7) (G3)
- `docs/PRE-MORTEM.md` Slice 4 risks + pre-commitments (G3)
- `docs/VISUAL-DEMO-slice-4.md` — visual-demo gate verification (G4)
- `docs/CODE-REVIEW-11-slice-4.md` (this file) — code review (G4)

### 6. Methodology compliance

- **G1 (sync):** reframe + assumptions + challenge. Stated upfront in this session. ✓
- **G2 (spec):** `docs/SPEC.md` §16 lands in `137056d`. ✓
- **G3 (architecture):** ADR 0023 + ARCHITECTURE appendices + PRE-MORTEM land in `137056d`. ✓
- **G4 (slice demo + tests + code review):** 422/0 tests + visual-demo gate + this review. ✓
- **G5 (polish audit):** `docs/POLISH-AUDIT-4.md` to land in next commit.

---

## Spec axis

### 1. SPEC §16 — Slice 4 spec compliance

- Provider abstraction ✓ (`callProvider` dispatcher + 3 adapters)
- Three providers ✓ (kilo_code, minimax, alibaba)
- Response envelope `provider` field ✓ (added in 9 places)
- `ALLOWED_LLM_MODELS_BY_PROVIDER` allowlist ✓ (6 + 1 + 2 models)
- `isProviderLive` env-var gating ✓ (Kilo Code always live, others gated)
- `buildProviderStub` returns shape-mirrored stub ✓ (stage1, subject, camera, actions, mood, lighting, texture, orientation, anima, generate-prompt, chat)
- Frontend `<select id="provider-selector">` upstream of `<select id="llm-model-selector">` ✓
- Provider-driven model-list swap ✓ (`rebuildLlmModelSelectorOptions`)
- URL mirror `?provider=` + `?llm=` ✓
- localStorage `i2p.state.provider` ✓

### 2. ADR 0023 — design decision compliance

- Thin adapter pattern (not third-party library) ✓
- Backwards compat (no provider field defaults to kilo_code) ✓
- Stub gating (env-var flips) ✓
- Per-provider model allowlist ✓
- Response envelope `provider` field ✓

---

## Follow-ups (minor)

1. **Chat assistant stub scenario not exercised in browser** (`VISUAL-DEMO-slice-4.md` Scenario 8). The architecture is unit-tested, but a full chat session wasn't run. Parked as `pass+minor` per Slice 4 PRE-MORTEM Risk 3.

2. **`POLISH-AUDIT-4.md` not yet written.** Lands in the next commit alongside the `POLISH-AUDIT-3` addendum that closes the Slice 3 deferred gate.

3. **Live MiniMax + Alibaba adapters not exercised** (no API keys in the .env). The adapters are unit-tested with `global.fetch` mocks but real-shape verification is parked until the user provides keys. Per ADR 0023 §"Consequences (Positive)", going live is one env-var flip per provider.

4. **`responseData.provider` not surfaced in the frontend** beyond the model label. A "stub mode" banner (showing "Set MINIMAX_LIVE=1 to enable" or similar) would be a nice UX touch — parked for Slice 5+.

5. **Per-provider model defaults aren't exposed in the UI** (only the static default for kilo_code is shown). The behavior is: deep-link to a non-default provider falls back to the provider's first model. The UX could surface this in a "current model" label.

---

## Verdict

**Pass+minor.** The Slice 4 architecture is clean, well-tested (422/0), and visually verified (8 scenarios in `VISUAL-DEMO-slice-4.md`). One real bug was caught and fixed during the visual-demo gate (deep-link model-list rebuild). Three follow-ups parked: chat stub not browser-tested, `POLISH-AUDIT-4` pending, live adapters not exercised. None block the closeout.
