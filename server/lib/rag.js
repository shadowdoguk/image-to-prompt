/**
 * server/lib/rag.js — Hand-rolled cosine vector store (CR-series)
 *
 * SPEC §17 / ADR 0025 / ARCHITECTURE CR-A1. Backed by `data/rag_index.json`
 * with Float32-serialised arrays. No external dependencies.
 *
 * Public surface:
 *   - getIndexPath(), loadIndex(), saveIndex()
 *   - loadCorpus()                       — read 3 curated JSON files
 *   - ensureCorpusSeeded(index)         — embed & merge curated seed
 *   - retrieveRelevantChunks(query, k)  — top-k retrieval
 *   - appendChunkToIndex(chunk)         — add a chunk (debounced re-embed)
 *   - getCorpusSummary()                — UI affordance
 *   - reindexAll()                      — re-embed everything
 *
 * Curated sources (`'composition' | 'historical_art' | 'oil_painting_style'`)
 * are never evicted by the cap. Auto-ingested sources (`'stage2' | 'chat'`)
 * are FIFO-evicted when the index exceeds `AUTO_INGEST_CAP`.
 */

const fs = require('fs');
const path = require('path');
const embeddings = require('./embeddings');

const CURATED_SOURCES = new Set(['composition', 'historical_art', 'oil_painting_style']);
const AUTO_INGEST_SOURCES = new Set(['stage2', 'chat']);
const AUTO_INGEST_CAP = 5000;
const DEFAULT_TOP_K = 4;

// Re-evaluated every call so test seams (process.env.RAG_INDEX_FILE)
// take effect even after the module has been loaded. The cost is a
// few nanoseconds — `getIndexPath` is not a hot path.
const getIndexPath = () => {
  return process.env.RAG_INDEX_FILE
    ? path.resolve(process.env.RAG_INDEX_FILE)
    : path.resolve(__dirname, '../../data/rag_index.json');
};

const getCorpusDir = () => path.resolve(__dirname, '../../data/rag_corpus');

const emptyIndex = () => ({
  embedding_model: embeddings.DEFAULT_EMBEDDING_MODEL,
  embedded_at: null,
  chunks: []
});

const loadIndex = () => {
  const p = getIndexPath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chunks)) {
      return emptyIndex();
    }
    // Defensive: ensure every chunk has the basic shape. Note we do
    // NOT require an embedding here — newly-appended chunks have
    // embedding: null until `lazyEmbedMissing` fills them. Filtering
    // on embedding would silently drop every freshly-ingested chunk.
    parsed.chunks = parsed.chunks.filter((c) =>
      c && typeof c.id === 'string' && typeof c.source === 'string' &&
      typeof c.content === 'string'
    );
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyIndex();
    console.warn(`[rag] loadIndex failed: ${err.message}. Returning empty index.`);
    return emptyIndex();
  }
};

const saveIndex = (index) => {
  const p = getIndexPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(index, null, 2), { mode: 0o600 });
    return true;
  } catch (err) {
    console.warn(`[rag] saveIndex failed: ${err.message}`);
    return false;
  }
};

const loadCorpus = () => {
  const dir = getCorpusDir();
  const sources = ['composition', 'historical_art', 'oil_painting_style'];
  const all = [];
  for (const source of sources) {
    const file = path.join(dir, `${source}.json`);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.chunks)) {
        for (const c of parsed.chunks) {
          if (c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.content === 'string') {
            all.push({ id: c.id, source, title: c.title, content: c.content });
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[rag] loadCorpus: failed to read ${file}: ${err.message}`);
      }
    }
  }
  return all;
};

/**
 * Ensure curated corpus is embedded and present in the index.
 * Idempotent: if all curated chunks are already embedded with the
 * current embedding_model, this is a no-op.
 */
const ensureCorpusSeeded = async (index) => {
  const curated = loadCorpus();
  const existingIds = new Set(index.chunks.map((c) => c.id));
  const missing = curated.filter((c) => !existingIds.has(c.id));
  if (missing.length === 0) return index;

  const texts = missing.map((c) => `${c.title}\n\n${c.content}`);
  const results = await embeddings.embedBatch(texts);
  const now = new Date().toISOString();
  for (let i = 0; i < missing.length; i++) {
    const r = results[i];
    if (!r.ok || !Array.isArray(r.embedding)) continue;
    const c = missing[i];
    index.chunks.push({
      id: c.id,
      source: c.source,
      title: c.title,
      content: c.content,
      embedding: r.embedding,
      embedding_model: embeddings.DEFAULT_EMBEDDING_MODEL,
      embedded_at: now
    });
  }
  index.embedded_at = now;
  saveIndex(index);
  return index;
};

/**
 * Retrieve the top-k most relevant chunks for a query string.
 * - Embeds the query (one call).
 * - Computes cosine similarity against every chunk.
 * - Returns the top-k above `MIN_SIMILARITY` (default 0.20 — chosen
 *   empirically; lower-bound to keep unrelated chunks out of the
 *   prompt).
 * - On embedding failure, returns `[]` and logs; the chat degrades
 *   to no-RAG mode.
 */
const MIN_SIMILARITY = 0.20;
const retrieveRelevantChunks = async (query, k = DEFAULT_TOP_K, index = null) => {
  if (typeof query !== 'string' || query.trim().length === 0) return [];
  if (!index) index = loadIndex();
  if (!Array.isArray(index.chunks) || index.chunks.length === 0) return [];

  const result = await embeddings.embedText(query);
  if (!result.ok || !Array.isArray(result.embedding)) {
    console.warn(`[rag] retrieveRelevantChunks: embedding failed (${result.error?.message || 'unknown'}). Returning empty retrieval.`);
    return [];
  }

  const scored = [];
  for (const chunk of index.chunks) {
    const sim = embeddings.cosineSimilarity(result.embedding, chunk.embedding);
    if (sim >= MIN_SIMILARITY) {
      scored.push({ id: chunk.id, source: chunk.source, title: chunk.title, content: chunk.content, score: sim });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
};

/**
 * Append a chunk to the index. The chunk is NOT immediately embedded —
 * the embedding is deferred to the next call to `retrieveRelevantChunks`
 * (which lazily fills any chunk missing an embedding). This keeps
 * burst activity from hammering the embedding endpoint.
 *
 * If the index exceeds `AUTO_INGEST_CAP`, evict the oldest auto-ingested
 * chunk first. Curated chunks are never evicted.
 */
const appendChunkToIndex = ({ source, title, content, meta = {} }) => {
  if (typeof source !== 'string' || !AUTO_INGEST_SOURCES.has(source) && !CURATED_SOURCES.has(source)) {
    console.warn(`[rag] appendChunkToIndex: invalid source "${source}". Skipped.`);
    return null;
  }
  if (typeof content !== 'string' || content.trim().length < 30) {
    // Skip tiny content (likely a stub or test).
    return null;
  }
  const index = loadIndex();
  const id = `${source}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const chunk = {
    id,
    source,
    title: typeof title === 'string' ? title.slice(0, 120) : `${source} chunk`,
    content,
    embedding: null, // deferred
    embedding_model: embeddings.DEFAULT_EMBEDDING_MODEL,
    embedded_at: null,
    meta
  };
  index.chunks.push(chunk);

  // FIFO eviction for auto-ingested only.
  if (AUTO_INGEST_SOURCES.has(source)) {
    const autoChunks = index.chunks.filter((c) => AUTO_INGEST_SOURCES.has(c.source));
    const curatedChunks = index.chunks.filter((c) => CURATED_SOURCES.has(c.source));
    if (autoChunks.length > AUTO_INGEST_CAP) {
      const sorted = [...autoChunks].sort((a, b) => (a.embedded_at || '').localeCompare(b.embedded_at || ''));
      const toEvict = new Set(sorted.slice(0, autoChunks.length - AUTO_INGEST_CAP).map((c) => c.id));
      index.chunks = [...curatedChunks, ...autoChunks.filter((c) => !toEvict.has(c.id))];
    }
  }
  saveIndex(index);
  return chunk;
};

/**
 * Lazily fill any chunk missing an embedding. Called inside
 * `retrieveRelevantChunks` so the embedding endpoint is only hit
 * once per missing chunk.
 */
const lazyEmbedMissing = async (index) => {
  const missing = index.chunks.filter((c) => !Array.isArray(c.embedding) || c.embedding.length === 0);
  if (missing.length === 0) return index;
  const texts = missing.map((c) => `${c.title}\n\n${c.content}`);
  const results = await embeddings.embedBatch(texts);
  const now = new Date().toISOString();
  let changed = false;
  for (let i = 0; i < missing.length; i++) {
    const r = results[i];
    if (!r.ok || !Array.isArray(r.embedding)) continue;
    missing[i].embedding = r.embedding;
    missing[i].embedded_at = now;
    changed = true;
  }
  if (changed) {
    index.embedded_at = now;
    saveIndex(index);
  }
  return index;
};

/**
 * Public wrapper: embed-missing first, then retrieve. This is the
 * function the chat handler calls.
 */
const retrieve = async (query, k = DEFAULT_TOP_K) => {
  const index = loadIndex();
  await lazyEmbedMissing(index);
  return retrieveRelevantChunks(query, k, index);
};

/**
 * Format retrieved chunks as a RETRIEVAL block for injection into
 * the chat system prompt. Each chunk is title + content, separated
 * by a divider. Source is included so the model can reason about
 * provenance (composition vs. historical_art vs. oil_painting_style
 * vs. stage2 vs. chat).
 */
const buildRetrievalBlock = (chunks, {
  maxCharsPerChunk = 480,
  maxTotalChars = 1800
} = {}) => {
  if (!Array.isArray(chunks) || chunks.length === 0) return '';
  const lines = ['# RETRIEVAL — Domain corpus excerpts (top-k by cosine similarity)'];
  let total = lines[0].length;
  for (const c of chunks) {
    const content = typeof c.content === 'string' && c.content.length > maxCharsPerChunk
      ? `${c.content.slice(0, maxCharsPerChunk - 1)}…`
      : (c.content || '');
    const block = `[${c.source || 'unknown'}] ${c.title || '(untitled)'}\n${content}`;
    if (total + block.length + 2 > maxTotalChars) break;
    lines.push(`\n---\n${block}`);
    total += block.length + 6;
  }
  return lines.join('\n');
};

/**
 * Re-embed every chunk (used after a model swap or first install).
 */
const reindexAll = async () => {
  const index = loadIndex();
  // Drop all existing embeddings.
  for (const c of index.chunks) {
    c.embedding = null;
    c.embedded_at = null;
  }
  saveIndex(index);
  return lazyEmbedMissing(index);
};

/**
 * UI affordance: chunk titles + sources, no embeddings.
 */
const getCorpusSummary = (index = null) => {
  if (!index) index = loadIndex();
  return index.chunks.map((c) => ({
    id: c.id,
    source: c.source,
    title: c.title,
    embedded: Array.isArray(c.embedding) && c.embedding.length > 0
  }));
};

module.exports = {
  CURATED_SOURCES,
  AUTO_INGEST_SOURCES,
  AUTO_INGEST_CAP,
  DEFAULT_TOP_K,
  MIN_SIMILARITY,
  getIndexPath,
  getCorpusDir,
  loadIndex,
  saveIndex,
  loadCorpus,
  ensureCorpusSeeded,
  retrieveRelevantChunks,
  retrieve,
  appendChunkToIndex,
  lazyEmbedMissing,
  reindexAll,
  getCorpusSummary,
  buildRetrievalBlock
};
