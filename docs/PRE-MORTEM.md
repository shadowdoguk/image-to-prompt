# PRE-MORTEM.md — image-to-prompt (Slice 1)

**Status:** Draft → In Review → Approved (pending Gate G3)
**Slice:** 1 — texture Populate-with-AI button
**Created:** 2026-07-29

**Purpose:** Imagine it's 2 weeks after Slice 1 ships. It failed. Why? Write the most likely reasons, with pre-commitments so we catch them now.

---

## Failure mode 1: The MiniMax prompt elicits useless output

**Narrative.** A user uploads a complex oil painting and clicks "Populate with AI" beneath texture. The endpoint returns `"A painted surface with visible brushwork."` (6 words, fails `minLength: 60`). The endpoint returns a 503. Or worse, the LLM slips past the floor with vague word-padding that adds no real signal. The user retries, gets the same thing, stops using the feature. Two weeks in, "Populate with AI" for texture has a 0% adoption rate; the others (actions/mood/lighting) work fine.

**Warning signs.** First manual demo with a real image returns <60 words. Or the words don't fit any of the 5 prompt categories (surface quality, mark-making, material, pigment, tactile) — they're a re-summary of subject/style instead. Or: the LLM says "the painting" / "the image" (meta-reference forbidden vocabulary).

**Pre-commitment actions:**

- **Action 1.** During manual demo, if the first response fails any of: <60 words, no category match, any forbidden vocabulary → **kill the slice** per `docs/SPEC.md` §11 (third kill criterion: "the MiniMax vision call returns garbage on every test image"). Don't ship a broken feature; iterate the prompt or abandon the slice.
- **Action 2.** Test with at least **3 diverse images** in manual demo (an oil painting, a digital render, a photograph) before declaring "works." Texture is the field where image-type variance is highest.

**Triggers.** If both Action 1 and Action 2 are needed and the prompt still produces garbage, the texture field isn't a good fit for the per-field re-analysis pattern. **Decision tree:** tighten prompt → switch to a non-prompt-engineering fix (e.g. higher `minLength` + explicit register enumeration in the prompt) → kill the slice and try a different field for Slice 1.

---

## Failure mode 2: Schema/handler mismatch causes silent frontend breakage

**Narrative.** The endpoint returns the right shape in tests, but the frontend's `populateTextureWithAI` destructures `.data.text` instead of `.data.texture` (or vice versa). The field doesn't update; `state.currentAnalysis.texture` stays `undefined`. Other fields are unaffected because the existing handlers use their own destructuring. The user sees a successful button click (loading spinner, no error) but the field stays at its previous value. Two weeks in, users report "the button doesn't work" and we can't reproduce because tests pass.

**Warning signs.** Manual demo: button click → no error toast → field value unchanged. Or: console log shows `data.texture` is the right string but `state.currentAnalysis.texture` is undefined after the handler completes. Or: the field's textarea content doesn't refresh in the DOM (still shows old value) despite the state being correct.

**Pre-commitment actions:**

- **Action 1.** Before declaring the slice done, **eyeball-trace the data flow** end-to-end: handler destructures → state update → DOM update. All three must use the same field name (`texture` everywhere). One inconsistency = silent failure.
- **Action 2.** The frontend test (in `tests/run-all.js`) should assert **both** the state update **and** the DOM update, mirroring the pattern from the existing 5 per-field button tests.
- **Action 3.** If unsure, add a `console.log` in `populateTextureWithAI` showing `data` immediately after the response parses. Remove it before commit.

**Triggers.** Two strikes (action fails twice in a row) → stop and re-read the existing handlers for `actions`/`mood`/`lighting` to find what's different about your handler. The bug is almost certainly a missing line that the established handlers have.

---

## Failure mode 3: `server.js` cleanup pattern silently leaks files

**Narrative.** The new `/api/texture` route's multer upload creates a file in `uploads/`. The handler's success path calls `fs.unlinkSync(filePath)`. But the cleanup is wrapped in a `try { ... } catch (_) {}` (silent catch, by design — same as `/api/actions`). If the upload directory is full or the file is locked, the unlink fails silently. Files accumulate in `uploads/`. Two weeks in, the dev's disk has 200MB of orphan texture uploads.

**Warning signs.** After 5 manual demo clicks, `ls uploads/ | wc -l` shows more than 5 files (some old, some new). Or `du -sh uploads/` shows unexpected growth.

**Pre-commitment actions:**

- **Action 1.** Before declaring the slice done, run **3 demo clicks** and then verify `uploads/` is empty (or only contains the most recent file). If orphans accumulate, the handler's cleanup logic is wrong.
- **Action 2.** Mirror `/api/actions` cleanup **exactly** — including the inner `try/catch (_) {}` around `fs.unlinkSync(filePath)`. Do NOT use a different cleanup pattern.
- **Action 3.** The existing pattern is: outer `try { ... filePath = req.file.path; ... fs.unlinkSync(filePath); filePath = null; res.json(...) } catch (error) { if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (_) {} } res.status(500).json(...) }`. Read this pattern verbatim before writing.

**Triggers.** If `uploads/` accumulates orphans after the test, the cleanup logic drifted from the established pattern. **Stop and fix before commit** — orphan uploads are user-visible (disk fills, dev needs to clean up) and not caught by `tests/run-all.js`.

---

## Aggregate verdict

| Failure mode | Likelihood | Severity | Pre-commitments cover it? |
|---|---|---|---|
| 1 — Prompt elicits useless output | Medium | Medium (kill criterion exists) | Yes (3 image types + kill) |
| 2 — Schema/handler mismatch | Low | Medium (silent UX breakage) | Yes (eyeball trace + test assertion) |
| 3 — File cleanup leak | Low | Low (dev-side, not user-side) | Yes (mirror pattern + check uploads/) |

**Slice 1 is bounded.** All three failure modes have clear pre-commitments and pre-committed kill criteria. The slice mirrors an established pattern; the risk is in execution drift, not in design.

---

## Slice 1 commitments (the bullet list)

Before declaring the slice done:

1. **Read** ADR 0018 §1–§5 once more before writing any code. (Pattern refresh.)
2. **Trace** the 3 existing per-field handlers (`/api/actions`, `/api/mood`, `/api/lighting`) line-by-line before writing `/api/texture`. (Mirror, don't reinvent.)
3. **Test** with 3 image types (oil painting, digital render, photograph) during manual demo.
4. **Verify** `uploads/` is empty after 3 demo clicks (cleanup works).
5. **Eyeball-trace** the frontend data flow: handler → state → DOM. (No silent breakage.)
6. **Run** `tests/run-all.js` and `scripts/session-init.js` and `node --check` — all must pass.
7. **Run** the per-slice code-review (Gate G4) before commit.

If any of these fail twice, kill the slice per `docs/SPEC.md` §11.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial pre-mortem (3 failure modes) | Phase G3 of Slice 1 |
| 2026-08-03 | Appended Slice 2 — Anima fork (5 failure modes) | Phase G3 of Slice 2; G2 approved |

---

# Slice 2 — Anima fork: pre-mortem

**Status:** Draft → In Review → Approved (pending Gate G3)
**Slice:** 2 — Anima fork (model selector + dispatch + Anima contract)
**Created:** 2026-08-03
**Purpose:** Imagine it's 2 weeks after Slice 2 ships. It failed. Why? Write the most likely reasons, with pre-commitments so we catch them now.

---

## Failure mode 1: The two contracts drift out of sync

**Narrative.** The Z-Image side evolves — a new prompt-contract rewrite (cf. ADR 0019), a new chat refinement template, a new safety vocabulary. The Anima side doesn't get the same treatment. After two weeks, the chat experience is dramatically better in Z-Image mode than in Anima mode, and the user (who works across both) notices and complains. Or worse: the per-field artifacts (subject, actions, mood, lighting, texture) start being assumed to be Z-Image-only, and an Anima-mode refinement that uses a Z-Image vocabulary produces an off-contract prompt.

**Warning signs.** Manual demo: chat refinement in Anima mode uses Z-Image vocabulary (e.g., "pastel palette," "focal glow"). Or: the per-field chips that show up in Anima mode are Z-Image-only. Or: a fix to the per-field pattern in one mode doesn't make it to the other.

**Pre-commitment actions:**

- **Action 1.** The per-field artifacts (`subject`, `actions`, `mood`, `lighting`, `texture`) are **shared** between both contracts. The dispatch layer is the only place that knows about model-specific output. Any fix to a per-field handler benefits both contracts. Document this in the code (a comment block at the top of the dispatch function, a comment in each per-field handler).
- **Action 2.** The chat default system prompt is **state.model-aware**, but the chat memory / history shape is the same — both contracts share the chat session schema. The model field is annotated per message. Any chat-handler fix is shared.
- **Action 3.** Before declaring the slice done, run **both** contracts through a single manual demo and verify the chat experience is symmetric. If not, document the asymmetry and decide whether to ship it or fix it.

**Triggers.** If a Z-Image contract rewrite is mid-flight, **defer Slice 2** until the rewrite lands. Two contracts evolving in lockstep is hard; two contracts evolving in parallel is harder. The Slice 2 SPEC §14.4.2 explicitly out-of-scopes Z-Image rewrites.

---

## Failure mode 2: The MiniMax prompt elicits useless Anima output

**Narrative.** A user uploads an image and picks Anima from the dropdown. The endpoint returns a generic "anime girl with detailed features" (fails the `positive.minLength: 60` floor → 503 path) or a verbose paragraph that ignores the Anima contract (no lowercase tags, no `@`-prefix on artist, no recommended positive prefix). The user retries, gets the same thing, stops using Anima mode. Two weeks in, Anima mode has 0% adoption.

**Warning signs.** First manual demo with a real image returns <60 characters in `positive`. Or the tags don't fit the Anima contract rules (uppercase, underscores, no `@` prefix, no prefix). Or the LLM says "the image" / "the painting" (meta-reference forbidden vocabulary from the manual §5).

**Pre-commitment actions:**

- **Action 1.** During manual demo, if the first response fails any of: `<60` chars in positive, no Anima contract match, any forbidden vocabulary → **iterate the prompt** *before* declaring the slice done. The kill criterion from SPEC §14.4.3 ("returns well-formed Anima positive + negative") is the bar.
- **Action 2.** Test with at least **3 diverse images** (an anime character, a landscape photo, a digital render) before declaring "works." The Anima contract is more condition-heavy than Z-Image (manual §7.5 non-anime routing). If the LLM mis-classifies a non-anime image, the prompt needs explicit branching.
- **Action 3.** The prompt's 6 categories (positive rules, negative rules, variant rules, non-anime routing, multi-character, forbidden vocabulary) are all explicit. If the LLM keeps missing one, the prompt needs to be tightened, not the model swapped.

**Triggers.** If all 3 image types fail after 2 prompt iterations, the Anima contract may not be expressible in a single MiniMax M3 system prompt. **Decision tree:** split per-variant constants (Base / Aesthetic / Turbo as separate prompts) → try a larger model → kill the slice. The per-field-stretch path in SPEC §14.9 covers the first option.

---

## Failure mode 3: Variant switching mid-session confuses the chat history

**Narrative.** A user generates an Anima prompt in Base mode. Mid-session, they switch to Aesthetic. The chat history is now refining the wrong prompt — the chat anchor is still keyed to the Base prompt, but the new chat default system prompt is for Aesthetic. The user refines, sees the Base prompt update instead of the Aesthetic one, gets confused. Two weeks in, users report "the chat refines the wrong prompt" and we can't reproduce because the bug only happens on switch.

**Warning signs.** Manual demo: switch from Base to Aesthetic mid-session, then chat-refine. The Base prompt updates, not the Aesthetic one. Or: the Aesthetic prompt panel is empty when the chat sends a refinement (because the chat is reading the wrong anchor).

**Pre-commitment actions:**

- **Action 1.** **Chat history is per-model AND per-variant.** Switching either ends the current session and starts a new one. This is the resolution of Open Question Q3 (option a) and Q4 (per-variant persistence). It's not a "nice to have" — it's a correctness requirement.
- **Action 2.** Session-end is a **clean break** — the user sees a confirmation ("Switching to Anima Aesthetic will end the current chat session. Continue?") with Cancel/Confirm. This mirrors the existing destructive-action pattern in the app.
- **Action 3.** The chat session's `model` and `variant` fields are written on every message. Even if the user hand-edits the prompt between sessions, the audit trail is preserved.

**Triggers.** If the chat session is being read across model switches, the dispatch is wrong. **Stop and fix before commit** — silent chat-anchor corruption is the worst kind of bug.

---

## Failure mode 4: localStorage / URL state corruption crashes the app

**Narrative.** A user has been using the app for weeks. The `state.model` in localStorage is a valid enum (`'anima'`). Then the user opens a stale bookmark with `?model=foo` in the URL. The app crashes on boot because `state.model` is checked against the enum without a fallback. Or: a future migration (e.g., adding a `'flux'` model) leaves old users with stale state. The app halts.

**Warning signs.** Manual demo: navigate to `?model=foo` → app crashes or shows a blank screen. Or: open the app after hand-editing localStorage to garbage → crash.

**Pre-commitment actions:**

- **Action 1.** **Validate on read.** Every state read from localStorage or URL checks against the allowed enum (`'zimage_turbo' | 'anima'` for model, `'base' | 'aesthetic' | 'turbo'` for variant). On mismatch, fall back to the default and log a warning.
- **Action 2.** **Default fallback is silent.** The user doesn't see "your saved state was corrupted" — they see the default. The warning is logged to `console.warn` for debugging.
- **Action 3.** **Migration is explicit.** If a future version changes the enum, a migration step updates existing localStorage. For Slice 2, the migration is "no migration needed" (the default is the new value).

**Triggers.** If validation is missing, the crash is silent. **Eyeball-trace every state read** before declaring the slice done.

---

## Failure mode 5: The license boundary is misread and the slice ships a commercial-restriction violation

**Narrative.** The Anima model is licensed under the CircleStone Labs Non-Commercial License v1.2 + the NVIDIA Open Model License. We are generating prompts via MiniMax M3 (not Anima weights), which is fine. But — a future feature ships `Anima-Aesthetic-v1.1.safetensors` download links from the app (to "make it easier to run the prompt"). That is hosting Anima weights behind a paid API in disguise. The CircleStone Labs §2.b says no. Two weeks in, the org gets a takedown notice.

**Warning signs.** Manual demo: the app downloads or serves Anima weights. Or: the app embeds Anima weights in a Docker image. Or: the app links to a paid platform that hosts Anima behind an API.

**Pre-commitment actions:**

- **Action 1.** **The slice ships no weights.** The app emits prompts; the user takes the prompts to ComfyUI / Civitai / TensorArt. The README manual §16 documents the boundary in plain English.
- **Action 2.** **The slice ships no inference integration.** No ComfyUI server call, no Civitai API token, no hosted Anima. The model file URL is **not** in the codebase. The user copies the prompt and runs it locally.
- **Action 3.** **The Slice 2 SPEC §14.10** documents the boundary explicitly. The ADR 0021 captures it as a decision. The CODE-REVIEW-2-anima-fork.md file should include a checklist item: "no Anima weights, no hosted inference, no paid-API integration."

**Triggers.** If a feature request during the slice asks for "make it easier to run the prompt" (download weights, embed inference, link to paid API), **park it in BACKLOG.md** with a license-risk note. Do not build it.

---

## Aggregate verdict

| Failure mode | Likelihood | Severity | Pre-commitments cover it? |
|---|---|---|---|
| 1 — Two contracts drift out of sync | Medium | High (the whole fork premise weakens) | Yes (shared per-field artifacts, symmetric demo) |
| 2 — Prompt elicits useless Anima output | Medium | Medium (kill criterion exists) | Yes (3 image types + prompt iteration + kill) |
| 3 — Variant switching breaks chat history | Medium | High (silent UX breakage) | Yes (per-model-and-per-variant sessions + confirmation) |
| 4 — State corruption crashes the app | Low | Medium (visible crash) | Yes (validate on read + fallback) |
| 5 — License boundary misread | Low | High (legal risk) | Yes (no weights, no inference, no paid-API; documented in §14.10) |

**Slice 2 is bounded, but with wider blast radius than Slice 1.** The fork creates two contracts to keep coherent. The license boundary requires discipline. The variant switching requires care. Each has a clear pre-commitment and a kill criterion or a decision tree.

---

## Slice 2 commitments (the bullet list)

Before declaring the slice done:

1. **Read** `docs/ANIMA-PROMPTING-MANUAL.md` §5, §7, §14 once more before writing any code. (Contract refresh.)
2. **Trace** the existing final-prompt route line-by-line before writing `/api/anima`. (Mirror, don't reinvent.)
3. **Test** with 3 image types (anime character, landscape photo, digital render) during manual demo.
4. **Verify** `uploads/` is empty after 3 demo clicks (cleanup works — same as Slice 1).
5. **Eyeball-trace** the frontend dispatch: handler → state.model → endpoint choice → result panel. (No silent breakage.)
6. **Verify** chat history is per-model and per-variant. Switching ends the session.
7. **Verify** localStorage + URL state validation. Navigate to `?model=foo` → app falls back to default.
8. **Verify** no Anima weights, no hosted inference, no paid-API links in the codebase.
9. **Run** `tests/run-all.js` and `scripts/session-init.js` and `node --check` — all must pass.
10. **Run** the per-sub-slice code reviews (G4) before commit.

If any of these fail twice, kill the slice per `docs/SPEC.md` §14.4.3.