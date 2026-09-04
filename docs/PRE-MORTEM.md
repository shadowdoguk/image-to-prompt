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

---

## Slice 3 — Kilo Code provider migration + model selector

**Date:** 2026-08-04
**Origin:** `docs/SPEC.md` §15 (G2 approved)
**Slice:** 3 — Kilo Code as sole provider with six-model LLM selector

### Failure mode 1: Kilo Code gateway is down or degrades

**What:** `api.kilo.ai` returns 5xx for all requests. No LLM calls succeed — Stage 1, per-field re-analysis, Stage 2, and chat all fail. The user sees error toasts for every action.

**Probability:** Medium. Third-party gateway dependency.

**Impact:** High. The entire app is non-functional without an LLM. There is no fallback provider.

**Mitigation:**
- Clear per-status-code error messages: 502 "Upstream provider error — try again", 503 "Kilo Code gateway temporarily unavailable — retry in a moment"
- The user can retry — gateway outages are typically minutes, not hours
- If the gateway proves unreliable long-term (≥3 incidents in one week), a fallback-provider slice (direct MiniMax or OpenAI as backup) becomes priority

**Pre-commitment:** Test error surfacing for all status codes. Manual demo: with an invalid API key, verify the error message is clear and actionable.

### Failure mode 2: Image format mismatch produces garbage output

**What:** `buildVisionMessage` constructs the `image_url` content parts incorrectly — wrong field names, nested structure, wrong MIME type. The LLM receives a malformed vision request and either ignores the image or produces hallucinated output.

**Probability:** Medium. The helper is new code; the image format is a cross-cutting change.

**Impact:** High. All vision-based analysis (Stage 1, all 6 per-field endpoints, Stage 2) produces garbage. The app's core value proposition breaks.

**Mitigation:**
- Test `buildVisionMessage` output against the OpenAI vision spec (ContentPart shape, `image_url.url` field, `type` enum)
- Manual demo with one known image across all six models
- If any model consistently misinterprets images, remove it from the hardcoded list

**Pre-commitment:** Test the helper's output shape. Manual three-image demo (oil painting, digital art, photograph) with MiniMax M3 and GPT-5.6 Luna. If vision output is unrecognisable on ≥2 of 3 images for any model, flag that model as unreliable and consider removing it.

### Failure mode 3: Helper rename misses a call site

**What:** One of the ~15 `callMiniMax*` references is not renamed to `callKilo*`. That endpoint calls the old (now-removed) function name and throws `ReferenceError`.

**Probability:** Low. Rename is mechanical — global find-and-replace covers it.

**Impact:** Medium. One endpoint breaks; the user sees an error for that specific action. Other endpoints continue to work.

**Mitigation:**
- After rename: `grep -n "callMiniMax" server.js` must return zero results
- Add a test that asserts zero `callMiniMax` references remain in `server.js`
- Run `node --check server.js` — syntax errors on unresolved references

**Pre-commitment:** The grep check is mandatory before any sub-slice commit. If any reference remains, fix before proceeding.

### Failure mode 4: localStorage collision between state.model and state.llmModel

**What:** The chat session schema has a `model` field (currently storing the output contract). Adding `llmModel` creates ambiguity — code that reads `session.model` might get the wrong value.

**Probability:** Medium. Naming collision in a shared schema.

**Impact:** Medium. Chat refinements target the wrong model. Chat history displays incorrectly.

**Mitigation:**
- Chat session stores `llm_model` (LLM model ID) — separate key, no collision
- Existing `model` field renamed to `contract` in the chat session schema (expand-contract: add `contract`, migrate reads, remove `model`)
- Backward-compatible: old sessions with only `model` are read as `contract = model`

**Pre-commitment:** Test that chat session reads from both `llm_model` and `contract` fields. Test that old sessions (no `llm_model`, no `contract`, only `model`) still load correctly.

### Failure mode 5: Model produces structurally different output

**What:** GPT-5.6 Luna or another model emits JSON that doesn't match the expected schema (e.g., different field names in the Stage 1 analysis JSON, or prose instead of structured JSON).

**Probability:** Low-Medium. Different models have different JSON-following reliability. MiniMax M3 is known-good (current baseline). GPT-5.6 Luna is strong at JSON. Grok 4.3 and Nemotron 3 Ultra are unknowns.

**Impact:** Medium. JSON Schema validation catches structural failures and returns an error. The user sees a validation error instead of a result. They can retry or switch models.

**Mitigation:**
- All response schemas remain enforced server-side (`minLength`, `additionalProperties: false`, `required` fields)
- The Stage 1 retry-with-strengthened-prompt loop still runs — if the first attempt fails validation, a second attempt with a stronger prompt is made
- If a specific model consistently fails on a specific endpoint, document it in the README

**Pre-commitment:** Test that JSON Schema validation still runs for all endpoints. Manual demo: run Stage 1 with each of the six models; if any model fails validation ≥2 times on the same image, flag it.

### Pre-commitments (bullet list)

1. **`grep -n "callMiniMax" server.js` returns zero results** after 3.1.
2. **`grep -n "minimaxi.chat" server.js` returns zero results** after 3.1.
3. **`node --check server.js` exit 0** after every sub-slice.
4. **`node tests/run-all.js` all pass** after every sub-slice.
5. **`node scripts/session-init.js` 10/10 V-checks** after 3.5.
6. **Manual demo:** upload one image, run through all six models, verify Stage 1 output is recognisable for each.
7. **Manual demo:** generate a prompt with MiniMax M3 through Kilo Code, compare to a saved prompt from the direct MiniMax era — quality should be equivalent.
8. **Manual demo:** switch model mid-session, verify chat refines the correct prompt with the correct model.
9. **Test** that `buildVisionMessage` output matches OpenAI vision ContentPart shape.
10. **Test** that chat sessions survive the `model` → `contract` rename.

If any of these fail twice, kill the slice per `docs/SPEC.md` §15.4.3.
---

# Slice 4 — Tri-provider routing: risks + pre-commitments

**Date:** 2026-09-03
**Origin:** `docs/SPEC.md` §16 + `docs/adr/0023-tri-provider-routing.md`

## Top risks (ranked)

### Risk 1 — Three response-shape normalizers to maintain
**Severity:** MEDIUM
**Likelihood:** MEDIUM
**Description:** Each adapter parses its provider's response shape and normalizes into `{ ok, content, raw, error }`. If a provider changes their response format (e.g. Kilo Code adds a wrapper, Alibaba renames `output.choices`), the adapter breaks silently.
**Mitigation:** Each adapter has a dedicated test that asserts the normalized shape against a canned raw response. If a provider changes shape, the test fails before the route handler runs. Smoke test on every adapter after deploy.
**Pre-commitment:** if any adapter test fails twice in a row, kill the slice. The provider shape is upstream of the entire app — adapter drift is a server-wide regression.

### Risk 2 — Auth complexity (3 keys, 3 env vars)
**Severity:** MEDIUM
**Likelihood:** LOW
**Description:** Kilo Code, MiniMax, and DashScope each use a different API key. Rotating one without updating its env var causes a silent 401. The user may not realize which provider is failing.
**Mitigation:** Each provider has its own health check route (`/api/health/providers`) that returns `{ provider: { live: bool, last_error: string|null } }`. The frontend's provider selector shows a per-provider "live ✓" or "auth failed" badge.
**Pre-commitment:** if auth fails for any provider at deploy time, the deploy is rolled back. Provider auth is a pre-condition for the slice, not a fix-it-later.

### Risk 3 — Stub-vs-live confusion in error messages
**Severity:** LOW
**Likelihood:** HIGH
**Description:** A stub returns `provider_not_live`; a live 401 returns the provider's actual error. The frontend must distinguish. If both are shown as "provider failed", the user can't tell whether to flip the env var or check the API key.
**Mitigation:** The adapter sets `error.code = 'stub' | 'auth' | 'rate_limit' | 'parse'` explicitly. Frontend renders error messages keyed on `error.code`. Stub mode shows a yellow "stub mode" banner, not a red error.
**Pre-commitment:** every error path has a user-readable message that names the provider and the actionable next step.

### Risk 4 — Per-provider rate-limit semantics differ
**Severity:** LOW
**Likelihood:** MEDIUM
**Description:** Kilo Code: 429 with `Retry-After`. MiniMax: 429 with custom header. DashScope: 429 with quota reset timestamp. A retry policy that works for one provider may over-retry on another.
**Mitigation:** Per-provider retry policy in `callProvider`'s `options.retryPolicy`. Default: 1 retry with exponential backoff for `kilo_code`, 0 retries for `minimax`/`alibaba` (per-frontend-driven retry). The chat-recovery fix from Slice 3 (`7a16088`) lives inside `callKiloProvider`, not at the dispatcher level — Kilo Code-specific.
**Pre-commitment:** rate-limit behavior is documented per provider in ADR 0023 §"Consequences (Negative)".

### Risk 5 — Provider selector UX (URL noise + double state)
**Severity:** LOW
**Likelihood:** MEDIUM
**Description:** Two new state flags (`state.provider`, `state.llmModel`) mean two URL params (`?provider=`, `?llm=`). If the user shares a URL with both, the canonicalization rules must agree (provider `kilo_code` + llm `minimax/minimax-m3` → both params omitted → URL is `/`). If a stale URL has `?provider=minimax&llm=minimax/minimax-m3`, the resolver should pick the MiniMax provider with the (allowed) M3 model.
**Mitigation:** The resolver treats the two params independently. Cross-validation is a UI concern (the model selector's option list is filtered by the selected provider).
**Pre-commitment:** URL canonicalization rules are documented in SPEC §16.4 and tested explicitly.

## Pre-commitments (apply to all sub-slices)

1. `node --check server.js` exit 0 after every sub-slice.
2. `node --check src/app.js` exit 0 after every sub-slice.
3. `node tests/run-all.js` — 402 + ~28 = ~430 passing after Slice 4.0.
4. `node scripts/session-init.js` — 10/10 V-checks after Slice 4.0.
5. **Visual-demo gate** (deferred from Slice 3 closeout) — open the app in a browser, upload an image, switch providers (kilo_code → minimax → alibaba), switch models within each provider, generate, verify response envelope `provider` and `model` fields reflect the selection. Capture screenshots and attach to the PR. This is the G4 step that was skipped for Slice 3 — Slice 4 lands it.
6. Test that stub-mode responses don't break the chat assistant's `extractChatReply` parser.
7. Test that switching provider mid-chat-session preserves the session's `provider` + `model` in the chat history.

## Kill criteria

Kill the slice if:
- A provider adapter can't normalize its provider's response shape within 3 attempts.
- Any of the three env-var configs fail auth in production after a clean deploy.
- The frontend provider selector UX confuses a user-reported test session (have a non-developer try it).
- The visual-demo gate fails twice (a button that doesn't work in the browser is a real bug).


## CR-series — Chat redesign (oil-painting RAG edition)

**Pre-approved G3 under full-autonomy directive (2026-09-04). Source: `docs/SPEC.md` §17–20, ADR 0025, ARCHITECTURE CR-A1–CR-A6.**

### Top risks

1. **R-1 (HIGH) — Kilo embedding endpoint rate limit or outage.** The Kilo gateway returned HTTP 429 on chat probes (2026-09-04). Embeddings use the same gateway. Mitigation: back-off retry with 3 attempts; degrade to no-RAG mode with a banner; never block the chat on embedding failures.
2. **R-2 (MEDIUM) — Persona rewrite breaks existing tests.** Tests that assert "Don't comment on style/aesthetic quality" or "Don't ask clarifying questions" must be updated. Mitigation: grep for both strings; rewrite the tests to assert the new behaviour (oil-painting vocabulary, clarifying questions allowed).
3. **R-3 (MEDIUM) — Hand-rolled cosine scan latency at 5k chunks.** Full-scan 1,536-dim cosine over 5,000 chunks is ~5 ms p50 in plain JS (measured mentally; will be benchmarked in CR-4). Mitigation: if latency > 50 ms p95, expand-contract to LanceDB (parked as a refactor trigger in ARCHITECTURE CR-A6).
4. **R-4 (MEDIUM) — Attachment upload abuse / disk exhaustion.** Multer accepts 10 MB per file; max 4 attachments per message; per-session storage uncapped. Mitigation: per-session attachment cap (100 MB) + total cap (1 GB) added in CR-4 cleanup if observed.
5. **R-5 (LOW) — RAG injection leaks prompt-injection content from the corpus.** The corpus is curated + user-owned; no third-party content enters. Mitigation: the system prompt instructs the LLM to use retrieval vocabulary *naturally*, not to obey instructions in retrieved chunks.
6. **R-6 (LOW) — Auto-ingest (CR-4) inflates the index with low-quality chat proposals.** Every chat proposal becomes a chunk regardless of content. Mitigation: minimum length floor (≥ 30 chars) on auto-ingested chunks; the FIFO cap protects against unbounded growth.

### Pre-commitments (apply to all CR sub-slices)

1. `node --check server.js && node --check src/app.js && node --check tests/run-all.js` — exit 0 after every sub-slice.
2. `node tests/run-all.js` — ≥ 439 + 30 = ≥ 469 passing after CR-1; ≥ 530 after CR-4.
3. `node scripts/session-init.js` — 10/10 V-checks pass after each sub-slice; `code_drift` = clean.
4. Visual-demo gate per slice via chromedevtools (UI states; stub provider fallback when Kilo rate-limited).
5. Code review per slice (`docs/CODE-REVIEW-12-CR-1.md` … `…-CR-4.md`).
6. Update `docs/SESSION-STATE.md` after every slice (append-only).
7. Embedding failures never block the chat. Cosine failures never crash the chat.
8. Attachment uploads never persist to disk before mime + size validation.
9. Session delete always cascades to attachment directories (best-effort fs cleanup; logged).
10. The curated seed is never modified by user actions; only re-embedded.

### Kill criteria (per sub-slice)

Kill the sub-slice if:
- The persona rewrite causes the chat to ignore the anchor-preservation contract (validated by ADR 0012 regression tests).
- Kilo embedding outages > 50% of probes on the visual-demo gate cannot be worked around.
- Hand-rolled cosine scan latency exceeds 200 ms p95 at the curated-seed corpus size (would block every chat turn).
- Attachment upload leaves files on disk after a session delete (fs leak).
- Auto-ingest produces an unparseable index (re-load fails; chat breaks).

