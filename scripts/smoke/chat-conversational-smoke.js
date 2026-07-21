'use strict';

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

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function withMockChatProvider(responses, callback) {
  const realFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return realFetch(url, options);
    const payload = responses.shift();
    if (!payload) throw new Error('mock chat response queue exhausted');
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { return await callback(); }
  finally { global.fetch = realFetch; }
}

async function main() {
  const snapshot = fs.existsSync(CHAT_FILE) ? fs.readFileSync(CHAT_FILE, 'utf8') : '[]';
  fs.mkdirSync(path.dirname(CHAT_FILE), { recursive: true });
  fs.writeFileSync(CHAT_FILE, '[]');

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

    console.log('1. POST /api/chat/sessions');
    const created = await fetchJson(`${base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'original prompt', preset_id: presetId })
    });
    record('  status === 201', created.status, 201);
    record('  pending_prompt === null', created.body.data && created.body.data.pending_prompt, null);
    const sessionId = created.body.data && created.body.data.id;

    const responses = [
      { reply: 'I chose this composition to isolate the subject from the background.', suggested_prompt: '' },
      { reply: 'A warmer directional treatment would emphasize the focal subject.', suggested_prompt: 'original prompt with warmer directional lighting' }
    ];

    await withMockChatProvider(responses, async () => {
      console.log('2. POST /api/chat/sessions/:id/messages - discussion');
      const discussion = await fetchJson(`${base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Why did you choose this composition?' })
      });
      record('  status === 200', discussion.status, 200);
      record('  current_prompt unchanged', discussion.body.data.current_prompt, 'original prompt');
      record('  pending_prompt === null', discussion.body.data.pending_prompt, null);

      console.log('3. POST /api/chat/sessions/:id/messages - proposal');
      const proposal = await fetchJson(`${base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'What changes would make the focal subject stand out more?' })
      });
      record('  status === 200', proposal.status, 200);
      record('  current_prompt unchanged', proposal.body.data.current_prompt, 'original prompt');
      record('  pending_prompt === suggested_prompt', proposal.body.data.pending_prompt, 'original prompt with warmer directional lighting');

      console.log('4. POST /api/chat/sessions/:id/messages - apply it');
      const committed = await fetchJson(`${base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'apply it' })
      });
      record('  status === 200', committed.status, 200);
      record('  current_prompt === pending_prompt', committed.body.data.current_prompt, 'original prompt with warmer directional lighting');
      record('  pending_prompt === null', committed.body.data.pending_prompt, null);
    });
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

main().catch((err) => {
  console.error('SMOKE TEST crashed:', err);
  process.exit(2);
});