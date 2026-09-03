'use strict';
/**
 * scripts/smoke/provider-key-store.smoke.js — Slice UI-R2 (ADR 0024)
 *
 * Boots the app on an ephemeral port against a throwaway key store and
 * exercises the provider-key endpoints end-to-end:
 *   GET (list, masked) → PUT (save + validation) → DELETE → 404 rule.
 * Keys must never appear in any response body.
 *
 * Run: node scripts/smoke/provider-key-store.smoke.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.PROVIDER_KEYS_FILE = path.join(os.tmpdir(), `prov_keys_smoke_${process.pid}.json`);
try { fs.unlinkSync(process.env.PROVIDER_KEYS_FILE); } catch (_) {}

const { app } = require(path.join(__dirname, '..', '..', 'server.js'));

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

(async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 1. List — three providers, no apiKey field anywhere.
    let res = await fetch(`${base}/api/providers`);
    let body = await res.json();
    if (!res.ok || !body.success || !Array.isArray(body.data) || body.data.length !== 3) {
      fail('GET /api/providers must list exactly the 3 allowed providers');
    }
    if (JSON.stringify(body.data).includes('"apiKey"')) fail('GET response must never contain apiKey');
    const minimax = body.data.find((p) => p.id === 'minimax');
    if (!minimax || !Array.isArray(minimax.models)) fail('provider entries need id + models[]');

    // 2. Save a valid key.
    res = await fetch(`${base}/api/providers/minimax/key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'eyJsmokeTestKey-abcdef123456' })
    });
    body = await res.json();
    if (!res.ok || !body.success) fail('PUT with a valid key should succeed');
    if (!process.env.MINIMAX_API_KEY && body.data.source !== 'stored') fail('source must be "stored" when env is absent');
    if (body.data.keyMasked && body.data.keyMasked.includes('smokeTestKey')) fail('keyMasked leaked the raw key');

    // 3. Reject an obviously bad key.
    res = await fetch(`${base}/api/providers/minimax/key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'short' })
    });
    if (res.status !== 400) fail('PUT with a short key must return 400');

    // 4. Delete the stored key again.
    res = await fetch(`${base}/api/providers/minimax/key`, { method: 'DELETE' });
    if (!res.ok && !process.env.MINIMAX_API_KEY) fail('DELETE of the stored key should succeed');

    // 5. Unknown provider → 404 on every route.
    res = await fetch(`${base}/api/providers/bogus/key`, { method: 'DELETE' });
    if (res.status !== 404) fail('unknown provider must return 404');
    res = await fetch(`${base}/api/providers/bogus/test`, { method: 'POST' });
    if (res.status !== 404) fail('unknown provider test must return 404');

    console.log('✓ provider-key-store smoke passed');
  } finally {
    server.close();
    try { fs.unlinkSync(process.env.PROVIDER_KEYS_FILE); } catch (_) {}
  }
})().catch((e) => fail(e.stack || String(e)));
