# BACKLOG.md Template

**Usage:** Created in Phase 3. Anything not on the slice plan goes here, with a clear reason and a next step.

---

# Backlog: image-to-prompt

**Created:** 2026-07-29

This is **not** a TODO list. TODO is what's happening now. Backlog is what we *chose not to do* (yet).

---

## Why this exists

A slice plan is a contract. Backlog is the parking lot for everything we encountered but decided to defer. If you don't write things down, they re-litigate themselves later.

---

## Parked items

### Item: {{TITLE}}

- **Origin:** When did this come up? Which slice / which conversation?
- **Why parked:** {{REASON}}
- **To un-park, we'd need:** {{CONDITION}}
- **Estimated impact if pursued:** {{LOW / MED / HIGH}}

### Item: Slice 2.1 — Anima fork: model-state + UI selector (the pre-Generate picker)

- **Origin:** Session #3 (2026-08-03). User asked for an Anima prompt manual + a goose-review of the Anima model. The session re-shaped into a feature request: "extend the app so the upload flow also produces Anima positive + negative prompts alongside Z-Image Turbo." User chose a **pre-Generate model fork** (dropdown or button group before Generate, exclusive siblings) over a dual-output design. G1 was approved, followed by G2 (SPEC §14) and G3 (ARCH A1–A9, PRE-MORTEM Slice 2, ADR 0021). All three gates approved.
- **Why parked:** Slice 2.1 was mid-implementation when I surfaced a candid checkpoint (state fields + helpers + UI binding were in `src/app.js`, but no `dom.modelSelector` reference, no HTML markup, no `init()` restore call, no tests, no demo, no code review). Per AGENTS.md, a slice must not ship without a passing demo + a code-review verdict. The user picked **Option A** ("stop, revert the partial code, summarise") rather than finish mid-session. The partial code was reverted via `git checkout -- src/app.js`. The durable G2/G3 artifacts remain.
- **What's parked (and where the design lives):**
  - Sub-slice plan: `docs/SPEC.md` §14.9 (5 sub-slices 2.1 → 2.5).
  - Slice 2.1 design: `docs/ARCHITECTURE.md` A3 (Modules D + E), A6 decisions.
  - Slice 2.1 failure modes: `docs/PRE-MORTEM.md` Slice 2 entry (specifically failure modes 4 — state corruption — and 5 — license boundary).
  - The full fork decision: `docs/adr/0021-anima-fork.md`.
  - The contract source of truth: `docs/ANIMA-PROMPTING-MANUAL.md` §5, §7, §14.
- **To un-park, we'd need:** (a) a fresh session dedicated to Slice 2.1 implementation. The work is bounded: ~30 more lines of `src/app.js`, ~12 lines of `src/index.html` (model selector button group), ~20 lines of `src/styles.css` (`.model-selector` + `.is-active`), ~80 lines of `tests/run-all.js` (5 test groups), one `docs/CODE-REVIEW-2-anima-fork.md` (one-axis, since the slice is small). The user already approved the design at G3. The next concrete action is "open a fresh session, read the durable docs above, land Slice 2.1 to a demoable state."
- **Estimated impact if pursued:** **MEDIUM** — adds a real feature (the Anima fork), but bounded by the existing per-field pattern. No new dependencies, no schema migration, no server.js split. After Slice 2.1 lands, Slices 2.2 → 2.5 follow in sequence (per `docs/SPEC.md` §14.9 blocking edges).

### Item: {{TITLE}}

- **Origin:** When did this come up? Which slice / which conversation?
- **Why parked:** {{REASON}}
- **To un-park, we'd need:** {{CONDITION}}
- **Estimated impact if pursued:** {{LOW / MED / HIGH}}

(continue)

---

## Stretch items (from SPEC.md §7)

Items the user marked as "stretch" at gate G2. Parked by definition; revisit at end of MVP.

- {{STRETCH_1}}
- {{STRETCH_2}}

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Created | — |

(Append-only.)

| 2026-08-03 | Appended: Slice 2.1 (Anima fork) + Q3 re-opened | Session #3 — research + G1–G3 design approved; implementation stopped at user's choice (Option A revert) |
| 2026-08-03 | Appended: Slice 2.1 SHIPPED | Session #4 — Slice 2.1 (and the rest of Slice 2) shipped end-to-end. The parked item above is now closed. Per AGENTS.md "corrections are new entries, never edits," the parked entry is preserved as-is; this entry is the cross-reference. |
| 2026-08-04 | Appended: Anima coverage gap (camera/mood/lighting/posture), issue #23 filed | Session #8 — bug reported by user, filed as issue #23 (`bug`, `runtime`). Fix parked pending user direction: in-session fix vs. next-slice pass. Issue body fully populated with repro, root-cause hypothesis, suggested fix area, acceptance criteria. |

---

## Shipped items (append-only)

Parked items that have since shipped. The original Parked-items entry is preserved verbatim above; this section is the cross-reference.

### Item: Slice 2.1 — Anima fork: model-state + UI selector (the pre-Generate picker)

- **Shipped:** 2026-08-03 (commit `1756d0d` + code review `9e98a54`).
- **Within:** Slice 2 — Anima fork (ADR 0021). The parked-item entry above describes the design that was implemented. Slice 2.1 shipped as the first of 5 sub-slices (2.1 → 2.2 → 2.3 → 2.4 → 2.5); all five passed per-sub-slice review with verdict `pass`.
- **Aggregate verdict:** `docs/CODE-REVIEW-2-anima-fork.md` §Slice 2.5 — "Slice 2 ships."
- **Tests:** 373 / 373 passing (was 321 baseline; +52 net new tests).
- **Quantitative:** 5 sub-slices shipped, 1 ADR (0021) accepted, 5 new docs (1 manual + 4 design docs), 1 aggregate code review, 0 regressions, 0 new dependencies, 0 schema migrations.

### Item: Anima coverage gap — camera / mood / lighting / posture tags missing from `positive` output

- **Origin:** Session #8 (2026-08-04). User reported: "when an Anima prompt is generated it omits the camera angle, mood, lighting, and posture of the subject." Filed as issue [#23](https://github.com/shadowdoguk/image-to-prompt/issues/23), label `bug`, class `runtime`.
- **Why parked (decision pending):** The fix is bounded — one constant edit (`DEFAULT_ANIMA_PROMPT` in `server.js:3050-3117`) plus one new smoke file (`scripts/smoke/anima-coverage-categories.js`). It mirrors the precedent of issues #1 (stale palette), #20 (chat-limit UX), #22 (Anima chat-apply sync) — all three were fixed in-session as small, single-seam changes with no slice plan. AGENTS.md "What you must ask before doing" requires a slice plan only when "new code that touches more than one module" is involved. This fix touches two modules (`server.js` constant + new smoke file), so it falls in a grey zone. **Awaiting user direction** before implementing.
- **Why the bug exists (root cause hypothesis):** `DEFAULT_ANIMA_PROMPT` specifies output *format* (lowercase, comma-separated, quality prefix, variant rules, forbidden vocabulary) but does not enumerate *coverage categories* — the categories the LLM should hit. The Anima manual's worked examples (`docs/ANIMA-PROMPTING-MANUAL.md` §9, §17) always include camera, mood, lighting, and posture tags, so the LLM is missing the explicit prompt hint to cover those categories. The Z-Image Turbo path captures all four in `state.currentAnalysis` but the Anima endpoint ignores those fields entirely (`callKiloAnimaAnalysis` reads only the image, not the analysis snapshot).
- **Suggested fix (smallest diff):**
  1. Add a "COVERAGE CATEGORIES" section to `DEFAULT_ANIMA_PROMPT` enumerating: subject/character, camera/shot (e.g. `looking at viewer`, `portrait`, `upper body`), mood/emotion (e.g. `smile`, `gentle smile`), lighting (e.g. `soft lighting`, `indoor`, `day`), posture/action (e.g. `standing`, `sitting`). Mirror the tag vocabulary from `docs/ANIMA-PROMPTING-MANUAL.md` §7.6 + §17.
  2. (Optional, more invasive) Thread `state.currentAnalysis.camera_angle`, `mood`, `lighting`, `actions` into the Anima endpoint's user prompt as a coverage hint. Skipped unless the prompt-only fix is insufficient.
  3. Add `scripts/smoke/anima-coverage-categories.js` — 7 static-source assertions: (a) the constant has a "COVERAGE" section, (b) camera tokens present, (c) mood tokens present, (d) lighting tokens present, (e) posture tokens present, (f) the helper signature is unchanged, (g) the response envelope is unchanged.
  4. Append "Consequences (2026-08-04)" section to ADR 0021 documenting the prompt-coverage sharpening.
- **To un-park, we'd need:** user OK on (i) in-session fix (mirror issue #22 precedent) vs. (ii) defer to next-slice planning pass. Estimated cost: ~30 minutes, 1 commit, 1 ADR append, ~80 lines of new smoke code.
- **Estimated impact if pursued:** **LOW–MEDIUM** — qualitative UX win, no contract change, no architectural commitment. The Anima manual already documents that the model supports these tag categories; the fix sharpens the prompt to nudge the LLM toward covering them.
- **Issue:** [#23](https://github.com/shadowdoguk/image-to-prompt/issues/23).

### Item: ~~Slice 3 — Kilo Code provider migration: paperwork says "shipped", code says 3.3/3.4 wiring missing (drift)~~ — RESOLVED 2026-09-03 (Session #12)

- **Origin:** Session #8 (2026-08-05). Detected while diagnosing issue [#24](https://github.com/shadowdoguk/image-to-prompt/issues/24) — the `model is not defined` bug turned out to be a Slice 3 leftover. The uncommitted working tree contained `docs/adr/0022-kilo-code-provider.md`, `docs/CODE-REVIEW-3-kilo-code-provider.md`, and `docs/POLISH-AUDIT-3-kilo-code-provider.md`, all dated 2026-08-04, plus modified `src/index.html`, `src/styles.css`, and `tests/run-all.js`. These look like the durable artifacts of a Slice 3 closeout that was prepared but never committed.
- **Why parked:** **The docs and the code disagree — that's drift.** The CODE-REVIEW-3 verdict is `pass`, the POLISH-AUDIT-3 verdict is `PASS — Slice 3 ships`, and ADR 0022 status is `Accepted. Implemented 2026-08-04`. But `node tests/run-all.js` shows **9 failures** in Slice 3.3 (selector UI + state) and 3.4 (param wiring). Concretely: `src/app.js` has zero references to `llmModel`, `ALLOWED_LLM_MODELS`, `LLM_MODEL_STORAGE_KEY`, `renderLlmModelSelector`, `llmModelSelector`, or `llm-model-selector`. The HTML+CSS exist for the `<select>` (added in `src/index.html` and `src/styles.css`) but no JS controller exists. API call paths (`apiCall`, chat send, generate-prompt) don't include `llmModel` in the request body.
- **Three pre-options considered (Session #8 closeout):**
  - **A. Park as-is** *(chosen)*. Add this BACKLOG entry, leave the working tree dirty, schedule a fresh dedicated session for Slice 3.3+3.4 closeout. No commits to anything in the dirty stack today.
  - B. Implement the missing wiring in-session. New sub-slice requiring G1–G5. ~5 commits. Ends the drift but burns the rest of this session on Slice 3 rather than letting the user move to a different task.
  - C. Revert the partial Slice 3 work (`git checkout -- <files>`) to a clean tree, restart Slice 3 fresh in a future session. Safest if the in-progress changes have grown stale or unclear in intent.
- **What's currently in the dirty working tree (do NOT touch without deliberate scope):**
  - Modified: `CONTEXT.md` (+6), `README.md` (+51), `docs/ANIMA-PROMPTING-MANUAL.md` (+27), `docs/ARCHITECTURE.md` (+186), `docs/PRE-MORTEM.md` (+100), `docs/SPEC.md` (+204), `src/index.html` (+14), `src/styles.css` (+20), `tests/run-all.js` (+269).
  - Untracked: `docs/CODE-REVIEW-3-kilo-code-provider.md` (new, 111 lines), `docs/POLISH-AUDIT-3-kilo-code-provider.md` (new, 109 lines), `docs/adr/0022-kilo-code-provider.md` (new, 100 lines), `scripts/smoke/palette-stale-id-guard.js` (new, 84 lines), `data/chat_sessions.json.bak.20260730-120651` (likely a backup of user state — review before committing).
- **To un-park, we'd need:** (a) Acknowledge the drift openly in SESSION-STATE (a new Session #9 entry, append-only) — the previous "PASS" verdicts are inaccurate and should be flagged as superseded. (b) Run G1 for a fresh Slice 3.3+3.4 closeout sub-slice: reframe in one paragraph ("wire `state.llmModel` end-to-end so the selector value reaches all 11 LLM endpoints, the LLM_MODEL_STORAGE_KEY persists across reloads, and the chat/generate-prompt bodies include `llmModel`"). (c) G2 spec update to `docs/SPEC.md` §15 if the design has drifted from the original. (d) G3 arch + pre-mortem deltas (likely small — mostly mechanical). (e) G4 implementation + per-slice review (similar shape to slice 8). (f) G5 polish update to `docs/POLISH-AUDIT-3-…` if needed. (g) Commit the entire stack (paperwork + implementation + tests) atomically so verdicts reflect reality. Estimated: 2–3 hours of focused work, ~3–5 commits, ~120 lines of new `src/app.js`, ~30 lines of `tests/run-all.js`.
- **Estimated impact if pursued:** **MEDIUM** — completes a shipped slice's missing wiring, makes the existing tests pass (9 → 0 failures in 3.3/3.4), lets the user actually pick a non-default model from the UI and have the selection take effect. Without it, the `<select>` in the UI is non-functional (selection is not read, value is not sent to backend). Risk if left too long: more stale paperwork accrues, drift compounds, future slices will reference Slice 3's "shipped" state and inherit the bug.
- **Related:** Issue [#24](https://github.com/shadowdoguk/image-to-prompt/issues/24) fix (commit `5ab78d2`) is independent of this drift — it fixes a Slice 3 leftover in `server.js` response payloads. Both bugs trace back to Slice 3 shipping with incomplete variable-rename + incomplete JS wiring.

### Item: Slice 4 — Tri-provider routing (Kilo Code / MiniMax / Alibaba Cloud)

- **Origin:** Session #0 (2026-07-29), original user ask for the Kilo Code slice. The ask was "review project and evaluate new feature for choosing kilocode as model provider … hardcode these minimax-m3, GPT-5.6 Luna, Gemini 3.1 Pro Preview, Gemini 3.5 Flash, Nemotron 3 Ultra, Grok 4.3." During Session #8 the user expanded the scope to multi-provider routing (Kilo Code + MiniMax direct + Alibaba Cloud). The Slice 3 closeout (Sessions #8–#12) shipped Kilo Code as the sole provider with model selection within Kilo; the multi-provider routing dimension is the natural next session.
- **Why parked:** Slice 3 was already a 5-sub-slice migration; adding tri-provider routing on top in the same sessions would have crossed too many seams at once. The user's "commit and get the change completed" instruction for the closeout prioritized drift resolution over feature expansion. Multi-provider is now a fresh G1 starting point.
- **Why this matters:** Different providers have different auth mechanisms, rate limits, response shapes, and pricing. A provider selector upstream of the Kilo Code model selector lets the artist pick the underlying vendor (Kilo Code's aggregator vs. direct MiniMax vs. Alibaba's DashScope) and then the model within that provider. Useful when (a) Kilo Code has an outage, (b) the user wants direct billing with MiniMax for cost reasons, (c) Alibaba Cloud's Qwen models outperform on a specific image type.
- **Suggested shape (smallest slice):**
  1. **Provider selector UI** — second `<select id="provider-selector">` upstream of `#llm-model-selector`. Three options: `kilo_code`, `minimax`, `alibaba_cloud`. Persisted + URL-mirrored (same pattern as Slice 3.3).
  2. **Per-provider model lists** — `ALLOWED_LLM_MODELS_BY_PROVIDER` in `server.js`. MiniMax provider exposes only `minimax/minimax-m3`. Alibaba exposes `qwen-vl-max`, `qwen-vl-plus`, etc. Kilo Code keeps the 6 existing models.
  3. **Per-provider call helpers** — generalize `callKilo*` into `callProvider(provider, model, messages, ...)`. Each provider gets its own schema/headers/retry policy.
  4. **Provider-aware validation** — `resolveProvider` + `resolveModel` chained in `resolveModelAndProvider(body)`.
  5. **Chat dispatch + URL params** — `?provider=kilo_code&llm=…` in URL; `i2p.state.provider` in localStorage.
  6. **Response envelope** — add `provider` field alongside `model`. Already partial in Slice 3.5.
- **To un-park, we'd need:** G1 with user on scope (which providers? which models per provider? auth model?). Estimated: 3–4 sessions, 1 new ADR (0023-tri-provider), 5–8 new tests, ~400 lines of new server-side code, ~150 lines of `src/app.js`, ~50 lines of `src/index.html`/`styles.css`. Likely needs sub-slices (provider abstraction layer first, then per-provider implementations).
- **Estimated impact if pursued:** **MEDIUM–HIGH** — opens up cost optimization, vendor diversification, and access to Alibaba's Qwen vision models. Risks: auth complexity (3 different API key formats), per-provider rate-limit semantics, response-shape normalization.
- **Pre-commitment:** if pursued, this slice should land in the same session as a **G5 polish audit refresh** of POLISH-AUDIT-3 + the visual-demo gate deferred from `CODE-REVIEW-10-slice-3-closeout.md` follow-up #2.

### Item: Manual visual-demo gate (G4) deferred from Slice 3 closeout

- **Origin:** `docs/CODE-REVIEW-10-slice-3-closeout.md` follow-up #2 (Session #12, 2026-09-03). The methodology's G4 step requires a manual smoke test before commit; this was skipped during the Sessions #8–#11 drift-parking cycle.
- **Why parked:** Slice 3 was closed via the test suite (402/0) which provides strong evidence the wiring is correct, but does not exercise the actual `<select>` click → Kilo API call → response render → Apply flow. The visual-demo gate is the methodology's safety net for wiring bugs that pass regex tests but fail at the browser level.
- **To un-park, we'd need:** First slice that builds on Slice 3 (likely Slice 4 — Tri-provider routing). In that session, do the manual smoke test: open the app in a browser, upload an image, switch `llm-model-selector` between all 6 models, generate, confirm the response envelope's `model` field reflects the selected model. Capture screenshots and attach to the slice's PR description.
- **Estimated impact if pursued:** **LOW effort / MEDIUM value** — ~10 minutes of manual testing, captures the screenshots that close the G4 gate. No new code.

### Item: Server serving follow-ups (re-parked from POLISH-AUDIT P1/P2 by UI-R5)

- **Origin:** `docs/POLISH-AUDIT.md` §5 — P1 no compression middleware, P2 no long-term asset caching. UI-R5 closed the UI-side findings (A1–A3, V1) and re-parked these two server-ops items here.
- **Why parked:** they are deployment concerns orthogonal to the UI redesign; the app is a local single-user tool where the gain is small.
- **To un-park:** add `compression` middleware + `Cache-Control` on static assets in `server.js`; ~20 lines + 1 dependency (dependency adoption needs its own approval per methodology).

### Item: Chat session rail (UI-R4 deviation)

- **Origin:** `CODE-REVIEW-UI-R4-chat-settings.md`. The Chat view currently uses the existing conversation `<select>` bar rather than the spec §4.3 left session rail.
- **Why parked:** functionally equivalent for the current session volume; a rail is a visual upgrade, not a capability gap.
- **To un-park:** render `state.chatSessions` (via `/api/chat/sessions`) as a left rail with new/delete; ~120 lines of shell.js + CSS.

### Item: Self-hosted woff2 typefaces (UI-R5 deviation)

- **Origin:** `CODE-REVIEW-UI-R5-identity-a11y.md`. Spec §7.2 asked for self-hosted Space Grotesk / IBM Plex Sans / IBM Plex Mono; UI-R5 shipped local-first font stacks instead (zero download weight for a local tool).
- **To un-park:** subset + bundle woff2 files and `@font-face` rules if the app ever ships beyond this machine.
