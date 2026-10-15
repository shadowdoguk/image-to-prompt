# ADR 0030 — Krea 2 fork: pre-Generate three-way picker for Z-Image / Anima / Krea 2

## Status

Accepted (designed 2026-10-15, Session #21+; pending implementation in a future session per `docs/SPEC.md` §30).

## Context

The image-to-prompt app shipped as a single-track pipeline in its early form, then grew a two-way pre-Generate picker under Slice 2 (ADR 0021): `Z-Image Turbo | Anima`. The picker is upstream of the Generate button; the two contracts are exclusive siblings; chat sessions are per-model.

The user has now identified a third option they want in the same picker: **Krea 2** (Krea AI, San Francisco — see `docs/KREA-2-PROMPTING-MANUAL.md`). Krea 2's contract is meaningfully different from both existing siblings:

- **Z-Image Turbo** — natural-language prose, the pastel-focal-glow contract (ADR 0019). Single prompt.
- **Anima** — tag-with-`@`-prefix, Gelbooru-favoured, lowercase, comma-separated (manual §5, §7). Positive + negative prompt pair.
- **Krea 2** — prose-only (no tags), the 5-layer formula (manual §7):
  Subject and action + Setting and environment + Lighting and mood + Style reference + Composition notes. Single prompt.

The Krea 2 contract also introduces a brand-new UI concept that the app doesn't have today: a **creativity slider** (integer 0-100, default 50) that conditions the LLM toward literal photographic rendering (low values) vs. stylised / artistic / interpretive rendering (high values). Manual §2 explicitly states "the **style and interpretation** control is the **Creativity slider**, not the variant."

The Krea 2 contract has its own variant layer too, but **for a different reason than Anima's variants**. Anima's variants (Base / Aesthetic / Turbo) are style variants. Krea 2's variants (Turbo / Medium / Large) are **capacity / latency tiers** — they do not change the contract, only the rendering cost and quality. All three variants accept the same prompt format and the same creativity slider (manual §2).

The user explicitly chose the pre-Generate picker over a dual-output or triple-output design (already established at Slice 2's G1 and re-confirmed at the 2026-10-07 Session #21+ finalisation). The third option follows Slice 2's pattern: same picker position, same dispatch shape, same per-model chat-sessions behaviour, same single dispatch path.

The Krea 2 research artifact (`docs/KREA-2-PROMPTING-MANUAL.md`, 716 lines, compiled 2026-10-07) is the contract source of truth.

The Slice K spec (`docs/SPEC.md` §30) and the Slice K architecture (`docs/ARCHITECTURE.md` §30) capture the slice in detail. The Slice K pre-mortem (`docs/PRE-MORTEM.md` §30) lists the failure modes and pre-commitments. **This ADR captures the strategic decision itself.**

## Decision

Adopt a **third branch** at the entry point of the app's pre-Generate picker:

1. **Pre-Generate picker extends to three options.** A dropdown or button group sits near the Generate button. The user picks one of three model lines: `Z-Image Turbo` (the default; existing behaviour), `Anima` (Slice 2 sibling), or `Krea 2` (new). The picker is persisted in `localStorage`, mirrored in the URL (`?model=...`), and recorded in chat sessions.

2. **Krea 2 variant selector.** If the user picks Krea 2, a separate, nested selector in the Krea-2 result panel chooses between Turbo / Medium / Large. Variants default to `Medium`. Variant is **capacity, not contract** — it does not modify the system prompt. Variant is recorded on chat sessions and on the result panel header.

3. **Krea 2 creativity slider.** If the user picks Krea 2, a slider in the Krea-2 result panel sets the integer 0-100 creativity value. Default is 50. The slider's bucket (**Raw / Low / Medium (default) / High** — per manual §4 Hard Specs row "Creativity slider" and §8 worked examples) flows into the LLM-facing system prompt as a one-line per-bucket instruction that conditions the rendering tone. The slider is the Krea-2-specific equivalent of Anima's variant selector (style control). **Exact numeric bucket boundaries are not published by Krea** — the LLM-facing prompt carries the bucket labels verbatim and the integer value provides fine-grained control. For in-image text rendering, manual §10 / §11 recommend **Creativity = Low** to avoid garbled lettering; the slider's "Low" position is reachable from the default Medium position.

4. **Single dispatch path (extended).** The frontend, on Generate, calls `/api/zimage`, `/api/anima`, or `/api/krea2` based on `state.model`. The dispatch is a single point of control, not three parallel dual endpoints. The dispatch state is persisted (model + variant + creativity for Krea-2) and is the single source of truth for which contract is active.

5. **Three contracts, shared per-field artifacts.** The per-field artifacts (`subject`, `actions`, `mood`, `lighting`, `texture`, etc.) are shared between all three pipelines (mirrors ADR 0021 decision #4). Only the **final-prompt assembly** is model-specific. The Krea 2 contract uses the manual as its source of truth (`docs/KREA-2-PROMPTING-MANUAL.md` §7, §8, §10). The Z-Image contract uses the pastel-focal-glow contract (ADR 0019). The Anima contract uses the tag-with-prefix rules (manual §5, §7.6).

6. **Per-model chat sessions (extended).** Chat history is annotated with `model` and (for Krea-2) `variant` + `creativity`. Switching between any of the three models ends the current session and starts a new one. The chat default system prompt is `state.model`-aware. Per-model sessions preserve the Anima rationale (ADR 0021 decision #5): three contracts refining the same prompt would produce inconsistent revisions.

7. **License boundary respected.** The app emits Krea-2-shaped prompts via MiniMax M3 (a third-party LLM) — it does **not** embed Krea 2 weights, host Krea 2 inference, or integrate with paid Krea APIs. Per manual §12.3, Krea 2's distribution licence permits prompt-engineering for non-commercial use; this slice ships prompts only. (Mirrors ADR 0021 decision #6 + rejected alternative #7 for Anima.)

8. **State validation.** Every state read from localStorage or URL validates against the allowed enums (`'zimage_turbo' | 'anima' | 'krea2'` for model, `'turbo' | 'medium' | 'large'` for Krea-2 variant, integer 0-100 for Krea-2 creativity). On mismatch, fall back to the default and log a warning. Mirrors ADR 0021 decision #7.

9. **No Krea-2 per-field vision buttons.** The per-field "Populate with AI" buttons (subject, actions, mood, lighting, texture, camera-angle, orientation) remain Z-Image-only. Krea-2's contract is final-prompt only — it does not have a per-field vision endpoint. Mirrors the Anima constraint (per ADR 0021).

The Slice K sub-slice breakdown (K.1 → K.5) is in `docs/SPEC.md` §30.5. The architecture is in `docs/ARCHITECTURE.md` §30. The pre-mortem is in `docs/PRE-MORTEM.md` §30.

## Consequences

The app gains a **three-contract code base** instead of a two-contract code base. The maintenance cost is real but bounded:

- **Three contracts to keep coherent.** Every bug fix to a per-field artifact benefits all three. Every fix to the final-prompt assembly needs to be applied to three places. The shared-per-field-artifacts principle (decision 5) constrains the duplication.
- **Three prompt contracts to evolve.** The Z-Image side might undergo another contract rewrite (ADR 0019 was the first). The Anima side will evolve as the model gets updated. The Krea-2 side will evolve as the model gets updated. The dispatch layer is the only place that knows about model-specific output, so the divergence is contained.
- **Frontend state proliferation.** `state.model` + `state.animaVariant` + `state.krea2Variant` + `state.krea2Creativity` join a long list of model-side state flags. The state is first-class, persisted, validated, and mirrored in the URL — but it's a real concept, and it has consequences for every UI render.
- **The creativity slider is brand-new.** The app has no other integer-slider-with-bucket-LLM-conditioning concept today. K.2's `DEFAULT_KREA2_PROMPT` constant is the four-line-per-bucket source of truth. Future creativity-aware prompt contracts (if any) can reuse the pattern.
- **Chat history is per-model.** Users who switch model mid-session lose the current session. Same UX choice as ADR 0021 — three contracts refining the same prompt would produce inconsistent revisions.
- **The license boundary is real.** The slice ships no weights, no hosted inference, no paid-API links. Future features that want to "make it easier to run the prompt" by linking to or embedding Krea 2 weights or inference are explicitly out-of-scope (SPEC §30.2 out-of-scope list + PRE-MORTEM failure mode R-5).
- **Krea-2 creativity defaults to 50.** The middle bucket per manual §2 is "the canonical safe choice." A user who never touches the slider gets the canonical output. A user who pushes to 0 gets photographic-rendering bias; 100 gets stylised rendering bias.

## Rejected alternatives

1. **Triple-output (all three contracts emitted per upload).** Rejected at G1 (re-confirmed at the 2026-10-07 finalisation). The three contracts are not interchangeable, and bundling them would produce incoherent outputs. The maintenance cost of branching every chat refinement across three contracts favours the fork.

2. **Post-hoc toggle (generate Z-Image, then switch to Anima or Krea 2).** Rejected. A post-hoc toggle would require re-LLM calls to re-emit the new contract, which is wasted work 50% of the time. The pre-Generate picker is downstream of the choice, which is the right place to make the call. (Mirrors ADR 0021 rejected alternative #2.)

3. **Three-level model selector (Model → Variant → Style).** Rejected (mirror of ADR 0021 rejected alternative #3). For Krea-2 specifically, the variant and creativity distinctions are orthogonal: variant is capacity, creativity is rendering tone. They are intra-Krea-2 concerns. The model selector should be one dropdown (which line). Variant + creativity live in the Krea-2 result panel header.

4. **Shared chat history across models.** Rejected (mirror of ADR 0021 rejected alternative #4). Three contracts refining the same prompt would produce inconsistent revisions. The chat default system prompt is different per contract. Per-model sessions are the only coherent design.

5. **Stitch the Krea-2 contract into the existing `/api/zimage` endpoint.** Rejected. The Krea-2 contract is prose-only with a creativity bucket; the Z-Image contract is the pastel-focal-glow contract. Combining them would require either a discriminated union or a per-request contract parameter. Two endpoints is clearer.

6. **Embed Krea 2 weights in the app for "convenience."** Rejected per license boundary (decision 7). Per manual §12.3, hosting Krea 2 behind a paid API is restricted; embedding weights in a Docker image would be a stretch too far. The slice ships prompts only. (Mirrors ADR 0021 rejected alternative #6.)

7. **Use a hosted Krea 2 inference API (`krea.ai/image` or third-party Replicate / fal.ai).** Rejected. The slice is a prompt-engineering slice, not an inference slice. Hooking into a third-party API would require tokens, billing, and a whole new feature surface. The user copies the prompt and runs it locally on ComfyUI or InvokeAI per manual §12.

8. **Make the Krea-2 picker opt-in (default hidden, advanced setting).** Rejected. The user asked for the third option at the same picker level. Hiding it behind an "advanced" toggle would defeat the point.

9. **Variant modifies the system prompt.** Rejected (manual §2 explicit). Variant is capacity (Turbo = fastest / distilled, Medium = canonical, Large = maximum quality). It does not change the contract. Modifying the prompt on variant change would mislead the LLM and waste prompt budget.

10. **Creativity defaults to 0 (Raw).** Rejected. Manual §4 explicitly recommends Medium (the default bucket) as the safe choice; defaulting to Raw would produce over-constrained "photographic rendering" that doesn't match the stylised workflows the user typically exercises.

## Verification

Verification commands to run post-Slice-K implementation:

- **`npm test`** — all existing + new tests pass (per-field tests + Krea-2-specific tests for `/api/krea2` + `DEFAULT_KREA2_PROMPT` + `callMiniMaxKrea2Analysis`).
- **`node scripts/session-init.js`** — 10/10 V-checks pass (validation gate green).
- **`node --check server.js && node --check src/app.js && node --check tests/run-all.js && echo "syntax OK"`** — exit 0, prints `syntax OK`.
- **`git diff --check`** — exit 0, no whitespace conflict markers.
- **`git status --short`** — clean tree (post-commit).
- **`node scripts/smoke/krea2-fork-smoke.js`** — exit 0; the smoke script covers the Krea-2 pick + creativity slide + variant switch + chat-refine-then-switch cycle, parallel to `scripts/smoke/anima-fork-smoke.js`.
- **Manual demo** — four scenarios:
  1. Pick Krea 2, upload an image, click Generate → single prose prompt appears in the Krea-2 result panel, following the 5-layer formula (Subject / Setting / Lighting / Style / Composition). Variant badge shows "Krea 2 Medium." Creativity readout shows "50 / Medium."
  2. Slide creativity to 0 (Raw) → re-Generate → prose biases toward literal photographic rendering ("photorealistic 35 mm film photograph" appears in the medium clause).
  3. Slide creativity to 100 (High) → re-Generate → prose biases toward stylised rendering ("stylised, artistic, interpretive" appear in the style clause).
  4. Pick Krea 2, generate, switch to Anima mid-session → confirmation: "Switching to Anima will end the current chat session. Continue?" → Cancel returns to Krea 2 (session intact), Confirm switches (session ended, new session begins with `model: 'anima'`).
- **Code review** — `docs/CODE-REVIEW-K-1.md` to `docs/CODE-REVIEW-K-4.md` per-sub-slice verdict: `pass` or `pass+minor`. Aggregate: `docs/CODE-REVIEW-K.md` verdict: `pass` or `pass+minor`.

## References

- `docs/SPEC.md` §30 — Slice K spec (G2 approved per Session #21+ 2026-10-15)
- `docs/ARCHITECTURE.md` §30 — Slice K architecture (G3 approved)
- `docs/PRE-MORTEM.md` §30 — Slice K pre-mortem (G3 approved)
- `docs/KREA-2-PROMPTING-MANUAL.md` — the Krea-2 contract source of truth (716 lines, compiled 2026-10-07)
- `docs/adr/0021-anima-fork.md` — the ADR this slice mirrors structurally (status legend + decision list + consequences + rejected alternatives + verification + references)
- `docs/adr/0019-zimage-pastel-focal-glow-contract.md` — the Z-Image contract that the Krea-2 contract parallels for prose
- `docs/adr/0020-conversational-prompt-drafts.md` — the chat-handling pattern that the chat dispatch extends
- `docs/adr/0018-populate-with-ai-actions-mood-lighting.md` — the per-field pattern that the Krea-2 backend contract (helper + route + default prompt) mirrors
- `docs/adr/0012-anchor-preserving-chat-refinements.md` — `validatePromptPreservation` invariant the Krea-2 chat-Apply branch must pass through
- `https://krea.ai/blog/krea-2-deep-dive-walkthrough`,
  `https://krea.ai/docs/user-guide/features/krea-2`,
  `https://krea.ai/docs/developers/krea-2/overview`,
  `https://huggingface.co/krea/Krea-2-Raw`,
  `https://krea.ai/blog/krea-2-technical-report` — primary sources
- `docs/SPEC.md` §22 / §23 / §24 / §26 / §28 — chat + IR slices that the K.4 chat-Apply branch must not regress
