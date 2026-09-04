# ADR 0025 — RAG foundation: hand-rolled cosine vector store, Kilo embeddings, oil-painting persona

**Status:** Accepted
**Date:** 2026-09-04
**Origin:** Slice series CR (chat redesign, oil-painting edition) — `docs/SPEC.md` §17–20. The CR-series spec entry flagged two new architectural surfaces: (a) a domain-grounded vector store for the chat assistant, and (b) a wholesale rewrite of the chat assistant's persona from a generic editor to an oil-painting-reference-creation specialist. Both are wide refactors → expand-contract territory under `docs/PRINCIPLES.md` §6.3.

## Context

The post-generation chat (ADR 0011/0011a/0012/0020/0021) is a strict JSON-schema editor with anchor preservation. Its system prompt is *generic*: the assistant is told explicitly not to comment on style or aesthetic quality and not to ask clarifying questions. There is no domain corpus. Every prompt the app emits is, per the user's standing directive, destined for use as a reference image for oil-painting practice — so the chat needs to ground its recommendations in:

1. **Composition** — rule of thirds, golden ratio, focal hierarchy, atmospheric perspective, leading lines, negative space, gestural composition, value structure, edge control.
2. **Historical art data** — Baroque chiaroscuro, Renaissance sfumato, Impressionist broken color, alla-prima freshness, Northern realism, Fauvism, Expressionist gestural brushwork, and the conventions that govern each.
3. **Style guides** — brushwork techniques (alla prima, glazing, scumbling, impasto, sgraffito, dry-brush, fat-over-lean), pigment-aware color theory (warm/cool contrast, complementary pairs, pigment properties), support/pigment notes, drying-time implications.
4. **Previously generated prompt assets** — the user's own Stage 2 outputs and chat proposals, auto-ingested as they're produced. The corpus grows organically with usage; the most domain-relevant signal is the user's own history.

The redesign needs all four. The first three ship as a static curated seed; the fourth lands in CR-4. The chat assistant must be able to *retrieve* the relevant chunks at every message turn and inject them into the system prompt as a `RETRIEVAL` block before the LLM is called. The persona must invert today's "no aesthetic commentary, no clarifying questions" rules and become an oil-painting-reference-creation specialist.

## Decision

### Vector store implementation: hand-rolled cosine over JSON (D1)

**Choice: (a) hand-rolled cosine similarity over a JSON-backed vector index.** No new npm dependencies. Embeddings stored as Float32-serialised arrays next to each chunk in `data/rag_index.json`. Cosine computed in plain JavaScript over a full scan. The corpus is bounded (curated seed ≈ a few hundred chunks; auto-ingest capped at 5,000 chunks per CR-4) so full scan is well below the latency budget for chat messages (≤ a few ms even at 5k × 1,536-dim). If the corpus or recall demand grows, expand-contract to LanceDB in a future ADR.

**Why not (b) LanceDB or (c) ChromaDB:** both add a native binary / out-of-process server. The project ethos is a local-desktop single-user app with zero build, no Docker, no cloud. Adding a native binary is a wide refactor that buys us ≤ a few ms of latency we don't yet need. The hand-rolled approach keeps the dependency surface zero and the test surface deterministic.

**Storage shape** — `data/rag_index.json` (mode `0600`, gitignored):
```json
{
  "embedding_model": "text-embedding-3-small",
  "embedded_at": "2026-09-04T13:00:00.000Z",
  "chunks": [
    {
      "id": "composition_001",
      "source": "composition",
      "title": "Rule of thirds",
      "content": "...",
      "embedding": [ -0.0123, 0.0456, ... ]
    }
  ]
}
```

Sources: `'composition' | 'historical_art' | 'oil_painting_style' | 'stage2' | 'chat'`. The first three are curated seed (never evicted); the last two are auto-ingested (FIFO-evicted at the 5,000-cap).

### Embedding source: Kilo gateway, `text-embedding-3-small` (D2)

**Choice: Kilo gateway embedding endpoint at `POST /api/gateway/embeddings`** with model `text-embedding-3-small` (1,536 dimensions). Consistent with the existing pattern (ADR 0022). Probe on 2026-09-04 confirmed HTTP 200 + valid `Float32` array. Embedding source is stored on every chunk so we can re-embed on model swap. Retry-on-429 with back-off (1 s → 2 s → 4 s, max 3 attempts).

**Why not local model (`@xenova/transformers`):** 80 MB+ download + native binaries for a single-purpose 1,536-dim embedding. The Kilo gateway returns embeddings in ~300 ms p50. Local-first doesn't win here.

**Fallback:** if Kilo embeddings fail repeatedly, the chat degrades to no-RAG mode (the assistant still runs, just without retrieval grounding). This is logged as a `WARN` per message; the user sees a banner in the chat view ("retrieval unavailable — running without corpus grounding").

### Persona rewrite: oil-painting-reference-creation specialist (D3 / A9)

**Choice: rewrite `DEFAULT_CHAT_SYSTEM_PROMPT`** to:

1. Open with the oil-painting-reference-creation persona and an explicit statement that every prompt is destined for use as a reference image for oil-painting practice.
2. Drop the "Don't comment on style/aesthetic quality" rule.
3. Drop the "Don't ask clarifying questions" rule — clarifying questions are now allowed and expected when the user's vision is underspecified.
4. Add: "When refining, ground every recommendation in composition, brushwork, pigment behaviour, and historical convention. Use the vocabulary of your `RETRIEVAL` block."
5. Add: "Top of your context is a `RETRIEVAL` block with the most relevant excerpts from your domain corpus. Use that vocabulary naturally — do not cite chunks by id."
6. Keep the anchor-preservation contract (ADR 0012) and the strict JSON schema (`{ reply, suggested_prompt }`) intact.
7. The 200-word cap on `reply` stays for revisions (so the proposal fits in a focused message). For discussion turns, the cap relaxes to 400 words — proposals must remain short, discussions can be richer.

**Why chat-only scope (D3-a):** the user framed this as a chat-feature redesign. The existing oil-painting presets (`preset_alla_prima_oil`, `preset_968c0ccdf6fc6151`) already cover the Stage 2 contract for oil-painting-reference outputs. Widening to every Stage 1.x button + every preset would be scope creep. Park widening in BACKLOG if usage demands it.

### RAG corpus seeding (D4)

**Choice: ship a curated default seed as three JSON files** under `data/rag_corpus/`:

- `composition.json` — the seven composition topics above; ~12 chunks of 150–300 words each.
- `historical_art.json` — the eight historical conventions above; ~14 chunks.
- `oil_painting_style.json` — brushwork + pigment + colour-theory chunks; ~16 chunks.

The seed is loaded once at first read, embedded in a one-shot batch (debounced + retried), and merged into the index. It is never evicted by the 5,000-cap logic. A future "Import reference" affordance (BACKLOG) will let users add their own JSON files; the schema is already there.

### Auto-ingest of generated prompt assets (D5)

**Choice: auto-ingest every Stage 2 output and every chat proposal** into the index as `source: 'stage2' | 'chat'` chunks. Debounced (5 s) so a burst of activity doesn't hammer the embedding endpoint. Capped at 5,000 chunks with FIFO eviction; curated seed is never evicted. Implemented in CR-4.

### Why a new ADR (the three-criteria test, `docs/PRINCIPLES.md` §8)

1. **Significant impact** — changes how every chat turn is shaped and how every chat message is grounded. ✅
2. **Long-term consequences** — the persona and the corpus are now part of the product's domain surface; future features will build on top of them. ✅
3. **Cross-cutting** — touches server.js, the chat view, the data layer (new `data/rag_corpus/` + `data/rag_index.json`), the API surface (new endpoints), and the test suite. ✅

All three criteria met → ADR warranted.

## Consequences

- **Zero new npm dependencies.** Hand-rolled cosine over JSON. The codebase remains 100% JavaScript.
- **The chat assistant becomes visibly different.** Every reply uses oil-painting vocabulary; every revision is grounded in retrieval. Tests that assert the old "no aesthetic commentary" rule will need updating (the rule is now inverted). This is a deliberate, user-driven behaviour change.
- **Latency budget.** Each chat turn now adds one embedding call (~300 ms) + one cosine scan over the corpus (~≤ 5 ms at 5k chunks). Total added latency: ~300 ms p50. Within the existing 60-second chat-timeout.
- **Disk footprint.** The seed corpus is ~30 KB. Each auto-ingested chunk adds ~6 KB (1,536-dim Float32 array serialised as JSON number array — ~6 KB raw, compressed negligible). At the 5,000-cap, the index is ~30 MB. Within the project's no-quota footprint.
- **Failure mode is graceful.** Kilo embedding failure → no-RAG mode (logged, banner shown). Index corruption → reload from curated seed (logged). Cosine overflow → catch + return empty retrieval (logged).
- **Privacy.** The index lives on disk in the user's home directory, alongside `chat_sessions.json` and the other state files. No data leaves the local machine except for the embedding call (which sends the user's last message + current prompt to Kilo gateway — same trust model as the existing chat).

## Rejected alternatives

1. **LanceDB / ChromaDB / HNSW.** Rejected at G1 (D1-a). Native binaries / out-of-process servers for a corpus that doesn't yet need ANN.
2. **Local embedding model.** Rejected at G1 (D2). 80 MB+ download for a single-purpose embedding; the gateway is already in the loop.
3. **Full-app oil-painting scope (D3-c).** Rejected at G1. Scope creep; the existing oil-painting presets already cover the Stage 2 contract. Widen later if usage demands it.
4. **Manual user-curated prompt ingestion only (D5-b).** Rejected at G1. The user's history is the most domain-relevant signal; requiring manual curation leaves the corpus empty for the most relevant user.
5. **Streaming chat responses.** Rejected. Streaming would require re-architecting the strict-JSON envelope (which itself is load-bearing for the schema-drop retry path). Park in BACKLOG.
6. **Cross-encoder re-ranking.** Rejected. Overkill at <5k chunks; cosine is sufficient.

## Verification

Verification commands run after CR-1 implementation:

- `node tests/run-all.js` — all existing tests pass + ≥15 new CR-1 tests pass (cosine math, corpus seed load, embedding batch round-trip, retrieval injection, persona prompt structure, retrieval provenance).
- `node scripts/session-init.js` — 10/10 V-checks pass; `code_drift` = clean.
- `node --check server.js` + `node --check src/app.js` + `node --check tests/run-all.js` — exit 0.
- Manual probe of the Kilo embedding endpoint confirmed HTTP 200 + valid embedding array (recorded in this ADR's `Date` line).
