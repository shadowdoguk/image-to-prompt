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