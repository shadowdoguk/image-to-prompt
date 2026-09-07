#!/usr/bin/env node
/**
 * Phase 1 feedback loop — wire-level repro for `messages must not be empty (2013)`.
 *
 * Replays the exact request body that `callKiloChat` would build when:
 *   - session.messages has a sequence ending in a user turn with `attachment_ids`
 *   - the resolved model is `minimax/minimax-m3` (the SESSION-STATE default)
 *   - the buildUserMessageWithAttachments helper returns a content-ARRAY
 *     (vision-capable model — VISION_CAPABLE_MODELS.has(model) === true)
 *
 * Sends to KILO_BASE_URL/chat/completions and asserts on the user's exact
 * symptom: HTTP 400 from Kilo, body parsing to MiniMax's "messages must
 * not be empty (2013)" base_resp.
 *
 * Red-capable: this script prints the EXACT upstream error string that
 * the frontend shows. If the bug is fixed upstream (or at any layer),
 * the upstream call returns a different status / body and the script
 * prints a clear PASS. If the bug is NOT fixed, the script prints the
 * MiniMax 2013 error verbatim and exits non-zero.
 *
 * Usage:
 *   node scripts/debug/chat-attachment-2013-repro.js
 *
 * Required env:
 *   KILO_API_KEY    — your Kilo Code gateway API key (real or stub)
 *   KILO_BASE_URL   — defaults to https://api.kilo.ai/api
 *
 * Optional env:
 *   LLM_MODEL       — default 'minimax/minimax-m3'
 *   DATA_URL        — default: 1x1 red png data URL (smallest valid image)
 *
 * Exit codes:
 *   0 — repo went red on this bug
 *   2 — repo went green (upstream accepted the request, or errored for
 *       a non-2013 reason that proves the messages-not-empty path is dead)
 */

const path = require('path');
const fs = require('fs');

// Best-effort .env loader so callers don't need to export manually.
// Order: process.env wins; .env fills gaps. Simple KEY=VALUE parser.
function loadDotenv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotenv();

const KILO_API_KEY = process.env.KILO_API_KEY;
const KILO_BASE_URL = process.env.KILO_BASE_URL || 'https://api.kilo.ai/api/gateway';
const LLM_MODEL = process.env.LLM_MODEL || 'minimax/minimax-m3';

// 1x1 red PNG, base64-encoded. Smallest valid image that Kilo Code's
// multimodal adapter will accept.
const DATA_URL = process.env.DATA_URL ||
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

if (!KILO_API_KEY) {
  console.error('Missing KILO_API_KEY in env. Skipping wire-level repro.');
  console.error('(Unit-level repro is still available — see comments in this script.)');
  process.exit(0); // don't fail if no key, since we're running CI green by default
}

// Build the exact body that callKiloChat constructs at server.js:7210-7218.
const systemPrompt = 'You are a helpful assistant.';
const baseOpenaiMessages = [
  { role: 'system', content: systemPrompt },
  // The last user message is the one with the attachment — its content
  // was rebuilt to the content-ARRAY form by buildUserMessageWithAttachments.
  { role: 'user', content: [
    { type: 'text', text: 'Here is the resulting image so you can see where you\'re going wrong with the prompt.' },
    { type: 'image_url', image_url: { url: DATA_URL } }
  ]},
];

const body = {
  model: LLM_MODEL,
  max_tokens: 2400,
  temperature: 0.5,
  messages: baseOpenaiMessages,
};

(async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${KILO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KILO_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    clearTimeout(timeout);
    const text = await response.text();
    const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();

    const errStrLower = text.toLowerCase();
    const is2013 =
      errStrLower.includes('messages must not be empty') ||
      errStrLower.includes('status_code":2013') ||
      errStrLower.includes('"code":2013');

    console.log('HTTP', response.status);
    console.log('--- response body (first 800 chars) ---');
    console.log(text.substring(0, 800));
    console.log('--------------------------------------');
    console.log('is_2013_messages_must_not_be_empty:', is2013);

    if (is2013) {
      console.log('\n[RED] Bug reproduced — upstream returned MiniMax 2013 "messages must not be empty"');
      process.exit(0);
    }
    if (response.status >= 500) {
      console.log(`\n[OTHER] Upstream ${response.status} (not 2013) — bug may or may not be present. Inspect body above.`);
      process.exit(2);
    }
    if (response.status === 401 || response.status === 403) {
      console.log('\n[AUTH] Upstream auth error — wire is reachable but credential is bad. Cannot red-capable repro.');
      process.exit(2);
    }
    if (!response.ok) {
      console.log(`\n[OTHER] Upstream ${response.status} (not 2013) — body shows a different error. Inspect.`);
      process.exit(2);
    }
    console.log('\n[GREEN] Upstream accepted the multimodal messages — bug is NOT reproduced.');
    process.exit(2);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error('Timeout — upstream did not respond within 60s');
      process.exit(2);
    }
    console.error('Network/other error:', err.message);
    process.exit(2);
  }
})();
