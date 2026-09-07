#!/usr/bin/env node
/**
 * Phase 1 — red-capable loop that goes GREEN after the fix.
 *
 * This is the integration unit harness: it builds a session whose
 * system prompt (with stubbed RAG) overflows CHAT_CONTEXT_CHAR_BUDGET,
 * then asserts:
 *
 *   - context.messages.length >= 1 (the regression assertion)
 *   - the wire body has at least [system, user] (no upstream 2013)
 *
 * Before the fix: messages.length === 0, wire body has only [system].
 * After the fix: messages.length === 1+, wire body has [system, user].
 *
 * Exits 0 on GREEN (fix working), 1 on RED (bug present).
 */

const path = require('path');

const {
  buildChatRequestContext,
  CHAT_CONTEXT_CHAR_BUDGET,
  buildKiloChatBody,
} = require(path.join(__dirname, '..', '..', 'server.js'));

const ragModule = require(path.join(__dirname, '..', '..', 'server', 'lib', 'rag.js'));
const originalRetrieve = ragModule.retrieve;

// Stub RAG to push the system prompt past the budget. Production
// sessions accumulate retrieval history over multiple turns — this
// stubs a realistic 4-chunk retrieval (the user-reported session had
// 4 prior RAG results).
ragModule.retrieve = async () => ([
  { id: 'a', source: 'stage2', content: 'Pastel-focal alla prima oil painting — saturated focal accent. '.repeat(20), similarity: 0.95 },
  { id: 'b', source: 'chat', content: 'Lost-and-found edges, scumbled atmospheric layers. '.repeat(20), similarity: 0.85 },
  { id: 'c', source: 'stage2', content: 'Palette-knife ridges, no depicted light source. '.repeat(20), similarity: 0.80 },
  { id: 'd', source: 'chat', content: 'Chromatic vibration from juxtaposed warm and cool near-complementaries. '.repeat(20), similarity: 0.75 }
]);

async function main() {
  try {
    // ~3.3 KB working prompt — the sweet spot where the trim cascade
    // does NOT shrink the prompt (so the base system prompt is at its
    // largest) but combined with the retrieval block it overflows the
    // 20,000-char budget.
    const session = {
      preset_id: 'preset_968c0ccdf6fc6151',
      original_prompt: 'A woman stands at the center of the composition. '.repeat(70),
      current_prompt: 'A woman stands at the center, frontal view, body oriented toward the viewer. '.repeat(70),
      pending_prompt: null,
      analysis_snapshot: null,
      messages: [
        { role: 'user', content: 'first user turn', suggested_prompt: null, timestamp: '2026-09-07T09:00:00.000Z', attachment_ids: [] },
        { role: 'assistant', content: 'first assistant turn', suggested_prompt: null, timestamp: '2026-09-07T09:00:01.000Z', retrieval_ids: [] },
        { role: 'user', content: 'second user turn — the last one', suggested_prompt: null, timestamp: '2026-09-07T09:00:02.000Z', attachment_ids: [] }
      ]
    };

    const context = await buildChatRequestContext(session);

    // Sanity: the test must be exercising the overflow path.
    const premise = context.systemPrompt.length > CHAT_CONTEXT_CHAR_BUDGET;
    console.log(`System prompt: ${context.systemPrompt.length} chars (budget ${CHAT_CONTEXT_CHAR_BUDGET})`);
    console.log(`Messages count: ${context.messages.length}`);
    console.log(`Premise (overflow): ${premise}`);

    if (!premise) {
      console.log('\n[SKIP] System prompt does not overflow — cannot exercise the bug. Bump prompt size.');
      process.exit(2);
    }

    // Build the wire body the chat route would send.
    const wireBody = buildKiloChatBody(
      [
        { role: 'system', content: context.systemPrompt },
        ...context.messages,
      ],
      'minimax/minimax-m3',
      true
    );

    const hasUserTurn = wireBody.messages.some((m) => m.role === 'user' && (
      typeof m.content === 'string'
        ? m.content.trim().length > 0
        : Array.isArray(m.content) && m.content.length > 0
    ));

    if (context.messages.length >= 1 && hasUserTurn) {
      console.log('\n[GREEN] Fix is in place — context includes the last user turn, wire body has [system, user].');
      process.exit(0);
    } else {
      console.log('\n[RED] Bug still present — context.messages.length=' + context.messages.length + ', wire body user turn present: ' + hasUserTurn);
      process.exit(1);
    }
  } finally {
    ragModule.retrieve = originalRetrieve;
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(2);
});
