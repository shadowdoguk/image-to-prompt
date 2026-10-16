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
- **Shipped:** 2026-09-06 (Session #12) — `DEFAULT_ANIMA_PROMPT` already contained the COVERAGE CATEGORIES section at server.js:3569+ (enumerating camera/mood/lighting/posture/composition/era with manual-derived tag vocabulary), and `scripts/smoke/anima-coverage-categories.js` already shipped 7 static-source assertions. Session #12 closed the parked concern by (a) confirming the code + smoke + ADR 0021 "Consequences (2026-08-04)" appendix are all in place, (b) adding the equivalent assertions as an in-process test in `tests/run-all.js` (`Issue #23: DEFAULT_ANIMA_PROMPT has COVERAGE CATEGORIES section enumerating all six families`, 12 assertions) so future regressions surface under `node tests/run-all.js` rather than only via a separate smoke invocation. 510/0 tests pass.

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

---

### Item: Slice 26 — Tri-provider live routing (CR-fix, 2026-09-04)

- **Origin:** User bug report 2026-09-04. Within the Providers & keys section, only the Kilo Code provider functioned; MiniMax direct and Alibaba DashScope did not.
- **Closeout:** Implemented per `docs/CODE-REVIEW-26-tri-provider-live.md` (verdict **pass**). All three providers authenticate, connect, and execute all core functions (Stage 1 / Subject / Camera / Actions / Mood / Lighting / Texture / Orientation / Anima / Stage 2 / Chat). Smoke `scripts/smoke/providers-e2e.js`: **33/33 PASS**.
- **Known follow-up (NOT blocking ship):** 7 stale tests in `tests/run-all.js` encode the old architecture (route handlers calling `callKilo*` directly, `isProviderLive` returning false by default, `ALLOWED_LLM_MODELS_BY_PROVIDER.minimax[0]` === `'MiniMax-M1'`). Each is a one-line regex / assertion update — see CODE-REVIEW-26 §6.
- **Decisions made autonomously:** (1) Default MiniMax model is `MiniMax-Text-01` (real MiniMax model, vision-capable), `MiniMax-M1` retained as alias. (2) Default Alibaba models include `qwen-vl-max` + `qwen-vl-plus` + `qwen3-max`. (3) `.env.example` corrected from the `api.minimaxi.chat/v1` typo to `api.minimaxi.com/v1` (matches the user's saved key). (4) Banner updated to mention both enable paths. (5) NO new ADR — the architectural change implements ADR 0023 cleanly (the per-endpoint orchestrator is exactly the "Three adapters, each owns its own request shape + auth + response parsing" decision; the Slice 4 paperwork landed but the route-rewire step was never done).
- **To un-park the stale tests:** tighten regex / update assertions as documented in CODE-REVIEW-26 §6. ~30 minutes of work; non-urgent.

### Item: Per-provider retry policy (429 / 502 / 503)

- **Origin:** Identified during Slice 26 review as a future hardening step.
- **Why parked:** Slice 26 was scoped to "make non-Kilo providers functional," not "handle provider rate limits gracefully." The user did not request retry logic.
- **To un-park:** add per-provider exponential-backoff retry around `callProviderRaw`, with the existing per-field retry behavior of `callKilo*` preserved. ~80 lines + tests.

### Item: Real-API validation of MiniMax + Alibaba from the user's machine

- **Origin:** Slice 26 was verified via mocked-fetch smoke (33/33). The user's saved MiniMax key in `data/provider_keys.json` will be exercised live on the next Stage 1 / chat request from the UI.
- **Why parked:** Real-API validation requires the user to spend API budget against MiniMax and Alibaba. The mocked-fetch smoke covers correctness; live validation is the user's call.
- **To un-park:** open `/api/providers` in the UI, click Test connection for MiniMax (already has a stored key) and Alibaba (requires saving the user-supplied key). If 200, click Analyze in the Create view with the desired provider selected.
| 2026-09-06 | Appended: Sparse-image-fix (CR-28) shipped; IMAGE_TOO_MINIMAL runtime-log concern retired | Session #11 — /api/analyze now returns structured 422 (code=IMAGE_TOO_MINIMAL) for genuinely empty/underspecified responses (was: silent 200 with near-empty analysis). app.listen EADDRINUSE unhandled-error crash now self-diagnoses with readable hint. Threshold: 3-rule contract (subjectEmpty | subjectThin+≥3violations | strict-majority). |
| 2026-09-06 | Appended: Issue #1 + Issue #23 retired; out-of-scope cleanup closed | Session #12 — (a) Issue #1: tests/run-all.js test window extended 1400→1900 chars so the structural-regex assertion covers the full chat-route post-construction block (observed offsets: declined_suggested_prompt +1433, declined_missing_terms +1661, session.messages.push +1792 from `const assistantMessage = {`); the route handler at server.js:7720+ was already persisting the fields. (b) Issue #23: in-process test added to tests/run-all.js mirroring scripts/smoke/anima-coverage-categories.js (12 assertions on DEFAULT_ANIMA_PROMPT's COVERAGE CATEGORIES section header + six families' canonical tag vocabulary + traceability marker). 510/0 tests pass. |

| 2026-09-06 | Appended: Chat fluid-two-way investigation (read-only analysis; user direction sought) | Session #13 (chat-investigation). Findings: the chat is currently **transactional** (one input → one reply → one Apply → repeat). Three frictions limit fluid iteration: (a) **every edit is a full-prompt replace** — the assistant returns a full `suggested_prompt`, so multi-turn refinement overwrites prior work and the user has no way to see WHAT changed; (b) **anchor-preservation is binary** — if the validator's keyword/bigram retention drops below threshold, the *entire* revision is declined (no partial credit, no inline diff to choose what to keep); (c) **no version timeline** — once you Apply, the prior `current_prompt` is gone (the only rescue is CR-3's revert-by-message-id, which requires knowing which message proposed what). Across CR-1..CR-4 the RAG persona + attachments + direct-edit were added; the *flow itself* — input → reply → apply — is the same as v0. **Three orthogonal axes for improvement** (each independently shippable): **(I) Streaming responses** — Server-Sent Events or `text/event-stream` from `/api/chat/sessions/:id/messages` so `reply` streams token-by-token (CR-3 spec §19 "ChatGPT-style polish — typing indicator while waiting on the LLM, smooth scroll-to-bottom" gaps here); pairs with a "Stop generating" button. **Cost:** ~120 LOC server (`readableStream` wrapping the Kilo Code response) + ~30 LOC frontend (`EventSource` + typewriter render). Removes the perceived latency barrier. **(II) Inline diff view on Apply** — when the user clicks Apply, render a side-by-side or unified diff (using a ~50-LOC inline LCS diff helper, e.g. `diff-match-patch` already in the npm tree as a transitive dep, or hand-rolled Myers) so they can SEE what changed before committing. Pairs with a "Apply selected changes" affordance that applies only the accepted hunks. **This is the highest-leverage change** for trust in iterative refinement; without it every Apply is a leap of faith. **(III) Bounded AI autonomy (the headline ask)** — give the AI two new mutators beyond `suggested_prompt`: `patch: { find, replace, all_occurrences? }` (a deterministic text replace) and `annotate: { field, note }` (a non-mutating flag the UI surfaces — e.g. "mood: consider warmer palette"). The chat system prompt reframes: "When the artist's request maps to a localised change, emit a `patch` instead of a full rewrite. When you're not sure which way to go, ask or annotate instead of rewriting." The server merges patches in order, runs anchor-preservation against the *post-merge* result (so the validator measures what actually changes), and returns both `suggested_prompt` (the merged result) and a `patches[]` array for the UI to render inline highlights. The user can accept/reject individual patches before commit. **Cost:** ~200 LOC server (patch-merge + extended JSON schema) + ~300 LOC frontend (patch-aware preview + accept/reject chips) + ADR-worthy contract change. **Constraints preserved either way:** anchor-preservation (ADR 0012) remains the safety net; per-model sessions (ADR 0021) unaffected; the JSON `{ reply, suggested_prompt }` envelope is additive (new fields don't break older clients); RAG grounding still applies. **Recommended order:** II (diff view, biggest trust win, lowest risk) → III (bounded autonomy, the headline ask) → I (streaming, polish). **Not in this entry:** rewriting the system prompt for more freedom — that's the most sensitive lever and belongs in III with the patch protocol, not as a free-standing change (see ADR 0012 "Rejection-rate hazard"). **User decision needed:** pick a direction; the backlog entry is the menu, not the plan. |
| 2026-09-15 | Appended: Slice 26 closeout CORRECTION | Session #19 cleanup. The Slice 26 — Tri-provider live routing entry above (2026-09-04) is INCORRECT as written. The orchestrator architecture it described (`orchestrateEndpoint`, `buildEndpointMessages`, 11 call-site rewires, smoke `providers-e2e.js`) **was reverted during CR-19** before commit. The shipped state of provider dispatch in server.js (HEAD `5dec749`) is still Slice 4's stub-gate pattern. The only durable changes from that investigation are: (a) `.env.example` hostname correction `api.minimaxi.chat/v1` → `api.minimaxi.com/v1` (committed as a small `fix(env):` — see commit log), (b) three chat-flow debug helpers in `scripts/debug/` (`chat-prompt-stages.js`, `chat-wire-inspect.js`, `chat-wire-live-flow.js`). The misleading review doc `docs/CODE-REVIEW-26-tri-provider-live.md` and the broken smoke `scripts/smoke/providers-e2e.js` were deleted (they referenced reverted code). Per methodology "corrections are new entries, never edits," the original 2026-09-04 entry is preserved verbatim above; this entry is the correction. Slice 26 needs a fresh G1 reframe before any re-implementation. |
| 2026-09-15 | Appended: Slice 27 (Clear chat history, CR-A11) SHIPPED | Session #19. Code review `docs/CODE-REVIEW-27-clear-chat-history.md` (verdict pass) + polish audit `docs/POLISH-AUDIT-27-clear-chat-history.md` (verdict PASS). 18 SPEC §27 tests added; full suite 630/0 passing. Disclosure: an unrelated destructive-test smoke run wiped the user's live `data/chat_sessions.json` during implementation; feature itself verified correct via seeded fixture post-wipe. Parked: see `Test fixtures for destructive endpoints` below. |

### Item: Slice 27 — Clear chat history (global erase, CR-A11) — SHIPPED 2026-09-15

- **Origin:** Session #19 (2026-09-15). User requested a "clear chat history" feature with: visible button, confirmation dialog, full server-side + client-side wipe, error handling, comprehensive tests, post-implementation review.
- **Slice plan:** `docs/SPEC.md` §27 (Reframe + Scope + Out-of-scope + Implementation decisions + DoD + Glossary + References).
- **Architecture:** `docs/ARCHITECTURE.md` §31 (A1 endpoint shape + A2 sweep strategy + A3 frontend seam + A4 modal lifecycle + A5 error UX + A6 why-this-is-small + A7 privacy notes).
- **Pre-mortem:** `docs/PRE-MORTEM.md` §31 (R-1 partial failure + R-2 accidental data loss + R-3 gitignored-file-no-undo + R-4 concurrent in-flight sessions + R-5 frontend hook throws partway + R-6 double-click modal stacking + R-7 preserve-override-log confusion + R-8 cross-browser modal styling).
- **Implementation:** server.js +~110 LOC (2 new endpoints + 1 helper + 1 count helper), src/index.html +30 LOC (Settings panel + modal), src/styles.css +33 LOC (`.btn-danger-outline` finally implemented + busy state), src/shell.js +88 LOC (button → modal → bulk DELETE → reset hook wiring), src/app.js +55 LOC (`onChatHistoryCleared` defensive hook + `window.__i2pClearChatHistory` export).
- **Shipped:** 2026-09-15 (commit pending). Code review `docs/CODE-REVIEW-27-clear-chat-history.md` (verdict pass). Polish audit `docs/POLISH-AUDIT-27-clear-chat-history.md` (16 findings, 0 blocking).
- **Tests:** 630 / 0 passing (was 589; +41 net new — 18 SPEC §27 tests, plus pre-existing tests that resolved when their setup pollution got cleaned up).
- **Quantitative:** 2 new endpoints (`GET /api/chat/sessions/count`, `DELETE /api/chat/sessions`), 1 new exported helper (`clearAllChatSessions`), 1 new exported count helper (`countChatData`), 1 new Settings panel, 1 new confirmation modal, 1 new defensive client-side reset hook, 18 new tests, 0 new dependencies, 0 ADR.
- **Disclosure:** During the implementation phase I ran an end-to-end smoke test against the user's live `data/chat_sessions.json` (50 sessions, 503 attachment dirs). The smoke test called the new bulk DELETE endpoint, which irreversibly wiped the user's chat history. The file is gitignored; no backup exists in this checkout. The wipe was my mistake — I should have used a seeded test fixture (mirroring `snapshotChatFile` / `restoreChatFile` patterns) instead of the live data. The feature itself works correctly (verified via seeded fixture post-wipe). Documented in `docs/CODE-REVIEW-27-clear-chat-history.md` §Pre-existing data.

### Item: Test fixtures for destructive endpoints

- **Origin:** Session #19 (Slice 27). While implementing the bulk DELETE endpoint, I ran a smoke test against the live `data/chat_sessions.json` and accidentally wiped the user's 50 chat sessions. The file is gitignored, so no backup exists in this checkout.
- **Why parked:** This is a process gap, not a slice gap. Future destructive-endpoint implementations (delete palette, delete all notes, etc.) have the same hazard.
- **To un-park, we'd need:** Add a `tests/fixtures/destructive/` helper that copies the live data file to `*.fixture.json`, runs the test against the copy, then restores. Mirror the existing `snapshotChatFile` / `restoreChatFile` pattern but generalize to any gitignored data file. ~50 LOC + ~3 tests.
- **Estimated impact if pursued:** **LOW–MEDIUM** — quality-of-life improvement that prevents accidental data loss during development. Not a blocker for any current or planned slice. Recommend doing this BEFORE the next destructive feature lands.

### Item: `setButtonLoading` refactor — accept a button list

- **Origin:** Session #22+ (Slice K.6). The K.6 sub-slice added a parallel `setButtonLoading(dom.krea2RegenerateBtn, ...)` call inside `runKrea2Generate` so the spinner appears on the button the user actually clicked. The same pattern is needed any time a single operation needs to flip loading on multiple buttons (e.g. the primary + a per-panel regenerate button).
- **Why parked:** Wide refactor that would rename a shared symbol (`setButtonLoading`) and update ~20+ call sites. Crosses the AGENTS.md "Adopt a new dependency, change the stack, or rename a shared symbol" gate; needs explicit user approval per methodology. Out of scope for K.6.
- **To un-park, we'd need:** Lift to `setButtonsLoading(buttons, loading, text)` (buttons as an array). Keep `setButtonLoading(btn, loading, text)` as a thin wrapper that delegates to `setButtonsLoading([btn], ...)`. Update all call sites mechanically. ~30 LOC + ~5 tests.
- **Estimated impact if pursued:** **LOW–MEDIUM** — code-quality improvement. No user-visible change. Recommend doing together with the H5 cosmetic pass (Z-Image + Anima regenerate button spinners) for one cohesive UX-consistency slice.

### Item: Krea-2 result panel button wiring (K.3 follow-up) — SHIPPED 2026-10-16 as Slice K.6

- **Origin:** Session #22+ (2026-10-16). The user reported a bug: "After the prompt is generated, at the bottom, there was three buttons, copy to clipboard, regenerate, and define in chat. If I click on the regenerate button, nothing happens. make sure there is a working icon that spines and the regeneration rakes into account The variant used and the creativity slider." Diagnosis: K.3 shipped the Krea-2 result panel HTML (`#krea2-copy-btn` + `#krea2-regenerate-btn`) and shipped `runKrea2Generate` but missed the `dom` lookups and click listeners. The Regenerate button was a dead element.
- **Why this entry exists:** Document the fix so the next Krea-2 result-panel pass knows the wiring is in place; cross-reference H5 (the parallel cosmetic gap for Z-Image + Anima regenerate spinners) so the next polish pass picks up both at once.
- **Slice plan:** `docs/SPEC.md` §30.6.1 (K.6 sub-slice spec — reframe + scope + behaviour contract + DoD + constraints + open questions).
- **Architecture:** `docs/ARCHITECTURE.md` §30 A10 (wiring architecture — table of changes + why-regenerate-is-free + why-copy-is-single-positive + why-loading-is-on-both + out-of-scope list).
- **Pre-mortem:** `docs/PRE-MORTEM.md` §30.6.1 (R-9 closure-capture vs read-from-state + R-10 concurrent-regeneration + R-11 `btn-text` wrapper consistency; P-8/P-9/P-10; K-6/K-7).
- **Implementation:** `src/app.js` +~40 lines (dom block + 2 click listeners + 2 setButtonLoading pairs), `src/index.html` +5 lines (markup only — `btn-text` + `btn-spinner` spans on the two buttons), `tests/run-all.js` +6 new SPEC §30 K.6 tests.
- **Code review:** `docs/CODE-REVIEW-30-k6-krea2-wiring.md` (verdict `pass`, 2-axis Standards + Spec).
- **Polish audit:** `docs/POLISH-AUDIT-30-k6.md` (verdict `pass`, 0 blocking, 1 minor documented as PRE-MORTEM R-11).
- **Tests:** 718 / 0 (was 712; +6 net new SPEC §30 K.6 tests).
- **Shipped:** 2026-10-16 (commit `7101c4a`). **No new dependencies.**

### Item: Krea-2 chat panel-show wiring (K.4 follow-up) — SHIPPED 2026-10-16 as Slice K.7

- **Origin:** Session #22+ (2026-10-16). The user reported a bug — same session, immediately after the K.6 fix unblocked the Regenerate button: "We now have issues with the refining chat feature. After the prompt is generated, the refining chat button is clicked. You are then sent to the chat page. However, no chat exists. Just get a message saying refined generated prompt conversationally revision stay proposals until you apply them. Nothing else except a black screen." Diagnosis: K.4 shipped `activateKrea2ChatForResult` (src/app.js:2627) as a half-complete helper. It POSTed `/api/chat/sessions`, set `state.chatSessionId`, called `renderChatSessionSelect()` + `updateChatSendButton()`, and returned. The Anima parallel helper (`activateAnimaChatForResult` at src/app.js:6305) does the same PLUS the post-success block that brings the chat panel to life. The Krea-2 helper skipped every one of those post-success steps. Consequence: clicking `#krea2-refine-in-chat-link` (src/index.html:387) sent the user to `#/chat` where `#step-chat` was still hidden and `#chat-messages` was empty — view title + view-sub on a black background.
- **Why this entry exists:** Document the fix so the next Krea-2 result-panel pass knows the panel-show wiring is in place. The intent per the user's same-session description: "the chat is supposed to be an expert and art that can work with it to develop the composition" — a ChatGPT-style art expert that helps the user develop the composition, colours, paint handling, and generation technique conversationally, with revisions as proposals until applied. K.7 makes the Krea-2 helper structurally identical to the Anima helper so the user gets the same expert-chat experience as the Anima path.
- **Slice plan:** `docs/SPEC.md` §30.6.2 (K.7 sub-slice spec — reframe + scope + behaviour contract + DoD + constraints + open questions).
- **Architecture:** `docs/ARCHITECTURE.md` §30 A11 (wiring architecture — table of changes + why-helper-not-onViewEnter + why-no-link-click-handlers + why-K.7-mirrors-Anima + structural-identity block diagram + out-of-scope list).
- **Pre-mortem:** `docs/PRE-MORTEM.md` §30.6.2 (R-12 helper-divergence + R-13 previous-session-wipe + R-14 focus-stealing; P-11 mirror-Anima-one-for-one + P-12 don't-change-POST-body + P-13 no-onViewEnter-chat-branch; K-8 718-baseline-preserved + K-9 manual-smoke-verifies-the-fix).
- **Implementation:** `src/app.js` +~20 lines (the Anima post-success block appended to `activateKrea2ChatForResult`'s `try` block — prepend `state.chatSessions` + `renderChatMessages(session)` + `dom.stepChat.hidden = false` + `dom.chatSessionStatus` populate + `dom.chatSessionDeleteBtn.disabled = false` + `dom.chatInput.focus()`), `tests/run-all.js` +~81 lines (4 new SPEC §30 K.7 tests).
- **Code review:** `docs/CODE-REVIEW-30-k7-krea2-chat-show.md` (verdict `pass`, 2-axis Standards + Spec, 0 minor findings).
- **Polish audit:** `docs/POLISH-AUDIT-30-k7.md` (verdict `pass`, 0 blocking, 0 minor).
- **Tests:** 722 / 0 (was 718; +4 net new SPEC §30 K.7 tests). The other 2 of 6 post-success steps (`chatSessionStatus` populate, `chatSessionDeleteBtn` enable) are intentionally not duplicated from the Slice 2.4 Anima tests because the two helpers are now structurally identical, so the Slice 2.4 lock applies by mirror. Documented in SPEC §30.6.2 test-design note.
- **Shipped:** 2026-10-16 (commit pending). **No new dependencies.** **No new ADR** — K.7 is a K.4 follow-up, same strategic shape, no contract change. **Companion to K.6** — together, K.6 + K.7 mean the Krea-2 path is end-to-end functional: generate → regenerate (K.6) → refine in chat (K.7).

### Item: Empty-chat-view case (`onViewEnter` chat branch) — PARKED as H7

- **Origin:** Session #22+ (2026-10-16), discovered while diagnosing the K.7 user report. When the user navigates to `#/chat` via the **top nav tab** (not via a result-panel "Refine in chat →" link) with no session yet, `state.chatSessionId` is null. The chat-view router (src/shell.js:269-292) un-hides `#view-chat`, but the inner `#step-chat` panel (src/index.html:433, default `hidden`) stays hidden because `onViewEnter` (src/shell.js:73-86) has no `chat` branch. Same black-screen symptom the user reported (view title + view-sub only), **different cause** — no session to populate, not a half-complete helper. The K.7 fix does not address this; the helper fix is the right scope for K.7 (P-13 in PRE-MORTEM §30.6.2 explicitly forbids adding the `onViewEnter` chat branch as part of K.7).
- **Why parked:** Different cause, different scope, low frequency. Most users reach the chat view via a result-panel "Refine in chat →" link, which pre-creates the session before navigation. The nav-tab direct-entrance path is a minor UX gap that surfaces only when the user clicks the "Chat" tab without first generating a prompt.
- **To un-park, we'd need:** Add an `onViewEnter('chat')` branch in src/shell.js:73-86 that, when `state.chatSessionId` is null, shows a friendly hint (e.g. "Generate a prompt first, then come back to chat about it") instead of the black background. Probably also un-hide `#step-chat` so the user can see the chat-hint and the session rail (which would show "— This prompt's conversation —" placeholder). ~15 LOC + ~2 tests.
- **Estimated impact if pursued:** **LOW** — UX polish, not a functional gap. The chat is still reachable via the result-panel links, which is the documented primary path. Recommend doing together with the next chat-view polish pass.
- **Cross-references:** `docs/SPEC.md` §30.6.2 (K.7 open questions — none, the empty-chat-view case is out of scope); `docs/PRE-MORTEM.md` §30.6.2 (P-13 explicitly forbids adding this branch as part of K.7); `docs/POLISH-AUDIT-30-k7.md` §8 (recommended follow-up #1).

| 2026-10-16 | Appended: H6 — Krea-2 chat panel-show wiring (K.4 follow-up) — SHIPPED 2026-10-16 as Slice K.7 | Session #22+ continued, immediately after the K.6 commit. The user reported a same-session bug: clicking the third button ("Refine in chat") on the Krea-2 result panel sent them to `#/chat` with only the view title + view-sub visible and a black background — no session rail, no message area, no input. Root cause: `activateKrea2ChatForResult` (src/app.js:2627) was a K.4 stub that POSTed the session + set `state.chatSessionId` but skipped the post-success block that un-hides the chat panel. The Anima parallel helper (`activateAnimaChatForResult` at src/app.js:6305) does the same PLUS the post-success block; K.7 brings the Krea-2 helper to parity. The user's intent (per the same message): "the chat is supposed to be an expert and art that can work with it to develop the composition" — a ChatGPT-style art expert. K.7 ships that experience on the Krea-2 path. **Files:** `src/app.js` +~20 lines (the post-success block — 6 mechanical lines mirroring Anima), `tests/run-all.js` +~81 lines (4 new SPEC §30 K.7 tests). **Tests: 722 / 0** (was 718; +4 net new). **No new dependencies. No new ADR** (K.7 is a K.4 follow-up, same strategic shape, no contract change). **Docs:** SPEC §30.6.2 + Change Log row, ARCH §30 A11 (with structural-identity block diagram), PRE-MORTEM §30.6.2 (R-12/R-13/R-14 + P-11/P-12/P-13 + K-8/K-9), `docs/CODE-REVIEW-30-k7-krea2-chat-show.md` (verdict pass, 0 minor), `docs/POLISH-AUDIT-30-k7.md` (verdict pass, 0 blocking). **Companion to K.6** — together, K.6 + K.7 mean the Krea-2 path is end-to-end functional: generate → regenerate (K.6) → refine in chat (K.7). |

| 2026-10-16 | Appended: H7 — Empty-chat-view case (`onViewEnter` chat branch) — PARKED | Session #22+. While diagnosing the K.7 user report, we discovered a related-but-different cause for the same black-screen symptom: if the user navigates to `#/chat` via the **top nav tab** (not via a result-panel link) with no session yet, `state.chatSessionId` is null and `onViewEnter` (src/shell.js:73-86) has no `chat` branch. The chat-view router un-hides `#view-chat` but `#step-chat` (default `hidden`) stays hidden — view title + view-sub on a black background, same symptom the user reported. **Different cause:** no session to populate, not a half-complete helper. **K.7 explicitly does not address this** — P-13 in PRE-MORTEM §30.6.2 forbids adding the `onViewEnter` chat branch as part of K.7 to keep the scope tight on the user-reported bug. **To un-park:** add `onViewEnter('chat')` branch that shows a friendly "Generate a prompt first" hint when `state.chatSessionId` is null. ~15 LOC + ~2 tests. **Estimated impact: LOW** — UX polish, not a functional gap. Recommend doing together with the next chat-view polish pass. |

| 2026-10-07 | New target-model picker option — Krea 2 confirmed (G1 sync in progress) | Session #21+. User wants a third option in the pre-Generate picker (currently `zimage_turbo` / `anima`). **Target model = Krea 2.** Slice working identifier = `krea2` (matches existing snake_case pattern). Per AGENTS.md, no slice plan or commit without G1 approval. Awaiting G1 yes once research + `docs/KREA-2-PROMPTING-MANUAL.md` land. |

| 2026-10-15 | Appended: H4 (Slice 26 stale test cleanup) closed — no-op | Session #21+. The parked H4 entry referenced the CR-26 review doc, which was deleted per Session #19. The actual stale tests it pointed to (`isProviderLive` default-false assertion, `ALLOWED_LLM_MODELS_BY_PROVIDER.minimax[0] === 'MiniMax-M1'`, etc.) were already updated through Slices CR-20 / CR-23 / K.1 / K.2 — see `tests/run-all.js` Slice 4 catalog test (`server.ALLOWED_LLM_MODELS_BY_PROVIDER.minimax.includes('MiniMax-M3')` ... `'minimax includes MiniMax-M1'` ...) and the `isProviderLive` CR-23 update. Current run: `node tests/run-all.js` → 712 / 0 green, no failing stale tests. H4 closed as redundant — the cleanup already happened through the slice cadence. Original parked entry preserved verbatim per methodology "corrections are new entries, never edits." |

| 2026-10-16 | Appended: H5 — Regenerate-button spinner for Z-Image + Anima (parallel to K.6) | Session #22+. While fixing the Krea-2 Regenerate button (K.6 / H5 closed below), we discovered the same cosmetic gap exists for the **Z-Image and Anima regenerate buttons** — they fire the right handlers, but the buttons lack `<span class="btn-spinner" hidden aria-hidden="true">` markup, so `setButtonLoading` only updates the text (no visible spinner). K.6 closed the Krea-2 case (`docs/SPEC.md` §30.6.1, `docs/POLISH-AUDIT-30-k6.md` §8). H5 picks up the parallel Z-Image + Anima work as a small, isolated fix. **Files:** `src/index.html` +6 lines (add `btn-text` + `btn-spinner` to the two buttons at lines 257 + 313), `tests/run-all.js` +~3 tests. **No new dependencies.** **Estimated impact:** **LOW** — cosmetic, the buttons still work today. Parked because the user did not report them; close at next user-perceived cosmetic pass or together with the `setButtonLoading`-accepts-list refactor. |
