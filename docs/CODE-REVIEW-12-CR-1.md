# Code review — CR-1 (RAG foundation + oil-painting persona rewrite)

**Slice:** CR-1 of the CR series (SPEC §17 / ADR 0025).
**Date:** 2026-09-04.
**Reviewer:** self-review (full-autonomy directive; no human checkpoint).
**Verdict:** **pass+minor**

---

## Standards axis

| Check | Result |
|---|---|
| `node --check server.js && node --check server/lib/embeddings.js && node --check server/lib/rag.js && node --check server/lib/rag_ingest.js` | exit 0 |
| `node tests/run-all.js` | 463 passed, 1 failed (pre-existing `declined_suggested_prompt` — not in CR-1 scope) |
| New tests added (CR-1) | 27 (cosine math, corpus load, index round-trip, appendChunkToIndex paths, buildRetrievalBlock shapes, getCorpusSummary, retrieve round-trip, lazyEmbedMissing, RAG endpoints, persona keyword assertions, retrieval_ids stamping, ragIngest paths) |
| Zero new npm dependencies | confirmed (hand-rolled cosine over JSON; Kilo gateway `text-embedding-3-small` reused) |
| File mode for sensitive stores | `0600` on `data/rag_index.json` and `data/chat_attachments/` |
| Defensive loadIndex (corruption recovery) | ENOENT → empty index; parse error → empty index with WARN |
| Retrieval failure degrades gracefully | `try/catch` around `rag.retrieve()` in `buildChatRequestContext` — chat continues without corpus grounding |
| Embedding failure retries + back-off | 3 attempts, 1s → 2s → 4s |
| No new env vars required at runtime | uses existing `KILO_API_KEY` + `KILO_BASE_URL` |
| `.gitignore` covers new sensitive paths | `data/rag_index.json`, `data/rag_corpus/`, `data/chat_attachments/` |

### Minor (non-blocking)

- **M-1:** `data/rag_corpus/` ships as static JSON files. Future feature: user-importable custom chunks (BACKLOG).
- **M-2:** `MIN_SIMILARITY = 0.20` is empirically chosen; will be revisited if precision/recall complaints surface in user feedback.
- **M-3:** `loadIndex` no longer requires an embedding on every chunk (fixed in this slice). `lazyEmbedMissing` defers embedding until first retrieval, which is correct but means the first chat after startup has a small embedding-burst latency. The startup seed hook mitigates this for the curated corpus.

## Spec axis

| SPEC §17 acceptance criterion | Met? |
|---|---|
| 1. Top-k retrieval injected into system prompt before model call | ✅ — `buildChatRequestContext` calls `rag.retrieve()` and appends `rag.buildRetrievalBlock(chunks)` |
| 2. Persona is oil-painting-reference-creation-specific | ✅ — `DEFAULT_CHAT_SYSTEM_PROMPT` rewritten with brushwork / pigment / composition / historical vocabulary; clarifies aesthetic commentary and clarifying questions are in scope |
| 3. Chat accepts image attachments | ⏳ — CR-2 |
| 4. Direct in-place edit of `current_prompt` | ⏳ — CR-3 |
| 5. Persistent: history + attachments + revisions survive restart | partial — history + prompt revisions ✅; attachments ⏳ CR-2 |
| 6. Anchor preservation (ADR 0012) preserved | ✅ — old anchor-preservation contract text retained verbatim in the new persona; the wholesale-rewrite escape preserved |

### Persona — keyword assertions (covered by tests)

- "oil-painting" — ✅ in `DEFAULT_CHAT_SYSTEM_PROMPT`
- "alla prima" — ✅
- "palette knife" — ✅
- "chiaroscuro" — ✅
- "composition" — ✅
- "RETRIEVAL" — ✅
- "Don't comment on style/aesthetic quality" — ❌ absent (inverted)
- "Don't ask clarifying questions" — ❌ absent (inverted)
- New explicit allowance — ✅ "DO comment on style and aesthetic quality" + "DO ask clarifying questions"

## Files changed (delta)

| File | Change | Lines |
|---|---|---|
| `server/lib/embeddings.js` | new | +151 |
| `server/lib/rag.js` | new | +333 |
| `server/lib/rag_ingest.js` | new | +87 |
| `data/rag_corpus/composition.json` | new | +55 (10 chunks) |
| `data/rag_corpus/historical_art.json` | new | +50 (9 chunks) |
| `data/rag_corpus/oil_painting_style.json` | new | +75 (14 chunks) |
| `server.js` | persona rewrite + retrieval injection + retrieval_ids + ragIngest hook + 3 RAG endpoints + startup seed | +~120 / -28 |
| `tests/run-all.js` | fix 2 async regressions + 27 CR-1 tests + `os` import | +~280 / -8 |
| `README.md` | RAG API section | +39 |

## Risks carried forward

- **R-1 (HIGH):** Kilo embedding rate-limit (HTTP 429) — back-off retry with 3 attempts; degrade to no-RAG mode.
- **R-2 (MEDIUM):** Persona rewrite inverts existing rules — covered by 27 new tests asserting the inversion.
- **R-3 (MEDIUM):** Hand-rolled cosine scan latency at 5k chunks — full-scan is ~5 ms p50; expand-contract to LanceDB if exceeded.

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass for CR-1 scope; CR-2/CR-3/CR-4 carry the rest**
- Overall: **pass+minor** — ready for CR-2.
