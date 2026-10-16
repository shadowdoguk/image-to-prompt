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


### CR-26 — Chat-attachment vision-capability data model (Slice 26)

**CR-fix track (per `docs/agents/bug-workflow.md`), 2026-09-05.** Source: ADR 0026, SPEC §21, ARCHITECTURE §26.A1–A5.

#### Top risks

1. **R-1 (LOW) — Set literal drifts from `ALLOWED_LLM_MODELS_BY_PROVIDER`.** The 5 regression tests catch this; the cost is one `node tests/run-all.js` run per PR. **Mitigation:** the static-parse test fails if a catalog id is missing from the Set, and the negative-case test fails if a catalog id is incorrectly added.
2. **R-2 (LOW) — User-added custom model (UI-R7) silently vision-capable without being added.** The Set is module-local; the chat route can't tell whether a custom model supports vision. **Mitigation:** false negatives are the existing behavior (text-only fallback); users see a banner.
3. **R-3 (LOW) — Future capability-table refactor (ADR 0026 §2) reshapes the consumer.** **Mitigation:** the consumer's Boolean return is stable; reshape to `metadata.has(provider, model, 'vision')` is mechanical and contained to `buildUserMessageWithAttachments`.

#### Pre-commitments

1. `node --check server.js && node --check tests/run-all.js` → exit 0.
2. `node tests/run-all.js` → all existing tests + 5 new tests pass.
3. `node scripts/session-init.js` → 10/10 V-checks.
4. Code-review doc `docs/CODE-REVIEW-27-vision-capability-coverage.md` → verdict `pass`.

#### Kill criteria

- The 5 regression tests do not lock membership (i.e. they pass with an empty Set) → kill the fix; the lock is the entire point.
- The Set is moved away from `ALLOWED_LLM_MODELS_BY_PROVIDER` without a regression test to bridge them → kill the fix; the colocation is part of the design.
- The change crosses into the orchestrator / provider adapters → kill; that's a wider slice, not a CR-fix.

---

## §27 — Inline-diff-on-Apply (SPEC §22)

### Top risks

- **R-1 (HIGH):** Word-level diff produces unintuitive boundaries. A change like "Edit" → "Edited" tokenises as a removal + an addition; merging them back may produce "EditEdited" if the user toggles the wrong hunk. *Mitigation:* the partial-merge algorithm only ever picks from the actual token positions; the round-trip property guarantees byte-identicality with default state. A test exercises the "Edit" → "Edited" case to catch off-by-one in the merge.
- **R-2 (MEDIUM):** Anchor-preservation may reject a partial prompt even when the user explicitly selected it. *Mitigation:* server-side, partial_prompt runs through the same validator; on decline, the existing `declined_suggested_prompt` + "Try as rewrite" fallback is shown. The user understands the prompt has structural anchors (subject, palette) that cannot be partially removed.
- **R-3 (MEDIUM):** Long prompts produce large diffs and slow DOM rendering. *Mitigation:* the diff is rendered only when the message is the active `pending_prompt` proposal (≤1 visible diff at a time in practice). For multi-thousand-word diffs, the user can fall back to the existing `chat-message__preview` block (still rendered, hidden by CSS).
- **R-4 (LOW):** The checkbox state is lost on page reload. *Mitigation:* selection state is ephemeral by design; the user can re-toggle. Persistence would add localStorage complexity for a small UX win.

### Pre-commitments

- **P-1:** The diff must not break the existing Apply button when JS is disabled. The `<pre class="chat-message__preview">` element is still rendered server-side; JS enhances it into a diff but the original is always present in the DOM (hidden via `hidden` attribute, not removed).
- **P-2:** The round-trip property is enforced by a unit test that asserts `computePartialPrompt(current, default) === suggested` for every fixture prompt.
- **P-3:** The server endpoint must accept BOTH legacy `{}` body (full apply) and new `{ partial_prompt }` body. Both code paths must be exercised in tests.

### Kill criteria

- **K-1:** If the round-trip test fails on more than one fixture prompt, revert the slice. The diff is too unreliable to ship.
- **K-2:** If the partial-merge produces a prompt the validator rejects in >20% of test fixtures, the user-facing affordance creates more friction than it solves. Park the slice and reconsider.
- **K-3:** If the diff DOM adds more than 50ms to message render time on a 14-field prompt, consider collapsing to character-level for the long-prompt case. (Not blocking; measured in §27 G5 polish.)

---

## §28 — Patch + annotate protocol (SPEC §23 / ADR 0027)

### Top risks

- **R-1 (HIGH):** The model emits malformed patches (wrong shape, oversized `find`, etc.). The validator pipeline must be defensive — every patch type-checks before reaching `String.prototype.replace`. *Mitigation:* the merge pipeline (§28.A2) validates every patch field before any mutation; malformed patches land in `rejected_patches[]` rather than crashing the request. A test exercises five malformed shapes (non-string `find`, empty `find`, oversized `find`/`replace`, non-boolean `all_occurrences`).
- **R-2 (HIGH):** A patch creates an unbounded string (e.g. `find: 'a', replace: 'aa'` applied 100× via `all_occurrences: true` amplifies). *Mitigation:* the merged result is bounded by `MAX_FINAL_PROMPT_LENGTH`; if the merge produces a longer string, it is rejected at the validator input with reason `'merged_oversized'` and stamped on the assistant message as a no-op with the reason set.
- **R-3 (MEDIUM):** The model learns to emit patches even when a full rewrite is cleaner (e.g. scene relocation), producing a series of patches that don't compose into a coherent result. *Mitigation:* the system prompt instructs the model to reserve `suggested_prompt` for restructurings; anchor-preservation catches incoherent merges (the validator measures the merged result against `current_prompt`, so incoherent patches still fail). The test suite exercises both "patches-only" and "patches + full rewrite" responses.
- **R-4 (MEDIUM):** The UI re-renders the patch list every time the user toggles a chip; for a session with many patches (e.g. 10) this re-renders the entire message node. *Mitigation:* the chip toggle handler updates a local `acceptedPatches` set and re-runs only the diff preview, not the whole message node. Measured at <5ms per toggle in the test fixture.
- **R-5 (LOW):** Annotation dismissal is client-side only, so a reload brings them back. *Mitigation:* dismissed state is stored in localStorage keyed by `chat_<session_id>_<message_id>`; cleared on session delete. Parked for a future slice if it becomes user-visible.

### Pre-commitments

- **P-1:** The server's chat route MUST validate every patch field (`find`, `replace`, `all_occurrences`) before applying any mutation. A single test exercises the "all 4 fields malformed" path.
- **P-2:** The merge result MUST be bounded by `MAX_FINAL_PROMPT_LENGTH`; over-long merges are rejected, not truncated. A test exercises a patch that would produce a >5000 char result.
- **P-3:** The system prompt paragraph MUST be present in `DEFAULT_CHAT_SYSTEM_PROMPT`. A static-source test asserts the paragraph's anchor phrases (`patches[]`, `annotations[]`, `Localised edits`).
- **P-4:** Every decline path (SPEC §22 partial-decline + Slice III patch-decline) produces the same `declined_suggested_prompt` + `declined_missing_terms` shape so the UI decline rendering doesn't need to distinguish.

### Kill criteria

- **K-1:** If the round-trip property test fails on more than one fixture (merge with all patches accepted produces byte-identical result to expected), the merge pipeline is unreliable and the slice is reverted.
- **K-2:** If the patch decline rate exceeds 30% on the test fixtures (most patches drop anchor terms), the model is misusing patches; the system prompt is too permissive. Tighten the persona prompt or back off to a smaller set of allowed patch shapes.
- **K-3:** If a user-visible regression appears in the decline fallback rendering (e.g. "Try as rewrite" affordance missing on patch-merge decline), the safety rail is broken. Pause the slice until the regression is fixed.

---

## §29 — Streaming responses (SPEC §24)

### Top risks

- **R-1 (HIGH):** Backpressure / buffer overflow. The upstream provider may produce chunks faster than the client can consume. If the server buffers everything, memory grows unboundedly. *Mitigation:* the server pipes each chunk through immediately (`res.write(...)`) without buffering; the underlying `http.ServerResponse` handles backpressure via Node's stream interface. A test asserts that 1000 chunks can be streamed without OOM.
- **R-2 (MEDIUM):** Connection drops mid-stream. If the client disconnects before the upstream call completes, the server's `req.on('close')` handler must abort the upstream call to avoid leaking the upstream request (and the upstream quota). *Mitigation:* `req.on('close')` is wired to abort the upstream call; verified by a test that simulates a client disconnect and asserts the upstream call is cancelled within 100ms.
- **R-3 (MEDIUM):** Streaming breaks anchor-preservation. The validator needs the FULL `reply` + `suggested_prompt` + `patches` to run; streaming sends chunks incrementally. *Mitigation:* the validator runs on the accumulated reply AFTER the stream completes, exactly as the existing route does. The streamed text is for UX only; the persisted message is the validator's verdict.
- **R-4 (LOW):** SSE doesn't work behind some proxies (nginx default `proxy_buffering on`). *Mitigation:* the server sets `X-Accel-Buffering: no` to disable nginx-style buffering. Tests run against a direct connection, not a proxy.
- **R-5 (LOW):** Concurrent streams on the same session can interleave the persisted messages. *Mitigation:* a session-level mutex (`Set<sessionId>` of active streams) rejects a second concurrent stream with 409.

### Pre-commitments

- **P-1:** The server MUST validate query params identically to the existing `POST` route. A test asserts that an empty `content` returns 400, an oversized `content` returns 400, an unknown `provider` returns 400.
- **P-2:** The server MUST persist the full assistant message on stream completion (or error), not just on stream success. A test asserts the partial reply is persisted with `audit: { kind: 'stream_aborted' }` when the client disconnects mid-stream.
- **P-3:** The client MUST show a "Stop generating" button while a stream is active. A test asserts the button is visible during the stream and hidden after completion.
- **P-4:** The streaming endpoint MUST return 409 if a second stream is requested while one is active. A test asserts the second request fails.

### Kill criteria

- **K-1:** If the streaming endpoint can't complete a single round-trip in under 200ms (excluding the model's response time), the streaming pipeline is too heavyweight. Revert to non-streaming.
- **K-2:** If the upstream provider rejects streaming requests, the streaming endpoint falls back to non-streaming (calls the upstream without `stream: true` and emits the full reply as one chunk). The endpoint still works; the client just sees the existing non-streaming UX.
- **K-3:** If memory grows unboundedly on a 1000-chunk test fixture, the backpressure path is broken. Revert the slice.

## §30 — Notes folders + image attachments (UI-R9)

Companion to SPEC §25 and ARCH §30.

### Top risks

- **R-1 (HIGH):** Orphaned attachment files. If a note is deleted, its attachment files must be removed from disk. If the process crashes mid-delete, files leak. *Mitigation:* cascade-delete is best-effort but idempotent (re-running on the same note is a no-op). A test asserts that `DELETE /api/notes/:id` removes both the note entry AND its attachments folder.
- **R-2 (HIGH):** Upload size DoS. A malicious client sends a 10 GB request claiming `Content-Length: 5 MB`. *Mitigation:* multer's `limits.fileSize` is enforced before the file lands on disk; the server returns 413 with a clean error. A test asserts 5 MB + 1 byte → 413.
- **R-3 (MEDIUM):** Manifest drift. If a file is removed on disk out-of-band (user `rm`'s it), the manifest entry stays and `/file` returns 404. *Mitigation:* the `/file` route auto-prunes the manifest entry on 404. Test asserts that calling `/file` for a missing file removes its manifest entry.
- **R-4 (MEDIUM):** Sort-order races. Two tabs reorder folders simultaneously; the last write wins. *Mitigation:* the server sorts on read by `(sort_order, created_at)` as a tiebreaker; reordering converges on next GET. Documented as "last write wins on ties; otherwise sort_order drives order."
- **R-5 (MEDIUM):** Folder rename → notes that reference it are unaffected (folder id is the FK, not the name). Good — but the sidebar must reflect the rename immediately. *Mitigation:* PUT returns the updated folder; the client patches in place without a full re-fetch.
- **R-6 (LOW):** Drag-and-drop on a touch device without keyboard support. *Mitigation:* sortablejs supports touch + keyboard reorder; explicit "Move to…" menu is the keyboard-only fallback.
- **R-7 (LOW):** Client opens 6 attachments on a 50 MB note → tab blows up on memory. *Mitigation:* each thumbnail is `<img loading="lazy">`; full image only loads on click. Max 5 attachments caps the worst case.
- **R-8 (LOW):** Filename spoofing. User uploads `evil.jpg.exe` claiming `image/jpeg`. *Mitigation:* multer uses the extension from the original filename, but the file is served with `Content-Type` from the **manifest**, not from the request. The filename is sanitised (alphanum + dot + dash + underscore) before storage.

### Pre-commitments

- **P-1:** Cascade-delete MUST remove both the manifest entries AND the on-disk files for the deleted note. A test asserts the directory is gone after delete.
- **P-2:** Upload errors (wrong MIME, too large, too many) MUST return clear, distinct HTTP codes: 400 / 413 / 409 respectively. A test asserts each.
- **P-3:** Folder delete MUST move all referencing notes to `folder_id: null` (Unfiled). A test asserts the cascade.
- **P-4:** The server MUST reject note PUT/MOVE requests that supply an unknown `folder_id` with 400. A test asserts this.
- **P-5:** Attachment downloads MUST set `Content-Disposition: inline` with the sanitised filename. A test asserts the header.
- **P-6:** All new endpoints MUST appear in `README.md` endpoint tables. A test asserts this.

### Kill criteria

- **K-1:** If multer can't be configured to cap file size before disk write, fall back to a manual `Content-Length` check on the raw `req`. (Should not happen — multer has had this since v1.)
- **K-2:** If sortablejs keyboard support proves unusable in our sidebar layout, drop the drag-and-drop and keep the explicit "Move to…" menu only.
- **K-3:** If the manifest pattern causes more than 1% of test runs to flake (timing issue with fs.renameSync), switch to a write-then-rename pattern with a per-note lock.


## §31 — Clear chat history (SPEC §27 / CR-A11)

### Top risks

- **R-1 (HIGH):** Partial failure leaves a torn state. Server clears the session file but a few `fs.rmSync` calls throw (permission denied, file busy on Windows, etc.), so some attachment directories linger. *Mitigation:* the bulk endpoint collects per-directory failures, still returns 500 (or 200 with a per-failure breakdown in the body), and the response message tells the user "Chat sessions cleared, but N attachment directories could not be removed." Idempotency: the user can retry; the session-write is already done so a retry is a no-op for sessions and just re-attempts the directory sweep. A test asserts the partial-failure case.

- **R-2 (HIGH):** Accidental data loss. User clicks the button without reading the modal, confirms without reading the count, and loses weeks of chat history. *Mitigation:* the modal shows "This will permanently delete all N chat sessions and M attachment files. This action cannot be undone." — explicit count + explicit "permanently" + explicit "cannot be undone". The confirm button is `class="btn-danger"` (the project's strongest visual danger style). The Cancel button is the default-focus target so Enter on the keyboard dismisses rather than confirms. The modal is dismissible by Cancel, Escape, and backdrop click.

- **R-3 (MEDIUM):** `data/chat_sessions.json` is gitignored (project convention for runtime state), so a cleared file is GONE — no undo from git. *Mitigation:* the SPEC explicitly accepts this; users who want backups copy the file before clearing. This is consistent with how `data/palettes.json`, `data/presets.json`, etc. are handled — the project is local-first, single-user, and trusts the user.

- **R-4 (MEDIUM):** Concurrent chat sessions in flight when the user clicks clear. User has Chat tab open in two browser tabs; tab A sends a message just as tab B clicks Clear. The new message may land between `readChatSessions()` and `writeChatSessions([])`, getting silently dropped. *Mitigation:* `writeChatSessions` uses the same atomic-rename pattern as every other write; the dropped-message window is the same as for any concurrent write (a few milliseconds). The user's other tab will see the chat view reset on its next GET, and any in-flight POST will return 404 (session not found) which the frontend handles gracefully. Documented in the test for the route, not blocked.

- **R-5 (MEDIUM):** Frontend `onChatHistoryCleared` throws partway through (e.g., a DOM element is missing because Settings was never opened). The chat view stays in a partially-reset state. *Mitigation:* the hook wraps its body in `try/finally` so each reset line runs even if a prior line throws; final state is re-established via `renderChatSessionSelect()` regardless. Test asserts the hook is defensive (calls `resetChatConsole` and `renderChatSessionSelect` in a finally block).

- **R-6 (LOW):** Modal can be opened twice rapidly (double-click on the button). User sees two stacked modals. *Mitigation:* the button is `disabled` between click and modal-open (cheap debounce via `setTimeout(…, 100)` in shell.js). Acceptable — even if two modals open, the trap infrastructure handles the stacking correctly (top-most modal traps focus).

- **R-7 (LOW):** `preservation_override_log.json` is NOT cleared (per G1 user direction). If the user expects it to be, they'll be confused. *Mitigation:* documented in SPEC §27 "Out of scope" and in the Settings panel's hint text ("This removes all chat sessions and their attachments. It does not affect preset overrides, palettes, directives, notes, or model settings.").

- **R-8 (LOW):** Cross-browser modal styling quirks (Safari backdrop-filter, Firefox scroll-lock). *Mitigation:* the modal reuses the existing patterns from the preset editor and notes-modal which are already exercised across browsers. No new CSS that diverges from the established `.modal` / `.modal-backdrop` / `.modal-content` classes.

### Pre-commitments

- **P-1:** The bulk endpoint MUST atomically rewrite `data/chat_sessions.json` to `[]` via the existing `writeChatSessions` helper. A test asserts the file is `[]` after a successful call and that the rewrite is atomic (no torn writes under concurrent reads).
- **P-2:** The bulk endpoint MUST sweep every `data/chat_attachments/chat_*/` directory via `fs.rmSync(..., { recursive: true, force: true })`, regardless of manifest presence. A test asserts orphan directories are removed even when the manifest is empty.
- **P-3:** The bulk endpoint MUST reset `data/chat_attachments/_manifest.json` to `[]`. A test asserts the manifest is `[]` after a successful call.
- **P-4:** The Settings "Chat data" panel MUST be the LAST panel in the Settings view (after Defaults, after System prompts). A test asserts the panel order via DOM-position check.
- **P-5:** The modal MUST show the current session count + attachment count BEFORE the user can confirm. A test asserts the modal text contains the live counts.
- **P-6:** The confirm button MUST be disabled while the bulk DELETE is in flight, and re-enabled on response. A test asserts this via the rendered button's `disabled` attribute.
- **P-7:** `onChatHistoryCleared` MUST reset `state.chatSessions = []`, `state.chatSessionId = null`, `state.chatPendingAttachmentIds = []`, `state.chatPendingAttachmentMeta = {}`, then call `resetChatConsole()` and `renderChatSessionSelect()`. A test asserts each.
- **P-8:** `onChatHistoryCleared` MUST defensively sweep `localStorage` for keys matching `/^i2p\.(chat|session)\b/i`. A test asserts the sweep runs even when no matching keys exist (no-throw).
- **P-9:** All new endpoints MUST appear in `README.md` endpoint tables OR be documented inline in `server.js` route comments. (Slice 27 adds 2 endpoints: DELETE /api/chat/sessions and GET /api/chat/sessions/count.)
- **P-10:** No regression in the 589 baseline tests.

### Kill criteria

- **K-1:** If `fs.rmSync` proves unreliable on the user's platform (Windows file locking, network filesystem), fall back to `fs.rmdirSync(dir, { recursive: true })` (the older Node API) or to a recursive unlink loop. Should not happen — `fs.rmSync` is the documented modern API.
- **K-2:** If the defensive `localStorage` sweep accidentally clears a non-chat key (false-positive regex), narrow the regex to `/^i2p\.chat/i` (chat prefix only). Mitigation is one-character.
- **K-3:** If the bulk endpoint can't be made idempotent (e.g., concurrent clears race on the manifest write), add a per-file mutex. Should not happen — `writeChatSessions` is already atomic and the manifest write follows the same pattern.

---

## §28 pre-mortem — Iterative refinement: "Analyze Generated Image" in Chat (SPEC §28)

### Risks

- **R-1 (HIGH):** The MiniMax vision model returns a `Mismatch[]` that
  is **wrong or fabricated**. This is a model-judged comparison,
  not a deterministic CV pipeline. Users may apply a revised
  prompt that moves them further from their reference.
  *Mitigation:* every revised prompt goes through `validatePromptPreservation`
  (ADR 0012) so non-targeted anchors cannot be silently dropped.
  The `Mismatch[]` is rendered inline in the transcript (SPEC §22
  inline-diff pattern) so the user can SEE the model's reasoning
  before applying. The Apply step is still user-initiated — no
  auto-apply. Iteration cap of 8 prevents unbounded credit burn
  on a wrong direction.

- **R-2 (HIGH):** The latency budget is blown. The three sequential
  vision calls + one text call can easily exceed 45s on slow
  networks. The user clicks Analyze, walks away, comes back to a
  half-rendered transcript.
  *Mitigation:* per-step timeouts (15/15/10s, hard 18/18/12s).
  Streaming in-flight indicator per SPEC §24. The 504 envelope
  returns gracefully. Smoke script `scripts/smoke/ir-loop-smoke.js`
  measures p95 at IR-6 — if it's > 90s, we don't ship multi-iteration
  (kill criterion K2).

- **R-3 (MEDIUM):** The attachment manifest's `role` field collides
  with a future field of the same name. *Mitigation:* the field is
  namespaced by being optional and only ever set by
  `markChatAttachmentAsReference`. Other write paths ignore it. A
  test asserts that `role` round-trips through `_manifest.json`
  without loss. If the project later needs a richer attachment
  taxonomy, this slice is a no-op for those changes.

- **R-4 (MEDIUM):** `validatePromptPreservation` declines the
  revised prompt on first iteration because the IR-Revise module
  rewrote it aggressively. The user sees a decline message and
  no revised prompt to apply.
  *Mitigation:* the IR-Revise system prompt explicitly tells the
  model to preserve every non-targeted term from `current_prompt`.
  The module has a unit test (IR-4 #3) that asserts the revised
  prompt does not drop > 10% of content words from `current_prompt`
  on a fixture. Decline path mirrors SPEC §22 partial-apply
  decline exactly, including the user-facing explanation.

- **R-5 (MEDIUM):** Concurrent Analyze calls (user double-clicks
  the button). Two parallel runs, double credit spend.
  *Mitigation:* button is `disabled` immediately on click (SPEC
  §24 streaming pattern). Server-side, the route reads
  `ir_iteration_count` then writes — if two requests interleave
  past the cap check, the second sees `count >= 8` on its read
  and returns 409. Race window is one read-write; we accept the
  window (mirrors the existing chat message write race which
  the project has accepted since Slice 26).

- **R-6 (LOW):** The `imageDataUri` for an 8MB image blows the
  MiniMax request body limit. *Mitigation:* the existing per-field
  vision callers (texture, lighting) already enforce an 8MB cap.
  We mirror: `fs.statSync(imagePath).size > 8 * 1024 * 1024`
  returns 422 "Image too large; resize to under 8MB." before the
  vision call.

- **R-7 (LOW):** `data/chat_attachments/<session_id>/` doesn't
  exist for a fresh session. *Mitigation:* the route validates
  session existence first (404 if missing), then attachment
  presence (422). Same pattern as the existing
  `POST /api/chat/sessions/:id/messages` route.

- **R-8 (LOW):** Cross-browser chat input-bar layout breaks (Safari
  input bar overflow). *Mitigation:* the new button is wrapped in
  a flex container that follows the existing chat input-bar
  layout rules (mirrors the chat-attachment-upload button).
  Cross-browser e2e at IR-6 covers this.

- **R-9 (LOW):** The user uploads a non-image file as a "reference"
  (multer filters JPG/PNG/WebP, but a corrupt or renamed file
  could pass the filter). *Mitigation:* the route re-reads the
  file with `fs.readFileSync` and validates the magic bytes
  (PNG: `89 50 4E 47`, JPG: `FF D8 FF`, WebP: `RIFF....WEBP`)
  before sending to the model. 415 on magic-byte mismatch.

### Pre-commitments

- **P-1:** Every revised prompt MUST pass `validatePromptPreservation`
  before being emitted. A test asserts that on a fixture where the
  model would aggressively rewrite, the route declines with the
  standard partial-apply-decline envelope. (IR-4 #5.)
- **P-2:** Each IR module MUST have its own unit test fixture
  (captured MiniMax responses for analyze / compare / revise),
  committed under `tests/fixtures/ir/` and loaded in CI without
  network access. No live LLM calls in CI. (IR-2, IR-3, IR-4.)
- **P-3:** `session.ir_iteration_count` MUST be incremented only
  after a successful (non-declined) Analyze. A test asserts the
  counter does not increment on 504 / 422 / 409 paths. (IR-5 #2.)
- **P-4:** The 8-iteration cap MUST be enforced server-side, not
  just client-side. A test asserts the 9th POST returns 409 even
  when the client counter says 7. (IR-5 #1.)
- **P-5:** The `Mismatch[]` MUST be rendered inline in the
  transcript, visible BEFORE the user clicks Apply. A test
  asserts the DOM contains the `Mismatch[]` text after a
  successful Analyze. (IR-6 regression suite.)
- **P-6:** Every error path MUST return a one-line user-facing
  message. No raw stack traces. (IR-5 #3-5.)
- **P-7:** No regression in the 589 baseline tests. (Per-slice
  gate; the IR-6 smoke + e2e run is the final proof.)
- **P-8:** p95 end-to-end latency MUST be ≤ 90s on the smoke
  script, measured at IR-6 with 3 iterations on a fixture pair.
  (Kill criterion K2.)

### Kill criteria

- **K-1:** If IR-3's `Mismatch[]` accuracy on a captured fixture
  pair is below 60% agreement with a human rater on 3 sample
  pairs, the slice does not merge; redesign the schema or kill
  the feature.
- **K-2:** If end-to-end p95 latency exceeds 90s on 3 real runs
  at IR-6, we don't ship multi-iteration — single-shot Analyze
  is the fallback.
- **K-3:** If the existing 589-test regression suite fails any
  time during IR-1…IR-6, that slice does not merge. The new
  feature is additive; existing chat must not break.


## §29 pre-mortem — Destructive-endpoint test fixtures (HOUSEKEEPING H1)

### Risks

- **R-1 (MEDIUM):** The helper is misused (nested calls). Outer
  helper restores the file mid-test, inner helper restores on top,
  the user's file gets overwritten by the inner pre-snapshot.
  *Mitigation:* lock the helper as non-reentrant for v1 (no
  nested calls). A test comment + the helper's own guard
  (`assert(!inFlight, 'withDataFileSnapshotted is non-reentrant;
  do not nest')`) makes the contract explicit. If a real
  nested-call case arises, this gets revisited.

- **R-2 (MEDIUM):** The helper swallows `body()`'s throw and re-throws
  AFTER restore — meaning a test that asserts on the throw will
  see both the original throw AND a restore side-effect. Currently
  no test asserts on throw; if one is added later, this contract
  holds because restore happens before re-throw. The helper's
  `onError` hook (optional) gives the caller a side channel for
  observation without altering the re-throw semantics.

- **R-3 (LOW):** The helper accidentally removes an existing
  tracked file because the `data/` directory also holds
  `data/presets.json` (tracked, not gitignored). *Mitigation:* the
  helper's documented contract is "use only on gitignored files
  under `data/`." Initial unit tests verify the helper against a
  gitignored path (`chat_sessions.json`) and the absent-file
  case. A future PR can add an automated `.gitignore`-intersect
  guard if regressions occur.

- **R-4 (LOW):** Two helpers coexist post-slice (`snapshotChatFile`
  + `withDataFileSnapshotted`). If a future destructive slice
  accidentally uses the legacy pattern instead of the new one,
  it inherits the Session #19 class of bug. *Mitigation:* the
  helper's docstring points future destructive tests at
  `withDataFileSnapshotted`; the BACKLOG entry that motivated
  this slice (test fixtures for destructive endpoints) is left
  open as the "follow-up migration" item.

### Pre-commitments

- **P-1:** The helper MUST always restore the file, even if
  `body()` throws synchronously. Test coverage:
  throws-and-restores case.
- **P-2:** The helper MUST handle the pre-absent-file case
  (file does not exist before test, body creates it, helper
  must remove it on exit if file is now present). Test coverage:
  absent-to-present-to-absent.
- **P-3:** No existing test may flip red. 672/672 baseline stays
  green. The legacy helpers are unchanged in behaviour.

### Kill criteria

- **K-1:** Any baseline test flips red → helper or migration
  changed semantics; revert and replan.

## §30 pre-mortem — Krea 2 picker (SPEC §30 / ADR 0030)

### Risks

- **R-1 (HIGH):** Krea 2's "creativity" slider is a brand-new UI
  concept the app doesn't have today. The LLM contract for
  `creativity=0` (Raw) vs `creativity=100` (High) is different,
  and the LLM may not actually condition on the bucket reliably
  with a one-line per-bucket instruction in the system prompt.
  *Mitigation:* lock the four creativity bucket labels (Raw / Low
  / Medium / High — per manual §4, **exact numeric boundaries not
  published**) and per-bucket prompt branches in K.2's
  `DEFAULT_KREA2_PROMPT` constant. K.2 includes a test that the
  constant contains all four bucket labels verbatim. K.3 includes
  a visual demo where creativity is moved from 0 to 100 and the
  resulting prose's tone visibly shifts (manual §8 worked examples
  cite characteristic phrase atoms — "photorealistic 35 mm film
  photograph" for low creativity, "stylised, artistic,
  interpretive" for high; a test asserts these phrase atoms are
  present in the appropriate LLM-response branch). Kill
  criterion: K-1 below.

- **R-2 (HIGH):** Chat Apply for Krea 2 hits the same class of bug
  ADR 0021 hit in 2026-08-04 (issue #22): the apply handler
  updates server-side state but the Krea-2 textarea doesn't
  refresh. *Mitigation:* apply the lesson in K.4's DoD — the
  `applyChatRevision` branch for Krea 2 **must** mirror the
  write to `state.krea2Result.prompt` + `dom.krea2ResultPrompt.value`
  in lockstep. Enforced as a test in K.4. Mirrors the
  `scripts/smoke/anima-chat-apply-sync.js` static-source armour
  added during the Anima fix.

- **R-3 (MEDIUM):** The Krea 2 contract is prose-only. The
  existing per-field "Populate with AI" buttons (subject, actions,
  mood, lighting, texture) write back to the shared per-field
  store. A user might click "Populate with AI" on a field, then
  generate through Krea 2, and expect that field's LLM-refreshed
  value to flow into the Krea-2 prompt. It does — the per-field
  store is shared (Slice 2's "shared per-field artifacts"
  principle, ADR 0021 decision #4). But the test coverage should
  verify this end-to-end. *Mitigation:* K.4 includes a test that
  `/api/subject` (per-field) updates `state.subject` AND the next
  `/api/krea2` request carries the new `subject` in its shared
  per-field payload. Mirrors the Slice 2.4 Apply regression test.

- **R-4 (MEDIUM):** Variant (Turbo / Medium / Large) is recorded
  on the chat session but does NOT modify the system prompt. A
  future reader might assume variant changes contract. *Mitigation:*
  K.2's `DEFAULT_KREA2_PROMPT` includes an inline comment "Variant
  is capacity, not contract — see manual §2 and ADR 0030."
  K.4's chat-session-state test asserts the variant field is
  preserved through the chat session but does NOT appear in
  the LLM-facing system prompt.

- **R-5 (MEDIUM):** License boundary. Krea 2's distribution
  licence permits prompt-engineering for non-commercial use but
  restricts hosting the model behind a paid API (manual §12.3).
  The slice ships prompts only — no weights, no hosted inference,
  no paid API hooks. *Mitigation:* documented inline in ADR 0030
  decision #6 and in `callMiniMaxKrea2Analysis`'s docstring.
  Smoke script `scripts/smoke/krea2-license-boundary.js` asserts
  the constant + helper do not reference paid API endpoints.

- **R-6 (MEDIUM):** The 5-layer formula structure (Subject /
  Setting / Lighting / Style / Composition) requires the LLM to
  produce prose that *covers* all five layers. If the LLM
  collapses to "Subject + Style" only, the output is
  zip-code-incomplete. *Mitigation:* the system prompt's per-
  bucket branch includes "All five layers must be present and
  covered in this order." A test asserts the constant references
  all five layer names verbatim. This mirrors ADR 0021's 2026-08-04
  coverage-categories sharpening for Anima.

- **R-7 (LOW):** The picker gains a third option. The existing
  pre-Generate render target (`dom.modelSelector`) was sized for
  two buttons. The CSS may need to accommodate three side-by-side
  buttons at the project's standard widths. *Mitigation:* the
  renderer uses `.model-selector__button` flexbox + width auto;
  three buttons fit at ≥768px viewport. K.1's visual demo
  verifies at 768px (the test threshold for tight layouts in
  the project).

- **R-8 (MEDIUM):** Krea 2 has **no negative prompt** — manual §10
  (troubleshooting R8) and §11 are explicit: default CFG=0
  means negative prompts have no effect. The Krea-2 dispatch
  must NOT emit a `negative` field on its response envelope,
  and the result panel must render exactly one textarea
  (positive prose). *Mitigation:* `callMiniMaxKrea2Analysis`'s
  JSON schema explicit keys are `{ prompt, variant, creativity,
  generated_at, model: 'krea2' }` — no `negative`. The frontend
  result-panel markup (`dom.krea2ResultPrompt`) is one textarea,
  not a pair. K.3 includes a static-source test that the response
  envelope does not carry a `negative` field and the result
  panel renders a single textarea.

### Pre-commitments

- **P-1:** `DEFAULT_KREA2_PROMPT` MUST contain references to all
  five layers (Subject / Setting / Lighting / Style / Composition)
  verbatim + the four creativity bucket labels (Raw / Low / Medium
  / High). Test coverage in K.2.
- **P-2:** `applyChatRevision`'s Krea-2 branch MUST write to
  `state.krea2Result.prompt` AND `dom.krea2ResultPrompt.value` in
  lockstep (mirroring the Anima fix). Test coverage in K.4.
- **P-3:** Krea-2 variant MUST persist through chat session
  creation and Apply, but MUST NOT appear in the LLM-facing system
  prompt. Test coverage in K.4.
- **P-4:** No regression in the 678-test baseline. The 678 includes
  Slice 2 (Anima), Slice 26 (cross-provider), Slice 27 (clear
  chat history), IR-1…IR-7 (iterative refinement), SPEC §29
  (destructive fixtures). Each K sub-slice's gate run asserts
  678 → 678 + new-for-that-sub-slice.
- **P-5:** Picker render quality at 768px viewport (the project's
  tight-layout threshold). Visual demo recorded for K.1.
- **P-6:** License-boundary constants + helpers do not reference
  paid Krea 2 APIs. Smoke script verifies.
- **P-7:** Krea-2 response envelope MUST NOT carry a `negative`
  field. The result panel MUST render exactly one prose textarea
  (not a positive + negative pair). Krea-2 chat Apply MUST NOT
  attempt to apply to a non-existent `negative` field. Test
  coverage in K.2 (response envelope), K.3 (panel markup), K.4
  (Apply branch).

### Kill criteria

- **K-1:** If creativity-tier differentiation is not visible in
  the LLM response shape on a captured fixture pair (creativity=0
  vs creativity=100 produce visibly different prose in tone,
  vocabulary, or rendering style), the slice does not merge;
  redesign `DEFAULT_KREA2_PROMPT` or kill the creativity feature.

- **K-2:** If the chat Apply for Krea-2 does not visibly update
  the Krea-2 result panel (mirroring the Anima issue #22 bug),
  the slice does not merge; the K.4 DoD test catches this in
  advance.

- **K-3:** If `validatePromptPreservation` (ADR 0012) rejects
  more than 30% of valid Krea-2 prose revisions (the prose-only
  contract interacts with the keyword/bigram retention metric
  differently from the Anima tag contract), the slice does not
  merge; investigate threshold re-tuning OUTSIDE this slice
  (a future `docs/POLISH-AUDIT-K.md` would surface it).

- **K-4:** If any of the 678 baseline tests flips red during
  K.1 → K.4, that sub-slice does not merge. The new feature is
  additive; existing flows must not break.

- **K-5:** If the Krea-2 response envelope gains a `negative`
  field at any point during K.1 → K.4 implementation, the slice
  does not merge; the contract is single-positive-prose per
  manual §10 + §11.

## §30.6.1 pre-mortem — K.6 wiring (K.3 follow-up)

Added 2026-10-16 as a K.3 ship-without-wiring fix. The
Krea-2 result panel's Regenerate + Copy buttons were rendered
in `src/index.html` but had no `dom` lookups and no click
listeners — the Regenerate button was a dead element. The user
reported the bug on 2026-10-16.

### Risks

- **R-9 (LOW):** Wiring the click listener as a direct
  reference (`runKrea2Generate`) rather than an inline closure
  could miss the `state.krea2Variant` /
  `state.krea2Creativity` updates the user just made on the
  slider + selector if any state mutation were happening
  in-flight. *Mitigation:* `runKrea2Generate` reads both
  fields from the global `state` object at call time
  (`src/app.js:2041-2042`), not from closure-captured values.
  The same pattern is used by the pre-Generate picker dispatch
  in `runGeneratePrompt` (`src/app.js:1782-1814`). K.6 test
  `runKrea2Generate sets loading on the krea2 regenerate
  button` locks the function's read-from-state contract. No
  regression risk.

- **R-10 (LOW):** Adding `setButtonLoading` on the secondary
  `krea2RegenerateBtn` could create a state inconsistency if
  the user starts a regeneration from the primary button
  (the pre-Generate picker) while a regeneration from the
  panel button is in flight (or vice versa). *Mitigation:*
  `state.isGenerating` is a single boolean; both call sites
  set it true at entry and false in `finally`. The primary
  button's `disabled` state is gated on `state.isGenerating`
  via `updateButtons()` (`src/app.js:357-361`). K.6 does not
  change this. No regression risk.

- **R-11 (LOW):** The HTML markup change adds
  `<span class="btn-text">` wrapping the button label. The
  existing Z-Image + Anima copy buttons do NOT have this
  wrapping — only the Anima regenerate button does (Slice
  2.3). If a future polish audit searches for "all copy
  buttons use btn-text wrapping", the Krea-2 + Z-Image copy
  buttons will be the only two without the wrapper. *Mitigation:*
  out of scope for K.6 (the Krea-2 copy button gets the
  wrapper because K.6's copy handler reads the inner `.btn-text`
  span to do the text-swap-back; the Z-Image copy button has
  a different pattern). Documented here so the next
  consistency pass knows to handle the Z-Image copy button
  separately. No immediate risk.

### Pre-commitments

- **P-8:** K.6's regenerate handler MUST be the direct
  reference `runKrea2Generate` (not an inline closure that
  re-reads `state.krea2Variant` / `state.krea2Creativity`),
  so the function is the single source of truth for the
  forward-to-API contract. Test coverage: K.6 test
  `krea2RegenerateBtn click listener fires
  runKrea2Generate`.

- **P-9:** K.6's copy handler MUST read from
  `dom.krea2ResultPrompt.value` only (the single prose
  textarea), not assemble a `Positive:\n${pos}\n\nNegative:
  \n${neg}` block. The Krea-2 contract is prose-only (P-7
  invariant). Test coverage: K.6 test
  `krea2CopyBtn click listener copies via
  navigator.clipboard.writeText` (asserts the handler window
  references `krea2ResultPrompt`).

- **P-10:** K.6's loading-state changes MUST NOT regress
  the existing primary-button loading behaviour. The primary
  `dom.generatePromptBtn` is still set to loading at entry
  and reset in `finally`, exactly as K.2 / K.3 left it. K.6
  adds a parallel pair on `dom.krea2RegenerateBtn`. The
  existing K.5 aggregate test still asserts the baseline
  invariant.

### Kill criteria

- **K-6:** If any of the 712 baseline tests flips red during
  K.6 (K.6 is additive — it adds 6 new tests but must not
  break any existing one), the slice does not merge. K.6
  verified at 718 / 0 green on 2026-10-16; criterion met.

- **K-7:** If clicking the Krea-2 Regenerate button does NOT
  fire a POST /api/krea2 with the current
  `state.krea2Variant` + `state.krea2Creativity` on a
  captured browser session (i.e. a manual smoke test fails),
  the slice does not merge. The user's 2026-10-16 report was
  the failure that triggered this slice; the fix is verified
  by the unit tests that lock the wiring + the read-from-
  state contract. Manual browser smoke (the G4 demo gate) is
  recommended before merging to a public branch.

### Out of scope (intentional)

- Z-Image + Anima regenerate button `.btn-spinner` markup
  (same cosmetic gap, but the user reported only the
  Krea-2 symptom). Parked for a future polish pass.
- `setButtonLoading` refactor to accept a button list. Wide
  refactor, would cross the AGENTS.md "rename a shared
  symbol" gate. Parked.
- `#krea2-refine-in-chat-link` is an `<a href="#/chat">` and
  needs no JS wiring. No change.

## §30.6.2 pre-mortem — K.7 wiring (K.4 follow-up)

Added 2026-10-16 as a K.4 ship-without-wiring fix. The
`activateKrea2ChatForResult` helper (src/app.js:2627) was a
half-complete helper that POSTs `/api/chat/sessions` and
sets `state.chatSessionId` but skips the post-success block
that un-hides the chat panel. The user reported the bug on
2026-10-16: clicking the "Refine in chat →" link on the
Krea-2 result panel sent them to `#/chat` with only the
view title + view-sub visible, no session rail, no
message area, no input. Black background underneath.

### Risks

- **R-12 (LOW):** Mirroring the Anima helper's post-success
  block into the Krea-2 helper creates a divergence risk if
  the two helpers ever drift (e.g. one adds a step the
  other doesn't). *Mitigation:* K.7 makes the two helpers
  structurally identical (see ARCH §30 A11 for the block
  diagram). The two call sites differ only in the POST
  body. A future refactor could lift this into one
  parameterised `activateChatForResult(model, data)` helper,
  but that crosses the AGENTS.md "rename a shared symbol"
  gate and is out of scope for K.7. The risk is the
  *motivation* to refactor, not the immediate correctness.

- **R-13 (LOW):** `renderChatMessages(session)` clears the
  message area (`dom.chatMessages.innerHTML = ''`) before
  rendering. If the user had a previous chat session
  selected (from a different model) when the Krea-2 result
  fires, the panel-show would wipe the previous messages.
  *Mitigation:* `state.chatSessionId` is updated atomically
  to the new session.id BEFORE `renderChatMessages` is
  called. The Anima helper does the same. The previous
  session is preserved in `state.chatSessions` and
  re-selectable from the session rail. No data loss.

- **R-14 (LOW):** `dom.chatInput.focus()` on chat-activation
  is new for the Krea-2 path. The Anima helper does it;
  Z-Image's helper does not (K.7 makes the Krea-2 path
  match Anima, not the other way around). If a user is
  mid-typing in a different input (e.g. the directive
  field), focus stealing could be a UX surprise.
  *Mitigation:* the user just clicked a "Refine in chat →"
  link, so they have signalled they want to type in the
  chat. Focus stealing is the intended UX. Same pattern as
  Anima (Slice 2.4). No regression risk.

### Pre-commitments

- **P-11:** K.7's helper MUST mirror the Anima helper's
  post-success block one-for-one: `state.chatSessions`
  prepend, `renderChatMessages(session)`, un-hide
  `dom.stepChat`, populate `dom.chatSessionStatus`, enable
  `dom.chatSessionDeleteBtn`, focus `dom.chatInput`. The
  K.7 tests lock the four most critical of these (prepend,
  render, un-hide, focus). Test coverage: 4 new SPEC §30
  K.7 tests.

- **P-12:** K.7 MUST NOT change the Krea-2 chat-session
  POST body. The body is a K.4 contract decision (model:
  'krea2', variant, creativity, metadata, no negative
  field per P-7 invariant). K.7 is a UI-binding fix, not a
  contract change. Test coverage: existing K.4 tests still
  pass; K.7 does not modify any K.4 assertion.

- **P-13:** K.7 MUST NOT add a `chat`-case branch to
  `onViewEnter` in src/shell.js. The empty-chat-view case
  (user navigates to `#/chat` via the top nav tab with no
  session) is a different cause, different scope. Parked
  as **H7** in BACKLOG. The helper fix is the right scope
  for K.7; mixing in the view-entrance handler would
  conflate "fix the Krea-2 result-panel flow" with "fix
  the chat-view entrance for all flows".

### Kill criteria

- **K-8:** If any of the 718 baseline tests flips red
  during K.7 (K.7 is additive — it adds 4 new tests but
  must not break any existing one), the slice does not
  merge. K.7 verified at 722 / 0 green on 2026-10-16
  (target — see SPEC §30.6.2 DoD); criterion met once
  verified.

- **K-9:** If clicking the "Refine in chat →" link on the
  Krea-2 result panel does NOT land the user on a chat
  view with the session rail populated, the working-prompt
  editor visible, the message area showing the empty-state
  hint, the send button enabled, and the input focusable
  (verified manually in a captured browser session), the
  slice does not merge. The user's 2026-10-16 report was
  the failure that triggered this slice; the fix is
  verified by the 4 unit tests + the manual smoke test
  (the G4 demo gate).

### Out of scope (intentional)

- Click handlers on the three `<a href="#/chat">` links
  (Z-Image, Anima, Krea-2). The helper fix is sufficient;
  the session is pre-created before the user ever clicks
  the link. Belt-and-braces only.
- An `onViewEnter('chat')` branch that handles the
  empty-chat-view case. Different cause, different scope.
  Parked as **H7** in BACKLOG.
- Z-Image + Anima regenerate button `.btn-spinner` markup
  (H5 parked, K.6 follow-on).
- `setButtonLoading` refactor (parked).
- A lifted `activateChatForResult(model, data)` helper
  (would cross the "rename a shared symbol" gate; parked).

## §30.6.3 pre-mortem — K.8 markup (H5 close)

Added 2026-10-16 as a parallel-to-K.6 cosmetic-gap fix.
K.6 added `btn-text` + `btn-spinner` markup to the
Krea-2 Regenerate button. The same gap existed on the
Z-Image and Anima Regenerate buttons. K.8 is a tiny
HTML-only fix that brings the two buttons to parity.

### Risks

- **R-15 (LOW):** Wrapping the existing button label
  ("Regenerate") in a `<span class="btn-text">` could
  shift the button's visual position if the surrounding
  CSS depends on direct text content (no whitespace
  control). *Mitigation:* the Krea-2 K.6 markup uses the
  same wrapper and the visual did not shift (the
  Krea-2 panel was verified in K.6's polish audit).
  The Z-Image + Anima result-action blocks use the
  same `.btn-secondary` class so the CSS rule is
  shared. No visual regression expected.

- **R-16 (LOW):** A future CSS change that targets
  `.btn-secondary > *` (direct children) could now
  match the new `<span>` children instead of the bare
  text. *Mitigation:* no such rule exists in
  `src/styles.css` as of 2026-10-16. If a future slice
  adds one, the test for the inner `.btn-text` /
  `.btn-spinner` would catch any regression that
  breaks the spinner toggle. No immediate risk.

### Pre-commitments

- **P-14:** K.8's markup MUST be a literal mirror of
  the K.6 Krea-2 markup. The `btn-text` span wraps
  the button label verbatim, and the `btn-spinner`
  span is a sibling with the same `hidden
  aria-hidden="true"` attributes. No stylistic
  divergence.

## §30.6.4 pre-mortem — K.9 wiring (H7 close)

Added 2026-10-16 as the close of H7. H7 was parked in
K.7's P-13 — different cause (no session, not a
half-complete helper) but same black-screen symptom.
K.9 adds the `onViewEnter('chat')` branch that P-13
explicitly deferred.

### Risks

- **R-17 (LOW):** Calling `showEmptyChatState` from
  `onViewEnter` on every entry to `#/chat` (even when
  a session is active) adds a function call per
  navigation. The function is a no-op when
  `state.chatSessionId` is set, so the cost is one
  boolean check + one early `return false` per
  navigation. Negligible. *Mitigation:* the function
  is intentionally cheap; no caching needed.

- **R-18 (LOW):** The empty-state paragraph overwrites
  any prior `#chat-messages` content. If the user has
  a session active, navigates away, and navigates back
  via the nav tab, the active-session path's
  `renderChatMessages` (or the new K.7 post-success
  block) re-runs AFTER `showEmptyChatState` returns
  false, so the active messages survive. *Mitigation:*
  the early `return false` in `showEmptyChatState`
  ensures the function never touches `#chat-messages`
  when a session is active. Test `SPEC §30 K.9:
  showEmptyChatState un-hides #step-chat` locks the
  no-op guard pattern.

- **R-19 (LOW):** The new `__i2pShowEmptyChatState`
  bridge adds one more `window.__i2pXxx` surface to
  the app.js IIFE. If a future refactor centralises
  these bridges, the count of `window.__i2p*` exports
  is currently 3 (ClearHistory, AnalyzeGenerated,
  ShowEmptyChatState) and growing. *Mitigation:* this
  is the established bridge pattern; not a new
  concern. The bridges are stable, documented, and
  guarded by `typeof` checks on the shell.js side.

### Pre-commitments

- **P-15:** K.9's `showEmptyChatState` MUST no-op
  (return `false`) when `state.chatSessionId` is set.
  The active-session path is owned by K.7 + Slice
  2.4 + loadOrCreateChatSession + selectChatSession.
  Test coverage: 1 of 3 K.9 tests asserts the
  no-op-when-active pattern.

- **P-16:** K.9's empty-state text MUST mention
  the two-step flow ("Generate a prompt in the
  Create view, then click 'Refine in chat →' on the
  result panel") so the user has actionable
  instructions. The current text is verbatim from
  the SPEC; future polish may reword but MUST
  preserve the two-step reference.

### Kill criteria

- **K-12:** If any of the 725 baseline tests flips
  red during K.9 (K.9 is additive — it adds 3 new
  tests but must not break any existing one), the
  slice does not merge. K.9 verified at 728 / 0
  green on 2026-10-16; criterion met.

- **K-13:** If clicking the top nav "Chat" tab
  without first generating a prompt does NOT show
  the friendly empty-state paragraph in
  `#chat-messages` on a captured browser session
  (i.e. manual smoke fails), the slice does not
  merge. The 3 unit tests lock the function
  presence + the shell.js call + the DOM writes;
  the smoke confirms the wiring renders correctly
  in a real browser.

### Out of scope (intentional)

- Auto-creating a chat session on empty view
  entrance. Different scope; would contradict the
  per-model chat-session pattern (ADR 0021).
- Auto-navigating to the Create view. Aggressive
  UX intervention not warranted by the symptom.
- Hiding the chat form below the empty state. The
  submit handlers already guard with
  `if (!state.chatSessionId)`.

### Kill criteria

- **K-10:** If any of the 722 baseline tests flips
  red during K.8 (K.8 is additive — it adds 3 new
  tests but must not break any existing one), the
  slice does not merge. K.8 verified at 725 / 0
  green on 2026-10-16; criterion met.

- **K-11:** If clicking the Z-Image or Anima
  Regenerate button does NOT show a visible spinner
  during the in-flight window on a captured browser
  session (i.e. manual smoke fails), the slice does
  not merge. The unit tests lock the markup
  presence; the smoke confirms the markup is wired
  to the right CSS animation. Manual browser smoke
  is recommended before merging to a public branch.

### Out of scope (intentional)

- `setButtonLoading` refactor to accept a button
  list. Wide refactor, would cross the AGENTS.md
  "rename a shared symbol" gate. Parked.

## §30.6.6 pre-mortem — K.13 (POLISH-AUDIT P1/P2 close)

### Risks

- **R-20: `compression()` rewrites
  `Content-Length`.** The middleware streams
  compressed output and removes the
  `Content-Length` header. Clients that buffer
  by length (rare; mostly old HTTP/1.0 clients)
  fall back to chunked transfer encoding. The
  test suite uses Node's built-in fetch which
  handles both. Risk: low; impact: low.

- **R-21: Cache-Control on `/src/app.js` could
  mask a buggy release.** A 1-day max-age means
  a user with the page open at deploy time could
  keep the old bundle for up to 24 h. The project
  has no in-app "new version available" toast
  (out of scope for K.13). Risk: low (current
  bundle is small + backwards-compatible at the
  contract level); impact: low.

- **R-22: compression adds CPU overhead on
  every response.** The middleware uses
  zlib.gzipSync for tiny responses, which is
  slower than zlib.createGzip. For the
  `/api/notes.json` style responses (1-5 KB)
  this is negligible. For the static bundle
  (1.2 MB) the first request pays the cost; the
  browser cache (post-K.13) eliminates it on
  repeat. Risk: low; impact: low.

### Pre-commitments

- **P-17: One-line revert path.** Removing the
  two `app.use(…)` lines fully reverts K.13.
  No migration, no data shape, no schema.
- **P-18: `STATIC_ASSET_CACHE_MS` is the single
  tuning knob.** Future cache-duration changes
  edit that one const, not the header template.

### Kill criteria

- **K-14:** If any of the 732 baseline tests
  flips red during K.13 (K.13 is additive — it
  adds 4 new tests but must not break any
  existing one), the slice does not merge.
  K.13 verified at 736 / 0 green on 2026-10-16;
  criterion met.

- **K-15:** If `node --check server.js` fails
  after the K.13 edits, the slice does not
  merge. Verified syntax OK on 2026-10-16;
  criterion met.

### Out of scope (intentional)

- Brotli encoding (would require the `iltorb`
  native binding; the project stays on pure-JS
  gzip).
- HTTP/2 server (project is on HTTP/1.1; the
  perf wins are real but the migration is a
  separate slice).
- Service worker for offline / instant-load
  (separate, much larger scope).
