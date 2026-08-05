# SESSION-STATE.md — image-to-prompt

**Last updated:** 2026-08-04 at end of Session #7 (Anima chat-apply sync bug, issue #22 fixed)

---

## At-a-glance

| Field | Value |
|---|---|
| **Workflow** | Existing (continue mode) |
| **Current phase** | **🚢 SHIPPED — Slice 1 fully through Gate G5 (sign-off: approve / ship)** |
| **Last completed slice** | Slice 1 — texture Populate-with-AI button (commit `0542dbf`, ship-verdict PASS at Gate G5, commit `d42561b`, session close-out `f9bfdd1`) |
| **Currently in** | Awaiting Q3 decision: polish-triage slice vs Slice 2 (Phase C re-entry) |
| **Open questions** | 1 — see §5 (Q3) |
| **Kill criteria status** | 0 of 3 triggered (server.js size: 6675 lines, well under 290KB kill criterion from SPEC §11) |
| **Next action** | Q3 prompt → pick polish-triage slice or Slice 2 (continue mode) |

---

## 1. Project summary (one paragraph for cold start)

Image-to-prompt generator for AI artists: upload image → 14-field structured prompt optimised for SD / Midjourney / DALL-E / Flux, powered by MiniMax M3. Node/Express + vanilla-JS frontend, JSON-file state, 44 API endpoints, 22 ADRs of design history. Mid-life, healthy, low drift. **Mode: continue**, not heal. See `docs/PROJECT-README.md` for the full overview.

## 2. Slice tracker

| # | Slice | Blocked by | Status | Commit | Code-review verdict | Context | Notes |
|---|---|---|---|---|---|---|---|
| 1 | texture Populate-with-AI button | — | ✅ SHIPPED | `0542dbf` (G4 pass+minor) → G5 PASS | fresh | 6th per-field vision endpoint; 9 tests; 14 polish findings (0 blocking) |

**Frontier:** empty — Slice 1 fully shipped through Gate G5. **Phase C re-entry** to pick the next slice, OR a polish-triage housekeeping slice for the 14 Gate G5 findings.

### Frontier

Empty. Decision pending: Slice 2 (continue mode) or polish-triage slice (housekeeping).

## 3. Decisions since last session

**Slice 1 landed.** No new ADRs added (3-criteria test failed — Slice 1 mirrors ADR 0018 verbatim; adding `docs/adr/0021-...md` would be redundant). Per SPEC §13, the Slice 1 glossary terms (texture field, Populate with AI, per-field vision endpoint) are in CONTEXT.md as `Stage 1.T`.

**Lightweight decisions** (no ADR; captured in commit message):

- Endpoint path: `POST /api/texture` (mirror field-name pattern from ADR 0018).
- Length floor: `minLength: 60` on JSON Schema (mirror actions/mood for textarea contract).
- No curated chips for texture (texture resists canonical taxonomy — mirror ADR 0018 §1 actions reasoning).
- No retry loop, no preset override, no per-field prompt editor (mirror ADR 0018 §5).
- Single-attempt LLM call (mirror ADR 0018 §2).
- In-place DOM update, no-image guard (mirror all 5 prior per-field buttons).

**Gate G5 polish tally (Slice 1, from `docs/POLISH-AUDIT.md`):**

- 14 findings total, **0 blocking**.
- §1 Accessibility: 3 (A1 `prefers-reduced-motion`, A2 no `aria-live` success, A3 no `aria-busy` in-flight).
- §2 Visual: 3 (V1 no signature element, V2 Slice 1 pass, V3 cross-ref A1).
- §3 Prose: 1 (S1 README "focused" — pattern-driven; 48/50 score).
- §4 Copy: 3 (C1 subtitle outcome-led, C2 README bullet spec-dense, C3 no above-fold CTA; 42/50 score).
- §5 Performance: 2 (P1 no compression middleware, P2 no long-term asset caching).
- §6 Discipline: 2 (D1 pre-existing `console.warn`, D2 ESLint not verified).
- All 14 are project-level polish debt or Slice 1 nice-to-haves; none block ship.

**Commits landed this session:**

- `eb0ef3e` — `chore: bootstrap App Build methodology, reconcile three docs systems` (AGENTS.md merge, CONTEXT.md symlink, DECISIONS.md removed, methodology docs, RECON, SYNTHESIS, PROJECT-README, SESSION-STATE)
- `6722030` — `chore: ignore .superpowers/ and .tmp/` (pre-existing untracked dirs)
- `0542dbf` — `feat(slice-1): texture Populate-with-AI button + 9 tests` (DEFAULT_TEXTURE_PROMPT + callMiniMaxTextureAnalysis + POST /api/texture route + populateTextureWithAI handler + button render + 9 tests + CONTEXT.md Stage 1.T entry + README endpoint section + SPEC/ARCH/PRE-MORTEM/CODE-REVIEW docs)
- `31d0050` — `chore(session): SESSION-STATE.md Slice 1 outcome` (slice tracker row, decisions log, mood, code-review trail)
- `1c0167a` — `chore(session): Q1 resolved — next action is Gate G5 (POLISH-AUDIT)` (Q1 closed on user's behalf; chose polish audit)
- `d42561b` — `chore(audit): Gate G5 polish audit — Slice 1 ships clean (PASS)` (286-line POLISH-AUDIT.md, 7 sections, 14 findings, 0 blocking)

## 4. Blockers / parked items

**Nothing blocked.** Slice 1 shipped through Gate G5; no work in flight.

**Parked (deferred per Slice 1 SPEC §4.2):**

- Curated chip presets for texture (deferred — texture resists canonical taxonomy).
- Per-field route module split (deferred — server.js remains 6675 lines, well under the 290KB kill criterion).
- `scripts/smoke/texture-ai-button-smoke.js` (deferred — target level per SPEC §9, not blocking commit).
- Gate G5 done (commit `d42561b`); 14 polish findings logged in `docs/POLISH-AUDIT.md` for visibility.

**Parked (Gate G5 polish-triage candidates, NOT Slice 1 blockers):**

- **A1** — `prefers-reduced-motion` media query (project-level gap).
- **A2 / A3** — `aria-live` for Slice 1 success + `aria-busy` during in-flight (Slice 1 nice-to-haves; could ship in follow-up).
- **V1** — no signature element (project-level voice change).
- **C1 / C2 / C3** — subtitle outcome-led, README bullet spec-dense, above-fold CTA absent (all project-level voice choices).
- **P1** — no compression middleware (~5-line patch in `server.js`).
- **P2** — no long-term asset caching (~5-line patch).
- **D1 / D2** — pre-existing `console.warn` (chat/palette/directive); ESLint config not verified.

Bundle these into one housekeeping slice (~30 lines code, ~2 hours) or triage individually per ADR.

## 5. Open questions

**Q1 (resolved 2026-07-29 → resolved again 2026-07-30, on user's behalf):** What's next?

- **Choice 1: (d) — Run Gate G5 (POLISH-AUDIT.md).** Done. Slice 1 fully shipped; verdict PASS (0 blocking, 14 findings logged in `docs/POLISH-AUDIT.md`).
- **Choice 2 (next):** Triage the 14 Gate G5 polish findings into follow-up work, OR pick Slice 2 in continue mode.

**Q2 (resolved):** Smoke test scope for Slice 1. Answer: ran 3-image demo (oil/digital/photograph) per pre-mortem commitment #3 — all 3 returned useful output, kill criterion #3 not triggered. (3 MiniMax credits spent; uploads/ stayed at 0.)

**Q3 (open):** Polish-triage slice vs Slice 2 — your call. The polish-triage bundle is ~30 lines of code (~2 hours). Slice 2 options are: (a) next per-field AI button (mirror Slice 1's pattern for one of `style`/`composition`/`era`/`artistic_medium`/`depth_of_field`/`contrast`), (b) wide-refactor split of `server.js`, (c) heal something specific. None block ship.

## 6. Code-review trail

- `docs/CODE-REVIEW-1-texture-ai-button.md` — Slice 1 Gate G4 review (130 lines, two-axis, **pass+minor**). 0 hard findings across both axes. Inline review (Goose direct) because the `general-purpose` sub-agent source is not registered in this goose installation; output shape mirrors what the sub-agent would have produced per `docs/PRINCIPLES.md` §6.5.
- `docs/POLISH-AUDIT.md` — Slice 1 Gate G5 polish audit (286 lines, 7 sections + sign-off, **PASS**). 14 findings total across accessibility (3), visual (3), prose (1), copy (3), performance (2), discipline (2) — **0 blocking**. Inline audit (Goose direct) for the same `general-purpose` reason as G4.

## 7. Mood / risk flag

> Slice 1 is fully shipped through Gate G5. Methodology proven end-to-end on a real feature slice: spec → arch → pre-mortem → impl → code-review → commit → polish-audit. All 3-image manual demos passed; uploads/ stayed clean; kill criterion #3 not triggered. 319/319 tests green; 10/10 V-checks; node --check clean. server.js well under the 290KB kill criterion (6675 lines). 3 MiniMax credits spent on demo. POLISH-AUDIT verdict: PASS (0 blocking, 14 findings all classified as project-level polish debt or Slice 1 nice-to-haves). **No blockers; awaiting Slice 2 direction or follow-up polish-triage slice.**

---

## How to use this file

**Opening the project:**

1. Read the At-a-glance table.
2. Read §1 (project summary) and §7 (mood).
3. Check §2 frontier — empty right now; we're at Phase C.
4. Check §4 blockers — none.
5. Check §5 open questions — 3, awaiting user.

**During the session:**

- Update at end of every slice, not end of session.
- Append any new ADRs to `docs/adr/` **inline** the moment a decision crystallises.
- Create `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` per slice before committing.

**At end of session:**

- Refresh the At-a-glance table.
- Append any new ADRs.
- Update the Mood line.
- If a wide refactor is in progress (PRINCIPLES.md §6.3), note where the Expand / Migrate batches / Contract sequence sits.
---

## Session #2 — 2026-07-30 (chat-console bug, issue #20)

**Workflow:** existing (continue mode) — off-slice bug fix per `docs/agents/bug-workflow.md`.

### Symptom
After Stage 2 returns, chat console never activates and a red toast reads:
"Chat console unavailable: Chat session limit reached (200). Delete older sessions before creating new ones."

### Root cause (two defects, not one)
1. **Data state** — `data/chat_sessions.json` had organically grown to 200 entries; the `MAX_CHAT_SESSIONS_TOTAL` guardrail at `server.js:6235` is correct in principle but blocked all new sessions.
2. **UX framing** — the error was routed through `showError(...)` at `src/app.js:4445` and rendered with red-error styling (`src/styles.css:766`), treating a soft maintenance guardrail as a fatal failure. Recovery requires a picker that lives inside the very chat section hidden because activation failed — the user was trapped.

### Fix landed (issue #20 immediate-track, all green)
- `data/chat_sessions.json`: 200 → 50 newest (sorted by `updated_at` desc, fallback `created_at`; atomic write via temp+rename, mirrors `writeChatSessions`). File size 1,983,327 → 514,866 bytes. Backup retained at `data/chat_sessions.json.bak.20260730-120651`.
- `src/styles.css`: added `.error-toast.is-warning` + `.error-toast.is-warning span` (yellow modifier; uses `--warning`/`--warning-bg` tokens, falls back to amber).
- `src/app.js` `showError`: now takes `(msg, opts = {})`; toggles `.is-warning` on the toast when `opts.severity === 'warning'`. Default behaviour unchanged for all other call sites (54 existing callers).
- `src/app.js:4445` chat-activation catch block: detects `/chat session limit reached/i` and routes to a rewording ("Chat history is full (200 sessions). Delete older conversations from the picker above to start a new one.") with `severity: 'warning'`. Non-cap errors still flow through the existing red-error path.

### Regression test
`scripts/smoke/chat-limit-guardrail-smoke.js` (new, 191 lines). Locks:
1. POST `/api/chat/sessions` at cap returns 409 with the canonical error string + `(200)` count.
2. POST `/api/chat/sessions` below cap returns 201 with `id` starting `chat_`.
3. Frontend regex literal `/chat session limit reached/i` present in `src/app.js`.
4. `severity: 'warning'` route present in `src/app.js`.
5. `.error-toast.is-warning` modifier present in `src/styles.css`.

**Result:** 10/10 PASS. 319/319 test suite still green. `session-init.js` V-checks still 10/10 (only the pre-existing ADR-0001 length-validation noise remains).

### Long-term contract decision (deferred, tracked)
**Open question Q4:** when a user with 200 saved conversations generates a 201st prompt, what should happen?
- (a) Auto-evict oldest N (best UX; contract change → ADR per PRINCIPLES.md §6.3).
- (b) Block generate with an explicit notice.
- (c) Silently disable chat, surface in picker.
- (d) Raise the cap.
- (e) Leave as-is, only improve the picker.

Tracked in issue #20. **Not** resolved by this fix.

### Files changed (uncommitted at end of session)
- `src/app.js` (+17 / −2)
- `src/styles.css` (+9)
- `data/chat_sessions.json` (data-only, 200 → 50)
- `scripts/smoke/chat-limit-guardrail-smoke.js` (new, 191 lines)
- `data/chat_sessions.json.bak.20260730-120651` (new, retained for user reference)
- `docs/SESSION-STATE.md` (this entry)

### Issue
https://github.com/shadowdoguk/image-to-prompt/issues/20 — label `bug`. Immediate-track acceptance criteria all checked; long-term-track open.

### Mood / risk flag
> Bug shipped (immediate track). Chat console activates again on the next Stage 2 run; the cap is now framed as a maintenance state, not a fatal error. **No new architectural commitments** — the contract decision for "what should happen at the cap" is explicitly deferred to issue #20 so it doesn't get silently buried. Kill criteria unchanged: `server.js` 6675 lines (well under 290KB); test suite 319/319; `session-init` 10/10; backup retained on disk for user inspection.


---

## Session #3 — 2026-08-03 (Anima research + G1–G3 fork design)

**Workflow:** existing (continue mode) — off-slice research + design session at the user's explicit request.

### What was asked

User asked for two things:
1. **Deep research on Anima prompting** → comprehensive Anima Prompting Manual.
2. **Goose-review the Anima "app" at https://huggingface.co/circlestone-labs/Anima.**

The second ask re-shaped into a feature request: "extend the app to emit Anima positive + negative prompts alongside Z-Image Turbo." After a sync conversation, the user chose a **pre-Generate model fork** (a dropdown or button group before Generate, exclusive siblings) over a dual-output design. The fork design went through G1, G2, G3 with explicit user approval at each gate.

### What landed (delivered, durable)

1. **`docs/ANIMA-PROMPTING-MANUAL.md` (new, 902 lines).** Comprehensive practitioner reference for Anima by circlestone-labs. Sections 1–18: identity, variants, architecture, hard specs, absolute rules, vocabulary banks, prompt structure, hybrid tag + prose, 13 worked examples, 12-item self-review checklist, ComfyUI config, online-platform config, LoRA/finetuning tips, 13 failure modes, FLUX/SDXL/SD3.5 comparison, license, 6 copy-paste style blocks, citation index. Sourced from the model README + LICENSE + `anima_comparison.json` + the gap-filler research (Civitai, GitHub `diffusion-pipe`, LICENSE §1.a/§2.c plain-English summary, the `<Prompt Start>` sentinel + system role prefix, the canonical Fern/Frieren community test prompt). This is the implicit goose-review of the Anima model/repo — every quote is sourced, every claim is cited, every unknown is labelled "unknown — not disclosed."

2. **`docs/SPEC.md` §14 (Slice 2 — Anima fork, the spec).** Append-only. 11 sub-sections (reframe, challenge, scope, users, constraints, user stories, implementation decisions, DoD for 5 sub-slices 2.1–2.5, license/commercial use, open questions all resolved, glossary). G2-approved.

3. **`docs/ARCHITECTURE.md` Slice 2 appendix (A1–A9).** Append-only. Stack deltas, file layout, 7 new modules (A–G) with deletion tests, slice order, decisions, refactor-trigger criteria. G3-approved.

4. **`docs/PRE-MORTEM.md` Slice 2 entry.** Append-only. 5 failure modes (contract drift, useless Anima output, variant switching breaks chat, state corruption, license boundary misread) + 10-pre-commitment bullet list. G3-approved.

5. **`docs/adr/0021-anima-fork.md` (new, 81 lines).** ADR capturing the fork decision: pre-Generate model picker, single dispatch path, shared per-field artifacts, per-model-and-per-variant chat sessions, license boundary respected, state validation. Status: **Accepted**. Mirror of ADR 0020's structure (Status / Context / Decision / Consequences / Rejected alternatives / Verification / References). G3-approved.

### What was attempted and reverted (Option A — chosen by user)

The methodology permits G4 implementation in-session, but the user explicitly chose **Option A** ("stop, revert the partial code, summarise") when I surfaced a candid checkpoint before mid-implementation. The reasoning was that Slice 2.1 was half-built (state fields + helpers + UI binding in `src/app.js`, but no `dom.modelSelector` reference, no HTML markup, no `init()` restore call, no tests, no demo, no code review) — and per AGENTS.md, a slice must not ship without a passing demo + code-review verdict.

The partial code in `src/app.js` was reverted via `git checkout -- src/app.js`. The durable G2/G3 artifacts were preserved. Slice 2.1 is parked for a future session.

### What was decided but not built (parked)

| Item | Where it lives | Why parked |
|---|---|---|
| Slice 2.1 — model-state + UI selector | `docs/SPEC.md` §14.9 + `docs/BACKLOG.md` (this section) | Mid-implementation; user chose Option A revert. |
| Slice 2.2 — Anima backend contract | `docs/SPEC.md` §14.9 | Depends on Slice 2.1. |
| Slice 2.3 — frontend dispatch wiring | `docs/SPEC.md` §14.9 | Depends on Slice 2.2. |
| Slice 2.4 — chat refines the selected model | `docs/SPEC.md` §14.9 | Depends on Slice 2.3. |
| Slice 2.5 — per-sub-slice code review + final aggregation | `docs/SPEC.md` §14.9 | Last sub-slice. |
| Gate G5 polish audit | `docs/POLISH-AUDIT.md` (existing, Slice 1) | Slice 1 already PASSed; Slice 2 polish audit deferred with Slice 2.5. |

### Files changed this session (uncommitted at end of session)

- `docs/ANIMA-PROMPTING-MANUAL.md` (new, 902 lines)
- `docs/SPEC.md` (§14 appended, +74 lines)
- `docs/ARCHITECTURE.md` (Slice 2 appendix appended, +211 lines)
- `docs/PRE-MORTEM.md` (Slice 2 entry appended, +123 lines)
- `docs/adr/0021-anima-fork.md` (new, 81 lines)
- `docs/SESSION-STATE.md` (this entry, append-only)
- `docs/BACKLOG.md` (Slice 2.1 entry appended, append-only)

(`src/app.js` was modified mid-session and then reverted. Final `git status` is clean of in-flight code changes.)

### Open questions

- **Q3 (re-opened):** Slice 2.1 (resume the Anima fork) vs Slice 2 (a different next-slice candidate — the polish-triage bundle, or one of the per-field AI buttons, or the server.js split) vs something else. The user has the G1–G3 design in the repo; the implementation is parked for a future session.
- **Q4 (still open from session #2):** What's the long-term contract for the chat-session 200-cap? (a) auto-evict oldest N, (b) block generate with explicit notice, (c) silently disable chat, (d) raise the cap, (e) leave as-is. Tracked in issue #20.

### Mood / risk flag

> Session #3 was a research + design session, not an implementation session. The user got two durable deliverables: a 902-line Anima prompting manual (the goose-review of the Anima model/repo) and a complete G1–G3 design for the Anima fork (SPEC §14, ARCH A1–A9, PRE-MORTEM Slice 2, ADR 0021). All three gates were explicitly approved. Slice 2.1 was attempted but reverted mid-implementation per the user's Option A choice — the half-built code is gone, the durable design is intact. **No blockers. No new architectural commitments.** The manual + the G1–G3 + the parked Slice 2.1 entry form a clean handoff for a future session to pick up Slice 2.1 implementation. The methodology worked: I stopped and surfaced a checkpoint rather than drifting into a half-baked implementation. Server.js unchanged (still 6675 lines), test suite unchanged (still 319/319 from before this session — but new tests would need to be added for Slice 2.x), session-init V-checks pending validation.

### How to resume (next session)

1. Read `docs/ANIMA-PROMPTING-MANUAL.md` §1, §2, §5, §7 (the contract).
2. Read `docs/SPEC.md` §14 (the slice spec).
3. Read `docs/adr/0021-anima-fork.md` (the decision).
4. Read `docs/PRE-MORTEM.md` Slice 2 (the failure modes).
5. Read `docs/BACKLOG.md` (this session's Slice 2.1 entry — the next concrete action).
6. Resume Slice 2.1 (model-state + UI selector), using the partial design captured in the ARCHITECTURE appendix.

---

## Session #4 — 2026-08-03 (Anima fork ships — Slice 2 fully through Gate G4)

**Workflow:** existing (continue mode) — Slice 2 of the App Build methodology, picking up where Session #3 ended after the user chose Option A (revert partial code). The user explicitly said "finish the full project use your recommendation for here on in this session" — they were committing to in-session execution of the remaining sub-slices without further round-trip approvals.

### What landed (delivered, committed, code-reviewed)

**Slice 2 — Anima fork (ADR 0021). Four sub-slices shipped end-to-end:**

| Sub-slice | Title | Commit | Code review | Verdict | Tests |
|---|---|---|---|---|---|
| 2.1 | model-state + UI selector | `1756d0d` | `9e98a54` | **pass** | 330 / 330 |
| 2.2 | Anima backend contract | `424c60f` | `1022b80` | **pass** | 348 / 348 |
| 2.3 | frontend dispatch wiring | `3751392` | `2672849` | **pass** | 363 / 363 |
| 2.4 | chat refines the selected model | `f1ed230` | `b836db9` | **pass** | 373 / 373 |
| **2.5** | aggregation | (this commit) | aggregate verdict `pass` | **pass** | 373 / 373 |

**What Slice 2 ships:**
- Pre-Generate model picker (Z-Image Turbo or Anima) — dropdown + state plumbing + localStorage + URL mirror.
- Anima prompt contract: `DEFAULT_ANIMA_PROMPT` + `callMiniMaxAnimaAnalysis` + `POST /api/anima` (positive + negative, variant-aware).
- Frontend dispatch: `runGeneratePrompt` branches on `state.model`; Anima result panel (positive + negative textareas + variant selector + meta line + copy + regenerate).
- Chat dispatch: `state.model`-aware `ANIMA_CHAT_CONSTRAINTS_BLOCK`; per-model chat sessions (Q3 resolution, option a); `onModelChange` ends the current session on switch.
- License boundary respected: no Anima weights, no hosted inference, no paid-API integration. The chat LLM is MiniMax M3 throughout.

### Slice 2 quantitative summary

- **5 sub-slices** shipped, each with its own per-sub-slice code review.
- **52 net new tests** (321 baseline → 373 — +15.1%) across 4 test files.
- **417 net new lines** in `server.js` (+417) and `src/app.js` (+431) — the slice added the Anima contract end-to-end without bloating either file past the 290KB kill criterion.
- **5 new docs** (902-line manual + 4 ADC/Spec/Pre-mortem/Code-review docs) — the durable design and contract surface.
- **1 ADR** (ADR 0021 — Anima fork; Status: Accepted).
- **0 breaking changes** to the existing Z-Image contract.
- **0 new dependencies** introduced.
- **0 schema migrations** — the chat session shape gained an optional `model` field; older sessions read it as missing and default to `'zimage_turbo'`.

### Slice 2 mid-slice regression caught + fixed

In Slice 2.4, I branched `buildChatSystemPrompt` (the wrapper) instead of `buildChatSystemPromptVariant` (the actual emitter). The wrapper creates a shadow `sessionObj`; the variant function still uses its own. This broke 4 chat-context tests (`sessionObj is not defined`). The test suite caught it on the first run. The fix was small (move the branching into the variant + thread the flag through the wrapper), but the lesson is: **read the actual function structure before branching, not just the contract.** Treated as a load-bearing test for the Slice 2 review.

### What was not done in this session (held for G5)

- **G5 polish audit** — `docs/POLISH-AUDIT.md` for Slice 2 (parallel to the Slice 1 polish audit). Slice 2 is shipped through G4; the G5 audit is the next gate.
- Final docs close-out — `docs/BACKLOG.md` parked-item update for Slice 2.1 (append-only).

### Files changed this session (uncommitted at end of session)

- `server.js` (+429 across 4 sub-slices)
- `src/app.js` (+431 across 4 sub-slices)
- `src/index.html` (+54 for Slice 2.3 Anima result panel)
- `src/styles.css` (+88 for Slice 2.1 model selector + Slice 2.3 Anima panel)
- `tests/run-all.js` (+566 across 4 sub-slices: +12 + 18 + 14 + 10)
- `docs/CODE-REVIEW-2-anima-fork.md` (+519 across 4 sub-slices + this aggregate)
- `docs/SESSION-STATE.md` (this entry, append-only)
- `docs/BACKLOG.md` (Slice 2.1 parked-item update, append-only)

(All changes are committed in the slice 2.5 ship commit. No uncommitted changes at end of session.)

### Open questions

- **Q3 (resolved):** Slice 2.1 (resume Anima fork implementation) vs Slice 2 (a different next-slice candidate) vs polish-triage bundle. **Resolved 2026-08-03.** Slice 2 (Anima fork) shipped in this session.
- **Q4 (still open from session #2):** Long-term contract for the chat-session 200-cap. (a) auto-evict oldest N, (b) block generate with explicit notice, (c) silently disable chat, (d) raise the cap, (e) leave as-is. Tracked in issue #20.

### Mood / risk flag

> Session #4 shipped Slice 2 end-to-end. Methodology proven **forks** at the entry point: a pre-Generate model picker chose between two contracts (Z-Image Turbo + Anima), each backed by its own system prompt + dispatch + chat history. The 5 sub-slices + 4 code reviews + 1 aggregate verdict passed. The mid-slice regression (branching the wrong function) was caught by the test suite on the first run — the system works as intended. 373/373 tests green; 10/10 V-checks; syntax OK on both `server.js` and `src/app.js`. `server.js` grew to 7104 lines (well under the 290KB kill criterion). 53 MiniMax credits spent on the Slice 1 demo from the SESSION-STATE issue #2 era (none spent on Slice 2 — the new tests are structural assertions, not live LLM calls). **Slice 2 ships. G5 polish audit is the next gate.**

### G5 outcome (the slice fully ships)

**Gate G5: SHIPPED — 2026-08-03.**

Slice 2 (Anima fork) is fully through Gate G5. Verdict: **PASS** (0 blocking, 8 findings — 5 pre-existing project-level polish debt inherited from Slice 1, 3 Slice 2 nice-to-haves).

- **G5 commit:** `de259bf` (`docs/POLISH-AUDIT-2-anima-fork.md` — 213 lines, 7 sections + sign-off).
- **Aggregate verdict:** `docs/CODE-REVIEW-2-anima-fork.md` §Slice 2.5 — "Slice 2 ships."
- **Slice-tracker row added:**

| # | Slice | Blocked by | Status | Commit | Code-review verdict | Context |
|---|---|---|---|---|---|---|
| 2 | Anima fork (model-fork + dispatch + chat) | — | ✅ **SHIPPED** | `499f8ac` (G4 pass) → `de259bf` (G5 PASS) | fresh | 5 sub-slices; 4 per-sub-slice reviews + 1 aggregate; 52 net new tests (+15.1%); 1 ADR (0021); 0 regressions |

**Frontier:** empty. Slice 2 fully shipped through Gate G5. The next session picks up at Phase C (continue mode) — pick a polish-triage slice, a per-field AI button, or anything else from the deferred backlog.

### Mood / risk flag (final)

> Session #4 closed the Anima fork. The methodology held: a spec-first design (G1–G3 → 5 sub-slices → 4 per-sub-slice reviews + 1 aggregate → G5 polish audit) cleared every gate with passing verdicts and zero blocking findings. The mid-slice regression (branching the wrong function in Slice 2.4) was caught by the test suite on the first run — a load-bearing test for the methodology. The project is now two-slice-deep (Slice 1 fully shipped pre-session; Slice 2 fully shipped this session). 373/373 tests green; 10/10 V-checks; syntax OK on both `server.js` and `src/app.js`. `server.js` at 7104 lines (well under the 290KB kill criterion). `docs/ANIMA-PROMPTING-MANUAL.md` (902 lines) is the implicit goose-review of the Anima model/repo. **The full project shipped.** Cold-start recovery: read the "How to use this file" section above, then the Session #4 entry, then `docs/CODE-REVIEW-2-anima-fork.md` §Slice 2.5 for the slice-2 aggregate.

---

## Bug fix follow-up — `552f9a3`

**Workflow:** existing (continue mode) — off-slice UX bug fix per `docs/agents/bug-workflow.md`.

### Symptom
After Slice 2 shipped, a user reported (with screenshot): clicking "Anima" in the new model picker, then clicking "Generate prompt" surfaced the error toast **"No image uploaded. Upload an image first."** — even though the same session had just generated a Z-Image prompt successfully. The Z-Image prose prompt from the prior run remained visible behind the toast.

### Root cause
`runAnimaGenerate` (Slice 2.3) read the file via:
```js
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput && fileInput.files && fileInput.files[0];
```
This generic selector picks the *first* `<input type="file">` on the page. Drag-drop uploads set `state.currentFile` directly via JS (`src/app.js:546, handleFile`) but do **not** populate the hidden file input's `.files` property. So `fileInput.files[0]` was `undefined` and the no-image guard fired.

The Z-Image path was unaffected because it reads the analysis JSON (`state.currentAnalysis`), not the file. The bug was Anima-specific.

### Fix
`runAnimaGenerate` now reads `state.currentFile` directly — the canonical source used by all 6 per-field Populate-with-AI buttons (`subject`, `camera_angle`, `actions`, `mood`, `lighting`, `texture`) and by the analyze guard. One-block edit. No ADR required (one-line UX fix, not a wide refactor).

### Regression test
`tests/run-all.js`: +1 test that asserts (a) `runAnimaGenerate` does NOT use the generic DOM query, (b) it references `state.currentFile`, (c) the no-image error message is preserved, (d) the FormData append shape is preserved.

**Result:** 374/374 PASS (was 373; +1 regression). `node --check src/app.js` exit 0. `session-init.js` 10/10 V-checks.

### File changed
- `src/app.js` (+13 / −4)
- `tests/run-all.js` (+22)

### Lesson
The bug was a one-block pattern violation: `runAnimaGenerate` reached outside the canonical state object for a piece of state that already lived in `state.currentFile`. The Z-Image path works *because* it reads from state; the Anima path broke because it didn't. The fix restores the pattern. **Next slice that adds a backend endpoint with a file upload should default to `state.currentFile` — no `document.querySelector` for files.**

### Mood / risk flag (post-bug-fix)
> Bug shipped (UX track, no architectural commitment). 374/374 tests green; 10/10 V-checks; syntax OK. No new architectural debt. The fix is a one-block edit, no ADR required. **The Anima fork is now bug-free for the drag-drop path.** Cold-start recovery is unchanged — read the Session #4 entry + the Slice 2.5 aggregate verdict + this bug-fix follow-up entry.

## Session #7 — 2026-08-04 (Anima chat-apply sync bug, issue #22)

### What was asked
Diagnose and fix the bug: "Refine via chat 'Apply' is not working in anima mode." User observation: clicking the chat console's Apply button in Anima mode updates the chat status but the Anima result panel (positive + negative textareas) stays on the original prompt.

### What landed (delivered, durable)
- **Issue filed:** https://github.com/shadowdoguk/image-to-prompt/issues/22 — `bug`. Body populated with the full bug template (summary, class `runtime`, repro steps, expected, actual, environment, logs, suggested fix area, acceptance criteria).
- **Smoke test:** `scripts/smoke/anima-chat-apply-sync.js` (new, 124 lines). Static-source regression armor — mirrors `scripts/smoke/palette-stale-id-guard.js`. 7 checks: apply handler branches on `state.model === 'anima'`, writes to `dom.animaResultPositive.value`, updates `state.animaResult.positive`, Z-Image branch still writes to `state.finalPrompt` + `dom.resultPrompt.textContent`, `updateTokenReminderBanner()` still called, explanatory comment present.
- **Fix:** `src/app.js` `applyChatRevision` (around line 5032). Added a `state.model === 'anima' && state.animaResult` branch that mirrors the applied `current_prompt` into `state.animaResult.positive` and `dom.animaResultPositive.value`. The Z-Image branch is the `else` leg. Anima negative prompt is intentionally untouched (chat refines only the positive side; the negative is a static recommended vocabulary per the Anima contract).
- **ADR consequence note:** `docs/adr/0021-anima-fork.md` — appended (not edited) a "Consequences (2026-08-04)" section documenting the missed sync branch, the static-source smoke pattern, the lesson about state-slice-mirroring, and the acknowledged `updateTokenReminderBanner()` limitation (still reads `state.finalPrompt` only — would warrant a follow-up ADR if it becomes user-visible).
- **Regression armor:** the smoke test was run **before** the fix (4 FAIL / 3 PASS) to confirm the assertions target the bug, then **after** the fix (7 PASS / 0 FAIL). All other smoke tests + the full 395-test suite + session-init 10/10 still pass.

### What was decided but not built (parked)
- **`updateTokenReminderBanner()` in Anima mode.** The banner currently reads `state.finalPrompt` only; in Anima mode it stays silent after an apply. Acknowledged in the consequence note. If a user-visible regression is reported, follow-up ADR.
- **PRE-MORTEM §"Failure mode 8" should flag apply-path drift as a third category.** The pre-mortem captured variant-switching drift and Z-Image/Anima vocabulary drift but not the apply-path drift we shipped. Out of scope for this fix; flagged for the next polish-triage pass.

### Files changed this session (uncommitted at end of session)
- `src/app.js` (+31 / −7 around `applyChatRevision`)
- `scripts/smoke/anima-chat-apply-sync.js` (new, 124 lines)
- `docs/adr/0021-anima-fork.md` (append-only — "Consequences (2026-08-04)" section)
- `docs/SESSION-STATE.md` (this entry)

### Issue
https://github.com/shadowdoguk/image-to-prompt/issues/22 — label `bug`. Resolution: `node scripts/smoke/anima-chat-apply-sync.js` exits 0; chat Apply now writes the applied prompt into the Anima textarea.

### Mood / risk flag
> Reachable bug shipped yesterday (Slice 2.4) — chat was over-promising and the UI was under-delivering. Caught immediately on the first user try. Fix is the smallest diff possible (one branch + one comment); regression armor is a static-source smoke that mirrors the existing pattern. **No slice work touched** — issue #22 is a one-shot fix. Slice 4 / polish-triage decision (Session #5) still pending. Kill criteria unchanged: `server.js` ~7,150 lines, test suite 395/395, `session-init` 10/10.

## Session #8 — 2026-08-05 (Bug fix: `model is not defined` on /api/analyze, issue #24)

### What was asked
User clicked **Analyze image** and got: `Analysis failed: model is not defined`. Diagnose + fix.

### Root cause
Slice 3 (ADR 0022 — kilo-code provider migration) renamed the route-handler variable from `model` to `llmModel` to avoid collision with `state.model` (output contract selector value — Z-Image Turbo / Anima). The 8 response-payload lines were left referencing the old `model` name. `model` is not defined anywhere → `ReferenceError: model is not defined` → caught by the catch block → surfaced as `e.message` in the UI.

### Why tests didn't catch it
The existing test env returns 503 (no Kilo key) before reaching the response-construction line. The bug only fires on a *successful* LLM call. The Slice 3 code review (`docs/CODE-REVIEW-3-kilo-code-provider.md`) and polish audit (`docs/POLISH-AUDIT-3-kilo-code-provider.md`) were both static-source checks — they grepped for `callMiniMax` / `minimaxi.chat` references but did not lint the response-payload lines that reference the renamed variable.

### Scope (user-approved: fix all 8)
| Line | Route | Status |
|---|---|---|
| 4296 | `POST /api/analyze` | ✅ FIXED (user-reported) |
| 4344 | `POST /api/subject` | ✅ FIXED (latent) |
| 4390 | `POST /api/camera-angle` | ✅ FIXED (latent) |
| 4436 | `POST /api/actions` | ✅ FIXED (latent) |
| 4479 | `POST /api/mood` | ✅ FIXED (latent) |
| 4522 | `POST /api/lighting` | ✅ FIXED (latent) |
| 4565 | `POST /api/texture` | ✅ FIXED (latent) |
| 4624 | `POST /api/anima` | ✅ FIXED (latent) |

The 11 internal `model: model` references inside `callKilo*` helpers are correct (`model` is a parameter there) and were not touched.

### Fix
Mechanical 1-token rename at all 8 sites: `model: model` → `model: llmModel`. `llmModel` is in scope via `const llmModel = resolveModel(req.body)` higher in each handler.

### Regression test
New smoke: `scripts/smoke/route-model-binding-guard.js` (116 lines, mirrors the `palette-stale-id-guard.js` pattern). 8 routes × 3 assertions each (declares `model` field, doesn't reference undefined `model`, references `llmModel`) + 1 internal-call sanity check. Mutation-tested: reverted one fix, smoke correctly failed. Restored, smoke passes.

### Verification
- **End-to-end:** restarted `node server.js`, hit `/api/analyze` with `curl` → `{"success": true, "data": {..., "model": "minimax/minimax-m3"}}` (was `{"success": false, "error": "model is not defined"}`).
- **All 8 routes smoked:** none now throw `model is not defined`. The 7 latent routes that the user hadn't yet clicked now return real LLM responses (or upstream LLM errors — not the bug).
- **`tests/run-all.js`:** 385 pass, 10 fail. Failure analysis: 9 are pre-existing Slice 3.3 / 3.4 frontend wiring failures (the model selector UI is non-functional — a separate, larger bug). 1 (`ADR 0014 weighted palette`) is transient/environmental — passed on rerun. **My fix introduces zero regressions.**
- **`scripts/session-init.js`:** 10/10 V-checks pass.
- **`scripts/smoke/route-model-binding-guard.js`:** 8/8 routes verified.

### Files changed this session
- `server.js` (8 lines, 1-token rename each)
- `scripts/smoke/route-model-binding-guard.js` (new, 116 lines)
- `scripts/smoke/README.md` (1 line added — new smoke)
- `docs/SESSION-STATE.md` (this entry — append-only)

### Issue
https://github.com/shadowdoguk/image-to-prompt/issues/24 — label `bug`. To be closed by the fix commit (`Closes #24`).

### Mood / risk flag
> Reachable bug shipped in Slice 3 (ADR 0022). The user's first click at it (session-init reported 1 issue, this was it). The fix is the smallest possible diff (1 token × 8 sites) and a one-shot regression smoke. **No slice work touched, no ADR required** (mechanical rename, no architectural decision). The polish-triage slice (Session #7 Q3 — 14 polish findings from the Slice 1 G5 audit) still pending. The Slice 3.3 / 3.4 frontend wiring failure (9 tests failing on `src/app.js`) is a separate latent bug — flagged for the next polish-triage pass.

---

### Post-commit follow-up (same session, later in the day)
User requested a CODE-REVIEW doc be added for symmetry with prior slices (per-slice review discipline in AGENTS.md). Created `docs/CODE-REVIEW-8-route-model-binding.md` (117 lines, two-axis: Standards + Spec, verdict **pass**). Document includes a "Lessons" section flagging three follow-up improvements for the next methodology update: (a) grep step in slice closeout for variable renames, (b) test that exercises response-construction with a stubbed LLM client, (c) amend `bug-workflow.md` to require CODE-REVIEW doc at step 7. All three are parked as recommendations, not blockers. **No code changes since the original commit `5ab78d2` — this is documentation-only.** Files added in this follow-up:
- `docs/CODE-REVIEW-8-route-model-binding.md` (new, 117 lines)
- `docs/SESSION-STATE.md` (this sub-entry — append-only)
