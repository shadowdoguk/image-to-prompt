'use strict';

// Smoke test for the chat session cap guardrail (ADR 0011, server.js:6235).
//
// Repro: when data/chat_sessions.json contains MAX_CHAT_SESSIONS_TOTAL
// (200) sessions, POST /api/chat/sessions must respond 409 with the
// canonical error string. Trimming back below the cap must restore 201.
//
// This locks the contract so future drift on the cap constant, the
// error message, or the storage path shows up in CI / manual smoke runs.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CHAT_FILE = path.join(ROOT, 'data', 'chat_sessions.json');
const PRESETS_FILE = path.join(ROOT, 'data', 'presets.json');

let failures = 0;

function record(label, actual, expected) {
  const ok = actual === expected;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${label}`);
  if (!ok) {
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
    failures++;
  }
}

function recordMatch(label, re, haystack) {
  const ok = re.test(haystack);
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${label}`);
  if (!ok) {
    console.log(`         pattern:  ${re}`);
    console.log(`         haystack: ${JSON.stringify(haystack)}`);
    failures++;
  }
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function makeSyntheticSessions(limit) {
  // Minimal session shape that passes validateChatSessionCreate on the
  // create route; we don't need them to be reachable, just present in
  // the store so the >= limit check fires.
  const sessions = [];
  const baseTime = Date.parse('2026-01-01T00:00:00.000Z');
  for (let i = 0; i < limit; i += 1) {
    sessions.push({
      id: `chat_${i.toString(16).padStart(16, '0')}`,
      preset_id: 'preset_synthetic',
      preset_name: 'synthetic',
      run_id: null,
      title: `synthetic session ${i}`,
      original_prompt: `synthetic prompt ${i}`,
      current_prompt: `synthetic prompt ${i}`,
      pending_prompt: null,
      analysis_snapshot: null,
      messages: [],
      created_at: new Date(baseTime + i * 1000).toISOString(),
      updated_at: new Date(baseTime + i * 1000).toISOString()
    });
  }
  return sessions;
}

async function main() {
  const snapshot = fs.existsSync(CHAT_FILE) ? fs.readFileSync(CHAT_FILE, 'utf8') : '[]';
  fs.mkdirSync(path.dirname(CHAT_FILE), { recursive: true });

  let server;
  try {
    const modulePath = path.join(ROOT, 'server.js');
    delete require.cache[require.resolve(modulePath)];
    const { app } = require(modulePath);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const presets = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
    const presetId = presets[0].id;

    // --- 1. Push the store to MAX_CHAT_SESSIONS_TOTAL and assert 409 ---
    console.log('1. POST /api/chat/sessions at cap returns 409');
    const synthetic = makeSyntheticSessions(200);
    fs.writeFileSync(CHAT_FILE, JSON.stringify(synthetic), 'utf8');

    const atCap = await fetchJson(`${base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'A test prompt to verify the chat cap guardrail returns 409.',
        preset_id: presetId
      })
    });
    record('  status === 409', atCap.status, 409);
    record('  success === false', atCap.body.success, false);
    recordMatch(
      '  error mentions "chat session limit reached"',
      /chat session limit reached/i,
      atCap.body.error || ''
    );
    recordMatch(
      '  error mentions the 200 cap',
      /\(200\)/,
      atCap.body.error || ''
    );

    // --- 2. Trim back below the cap and assert 201 ---
    console.log('2. POST /api/chat/sessions below cap returns 201');
    const trimmed = makeSyntheticSessions(50);
    fs.writeFileSync(CHAT_FILE, JSON.stringify(trimmed), 'utf8');

    const underCap = await fetchJson(`${base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'A test prompt to verify the chat cap guardrail allows creation below cap.',
        preset_id: presetId
      })
    });
    record('  status === 201', underCap.status, 201);
    record('  success === true', underCap.body.success, true);
    record('  returned id starts with chat_',
      typeof underCap.body.data?.id === 'string' && underCap.body.data.id.startsWith('chat_'),
      true
    );

    // --- 3. Lock the frontend regex the toast detector uses ---
    // The frontend detects the chat-limit error via a regex literal in
    // src/app.js. If anyone changes the server error message without
    // updating the frontend, the user would see a red toast instead of
    // a yellow warning. Lock both sides together.
    console.log('3. Frontend regex matches server error string');
    const serverError = atCap.body.error || '';
    const appText = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const regexMatch = appText.match(/\/chat session limit reached\/i/);
    record('  /chat session limit reached/i literal present in src/app.js',
      Boolean(regexMatch),
      true
    );
    record('  src/app.js routes to severity: "warning" for chat-limit',
      /severity:\s*'warning'/.test(appText),
      true
    );

    // --- 4. CSS warning modifier exists ---
    console.log('4. CSS warning modifier exists');
    const cssText = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
    record('  .error-toast.is-warning in stylesheet',
      /\.error-toast\.is-warning/.test(cssText),
      true
    );

    // Re-assert for the trimmed file (we used a synthetic 200-entry
    // store; restore is handled by the finally block below).
    void serverError;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(CHAT_FILE, snapshot);
  }

  console.log('');
  if (failures === 0) {
    console.log('SMOKE TEST RESULT: all checks passed');
    process.exit(0);
  } else {
    console.log(`SMOKE TEST RESULT: ${failures} check(s) failed`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Smoke crashed:', e && e.stack || e);
  // Always restore the chat file on crash too.
  try {
    const snapshotPath = process.env.CHAT_FILE_SNAPSHOT;
    if (snapshotPath) fs.copyFileSync(snapshotPath, CHAT_FILE);
  } catch { /* best effort */ }
  process.exit(2);
});
