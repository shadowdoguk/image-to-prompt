#!/usr/bin/env node
/**
 * Smoke test — Anima prompt coverage categories (issue #23).
 *
 * The Anima tag-style prompt contract used by POST /api/anima specifies
 * output *format* (lowercase, comma-separated, etc.) but originally did
 * not enumerate *coverage categories* — i.e. which tag families the LLM
 * must emit (camera, mood, lighting, posture, composition, era). The
 * Z-Image Turbo 14-field analysis captures all of these in
 * state.currentAnalysis, but the Anima path ignored them and emitted a
 * subject-only tag list.
 *
 * This smoke test is a static-source assertion: it reads server.js and
 * verifies that DEFAULT_ANIMA_PROMPT now contains a COVERAGE CATEGORIES
 * section enumerating each category with at least one canonical tag.
 *
 * Mirrors the pattern of:
 *   scripts/smoke/anima-chat-apply-sync.js  (issue #22)
 *   scripts/smoke/palette-stale-id-guard.js (issue #21)
 *
 * Run:  node scripts/smoke/anima-coverage-categories.js
 * Pass: exits 0 with "7 passed, 0 failed".
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_PATH = path.join(ROOT, 'server.js');

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// 1. server.js exists and is readable.
const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');

// 2. DEFAULT_ANIMA_PROMPT is defined.
assert(
  'server.js exports DEFAULT_ANIMA_PROMPT',
  /const\s+DEFAULT_ANIMA_PROMPT\s*=/.test(serverSrc),
  'const DEFAULT_ANIMA_PROMPT = ... not found'
);

// 3. The prompt contains a COVERAGE CATEGORIES section header.
const coverageSectionMatch = serverSrc.match(/# COVERAGE CATEGORIES([\s\S]*?)(?=\n# [A-Z]|\n\")/);
assert(
  'DEFAULT_ANIMA_PROMPT has a # COVERAGE CATEGORIES section',
  coverageSectionMatch !== null,
  'section header not found inside the template literal'
);

// The remaining assertions scope to the COVERAGE CATEGORIES section body,
// so a future prompt restructure elsewhere cannot accidentally satisfy them.
const coverageBody = coverageSectionMatch ? coverageSectionMatch[1] : '';

// 4. CAMERA ANGLE category present with at least one canonical tag.
assert(
  'CAMERA ANGLE category enumerated (e.g. "looking at viewer", "portrait")',
  /CAMERA ANGLE/.test(coverageBody) &&
    /looking at viewer/.test(coverageBody) &&
    /portrait/.test(coverageBody),
  'camera vocabulary missing or section mis-named'
);

// 5. MOOD / EXPRESSION category present.
assert(
  'MOOD category enumerated (e.g. "gentle smile")',
  /MOOD/.test(coverageBody) && /gentle smile/.test(coverageBody),
  'mood vocabulary missing or section mis-named'
);

// 6. LIGHTING category present.
assert(
  'LIGHTING category enumerated (e.g. "soft lighting")',
  /LIGHTING/.test(coverageBody) && /soft lighting/.test(coverageBody),
  'lighting vocabulary missing or section mis-named'
);

// 7. POSTURE / ACTION category present.
assert(
  'POSTURE / ACTION category enumerated (e.g. "standing", "sitting")',
  /POSTURE/.test(coverageBody) && /standing/.test(coverageBody) && /sitting/.test(coverageBody),
  'posture vocabulary missing or section mis-named'
);

// 8. The section references issue #23 so future regressions trace back.
assert(
  'section references issue #23 for traceability',
  /#23/.test(coverageBody),
  'cross-reference to issue #23 missing — regressions will be harder to triage'
);

console.log('');
console.log(`  ${pass} passed, ${fail} failed`);

if (fail > 0) {
  console.error('\n  FAILURES:');
  failures.forEach((f) => console.error(`    - ${f}`));
  process.exit(1);
}

process.exit(0);