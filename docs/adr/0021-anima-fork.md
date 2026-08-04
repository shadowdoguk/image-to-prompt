# ADR 0021 — Anima fork: pre-Generate model picker for the Z-Image / Anima contract fork

## Status

Accepted. Implemented 2026-08-03 (Slice 2 of the App Build methodology).

## Context

The image-to-prompt app was a single-track pipeline: upload → click Generate → contact MiniMax M3 → emit one Z-Image Turbo prompt (the pastel-focal-glow contract, ADR 0019). The user reached a fork point in two senses:

1. **The Z-Image Turbo contract is one of two viable contracts.** The user actively works with **Anima** (CircleStone Labs, 2 B-parameter Cosmos-based anime/illustration model — see `docs/ANIMA-PROMPTING-MANUAL.md`) and wants the same upload + chat flow to target it too. The two contracts are not interchangeable (tags + lowercase + `@`-prefix for Anima vs. natural-language prose + pastel-focal-glow for Z-Image), so a single shared output would be incoherent.
2. **The user explicitly chose a pre-Generate model picker** over a dual-output design. The picker is upstream of the Generate button, not a post-hoc toggle. This means the two contracts are **exclusive siblings** — one model is selected per generation, the prompt panel and chat console both operate on that model's logic, and switching back/forth is a deliberate user action.

The user also chose a **per-model-and-per-variant chat session** model: switching model (or Anima variant) ends the current session and starts a new one. The `model` field is annotated on every chat message. The chat default-system-prompt is `state.model`-aware.

The Z-Image side remains unchanged. The Anima side is a sibling — additive, not a replacement.

The Slice 2 SPEC (`docs/SPEC.md` §14) and the Slice 2 architecture (`docs/ARCHITECTURE.md` A1–A9) capture the slice in detail. The Slice 2 pre-mortem (`docs/PRE-MORTEM.md` "Slice 2") lists the failure modes and pre-commitments. This ADR captures the strategic decision itself.

## Decision

Adopt a **fork** at the entry point of the app's pipeline:

1. **Pre-Generate model picker.** A dropdown or button group sits near the Generate button. The user picks one of two model lines: `Z-Image Turbo` (the default; existing behavior) or `Anima`. The picker is **persisted** in `localStorage`, **mirrored** in the URL (`?model=...`), and **recorded** in chat sessions.
2. **Anima variant selector.** If the user picks Anima, a separate, nested selector in the Anima result panel chooses between Base / Aesthetic / Turbo. Variants default to `Base`. The variant selector is a different abstraction level from the model selector (which model line vs. which checkpoint).
3. **Single dispatch path.** The frontend, on Generate, calls `/api/zimage` (existing) or `/api/anima` (new, sibling) based on `state.model`. The dispatch is a single point of control, not parallel dual endpoints. The dispatch state is persisted (model + variant) and is the single source of truth for which contract is active.
4. **Two contracts, shared per-field artifacts.** The per-field artifacts (`subject`, `actions`, `mood`, `lighting`, `texture`, etc.) are shared between both pipelines. Only the **final-prompt assembly** is model-specific. The Anima contract uses the manual as its source of truth (`docs/ANIMA-PROMPTING-MANUAL.md` §5, §7, §14). The Z-Image contract uses the pastel-focal-glow contract (ADR 0019).
5. **Per-model-and-per-variant chat sessions.** Chat history is annotated with `model` and (for Anima) `variant`. Switching either ends the current session and starts a new one. The chat default-system-prompt is `state.model`-aware.
6. **License boundary respected.** The app emits prompts via MiniMax M3 (a third-party LLM) — it does **not** embed Anima weights, host Anima inference, or integrate with paid Anima APIs. The CircleStone Labs Non-Commercial License v1.2 + NVIDIA Open Model License restrict hosting the model behind a paid API, but do not restrict prompt-engineering for Anima. Per Slice 2 SPEC §14.10, prompts are the user's own creative work; the model itself is not redistributed.
7. **State validation.** Every state read from localStorage or URL validates against the allowed enums (`'zimage_turbo' | 'anima'` for model, `'base' | 'aesthetic' | 'turbo'` for variant). On mismatch, fall back to the default and log a warning.

The Slice 2 sub-slice breakdown (Slice 2.1 → 2.5) is in `docs/SPEC.md` §14.9. The pre-mortem is in `docs/PRE-MORTEM.md` (Slice 2 entry). The implementation modules are listed in `docs/ARCHITECTURE.md` A3.

## Consequences

The app gains a **two-contract code base** instead of a one-contract code base. The maintenance cost is real but bounded:

- **Two contracts to keep coherent.** Every bug fix to a per-field artifact benefits both contracts. Every fix to the final-prompt assembly needs to be applied to both. The shared-per-field-artifacts principle (decision 4) constrains the duplication.
- **Two prompt contracts to evolve.** The Z-Image side might undergo another contract rewrite (ADR 0019 was the first). The Anima side will evolve as the model gets updated. The dispatch layer is the only place that knows about model-specific output, so the divergence is contained.
- **Frontend state proliferation.** `state.model` + `state.animaVariant` join a long list of model-side state flags. The state is first-class, persisted, validated, and mirrored in the URL — but it's a real concept, and it has consequences for every UI render.
- **Chat history is per-model.** Users who switch model mid-session lose the current session. This is a deliberate UX choice (resolution of Open Question Q3 in the SPEC §14.11) — the alternative (shared chat history, two parallel prompts) would produce inconsistent revisions.
- **The license boundary is real.** The slice ships no weights, no hosted inference, no paid-API links. Future features that want to "make it easier to run the prompt" by linking to or embedding Anima weights are explicitly out-of-scope (SPEC §14.4.2 + PRE-MORTEM failure mode 5).
- **The Anima contract is more condition-heavy.** Pure-tag, pure-prose, hybrid shapes (manual §7) depend on the image's subject. The LLM contract itself must condition on the image content. The slice ships one system prompt with branching rules; per-variant constants are a stretch path.

## Rejected alternatives

1. **Dual-output (both contracts emitted per upload).** Rejected at G1. The user explicitly preferred the pre-Generate picker over a dual-output design. The two contracts are not interchangeable, and bundling them would produce incoherent outputs. The maintenance cost of branching every chat refinement across two contracts favours the fork.
2. **Post-hoc toggle (generate Z-Image, then switch to Anima).** Rejected at G1. A post-hoc toggle would require a re-LLM call to re-emit the Anima contract, which is wasted work 50% of the time. The pre-Generate picker is downstream of the choice, which is the right place to make the call.
3. **Three-level model selector (Model → Variant → Checkpoint).** Rejected. The variant and checkpoint distinctions are intra-Anima concerns. The model selector should be one dropdown (which model line). The variant lives in the Anima result panel header. (Resolution of Open Question Q1 in SPEC §14.11.)
4. **Shared chat history across models.** Rejected. Two contracts refining the same prompt would produce inconsistent revisions. The chat default-system-prompt is different per contract (Z-Image's pastel-focal-glow vs. Anima's Danbooru-tag rules). Per-model sessions are the only coherent design. (Resolution of Open Question Q3 in SPEC §14.11.)
5. **Stitch the Anima contract into the existing `/api/zimage` endpoint.** Rejected. The two contracts have different output shapes (single prompt vs. positive + negative pair). Combining them would require a discriminated union, which is more code than two endpoints. The single dispatch path keeps the code small.
6. **Embed Anima weights in the app for "convenience."** Rejected per license boundary (decision 6). The CircleStone Labs Non-Commercial License v1.2 explicitly restricts hosting the model behind a paid API; embedding weights in a Docker image would be a stretch too far. The slice ships prompts only.
7. **Use a hosted Anima inference API (Civitai, TensorArt, etc.).** Rejected. The slice is a prompt-engineering slice, not an inference slice. Hooking into a third-party API would require tokens, billing, and a whole new feature surface. The user copies the prompt and runs it locally.

## Verification

Verification commands run in the worktree (post-Slice-2 implementation):

- **`npm test`** — all existing + new tests pass (per-field tests + Anima-specific tests for `/api/anima` + `DEFAULT_ANIMA_PROMPT` + `callMiniMaxAnimaAnalysis`).
- **`node scripts/session-init.js`** — 10/10 V-checks pass (validation gate green).
- **`node --check server.js && node --check src/app.js && node --check tests/run-all.js && echo "syntax OK"`** — exit 0, prints `syntax OK`.
- **`git diff --check`** — exit 0, no whitespace conflict markers.
- **`git status --short`** — clean tree (post-commit).
- **`node scripts/smoke/anima-fork-smoke.js`** — exit 0; the smoke script covers the Anima pick + generate + variant switch + chat-refine-then-switch cycle.
- **Manual demo** — three scenarios:
  1. Pick Anima, upload an anime character image, click Generate → positive + negative prompts appear in the Anima result panel. Both follow the Anima contract (lowercase tags, `@`-prefix, recommended positive prefix, recommended negative vocabulary).
  2. Switch to Z-Image Turbo, upload the same image, click Generate → single Z-Image prompt appears. The Z-Image picker is unaffected.
  3. Pick Anima, generate, switch to Z-Image Turbo mid-session → confirmation dialog appears, "Switching to Z-Image Turbo will end the current chat session. Continue?" → Cancel returns to Anima (session intact), Confirm switches (session ended, new session begins).
- **Code review** — `docs/CODE-REVIEW-2-anima-fork.md` per-sub-slice verdict: `pass` or `pass+minor`.

## References

- `docs/SPEC.md` §14 — Slice 2 spec (G2 approved)
- `docs/ARCHITECTURE.md` A1–A9 — Slice 2 architecture (G3)
- `docs/PRE-MORTEM.md` Slice 2 entry — failure modes and pre-commitments (G3)
- `docs/ANIMA-PROMPTING-MANUAL.md` — the Anima contract source of truth (882 lines, compiled 2026-08-03)
- `docs/adr/0019-zimage-pastel-focal-glow-contract.md` — the Z-Image contract that the fork parallels
- `docs/adr/0020-conversational-prompt-drafts.md` — the chat-handling pattern that the chat dispatch extends
- `docs/adr/0018-populate-with-ai-actions-mood-lighting.md` — the per-field pattern that the Anima backend contract (helper + route + default prompt) mirrors
- `https://huggingface.co/circlestone-labs/Anima` — primary source for the Anima model card
- `docs/ANIMA-PROMPTING-MANUAL.md` §16 — the license boundary in plain English

## Consequences (2026-08-04) — chat Apply: missed Anima sync branch

**Issue:** [`#22`](https://github.com/shadowdoguk/image-to-prompt/issues/22) — "Refine via chat 'Apply' does not update Anima result panel."

**What shipped in Slice 2.4 that triggered the bug.** Slice 2.4 added the Anima chat activation (`activateAnimaChatForResult`) and the `model: 'anima'` dispatch so the chat server-side constraints block (`ANIMA_CHAT_CONSTRAINTS_BLOCK`) fires for Anima-mode sessions. The session was correctly anchored on `data.positive` and the chat UI worked end-to-end (suggested_prompt proposals, Apply badge, status messages). One piece was missed: the **client-side apply handler** (`applyChatRevision` in `src/app.js`) only updated `state.finalPrompt` + `dom.resultPrompt.textContent` — the Z-Image result panel's render targets. In Anima mode, `dom.resultPrompt` is hidden (`displayAnimaResult` sets `dom.resultSection.hidden = true`) and the visible UI is `dom.animaResultPositive` (textarea) backed by `state.animaResult.positive`. The chat revision applied correctly server-side, the chat panel showed "Applied," but the Anima textarea continued to display the original prompt.

**Lessons.**

1. **State slices parallel to UI elements must be mirrored at every mutation point.** The fork introduced `state.animaResult` as a parallel to `state.finalPrompt`, but the apply handler was written against the original Z-Image state. The fix is a `state.model === 'anima'` branch that mirrors the change into `state.animaResult.positive` + `dom.animaResultPositive.value`. The Z-Image branch remains the `else` leg.
2. **The token-reminder banner is still Z-Image-only.** `updateTokenReminderBanner()` reads `state.finalPrompt` only. In Anima mode it stays quiet after an apply. This is an acknowledged limitation; if a user-visible regression is reported, it would warrant a follow-up ADR (reading `state.animaResult?.positive` when `state.model === 'anima'`). Not in scope for this fix.
3. **Static-source smoke regression armor.** New file `scripts/smoke/anima-chat-apply-sync.js` — 7 checks, all pass. The smoke mirrors the `palette-stale-id-guard.js` pattern: pure source-string inspection, no server/LLM dependency. Checks (a) the apply handler branches on `state.model === 'anima'`, (b) writes to `dom.animaResultPositive.value`, (c) updates `state.animaResult.positive`, (d) the Z-Image branch still writes to `state.finalPrompt` + `dom.resultPrompt.textContent` (regression armor), (e) `updateTokenReminderBanner()` is still re-evaluated, (f) an explanatory comment is present.
4. **PRE-MORTEM §"Failure mode 8" anticipated a related but distinct outcome.** The pre-mortem warned about variant switching mid-session (Base → Aesthetic) breaking the chat anchor. The bug we hit is different: everything within a single Anima session worked, but the **apply step** didn't propagate to the visible UI. The two issues share a root cause — chat-side state desync from display-side state — but the failure mode was not predicted because it required looking at the *apply* path, not just the *generate* path. Update the pre-mortem to flag apply-path drift as a third category.

**Resolution path.** Issue #22 fixed in this commit. The fix to `applyChatRevision` is the only code change required.

## Consequences (2026-08-04) — coverage categories sharpening in `DEFAULT_ANIMA_PROMPT`

**Issue:** [`#23`](https://github.com/shadowdoguk/image-to-prompt/issues/23) — "Anima prompt generation omits camera angle, mood, lighting, and posture tags."

**What the user observed.** A handful of Anima generations on varied subject matter produced `positive` tag lists that covered `subject`, `count`, `quality`, `safety`, `style`, and a handful of general tags — but consistently omitted the camera-angle, mood, lighting, and posture tags that the manual's worked examples (§7, §9, §17 of `docs/ANIMA-PROMPTING-MANUAL.md`) treat as expected. The Z-Image Turbo path on the same image captured all four families in `state.currentAnalysis` (per ADR 0018's per-field analysis contract). The Anima path was only sending the image bytes to the LLM, with no instruction to mirror those families into the tag output.

**Root cause.** `DEFAULT_ANIMA_PROMPT` (Slice 2.2, server.js:3050+) is a comprehensive style-and-format brief: lowercase, comma-separated, Gelbooru-favored, quality-prefix, forbidden vocabulary. It documents *output shape* in depth. It documents *output content* only via examples embedded in the prompt and via the manual — but the worked examples were not enumerated as required categories. The LLM, given a format brief plus a few worked examples, treated the categories as illustrative rather than mandatory, and the 60-character `minLength` floor on `positive` was satisfied by subject + style + count tags alone.

**Resolution path.** Issue #23 fixed in this commit. One section added to `DEFAULT_ANIMA_PROMPT` (no other code paths touched):

- New `# COVERAGE CATEGORIES` section enumerates six tag families — camera angle, mood/expression, lighting, posture/action, composition/framing, era/time-of-day — each with the canonical vocabulary to use (mirroring the manual's worked-example vocabulary). The section explicitly states "missing categories are a bug — see issue #23" so future regressions trace back.
- The section also states the **negative** form of the rule ("Do NOT invent tags for categories that are genuinely not present") so the LLM does not over-correct and emit misleading tags (e.g. `year 2025` on a pure character portrait on white background). The principle is "cover what's there," not "always emit all six."
- New file `scripts/smoke/anima-coverage-categories.js` — 7 static-source assertions that the section header exists and each of the four originally-reported categories (camera, mood, lighting, posture) is enumerated with at least one canonical tag, plus the traceability check that references `#23`. Mirrors `scripts/smoke/anima-chat-apply-sync.js` and `scripts/smoke/palette-stale-id-guard.js` patterns.
- `POST /api/anima`, `callKiloAnimaAnalysis`, `state.animaResult`, `displayAnimaResult` all untouched. The fix lives entirely in the LLM-facing system prompt — the smallest possible diff.

**Lessons.**

1. **Format briefs and coverage briefs are different documents.** The Slice 2.2 prompt was a format brief ("write lowercase tags, separate with commas"). It is now also a coverage brief ("when camera angle is visible, emit `looking at viewer`/`portrait`; when mood is visible, emit `gentle smile`; etc."). Future provider-specific prompt contracts should be authored with both halves present from the start — coverage first, then format.
2. **The 60-character `minLength` floor was a guard against empty output, not a coverage guard.** Schema length floors do not enforce semantic coverage. The fix is the prompt, not the schema.
3. **The manual (`docs/ANIMA-PROMPTING-MANUAL.md`) is the source of truth for what "Anima-shaped output" means.** The manual's worked examples were the right artifact to mine for coverage vocabulary — that's where `looking at viewer`, `gentle smile`, `soft lighting`, `standing`, `indoors`, `day` came from. Future prompt edits should treat the manual as the contract and the prompt as a derivable subset.
4. **Issue #22's lesson ("apply-path drift") is mirrored here as "generate-path coverage drift."** Both are state-shape-vs-display-shape mismatches: #22 was a sync failure at the apply step (state updated, UI didn't), #23 was a generation-side semantic gap (UI rendered exactly what the LLM produced, but the LLM wasn't told to produce coverage). The two issues share a category — the visible UI can drift from the contract — and warrant a consolidated PRE-MORTEM entry at the next polish-triage pass.

**Follow-ups (out of scope, parked).**

- Subjectively measure generated prompts against the manual's worked-example tag list to quantify the fix (would require a small evaluation harness and is overkill for a single prompt edit; defer to Slice 2.5+ if any user-visible regression is reported).
- A small "Anima coverage badge" in the result panel (e.g. "✓ camera + mood + lighting + posture") would make the contract self-documenting to the user. Parked in `docs/BACKLOG.md` — not in scope for a bug fix.
