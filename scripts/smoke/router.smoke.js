'use strict';
/**
 * scripts/smoke/router.smoke.js — Slices UI-R0 / UI-R1
 *
 * Static smoke checks for the hash-router shell (no browser needed):
 *   - src/shell.js exists and registers a hashchange router
 *   - index.html mounts exactly the five views + primary nav + skip link
 *   - every nav href matches a view container id
 *
 * Run: node scripts/smoke/router.smoke.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

const shell = fs.readFileSync(path.join(ROOT, 'src', 'shell.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');

if (!/addEventListener\('hashchange'/.test(shell)) fail('shell.js must register a hashchange listener');
if (!/trapFocus|focus-trap/.test(shell)) fail('shell.js must include the focus-trap utility');
if (!/announce/.test(shell)) fail('shell.js must include a live-region announce utility');

const VIEWS = ['create', 'library', 'chat', 'providers', 'settings'];
for (const v of VIEWS) {
  if (!html.includes(`id="view-${v}"`)) fail(`missing view container #view-${v}`);
  if (!html.includes(`href="#/${v}`)) fail(`missing nav link to #/${v}`);
}
if (!/<nav[^>]*aria-label="Primary"/.test(html)) fail('missing primary nav landmark');
if (!/class="skip-link"/.test(html)) fail('missing skip link');
if (/<section class="step"/.test(html)) fail('gated-step sections must be removed');

// Nav items form a tablist with roving keyboard support in the router.
if (!/role="tablist"/.test(html)) fail('primary nav must use role="tablist"');

console.log('✓ router smoke passed');
