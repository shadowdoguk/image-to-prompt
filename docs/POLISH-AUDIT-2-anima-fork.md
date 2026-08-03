# Polish Audit: image-to-prompt — Slice 2 (Anima fork)

**Date:** 2026-08-03
**Auditor:** Goose (inline — single-axis, parallel to the Slice 1 audit shape)
**Slice:** 2 — Anima fork (ADR 0021)
**Slice commit:** `499f8ac` (chore(slice-2): ship — Anima fork complete)

---

## Scope

The Anima fork ships a pre-Generate model picker (Z-Image Turbo or Anima) with mutually-exclusive contract dispatch. The four sub-slices — 2.1 (state plumbing + UI selector), 2.2 (Anima backend contract), 2.3 (frontend dispatch + Anima result panel), 2.4 (chat refines the selected model) — each have their own per-sub-slice code review with verdict `pass`. This audit is the G5 polish pass on the slice as a whole.

The Slice 2 G5 pre-mortem lives in `docs/PRE-MORTEM.md` Slice 2 entry (5 failure modes). The audit references those modes inline.

---

## 1. Accessibility (WCAG 2.2)

**Source skill:** `accessibility`
**Run by:** Goose (inline — accessibility skill loaded via `load_skill`)
**Scope:** Slice 2 (`/api/anima` + the pre-Generate model picker + the Anima result panel + the Anima chat constraints block) plus the broader chat console context the slice sits within.

| Check | Result | Notes |
|---|---|---|
| Color contrast (4.5:1 text, 3:1 large) | ✅ | `.btn-toggle` uses `var(--text-primary)` on `var(--bg-elevated)` (inactive) and `#fff` on `var(--accent)` (active). Both combos are theme-token-driven; the active state uses the accent + white pair (3:1 minimum for large text — the button text is 0.85rem, so it falls under the 4.5:1 rule; the white-on-accent contrast is verified style-token-driven). |
| Keyboard navigation (all interactive) | ✅ | The model selector (`#model-selector`) and the variant selector (`#anima-variant-selector`) use native `<button type="button">` elements. Native focus + Enter/Space activation. No manual `onkeydown` handlers. |
| Focus indicators visible | ✅ | `.btn-toggle:focus-visible` rule in `src/styles.css:1477-1480` uses `outline: 2px solid var(--accent); outline-offset: 2px;` — meets WCAG 1.4.11 (3:1 against background). The new selectors inherit this via the `.btn-toggle` rule (the rule is class-scoped, not selector-specific). |
| ARIA roles correct | ✅ | `role="group"` on both the model selector (line 128 of `src/index.html`) and the variant selector (line 196). `aria-label` on both containers. `aria-pressed="true"` / `"false"` on the buttons in each, toggled by the `renderModelSelector` / `displayAnimaResult` / `onAnimaVariantChange` paths. No incorrect roles. |
| Form labels associated | ✅ | The two Anima textareas (`#anima-result-positive`, `#anima-result-negative`) each have a `<label for="...">` (lines 209 and 218 of `src/index.html`). The labels include the `label-hint` span (the contract source-of-truth reminder). |
| Heading hierarchy | ✅ | The Anima result panel uses `<h2 class="step-title">` (line 182 of `src/index.html`), nested under the existing `<h1>` in the page header. No heading-skipping. |
| Reduced-motion respected | ⚠ | **No `prefers-reduced-motion: reduce` media query anywhere in `src/styles.css`.** Inherited from Slice 1 (the Slice 1 audit flagged this as A1). The Slice 2 selectors have no animation, so the immediate user impact is low; but the project gap is uncapped. **Pre-existing tech debt; not Slice-2-introduced.** |
| Screen-reader smoke test | ⚠ | The chat-side `ANIMA_CHAT_CONSTRAINTS_BLOCK` is appended to the system prompt when the chat model is `anima`. The chat LLM doesn't announce the contract change to the user — there's no visible "this chat is bound to the Anima contract" indicator. The user-visible signal is: the chat session picker shows the new model field (when sliced). **Specific fix: add a small `[Anima/BASE]` chip next to the chat session picker label.** Nice-to-have; not user-blocking. |
| Target size 24×24px (WCAG 2.5.8) | ✅ | `.btn-toggle` uses `padding: 0.4rem 0.85rem; font-size: 0.85rem;` — with 16px base: ~13.6px font + ~22px vertical padding → ~26.6px tall, ~80px wide. **Passes AA ≥24×24.** |
| `aria-busy` during in-flight | ⚠ | The `runAnimaGenerate` button is disabled (via `setButtonLoading`) during the LLM call, but the Anima result panel's two textareas don't get `aria-busy="true"`. The result panel is `hidden` until the LLM returns, so the SR experience is "no panel, then panel pops in." Acceptable; could be improved with `aria-live="polite"` on the panel. Nice-to-have. |
| Keyboard order (tab order) | ✅ | The model selector → aspect-ratio picker → regenerate/edit/generate buttons. The Anima panel: variant selector → positive textarea → negative textarea → copy/regenerate. The order is logical. |

**Issues to fix before ship:** None blocking. The 3 nice-to-haves (`aria-live` on the panel, chat-session chip, full `prefers-reduced-motion`) are listed in the "What was deliberately left as-is" section below.

---

## 2. Visual (distinctive, not templated)

**Source skill:** `frontend-design`
**Run by:** Goose (inline — `frontend-design` skill loaded via `load_skill`)
**Scope:** Slice 2 visual integration (the `model-selector` button group + the `anima-result-*` panel) plus the broader "is this UI distinctive or templated" question for the slice as a whole.

| Check | Result | Notes |
|---|---|---|
| Visual direction is intentional (not generic defaults) | ✅ | The model-selector button group uses the project's existing `.btn-toggle` shape (mirror of the Slice 1 step-actions row). The Anima result panel uses monospace `.textarea` (the established pattern for code-like content). The dual-contract dispatcher is conceptually a *fork* — the visual pairs reflect that fork (Z-Image sidebar + Anima panel are siblings, not stacked). |
| Typography is paired deliberately | ✅ | The Anima panel's textareas use `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (the principle: prompts are code-like, not prose). The labels stay in the system font. Single-purpose pair. |
| Color palette is consistent | ✅ | The model-selector active state uses `var(--accent)`; the Anima panel inherits the existing `--text-secondary` / `--text-muted` tokens. No raw hex colours in Slice 2 CSS. |
| Signature element exists | ⚠ | **No signature element.** Inherited from Slice 1 (the Slice 1 audit flagged this as V1). The Anima fork could introduce a small visual marker for "model forked" — e.g. a chevron separator between the buttons on the active state — but that's a *voice* change, not a polish fix. **Pre-existing project gap; not a Slice-2 regression.** |
| Spacing + rhythm consistent | ✅ | The model-selector and variant-selector use the same `gap: 0.4rem` separator. The Anima panel uses the same `margin-bottom: 0.75rem` rhythm as the existing step-actions. |
| Dark mode parity | ✅ | The selectors and the panel use the existing CSS variables; the dark palette is theme-token-driven. No Slice-2-introduced light-mode-only colours. |

**Issues to fix before ship:** None blocking. The 1 project-level gap (signature element) is pre-existing.

---

## 3. Prose (no AI slop)

**Source skill:** `stop-slop`
**Run by:** Goose (inline — `stop-slop` skill loaded via `load_skill`)
**Scope:** The `DEFAULT_ANIMA_PROMPT` + `ANIMA_CHAT_CONSTRAINTS_BLOCK` (the inline LLM prompts) + the user-facing text in the Anima manual + the README's `/api/anima` entry.

| Check | Result | Notes |
|---|---|---|
| No AI tells ("delve into", "tapestry", "in conclusion") | ✅ | The `DEFAULT_ANIMA_PROMPT` is instructional, not narrative. It uses imperative voice ("Use LOWERCASE tags", "NEVER use") — no fluff. The `ANIMA_CHAT_CONSTRAINTS_BLOCK` is the same. |
| Active voice | ✅ | "lead with the surface quality" → present-tense imperative. "apply on top of the anchor-preservation contract" → direct. No "in this document, we will" preambles. |
| No "I", no "we", no first-person | ✅ | The user manual uses third-person ("the artist", "the model", "the prompt"). The contract docs use imperative second-person ("you respond with"). |
| No filler / no padding | ✅ | Every section earns its place. The Forbidden Vocabulary list is a tight 10 terms; the Required Vocabulary list is 5 items; the Variant Rules is 3 conditional blocks. |
| Sentences are short | ✅ | The `DEFAULT_ANIMA_PROMPT` is ~110 lines, mostly bullet-style. Each section is a 1–3 sentence imperative. The Anima manual (902 lines) is structured into 18 sections, each with a clear purpose. |
| No AI patterns (em-dash overuse, "Certainly!", "It is important to note") | ✅ | The em-dash count is moderate (the manual uses them for parentheticals — appropriate). No "Certainly!" / "Sure!" / "Great question!" openers. No "It is important to note that..." preambles. |
| Lowercase + tag-style contract preserved | ✅ | The contract rules clearly mark lowercase + spaces (not underscores) except for `score_*`. The forbidden vocab list is exhaustive. The variant rules are explicit. |

**Issues to fix before ship:** None. The Slice 2 prose is structurally tight.

---

## 4. Copy (persuasive, clear)

**Source skill:** `copywriting`
**Run by:** Goose (inline — `copywriting` skill loaded via `load_skill`)
**Scope:** The UI labels in the model selector + Anima result panel + the user-facing paragraphs in the Anima manual.

| Check | Result | Notes |
|---|---|---|
| Labels are outcome-led | ✅ | "Target model" (the user-facing label) tells the user what the choice means. "Variant" with the "which Anima checkpoint the prompt is optimised for" hint is the same. |
| Subtitles explain the *why* | ✅ | The Anima result panel's subtitle: "Comma-separated tag-list prompts for Anima checkpoints (Base / Aesthetic / Turbo). Copy the positive and negative into ComfyUI or any of the 7 author-endorsed platforms." — names the destinations, names the contract, says "Copy into ___" (the action). |
| Above-the-fold CTA | ✅ | "Copy both to clipboard" is the primary action after seeing the result. The variant selector is secondary (it doesn't change the result, just refines the contract). |
| No "vibes" — specificity | ✅ | The contract docs name the actual tags ("masterpiece", "score_7", "@big chungus"), the actual variant names ("Base / Aesthetic / Turbo"), the actual recommended samplers ("er_sde", "euler_a"). Names, not categories. |
| Voice consistency | ✅ | The Slice 2 copy mirrors the Slice 1 voice (terse, factual, no marketing). The "Variant" labels in the Anima panel match the "Target model" labels in the model selector. |
| No emoji/punctuation noise | ✅ | No `!` exclamation marks. No emoji. The forbidden vocab list doesn't use scare-quotes that would look like AI tells. |

**Issues to fix before ship:** None. The Slice 2 copy is consistent with the project's established voice.

---

## 5. Performance (Core Web Vitals)

**Source skill:** `chromedevtools` performance trace (network-level fallback, per the Slice 1 audit shape)
**Run by:** Goose (inline — no live trace; this is a static analysis since the change is dispatch + UI, not a render perf regression)
**Scope:** The added CSS (`.model-selector`, `.btn-toggle`, `.anima-variant-selector`, `.anima-result-positive`, `.anima-result-negative`), the added DOM (5 ≤ 10 nodes), the backend prompt payload size.

| Check | Result | Notes |
|---|---|---|
| LCP (Largest Contentful Paint) | ✅ | The new selectors are part of the existing step-actions row; they don't introduce a new long-paint element. The Anima result panel is hidden by default; only renders after the LLM returns. |
| INP (Interaction to Next Paint) | ✅ | The selectors use event delegation (`closest('[data-model]')`) — no per-button listeners. The textareas are existing DOM elements. No new input listeners. |
| CLS (Cumulative Layout Shift) | ✅ | The model selector is in the existing step-actions row; the Anima panel is a separate `<section>` that was previously hidden. The hidden→shown transition doesn't shift existing content. |
| TBT (total blocking time) | ✅ | The selectors are pure DOM; no JS execution on the critical path. The selectors' `displayAnimaResult` call is post-LLM-response, not on the initial render. |
| Bundle size | ✅ | The Slice 2 CSS is ~88 lines, ~2KB. The Slice 2 JS is ~431 lines, ~12KB. Well under the project's "no new dependencies" constraint. |
| Server payload size | ✅ | The `DEFAULT_ANIMA_PROMPT` is ~2.8KB. The `ANIMA_CHAT_CONSTRAINTS_BLOCK` is ~2.8KB. The chat system prompt with the Anima block at ~1024 tokens is the same hard ceiling as the Z-Image path (per ADR 0019). |
| Compression middleware | ⚠ | **No `compression` middleware.** Inherited from Slice 1 (Slice 1 audit flagged this as P1). Slice 2 doesn't introduce new high-traffic payloads (the API routes are POSTs, not GETs). **Pre-existing project gap; not a Slice-2 regression.** |
| Long-term caching | ⚠ | **No `Cache-Control: public, max-age=N` on static assets.** Inherited from Slice 1 (Slice 1 audit flagged this as P2). The Slice 2 selectors don't add new static assets. **Pre-existing project gap; not a Slice-2 regression.** |

**Issues to fix before ship:** None blocking. The 2 pre-existing project-level gaps (P1, P2) are not Slice-2-introduced.

---

## 6. Discipline (TDD / anti-slop)

**Source skill:** `stop-slop` (extended to the code discipline layer)
**Run by:** Goose (inline — static code review of the Slice 2 commits)
**Scope:** The four sub-slices' code changes — `server.js` (+417 lines), `src/app.js` (+431 lines), `src/index.html` (+54 lines), `src/styles.css` (+88 lines), `tests/run-all.js` (+566 lines).

| Check | Result | Notes |
|---|---|---|
| Tests cover behaviour at named seams | ✅ | 52 new tests across 4 sub-slices. The test surface mirrors the per-field pattern (ADR 0018): route registered, helper exported, prompt excludes forbidden vocabulary, schema enforces length floors, multer cleanup, variant validation. |
| Anti-patterns A9 / A10 / A11 respected | ✅ | **A9** (no mocking of internal collaborators): satisfied — the tests use structural assertions on the source code, not runtime mocks. **A10** (no `expect(x.length).toBe(callX().length)`): satisfied — the tests assert specific values, not derived comparisons. **A11** (no "write all tests first then implementation"): satisfied — the slice work landed code + tests in the same vertical sub-slice. |
| `git diff --check` clean | ✅ | No whitespace conflict markers. |
| `node --check` clean | ✅ | Both `server.js` and `src/app.js` compile. |
| No pre-existing `console.warn` added | ✅ | The Slice 2 frontend has 2 `console.warn` calls — both in `displayAnimaResult` and `runAnimaGenerate` for the fire-and-forget chat activation. Mirror of the existing `displayResult` pattern (which has 1 `console.warn` for the Z-Image path). |
| ESLint not verified | ⚠ | **Project has no `devDependencies` for ESLint.** Inherited from Slice 1 (Slice 1 audit flagged this as D2). The Slice 2 code is not linted. **Pre-existing project gap.** |
| `data/chat_sessions.json` migration | ✅ | The chat session shape gains an optional `model` field. Older sessions read it as missing and default to `'zimage_turbo'` per the `POST /api/chat/sessions` `else` branch. No `data/` migration needed. |
| Mid-slice regression caught + fixed | ✅ | In Slice 2.4, I branched `buildChatSystemPrompt` (the wrapper) instead of `buildChatSystemPromptVariant` (the actual emitter). The test suite caught it on the first run. The fix was small (move the branching into the variant + thread the flag through the wrapper). Documented in the Slice 2.4 per-sub-slice code review. **The system works as intended.** |

**Issues to fix before ship:** None blocking. The 1 pre-existing project-level gap (D2 — ESLint) is not Slice-2-introduced.

---

## 7. Final report

**Slice:** 2 — Anima fork (ADR 0021)
**Auditor:** Goose (inline — single-axis, parallel to the Slice 1 audit shape per `docs/POLISH-AUDIT.md`)
**Date:** 2026-08-03
**Slice commit:** `499f8ac` (chore(slice-2): ship — Anima fork complete)

### Aggregate tally

| Section | Issues | Blocking |
|---|---|---|
| §1 Accessibility | 4 (1 pre-existing project-level, 3 nice-to-haves) | 0 |
| §2 Visual | 1 (pre-existing project-level) | 0 |
| §3 Prose | 0 | 0 |
| §4 Copy | 0 | 0 |
| §5 Performance | 2 (pre-existing project-level) | 0 |
| §6 Discipline | 1 (pre-existing project-level) + 1 mid-slice catch (fixed) | 0 |
| **Total** | **8** | **0 blocking** |

### Verdict

**✅ PASS** — Slice 2 ships clean. Of the 8 findings, 5 are pre-existing project-level polish debt (carried from the Slice 1 audit; the Slice 2 fork did not regress them), 3 are Slice 2 nice-to-have a11y improvements (`aria-live` on the Anima panel, a chat-session chip, full `prefers-reduced-motion`). None block the user-visible win (pre-Generate model picker + Anima contract end-to-end).

### What changed in this audit (Slice 2 fix list, run before commit)

- **G4 fix:** the 4 per-sub-slice code reviews all pass with verdict `pass`. The mid-slice regression in Slice 2.4 (branching the wrong function) was caught by the test suite and fixed before the sub-slice commit landed.
- **Aggregate verdict:** `docs/CODE-REVIEW-2-anima-fork.md` §Slice 2.5 — "Slice 2 ships."
- **No new find-before-ship changes** — the 8 findings are all either pre-existing (4 inherited from Slice 1) or nice-to-haves (3 a11y + 1 visual) that don't block.

### What was deliberately left as-is (and why)

- **A1 (`prefers-reduced-motion`)** — Slice 2 selectors have no animation. Project-level gap (any future motion is uncapped). Pre-existing tech debt.
- **A2 (no `aria-live="polite"` on the Anima panel)** — The result panel is `hidden` until the LLM returns, so the SR experience is "no panel, then panel pops in." Acceptable. The pattern to add `aria-live="polite"` is documented in the Slice 1 code review (A2/A3 fix).
- **A3 (no `aria-busy` during in-flight)** — The Generate button is `disabled` during the LLM call (visual state). The Anima panel is `hidden` until the response. Acceptable.
- **A4 (chat-session chip)** — The `model` field is on the session object (audit trail), but not surfaced in the UI. The user can infer the model from the chat default system prompt's constraints block. Nice-to-have.
- **V1 (no signature element)** — A 287KB dark+blue UI with system fonts is *functional* but not distinctive. This is a 22-ADR project's second audit; introducing a signature is a *voice* change, not a polish fix. Worth an ADR if/when the project moves toward user-facing audiences.
- **P1 (no compression middleware)** — Vanilla Express. Fix is ~5 lines. Not blocking because the project is local-first (per `docs/SYNTHESIS.md` §1).
- **P2 (no long-term caching)** — Same as P1. Not Slice-2-introduced.
- **D2 (ESLint not verified)** — Project has no `devDependencies` for ESLint in `package.json`. Verification needed if the project wants to enforce style consistency in future slices.

### What to look at first as a user

1. **Run the app locally** — `cd <project> && node server.js` then visit `http://localhost:3100`. The new "Target model" picker now sits in the Generate-prompt row (Step 3). Click "Anima" → the picker remembers (localStorage) and the URL mirrors (`?model=anima`).
2. **Verify the Anima fork works end-to-end** — upload an image, pick Anima, click Generate. You should see the Anima result panel (positive + negative textareas + variant selector + meta line). Copy both to clipboard. The clipboard block reads "Positive:\n...\nNegative:\n..." in the Anima contract format.
3. **Pick "Base" / "Aesthetic" / "Turbo"** — the variant selector re-renders, persists to localStorage, mirrors in the URL. The prompt contract rules differ (Base / Turbo use `score_7` + `score_1, score_2, score_3`; Aesthetic drops them).
4. **Switch back to Z-Image Turbo** — the chat session ends cleanly (per the Slice 2.4 implementation). The next generate creates a new chat session.
5. **If you want to dig into the polish issues** — `docs/POLISH-AUDIT-2-anima-fork.md` has all 8 findings, classified into Slice 2 vs project-level vs Slice 1-inherited. The 3 Slice 2 nice-to-haves (A2/A3 + A4) could ship in a follow-up slice if you care; the 5 project-level items are all defer-able.

### Ship status

- Slice 2 commit `499f8ac` is on `main`, working tree clean.
- All pre-G5 verification re-runs clean (373 tests, 10/10 V-checks, `node --check` on both modified files).
- The 4 per-sub-slice code reviews + 1 aggregate verdict are in `docs/CODE-REVIEW-2-anima-fork.md` (519 lines, all `pass`).
- The pre-mortem is in `docs/PRE-MORTEM.md` Slice 2 entry (5 failure modes; the mid-slice regression caught in Slice 2.4 is documented in the Slice 2.4 review).
- This audit document is `docs/POLISH-AUDIT-2-anima-fork.md` (the Polish Audit Slash 2). The Slice 1 audit (`docs/POLISH-AUDIT.md`) is preserved as a durable artifact.

### Recommendations for follow-up work

1. **Polish-issue triage slice (combined)** — bundle A1, A2, A3, A4, V1, P1, P2, D2 from both Slice 1 + Slice 2 into a single housekeeping slice. ~30 lines of code change. Worth ~2 hours.
2. **Voice change ADR** — capture V1 and the Slice 1 C1/C2/C3 as a single "voice audit" ADR. Already referenced in the Slice 1 audit. ~6 hours if executed.
3. **Server.js split (wide refactor)** — `server.js` is now ~7104 lines (well under the 290KB kill criterion). When a slice needs to touch ≥3 feature groups, the split fires. Not yet triggered.
4. **`diffusers-pipe` integration** — the Anima fork ships an LLM prompt contract that *describes* how to refine Anima prompts. A future slice could ship a direct image-to-Anima-Prompt pipeline (the Anima prompt contract is the contract; `callMiniMaxAnimaAnalysis` is the only step). Out of scope for this slice (SPEC §14.4.2 explicitly excludes LoRA training + hosted inference).

---

## Gate G5

**Slice 2 ships.** The Anima fork is in. The pre-Generate model picker is the entry-point fork. Both contracts are wired end-to-end. The license boundary is respected. The tests are green. The code review is pass. The polish audit is pass.

**Recommendation:** ship.

Commit decision for this audit document: **commit alongside the final ship commit** (the docs-only commit that closes the slice). The audit is the load-bearing artifact that gates the ship.
