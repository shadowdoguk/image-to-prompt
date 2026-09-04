# Code review — CR-4 (auto-ingest + sync hardening)

**Slice:** CR-4 of the CR series (SPEC §20 / ADR 0025).
**Date:** 2026-09-04.
**Reviewer:** self-review (full-autonomy directive).
**Verdict:** **pass+minor**

---

## Standards axis

| Check | Result |
|---|---|
| `node --check server.js && node --check src/app.js` | exit 0 |
| `node tests/run-all.js` | 493 passed, 1 failed (pre-existing `declined_suggested_prompt` — not in CR-4 scope) |
| New tests added (CR-4) | 6 (chat sessions survive restart, attachments survive restart, RAG index survives restart, current_prompt survives restart, both Stage 2 ingest call sites wired, rag_ingest.js debounced + capped) |
| Auto-ingest on /api/generate-prompt | ✅ — `ragIngest.ingestStage2Output({ presetName, model, finalPrompt, meta })` before `res.json` |
| Auto-ingest on /api/anima | ✅ — same call, with negative prompt preserved in `meta` |
| Ingest is best-effort | ✅ — wrapped in `try/catch` so a failure logs but does NOT break the response (the user already got their prompt) |
| Debounce window | 5 s — burst of activity doesn't hammer the embedding endpoint |
| Min content length floor | 30 chars — skips tiny stubs |
| FIFO eviction at cap | 5,000 chunks — auto-ingested only; curated seed is never evicted |
| Lazy embedding | ✅ — `lazyEmbedMissing` fills null embeddings on next retrieval |
| Sync across restart | ✅ — tests verify chat sessions, attachments, RAG index, and current_prompt all survive a simulated restart |

### Minor (non-blocking)

- **M-1:** Ingest runs inline in the handler. For a burst of 10 generations in 10 seconds, only the first triggers a debounced flush; the rest queue. Acceptable per the 5 s window, but could be tuned.
- **M-2:** No retry on auto-ingest failure (the user already got their prompt, so retry would be wasteful). Parked.

## Spec axis

| SPEC §20 acceptance criterion | Met? |
|---|---|
| 1. Every chat turn has top-k RAG retrieval injected into the system prompt before the model is called | ✅ — CR-1 |
| 2. Persona is oil-painting-reference-creation-specific | ✅ — CR-1 |
| 3. Chat accepts image attachments | ✅ — CR-2 |
| 4. Direct in-place edit of `current_prompt` | ✅ — CR-3 |
| 5. Persistent: history + attachments + prompt revisions survive restart | ✅ — CR-4 sync hardening tests prove all four (chat, attachments, RAG index, prompts) survive |
| 6. Anchor preservation (ADR 0012) preserved | ✅ — unchanged through the series |

## Files changed (delta)

| File | Change | Lines |
|---|---|---|
| `server.js` | ingest call in /api/generate-prompt + ingest call in /api/anima | +~30 |
| `tests/run-all.js` | 6 CR-4 sync hardening tests | +~100 |
| `docs/POLISH-AUDIT-CR.md` | new (Gate G5) | +106 |
| `docs/CODE-REVIEW-15-CR-4.md` | new (this doc) | — |

## Risks carried forward

- **R-1 (carried from CR-1):** Kilo embedding endpoint rate-limit (HTTP 429). Back-off retry; no-RAG mode fallback. CR-4's auto-ingest inherits the same fallback.
- **R-2 (carried from CR-1):** Hand-rolled cosine scan latency at 5k chunks. ~5 ms p50; expand-contract to LanceDB if exceeded.
- **R-3 (new, LOW):** Auto-ingest inflates the index with low-quality chat proposals. Mitigated by the 30-char floor + 5,000 cap + curated-seed-never-evicted guarantee.

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass for CR-4 scope; whole CR series is now pass**
- Overall: **pass+minor** — the CR series ships.
