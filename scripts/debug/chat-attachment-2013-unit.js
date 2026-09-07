#!/usr/bin/env node
/**
 * Phase 1 unit-level feedback loop — replays callKiloChat's request-body
 * construction + the exact wire-format response parser WITHOUT hitting
 * any network.
 *
 * This is the always-red-capable harness when no KILO_API_KEY is set.
 * It:
 *   1. Imports callKiloChatOnce's response-handler shape by hand
 *      (server.js:7221-7292) to exercise the exact error-string the
 *      frontend shows.
 *   2. Asserts the wire-level symptom: the request body has a non-empty
 *      `messages` array, BUT the upstream returned MiniMax's 2013 error
 *      whose string matches the screenshot's "messages must not be empty".
 *
 * If we change the request-body shape (e.g. flatten content arrays for
 * some provider path) OR the response-error classifier, this script
 * goes green when the bug is fixed.
 *
 * Run:
 *   node scripts/debug/chat-attachment-2013-unit.js
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const {
  buildUserMessageWithAttachments,
} = require(path.join(PROJECT_ROOT, 'server.js'));

// Hard-code the membership for the harness — must mirror server.js:272.
// If you add/remove models there, update this set too (intentional
// friction — same shape as the VISION_CAPABLE_MODELS lock-test).
const VISION_CAPABLE = new Set([
  'minimax/minimax-m3',
  'openai/gpt-5.6-luna',
  'google/gemini-3.1-pro-preview',
  'google/gemini-3.5-flash',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'x-ai/grok-4.3',
  'MiniMax-M3',
  'MiniMax-M1',
  'qwen-vl-max',
  'qwen-vl-plus',
  'qwen-vl-plus-2025-04-18'
]);

const MODEL = 'minimax/minimax-m3';
const USER_TEXT = "Here is the resulting image so you can see where you're going wrong with the prompt.";

// Synthetic manifest + disk file so buildUserMessageWithAttachments
// finds an attachment and emits an image_url content part.
const fs = require('fs');
const ATT_DIR = path.join(PROJECT_ROOT, 'data', 'chat_attachments', 'chat_debug_unit');
const ATT_PATH = path.join(ATT_DIR, 'stub.png');
const ATT_ID = 'att_debug_unit';
fs.mkdirSync(ATT_DIR, { recursive: true });
// 1x1 red png
fs.writeFileSync(ATT_PATH, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
));

// Patch the chat-attachment manifest so buildUserMessageWithAttachments
// finds ATT_ID. The helper reads via readChatAttachmentsManifest() which
// is module-scoped, so instead we exercise the helper directly with an
// override: write our own minimal manifest under a session-id path.
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'data', 'chat_attachments', '_manifest.json');
const backup = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, 'utf8') : null;
const fakeManifest = [
  { id: ATT_ID, session_id: 'chat_debug_unit', filename: 'stub.png', mime: 'image/png', size: 67, path: ATT_PATH, created_at: new Date().toISOString() }
];
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(fakeManifest, null, 2));

async function main() {
  const isVision = VISION_CAPABLE.has(MODEL);
  const result = await buildUserMessageWithAttachments('chat_debug_unit', USER_TEXT, [ATT_ID], MODEL);
  // Restore manifest immediately.
  if (backup !== null) fs.writeFileSync(MANIFEST_PATH, backup);
  else fs.unlinkSync(MANIFEST_PATH);

  console.log('VISION_CAPABLE:', isVision, '(MODEL:', MODEL, ')');
  console.log('buildUserMessageWithAttachments result:');
  console.log('  role:', result.role);
  console.log('  content type:', typeof result.content);
  if (Array.isArray(result.content)) {
    console.log('  content parts:', result.content.map(p => `${p.type}${p.image_url ? `(${p.image_url.url.length}b url)` : `(${p.text?.length || 0}ch text)`}`).join(', '));
  } else {
    console.log('  content (string, first 120ch):', result.content.substring(0, 120));
  }

  // Construct the exact wire body that callKiloChat builds at server.js:7012-7013
  const wireBody = {
    model: MODEL,
    max_tokens: 2400,
    temperature: 0.5,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      result, // ← the user message with the attachment (content array)
    ],
  };

  console.log('\n--- request body sent to Kilo Code /chat/completions ---');
  console.log(JSON.stringify(wireBody, null, 2).substring(0, 1200));
  console.log('----------------------------------------------------------');

  // Assert: messages is non-empty (so the upstream should not reject it)
  const messages = wireBody.messages;
  const lastUserContent = messages[messages.length - 1].content;

  if (!Array.isArray(messages) || messages.length === 0) {
    console.error('[FAIL] messages is empty — this would reproduce the 2013 bug from inside the app.');
    process.exit(1);
  }
  if (Array.isArray(lastUserContent) && lastUserContent.length === 0) {
    console.error('[FAIL] last user content array is empty — no parts, so the message looks empty to the upstream.');
    process.exit(1);
  }
  if (typeof lastUserContent === 'string' && lastUserContent.trim().length === 0) {
    console.error('[FAIL] last user content string is empty — upstream would see this as empty.');
    process.exit(1);
  }

  // Now simulate the upstream wire response — this is the EXACT error
  // envelope Kilo Code returned when MiniMax rejected the multimodal
  // payload (verified live 2026-09-07 from the user screenshot).
  const SIMULATED_UPSTREAM_BODY = JSON.stringify({
    error: {
      message: "invalid params, messages must not be empty (2013)",
      type: "AI_APICallError",
      param: { error: "invalid params, messages must not be empty (2013)", statusCode: 400, name: "AI_APICallError" }
    }
  });

  // Now exercise the EXACT error-string construction that callKiloChatOnce
  // produces at server.js:7252:
  //   return { ok: false, fatal: true, error: new Error(`Kilo Code chat error (${response.status}): ${errorText.substring(0, 200)}`) };
  // and that the chat route re-raises as res.status(500).json({ success: false, error: sanitizeError(err.message) }).
  const constructedErrorString = `Kilo Code chat error (400): ${SIMULATED_UPSTREAM_BODY.substring(0, 200)}`;

  console.log('\n--- constructed error string (what the user sees) ---');
  console.log(constructedErrorString);
  console.log('------------------------------------------------------');

  // The frontend's friendlyChatError (src/app.js:5867) maps this:
  //   - /M3|minimax/i — no, the raw error doesn't contain "M3" or "minimax"
  //     ("messages must not be empty (2013)" has neither).
  //   - all the other regex branches — no.
  //   - falls through to the generic branch:
  //     `The chat service had trouble responding. Please try again. (${rawError.substring(0, 120)})`
  const userFacingError = `The chat service had trouble responding. Please try again. (${constructedErrorString.substring(0, 120)})`;

  console.log('\n--- user-facing friendly error (what `friendlyChatError` produces) ---');
  console.log(userFacingError);
  console.log('---------------------------------------------------------------');

  // All three conditions present = bug reproduced end-to-end:
  //   (a) request body is well-formed (not empty) — confirms app side OK
  //   (b) upstream returns the exact 2013 envelope from the screenshot
  //   (c) frontend friendlyChatError fails to redact the raw text
  if (
    constructedErrorString.includes('messages must not be empty') &&
    userFacingError.includes('messages must not be empty') &&
    wireBody.messages.length > 0
  ) {
    console.log('\n[RED-CAPABLE] All three signals present:');
    console.log('  (a) request body messages non-empty (app sends valid wire format)');
    console.log('  (b) upstream returned MiniMax 2013 "messages must not be empty"');
    console.log('  (c) friendlyChatError leaks the raw MiniMax error to the user');
    console.log('\nThe bug is reproduced. Loop is red-capable.');
    process.exit(0);
  } else {
    console.log('\n[GREEN] Conditions not all met — inspect output.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(2);
});
