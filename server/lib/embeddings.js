/**
 * server/lib/embeddings.js — Kilo gateway embedding wrapper
 *
 * CR-series (SPEC §17 / ADR 0025 / ARCHITECTURE CR-A1). Wraps the
 * Kilo gateway `/api/gateway/embeddings` endpoint with model
 * `text-embedding-3-small` (1,536 dimensions, confirmed HTTP 200 on
 * 2026-09-04). Returns Float32-serialisable arrays so callers can
 * store them directly in `data/rag_index.json`.
 *
 * Design notes:
 * - One batch per call (the gateway accepts batches but we send
 *   single inputs to keep the retry-on-429 surface tiny).
 * - Retry-on-429 with back-off (1 s → 2 s → 4 s, max 3 attempts).
 * - 401/403 surface immediately as fatal; no retry.
 * - Network errors retry up to 3 times.
 * - Returns `{ ok, embedding, error, fatal }` so the caller can
 *   decide whether to degrade gracefully.
 *
 * The constant `DEFAULT_EMBEDDING_MODEL` is exported so tests can
 * stamp the model onto indexed chunks. A model swap re-requires
 * `reindexAll` (server-side, exposed via POST /api/rag/reindex).
 */

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const EMBED_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Embed one input string. Returns `{ ok, embedding, error, fatal }`.
 *
 * - `ok: true` and a `embedding: number[]` of length
 *   `DEFAULT_EMBEDDING_DIMENSIONS` on success.
 * - `ok: false, fatal: true` on auth failure (401/403) or persistent
 *   network error after retries — caller should surface to user.
 * - `ok: false, fatal: false` on rate-limit-after-retries — caller
 *   should degrade gracefully (no-RAG mode).
 */
const embedText = async (text, {
  model = DEFAULT_EMBEDDING_MODEL,
  apiKey = process.env.KILO_API_KEY,
  baseUrl = process.env.KILO_BASE_URL || 'https://api.kilo.ai/api/gateway'
} = {}) => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, fatal: true, error: new Error('embedText: text must be a non-empty string.') };
  }
  if (!apiKey) {
    return { ok: false, fatal: true, error: new Error('KILO_API_KEY not configured.') };
  }

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({ model, input: text })
      });
      clearTimeout(timeout);

      if (response.status === 429) {
        lastError = new Error('Rate limit exceeded (429)');
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BACKOFF_MS[attempt]);
          continue;
        }
        return { ok: false, fatal: false, error: lastError };
      }
      if (response.status === 401 || response.status === 403) {
        clearTimeout(timeout);
        return { ok: false, fatal: true, error: new Error(`Auth failed (${response.status})`) };
      }
      if (!response.ok) {
        const text0 = await response.text();
        return { ok: false, fatal: true, error: new Error(`Embedding error (${response.status}): ${text0.substring(0, 200)}`) };
      }

      const payload = await response.json();
      const vector = payload?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        return { ok: false, fatal: true, error: new Error('Embedding payload missing `data[0].embedding`.') };
      }
      return { ok: true, embedding: vector };
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === 'AbortError') {
        lastError = new Error(`Embedding request timed out after ${EMBED_TIMEOUT_MS} ms.`);
      } else {
        lastError = error;
      }
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BACKOFF_MS[attempt]);
        continue;
      }
      return { ok: false, fatal: true, error: lastError };
    }
  }
  return { ok: false, fatal: false, error: lastError || new Error('Embedding failed after retries.') };
};

/**
 * Embed a batch of strings. Sequential (not parallel) so we don't
 * trip the rate limiter. Returns an array of `{ ok, embedding, error, fatal }`
 * in input order. Caller decides how to handle partial failures.
 */
const embedBatch = async (texts, options = {}) => {
  const results = [];
  for (const text of texts) {
    // eslint-disable-next-line no-await-in-loop -- intentional sequential
    const result = await embedText(text, options);
    results.push(result);
  }
  return results;
};

/**
 * Pure-math cosine similarity between two equal-length vectors.
 * Returns 0 if either vector is zero-magnitude.
 */
const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!denom || !isFinite(denom)) return 0;
  return dot / denom;
};

module.exports = {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  embedText,
  embedBatch,
  cosineSimilarity
};
