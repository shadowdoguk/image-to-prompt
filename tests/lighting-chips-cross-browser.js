'use strict';
/**
 * Playwright cross-browser verification for the lighting curated-preset
 * chips (ADR 0018). This test covers the critical bug fix: chip clicks
 * must update the visible input/textarea (not silently set .value on
 * the row <div>).
 *
 * Scenarios covered:
 *   1. Lighting chip click updates the input element (regression for
 *      the row-div bug — fix #1).
 *   2. Lighting chip click updates state.currentAnalysis.lighting.
 *   3. Mood chip click updates the textarea element (same regression).
 *   4. Mood chip click updates state.currentAnalysis.mood.
 *   5. Multiple chip clicks on the same field chain (last value wins).
 *   6. AI Populate-with-AI button updates the input (regression for
 *      the AI path — should already work; we re-verify).
 *   7. role="group" attribute is present on chip wrap.
 *   8. Each chip button has aria-label describing the action.
 *
 * Runs against the live server at $BASE_URL (default localhost:3100).
 * If $BASE_URL is not set, the test starts a fresh server on a random
 * port.
 *
 * Browsers: chromium + firefox + webkit + mobile emulation.
 */
const path = require('path');
const { chromium, firefox, webkit, devices } = require(
  '/home/david/.local/share/Trash/files/node_modules/playwright'
);

const PROJECT_ROOT = path.resolve(__dirname, '..');

let _server;
async function ensureServer() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (_server) return _server.base;
  const { app } = require(path.join(PROJECT_ROOT, 'server.js'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  _server = {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r))
  };
  return _server.base;
}

async function withCleanup(fn) {
  // Server lifecycle is now managed at the top level — each browser
  // reuses the same server. Cleanup happens once at process exit.
  return await fn();
}

async function shutdownServer() {
  if (_server) {
    await _server.close();
    _server = null;
  }
}

// Stub the LLM-driven `Populate with AI` so we can test the in-place
// DOM update without hitting the network. Returns 200 with a deterministic
// payload so the populate handler runs its happy path.
async function stubLightingEndpoint(page) {
  await page.route('**/api/lighting', async (route, req) => {
    if (req.method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { lighting: 'stubbed cinematic golden hour from camera-left', model: 'stub' }
      })
    });
  });
  await page.route('**/api/mood', async (route, req) => {
    if (req.method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { mood: 'stubbed contemplative and quietly defiant atmosphere', model: 'stub' }
      })
    });
  });
}

// Render the analysis editor in-page (no LLM needed) by seeding
// `state.currentAnalysis` and calling the private `renderAnalysisEditor`.
// We expose it through a tiny test hook that the page only registers
// when ?test-hook=1 is present. We add the hook ourselves here.
async function seedAnalysisEditor(page, preset, analysis) {
  await page.evaluate(({ preset, analysis }) => {
    const hook = window.__i2pTest;
    if (!hook || typeof hook.renderAnalysisEditor !== 'function') {
      throw new Error('Test hook not present — verify ?test-hook=1 is in URL');
    }
    // Make the analysis step visible (otherwise CSS hides the section).
    if (hook.dom.stepAnalyze) hook.dom.stepAnalyze.classList.add('is-active');
    if (hook.dom.analysisEditor) hook.dom.analysisEditor.hidden = false;
    // Seed a fake currentFile so the Populate buttons are enabled.
    if (!hook.state.currentFile) {
      const blob = new Blob(['fake'], { type: 'image/png' });
      hook.state.currentFile = new File([blob], 'fake.png', { type: 'image/png' });
    }
    hook.state.selectedPresetId = preset;
    hook.state.currentAnalysis = analysis;
    hook.renderAnalysisEditor(analysis);
  }, { preset, analysis });
}

async function chipClickSpec(browserType, browserName, deviceOpts) {
  const browser = await browserType.launch();
  const context = await browser.newContext(deviceOpts || undefined);
  const page = await context.newPage();
  let pass = 0, fail = 0;
  const log = (status, msg) => {
    if (status === 'pass') { console.log(`  ✓ [${browserName}] ${msg}`); pass++; }
    else { console.log(`  ✗ [${browserName}] ${msg}`); fail++; }
  };

  try {
    const base = await ensureServer();
    await stubLightingEndpoint(page);
    await page.goto(base + '/?test-hook=1');

    // Wait for the app to initialise.
    await page.waitForFunction(() => typeof window.__i2pTest?.renderAnalysisEditor === 'function', { timeout: 10000 });

    // Seed a minimal analysis with lighting + mood fields.
    await seedAnalysisEditor(page, 'preset_alla_prima_oil', {
      lighting: 'original lighting from stage 1',
      mood: 'original mood from stage 1',
      subject: 'stub',
      style: 'stub',
      colors: [],
      composition: 'stub',
      texture: 'stub',
      artistic_medium: 'stub',
      depth_of_field: 'stub',
      contrast: 'stub',
      camera_angle: 'stub',
      actions: 'stub'
    });

    // 1. Lighting chip click updates the visible <input>
    const lightingBefore = await page.locator('input[data-field="lighting"]').inputValue();
    if (lightingBefore !== 'original lighting from stage 1') {
      log('fail', `seed mismatch: lighting='${lightingBefore}'`);
    } else {
      log('pass', 'analysis editor seeded');
    }

    await page.locator('.preset-chip[data-preset-value="golden hour"]').click();
    const lightingAfter = await page.locator('input[data-field="lighting"]').inputValue();
    if (lightingAfter === 'golden hour') {
      log('pass', 'lighting chip click updates visible input (regression: row-div bug)');
    } else {
      log('fail', `lighting chip click did NOT update input: got '${lightingAfter}'`);
    }

    // 2. Lighting chip click updates state.currentAnalysis.lighting
    const stateLighting = await page.evaluate(() => window.__i2pTest.state.currentAnalysis.lighting);
    if (stateLighting === 'golden hour') {
      log('pass', 'lighting chip click updates state.currentAnalysis.lighting');
    } else {
      log('fail', `state.currentAnalysis.lighting='${stateLighting}'`);
    }

    // 3. Mood chip click updates the visible <textarea>
    await page.locator('.preset-chip[data-preset-value="serene"]').click();
    const moodAfter = await page.locator('textarea[data-field="mood"]').inputValue();
    if (moodAfter === 'serene') {
      log('pass', 'mood chip click updates visible textarea (regression: row-div bug)');
    } else {
      log('fail', `mood chip click did NOT update textarea: got '${moodAfter}'`);
    }

    // 4. Mood chip click updates state.currentAnalysis.mood
    const stateMood = await page.evaluate(() => window.__i2pTest.state.currentAnalysis.mood);
    if (stateMood === 'serene') {
      log('pass', 'mood chip click updates state.currentAnalysis.mood');
    } else {
      log('fail', `state.currentAnalysis.mood='${stateMood}'`);
    }

    // 5. Chain chips: last click wins, no accumulation
    await page.locator('.preset-chip[data-preset-value="chiaroscuro"]').click();
    await page.locator('.preset-chip[data-preset-value="rim-lit"]').click();
    const chain = await page.locator('input[data-field="lighting"]').inputValue();
    if (chain === 'rim-lit') {
      log('pass', 'chained chip clicks: last value wins (no accumulation)');
    } else {
      log('fail', `chained chip click value='${chain}'`);
    }

    // 6. AI Populate-with-AI button updates the input
    await page.locator('.btn-populate-lighting').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('input[data-field="lighting"]');
      return el && el.value === 'stubbed cinematic golden hour from camera-left';
    }, { timeout: 5000 }).then(() => {
      log('pass', 'AI Populate-with-AI button updates input');
    }).catch(() => {
      log('fail', 'AI Populate-with-AI button did NOT update input within 5s');
    });

    // 7. role="group" attribute on chip wrap
    const hasRole = await page.locator('.preset-chips[role="group"]').count();
    if (hasRole > 0) {
      log('pass', 'chip wrap carries role="group" for a11y');
    } else {
      log('fail', 'chip wrap missing role="group"');
    }

    // 8. Each chip has aria-label
    const ariaCount = await page.locator('.preset-chip[aria-label]').count();
    const chipCount = await page.locator('.preset-chip').count();
    if (ariaCount === chipCount && chipCount > 0) {
      log('pass', `every chip (${chipCount}) has aria-label`);
    } else {
      log('fail', `aria-label mismatch: ${ariaCount}/${chipCount} chips have aria-label`);
    }
  } catch (e) {
    log('fail', `unexpected error: ${e.message}`);
  } finally {
    await context.close();
    await browser.close();
  }

  return { browserName, pass, fail };
}

(async () => {
  let total = { pass: 0, fail: 0 };
  for (const [type, name] of [
    [chromium, 'chromium'],
    [firefox, 'firefox'],
    [webkit, 'webkit']
  ]) {
    let result;
    try {
      result = await withCleanup(() => chipClickSpec(type, name));
    } catch (e) {
      console.log(`  ✗ [${name}] launcher error: ${e.message}`);
      result = { browserName: name, pass: 0, fail: 1 };
    }
    if (result) {
      total.pass += (result.pass || 0);
      total.fail += (result.fail || 0);
    }
  }
  // Mobile emulation
  let mobileResult;
  try {
    mobileResult = await withCleanup(() => chipClickSpec(chromium, 'chromium-mobile', { ...devices['Pixel 5'] }));
  } catch (e) {
    console.log(`  ✗ [chromium-mobile] launcher error: ${e.message}`);
    mobileResult = { browserName: 'chromium-mobile', pass: 0, fail: 1 };
  }
  if (mobileResult) {
    total.pass += (mobileResult.pass || 0);
    total.fail += (mobileResult.fail || 0);
  }

  console.log('');
  console.log(`Browser suite: ${total.pass} passed, ${total.fail} failed`);
  await shutdownServer();
  process.exit(total.fail > 0 ? 1 : 0);
})();