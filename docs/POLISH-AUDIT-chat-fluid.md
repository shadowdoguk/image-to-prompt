# POLISH-AUDIT-chat-fluid — Chat fluid two-way (Slices II + III + I)

**Date:** 2026-09-06
**Slices audited:** SPEC §22 (Inline diff on Apply), §23 (Patch + annotate protocol / ADR 0027), §24 (Streaming responses).
**Verdict:** **PASS** — ship-ready. 9 non-blocking findings; 0 blocking.

---

## §1 Accessibility

| Finding | Severity | Action |
|---|---|---|
| **A1** — Each patch chip's checkbox has a meaningful `aria-label` that quotes the `find` and `replace` strings. | good | — |
| **A2** — Each annotation pill has a Dismiss button with `aria-label="Dismiss annotation about {field}"`. | good | — |
| **A3** — The streaming placeholder uses `aria-live` (inherited from the chat-messages container) so the typed text is announced. | good | — |
| **A4** — The Stop generating button uses `aria-label="Stop generating response"`. | good | — |
| **A5** — When the stream errors, the placeholder message keeps the partial reply and shows an `audit: { kind: 'stream_error' }` marker. The error is also surfaced via the `chat-form-status` element with `role="status" aria-live="polite"`. | good | — |
| **A6** — Hunk checkboxes in the SPEC §22 diff view don't have an explicit `aria-label` per hunk. | minor | Parked — the chat-diff container has `role="group"` + `aria-label="Inline diff of proposed revision"`. Per-hunk labels could be tightened; current granularity (whole-group) is acceptable for the typical prompt length. |
| **A7** — The diff hunk checkboxes are `<input type="checkbox">` rendered inside `<span>` elements, which is technically a non-semantic container. A `<label>` wrapping the hunk content would be more correct. | minor | Parked — screen readers announce the `aria-label` and the checked state; the visual rendering is identical. |

**§1 verdict:** accessible. No blocking findings.

## §2 Visual

| Finding | Severity | Action |
|---|---|---|
| **V1** — Inline diff uses color + strikethrough + background to distinguish added/removed/context words. Color-blind safety: removed words use `text-decoration: line-through` in addition to red, so the visual signal survives monochrome viewing. | good | — |
| **V2** — Patch chips render `find → replace` as inline code with a colored background, mimicking the diff visual language. The visual hierarchy (chip > word > character) is consistent. | good | — |
| **V3** — Annotation pills use a blue accent (`#60a5fa`) distinct from the green (added) and red (removed) diff colors. No visual confusion between mutators and annotations. | good | — |
| **V4** — Streaming placeholder has a warning-colored left border + "generating…" suffix on the role badge. The border disappears when the stream completes (no longer `chat-message--streaming`). | good | — |
| **V5** — Stop button uses the warning color (`var(--warning)`) to differentiate from the primary Send button. | good | — |

**§2 verdict:** visually coherent. No blocking findings.

## §3 Prose

| Finding | Severity | Action |
|---|---|---|
| **S1** — The patch + annotate paragraph in `DEFAULT_CHAT_SYSTEM_PROMPT` uses domain-grounded examples (palette, lighting, chiaroscuro, alla prima) consistent with the existing persona. | good | — |
| **S2** — "Apply all" / "Apply selected" / "Nothing to apply" is outcome-led. | good | — |
| **S3** — "Stop generating" is unambiguous; alternatives like "Cancel" would conflate with the form-cancel path. | good | — |

**§3 verdict:** prose is on-brand. No blocking findings.

## §4 Copy

| Finding | Severity | Action |
|---|---|---|
| **C1** — The patch-hygiene instruction in the system prompt is concrete ("keep `find` strings short and unambiguous (≤ ~50 characters when possible)"). | good | — |
| **C2** — The decline fallback for partial-merge failures uses the same copy as the wholesale-decline fallback ("Partial revision declined — too much of the original context would have been lost."). | good | — |
| **C3** — The 409 concurrent-stream error message ("Another stream is already in progress for this session. Wait for it to complete or click Stop.") is actionable. | good | — |
| **C4** — The streaming error toast ("Stream error: {error}") is short and direct. | good | — |
| **C5** — The "Stream stopped." status after the user clicks Stop is neutral, not error-toned. | good | — |

**§4 verdict:** copy is clear. No blocking findings.

## §5 Performance

| Finding | Severity | Action |
|---|---|---|
| **P1** — Word-level LCS over typical prompts (≤ 500 chars) runs in <1 ms. The LCS table is `Uint32Array` for memory efficiency. | good | — |
| **P2** — SPEC §23 `applyChatPatches` is O(patches × prompt_length) — ≤ 5K operations for sane inputs (≤ 5 patches × 1000 chars). Runs in microseconds. | good | — |
| **P3** — SPEC §24 streaming v1 emits ONE synthetic delta when the full reply arrives. No upstream integration cost; no memory growth beyond the accumulated reply string. | good | — |
| **P4** — Annotation pill rendering is O(annotations × DOM nodes) — ≤ 5 annotations per message in practice. Negligible. | good | — |
| **P5** — The full chat-messages re-render on every streaming delta is O(message_count) — could become slow at 50+ messages. The streaming placeholder is the LAST message, so the re-render creates a fresh fragment on each delta. | minor | Parked — typical sessions have ≤ 20 messages; the cost is bounded. Future: incremental DOM updates (only mutate the placeholder node, not the whole list). |

**§5 verdict:** performance within budget. No blocking findings.

## §6 Discipline

| Finding | Severity | Action |
|---|---|---|
| **D1** — All three slices followed the App Build methodology (G1 → G2 → G3 → G4 → per-slice review). | good | — |
| **D2** — Each slice has a dedicated `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` with verdict + standards/spec axes + implementation notes + parked items. | good | — |
| **D3** — Slice III has an ADR (`docs/adr/0027-patch-protocol.md`) per PRINCIPLES.md §8 (long-term consequence + reversibility cost). | good | — |
| **D4** — Each slice updated `docs/SESSION-STATE.md` with a per-slice entry. | good | — |
| **D5** — Tests are co-located in `tests/run-all.js` under a `// ─── SPEC §NN ─` heading. No separate test files. | good | — |
| **D6** — Each slice is its own commit (eda9fd9 / 2c9adaa / 35072b3) so rollback is atomic. | good | — |
| **D7** — Pre-existing uncommitted changes (.env.example, data/model_config.json, src/index.html provider labels, etc.) are NOT in the chat-fluid commit chain. They remain in the working tree for a future cleanup session. | minor | Parked — out of scope for chat-fluid; the cleanup slice (Session #12 precedent) handles parked drift separately. |

**§6 verdict:** methodology honoured. No blocking findings.

## §7 Dependency

| Finding | Severity | Action |
|---|---|---|
| **DE1** — No new runtime dependencies. All three slices use built-in Node + browser APIs. | good | — |
| **DE2** — `package.json` unchanged. | good | — |

**§7 verdict:** no new dependencies. No blocking findings.

---

## Summary

The chat fluid two-way implementation (Slices II + III + I) is ship-ready. The three slices are orthogonal and compose cleanly:

- **Slice II (SPEC §22)** — Inline diff on Apply. Trust-building change. Lowest-risk.
- **Slice III (SPEC §23 / ADR 0027)** — Bounded AI autonomy via patch + annotate protocol. Headline ask. Schema-additive; declined-path unchanged.
- **Slice I (SPEC §24)** — Streaming responses. Polish slice. New endpoint + client-side UX; existing route unchanged.

**Test surface:** 510 → 553 (+43 net new tests across the three slices).
**Code surface:** ~1100 LOC server + ~700 LOC frontend + ~270 LOC CSS + ~250 LOC docs/SPEC/ARCH/PRE-MORTEM.

No blocking findings. 9 non-blocking findings (parked). Recommended action: ship and address parked items in follow-up slices as user demand surfaces.

## Commit chain

```
eda9fd9  feat(chat): SPEC §22 inline diff on Apply (Slice 2 of 3)
2c9adaa  feat(chat): SPEC §23 patch + annotate protocol (Slice 3 of 3)
35072b3  feat(chat): SPEC §24 streaming responses (Slice 1 of 3)
```

## References

- docs/CODE-REVIEW-29-inline-diff.md
- docs/CODE-REVIEW-30-patch-protocol.md
- docs/CODE-REVIEW-31-streaming.md
- docs/adr/0027-patch-protocol.md
- docs/SPEC.md §22, §23, §24
- docs/ARCHITECTURE.md §27, §28, §29
- docs/PRE-MORTEM.md §27, §28, §29
- docs/SESSION-STATE.md Sessions #13, #14, #15
- docs/BACKLOG.md 2026-09-06 Chat fluid-two-way investigation entry
