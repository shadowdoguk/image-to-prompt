/**
 * server/lib/rag_ingest.js — Auto-ingest hooks for the RAG index
 *
 * SPEC §20 / ADR 0025 / ARCHITECTURE CR-A1. Called from the
 * Stage 2 success path and the chat-proposal success path so the
 * user's own prompt history becomes part of the corpus.
 *
 * Debounced (5 s) so bursts of activity don't hammer the embedding
 * endpoint. Capped at the rag.AUTO_INGEST_CAP (5,000 chunks).
 */

const rag = require('./rag');

const DEBOUNCE_MS = 5000;
const MIN_CONTENT_LENGTH = 30;

const pendingQueue = [];
let debounceTimer = null;

const flushNow = async () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingQueue.length === 0) return;
  const batch = pendingQueue.splice(0, pendingQueue.length);
  for (const item of batch) {
    if (typeof item.content !== 'string' || item.content.length < MIN_CONTENT_LENGTH) continue;
    rag.appendChunkToIndex({
      source: item.source,
      title: item.title,
      content: item.content,
      meta: item.meta || {}
    });
  }
};

const scheduleFlush = () => {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    flushNow().catch((e) => console.warn(`[rag_ingest] flush failed: ${e.message}`));
  }, DEBOUNCE_MS);
};

/**
 * Ingest a Stage 2 prompt output.
 * Called after POST /api/generate-prompt (or /api/anima) succeeds.
 */
const ingestStage2Output = ({ presetName, model, finalPrompt, meta = {} }) => {
  if (typeof finalPrompt !== 'string' || finalPrompt.length < MIN_CONTENT_LENGTH) return;
  pendingQueue.push({
    source: 'stage2',
    title: `${presetName || 'Stage 2'} — ${model || ''}`.slice(0, 120),
    content: finalPrompt,
    meta: { ...meta, ingested_at: new Date().toISOString() }
  });
  scheduleFlush();
};

/**
 * Ingest a chat proposal (assistant message with non-null suggested_prompt).
 * Called after the chat message handler returns successfully.
 */
const ingestChatProposal = ({ sessionId, messageId, suggestedPrompt }) => {
  if (typeof suggestedPrompt !== 'string' || suggestedPrompt.length < MIN_CONTENT_LENGTH) return;
  pendingQueue.push({
    source: 'chat',
    title: `Chat proposal — ${messageId || sessionId || ''}`.slice(0, 120),
    content: suggestedPrompt,
    meta: { session_id: sessionId, message_id: messageId, ingested_at: new Date().toISOString() }
  });
  scheduleFlush();
};

/**
 * Flush on server shutdown (best-effort).
 */
const shutdown = async () => {
  await flushNow();
};

module.exports = {
  ingestStage2Output,
  ingestChatProposal,
  flushNow,
  shutdown
};
