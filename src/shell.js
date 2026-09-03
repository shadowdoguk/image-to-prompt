/**
 * Image-to-Prompt — App shell (Slices UI-R0…UI-R4, docs/UI-REDESIGN-SPEC.md)
 *
 * Loads AFTER app.js and never mutates its internals. Integration surface:
 *   - DOM ids (stable contracts, verified by tests)
 *   - REST endpoints (existing + ADR 0024 provider endpoints)
 *   - hashchange routing
 *
 * Contents:
 *   §1 utilities ($, announce, api, escapeHtml)
 *   §2 hash router + focus management (AX2) + tablist keyboard (AX3)
 *   §3 modal focus-trap pattern (AX4)
 *   §4 provider status: poller, header dots, Create-view inline warnings
 *   §5 Providers & keys view (spec §6)
 *   §6 Library view (spec §4.2)
 *   §7 Chat view glue
 *   §8 Settings view (spec §4.5)
 *   §9 Create-view extras: field completion meter, result announcements
 */

(() => {
  'use strict';

  // ─── §1 Utilities ────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const VIEWS = ['create', 'library', 'chat', 'providers', 'settings'];

  const announcer = $('a11y-announcer');
  /** Announce to screen readers via the polite live region (AX5). */
  const announce = (message) => {
    if (!announcer) return;
    announcer.textContent = '';
    window.setTimeout(() => { announcer.textContent = message; }, 40);
  };

  /** Small fetch wrapper that normalizes the { success, data, error } shape. */
  const api = async (path, options = {}) => {
    const res = await fetch(path, {
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options
    });
    let body = null;
    try { body = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok || (body && body.success === false)) {
      const message = (body && body.error) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  };

  const escapeHtml = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ─── §2 Hash router ──────────────────────────────────────────────────────

  const parseHash = () => {
    const raw = (location.hash || '').replace(/^#\/?/, '') || 'create';
    const qIndex = raw.indexOf('?');
    const pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
    const params = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
    const view = VIEWS.includes(pathPart) ? pathPart : 'create';
    return { view, params };
  };

  let currentView = null;

  const onViewEnter = (view, params) => {
    if (view === 'library') {
      setLibraryTab(params.get('tab') || libraryState.tab, { fromRoute: true });
    }
    if (view === 'providers') {
      pendingProviderFocus = params.get('focus');
      pendingReturn = params.get('return');
      fetchProviders(); // fresh status whenever the module is opened
      renderProviderCards();
    }
  };

  const onRoute = () => {
    const { view, params } = parseHash();
    for (const v of VIEWS) {
      const el = $(`view-${v}`);
      if (el) el.hidden = v !== view;
      const tab = $(`nav-${v}`);
      if (tab) {
        tab.setAttribute('aria-selected', String(v === view));
        tab.setAttribute('tabindex', v === view ? '0' : '-1');
      }
    }
    document.title = `${view === 'create' ? 'Create' : view.charAt(0).toUpperCase() + view.slice(1)} · Image-to-Prompt`;

    if (currentView !== view) {
      currentView = view;
      onViewEnter(view, params);
      // AX2 — move focus to the view heading on route change.
      const heading = $(`view-${view}-title`);
      if (heading) heading.focus({ preventScroll: false });
    } else if (view === 'library' || view === 'providers') {
      onViewEnter(view, params); // deep-link params changed within the view
    }
  };

  /** AX3 — roving tabindex + arrow-key navigation for a tablist of links/buttons. */
  const bindTablistKeyboard = (container, selector) => {
    if (!container) return;
    container.addEventListener('keydown', (e) => {
      const tabs = Array.from(container.querySelectorAll(selector));
      const index = tabs.indexOf(document.activeElement);
      if (index === -1) return;
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
        if (next.tagName === 'A') next.click(); // nav tabs activate on focus
        else next.click(); // library tabs
      }
    });
  };

  // ─── §3 Modal focus trap (AX4) ───────────────────────────────────────────

  let lastFocusBeforeModal = null;

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const trapFocus = (modal, e) => {
    const focusables = Array.from(modal.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const bindModalTraps = () => {
    const modals = Array.from(document.querySelectorAll('.modal'));
    modals.forEach((modal) => {
      modal.addEventListener('keydown', (e) => {
        if (modal.hidden) return;
        if (e.key === 'Tab') trapFocus(modal, e);
        if (e.key === 'Escape') {
          const dismiss =
            modal.querySelector('[id$="-cancel"]') ||
            modal.querySelector('[id$="-close"]');
          if (dismiss) { e.preventDefault(); dismiss.click(); }
        }
      });
    });

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const modal = m.target;
        if (modal.hidden) {
          // Dialog closed — return focus to the invoker.
          if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') {
            try { lastFocusBeforeModal.focus(); } catch (_) {}
          }
          lastFocusBeforeModal = null;
        } else if (m.oldValue === 'true' || m.oldValue === null || m.oldValue === '') {
          lastFocusBeforeModal = document.activeElement;
          const focusables = modal.querySelectorAll(FOCUSABLE);
          const target =
            modal.querySelector('.modal-content input, .modal-content textarea, .modal-content select') ||
            focusables[0];
          if (target) window.setTimeout(() => { try { target.focus(); } catch (_) {} }, 30);
        }
      }
    });
    modals.forEach((modal) => observer.observe(modal, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true }));
  };

  // ─── §4 Provider status — poller, dots, Create inline warnings ──────────

  let providerCache = [];
  let pendingProviderFocus = null;
  let pendingReturn = null;

  const providerStatusText = (p) => {
    if (!p.configured) return 'no key';
    if (p.source === 'env') return 'configured (environment)';
    return 'configured (saved here)';
  };

  const renderProviderDots = () => {
    const dots = $('provider-dots');
    if (!dots) return;
    dots.textContent = '';
    providerCache.forEach((p) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      let cls = 'provider-dot dot--missing';
      if (p.configured) {
        cls = p.lastTest && p.lastTest.ok === true ? 'provider-dot dot--ok' : 'provider-dot dot--untested';
      } else if (p.lastTest && p.lastTest.ok === false) {
        cls = 'provider-dot dot--error';
      }
      dot.className = cls;
      const label = `${p.label}: ${providerStatusText(p)}`;
      dot.setAttribute('aria-label', label);
      dot.title = label;
      const glyph = document.createElement('span');
      glyph.className = 'provider-dot__glyph';
      glyph.setAttribute('aria-hidden', 'true');
      dot.appendChild(glyph);
      dot.addEventListener('click', () => { location.hash = `#/providers?focus=${p.id}`; });
      dots.appendChild(dot);
    });
  };

  const updateCreateWarnings = () => {
    const sel = $('provider-selector');
    const warn = $('provider-key-warning');
    if (!sel || !warn) return;

    // Options carry live status: "MiniMax direct (stub) — no key".
    Array.from(sel.options).forEach((opt) => {
      const info = providerCache.find((p) => p.id === opt.value);
      if (!info) return;
      if (!opt.dataset.baseLabel) opt.dataset.baseLabel = opt.textContent.replace(/\s—\s(no key|configured.*)$/, '');
      opt.textContent = info.configured ? opt.dataset.baseLabel : `${opt.dataset.baseLabel} — no key`;
    });

    const current = providerCache.find((p) => p.id === sel.value);
    if (current && !current.configured) {
      warn.textContent = '';
      warn.append(`${current.label} has no API key configured. Generation will fail until one is added. `);
      const link = document.createElement('a');
      link.href = `#/providers?focus=${current.id}&return=create`;
      link.textContent = 'Add key →';
      warn.appendChild(link);
      warn.hidden = false;
      const disclosure = $('output-options');
      if (disclosure) disclosure.open = true;
    } else {
      warn.hidden = true;
      warn.textContent = '';
    }
  };

  const fetchProviders = async () => {
    try {
      const body = await api('/api/providers');
      providerCache = Array.isArray(body.data) ? body.data : [];
    } catch (_) {
      providerCache = [];
    }
    renderProviderDots();
    updateCreateWarnings();
    if (currentView === 'providers') renderProviderCards();
  };

  // ─── §5 Providers & keys view ────────────────────────────────────────────

  const KEY_FORMAT_HINTS = {
    kilo_code: 'Provided by your Kilo Code gateway account. Any gateway token works.',
    minimax: 'MiniMax keys are JWTs and start with “eyJ”.',
    alibaba: 'DashScope keys start with “sk-”.'
  };

  const renderProviderCards = () => {
    const wrap = $('provider-cards');
    if (!wrap) return;
    wrap.setAttribute('aria-busy', providerCache.length === 0 ? 'true' : 'false');
    if (providerCache.length === 0) {
      wrap.innerHTML = '<p class="library-empty">Loading provider status…</p>';
      return;
    }
    wrap.textContent = '';
    providerCache.forEach((p) => {
      const card = document.createElement('article');
      card.className = 'provider-card panel';
      card.id = `provider-card-${p.id}`;

      const badgeClass = !p.configured ? 'badge badge--missing'
        : p.source === 'env' ? 'badge badge--locked'
        : p.lastTest && p.lastTest.ok ? 'badge badge--ok'
        : 'badge badge--untested';
      const badgeText = !p.configured ? '○ No key'
        : p.source === 'env' ? '● Configured — provided by server environment (locked)'
        : `● Key saved here · ${p.keyMasked || ''} · added ${p.addedAt ? new Date(p.addedAt).toLocaleDateString() : 'recently'}`;

      let keySection = '';
      if (p.source === 'env') {
        keySection = `
          <p class="provider-card__note">
            This key comes from an environment variable on the server, so it cannot be
            edited or removed from this screen. Saved keys are only used when no
            environment variable is present.
          </p>`;
      } else if (p.configured) {
        keySection = `
          <div class="provider-card__actions">
            <button type="button" class="btn-secondary" data-action="replace">Replace key</button>
            <button type="button" class="btn-danger-outline btn-secondary" data-action="remove">Remove key</button>
            <button type="button" class="btn-secondary" data-action="test">Test connection</button>
          </div>
          <p class="provider-card__test" data-role="test-result">${p.lastTest ? lastTestText(p.lastTest) : 'Never tested.'}</p>
          <div class="provider-card__keyform" data-role="key-form" hidden>
            ${keyFormMarkup(p.id)}
          </div>`;
      } else {
        keySection = `
          ${keyFormMarkup(p.id)}
          <div class="provider-card__actions">
            <button type="button" class="btn-secondary" data-action="test">Test connection</button>
          </div>
          <p class="provider-card__test" data-role="test-result">${p.lastTest ? lastTestText(p.lastTest) : 'Never tested.'}</p>`;
      }

      card.innerHTML = `
        <header class="provider-card__header">
          <h2 class="panel-title provider-card__title" tabindex="-1">${escapeHtml(p.label)}</h2>
          <span class="${badgeClass}" role="status">${escapeHtml(badgeText)}</span>
        </header>
        <p class="provider-card__meta">
          Base URL: <code>${escapeHtml(p.baseUrl)}</code> · Default model: <code>${escapeHtml(p.defaultModel)}</code>
        </p>
        <p class="provider-card__models">Models: ${p.models.map((m) => `<code>${escapeHtml(m)}</code>`).join(' · ')}</p>
        ${keySection}
        <p class="provider-card__status" data-role="save-status" role="status" aria-live="polite"></p>`;
      wrap.appendChild(card);
      wireProviderCard(card, p);
    });

    if (pendingProviderFocus) {
      const target = providerCache.find((p) => p.id === pendingProviderFocus);
      pendingProviderFocus = null;
      if (target) {
        window.setTimeout(() => {
          const input = $(`key-input-${target.id}`);
          const heading = document.querySelector(`#provider-card-${target.id} .provider-card__title`);
          (input || heading || {}).focus && (input || heading).focus();
        }, 30);
      }
    }
  };

  const lastTestText = (t) => {
    if (!t || !t.at) return 'Never tested.';
    const when = new Date(t.at).toLocaleString();
    if (t.ok) return `Last test passed · ${when} · ${t.latencyMs} ms`;
    return `Last test failed (${escapeHtml(t.error || 'unknown error')}) · ${when}`;
  };

  const keyFormMarkup = (providerId) => `
    <label for="key-input-${providerId}" class="label">API key</label>
    <div class="key-input-row">
      <input
        type="password"
        id="key-input-${providerId}"
        class="text-input key-input"
        autocomplete="off"
        spellcheck="false"
        aria-describedby="key-hint-${providerId}"
      >
      <button type="button" class="btn-secondary key-show-btn" data-action="toggle-show" aria-pressed="false" aria-label="Show key">Show</button>
    </div>
    <p class="label-hint" id="key-hint-${providerId}">${escapeHtml(KEY_FORMAT_HINTS[providerId] || '')} Minimum 12 characters. Never sent back to the browser after saving.</p>
    <div class="provider-card__actions">
      <button type="button" class="btn-primary key-save-btn" data-action="save">Save key</button>
    </div>`;

  const wireProviderCard = (card, provider) => {
    const statusEl = card.querySelector('[data-role="save-status"]');
    const testEl = card.querySelector('[data-role="test-result"]');
    const keyForm = card.querySelector('[data-role="key-form"]');

    card.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'toggle-show') {
        const input = $(`key-input-${provider.id}`);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', String(show));
        btn.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
        return;
      }

      if (action === 'replace') {
        if (keyForm) {
          keyForm.hidden = !keyForm.hidden;
          if (!keyForm.hidden) ($(`key-input-${provider.id}`) || {}).focus && $(`key-input-${provider.id}`).focus();
        }
        return;
      }

      if (action === 'remove') {
        if (!window.confirm(`Remove the stored key for ${provider.label}? This cannot be undone.`)) return;
        try {
          await api(`/api/providers/${provider.id}/key`, { method: 'DELETE' });
          announce(`${provider.label} key removed.`);
          await fetchProviders();
        } catch (err) {
          if (statusEl) statusEl.textContent = err.message;
        }
        return;
      }

      if (action === 'test') {
        if (btn.disabled) return;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Testing…';
        try {
          const body = await api(`/api/providers/${provider.id}/test`, { method: 'POST' });
          const t = body.data;
          if (testEl) testEl.innerHTML = lastTestText(t);
          announce(t.ok ? `${provider.label} connection test passed.` : `${provider.label} connection test failed: ${t.error}`);
          await fetchProviders();
        } catch (err) {
          if (testEl) testEl.textContent = `Test error: ${err.message}`;
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
        return;
      }

      if (action === 'save') {
        const input = $(`key-input-${provider.id}`);
        if (!input) return;
        const apiKey = input.value;
        btn.disabled = true;
        try {
          const body = await api(`/api/providers/${provider.id}/key`, {
            method: 'PUT',
            body: JSON.stringify({ apiKey })
          });
          input.value = '';
          announce(`${provider.label} key saved.`);
          if (statusEl) statusEl.textContent = body.warning || 'Key saved.';
          await fetchProviders();
          if (pendingReturn) {
            const dest = pendingReturn;
            pendingReturn = null;
            location.hash = `#/${VIEWS.includes(dest) ? dest : 'create'}`;
          }
        } catch (err) {
          if (statusEl) statusEl.textContent = err.message;
          announce(`Could not save key: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      }
    });
  };

  // ─── §6 Library view ─────────────────────────────────────────────────────

  const libraryState = { tab: 'presets', items: [], selectedId: null, filter: '' };
  const LIBRARY_ENDPOINTS = { presets: '/api/presets', palettes: '/api/palettes', directives: '/api/directives' };
  const LIBRARY_EMPTY = {
    presets: 'No presets yet. Create one from the Create view with “+ New”.',
    palettes: 'No palettes yet. Analyze an image, then save its palette from the colors field.',
    directives: 'No directives yet. Write one in the Create view and choose “Save directive…”.'
  };

  const setLibraryTab = (tab, opts = {}) => {
    if (!['presets', 'palettes', 'directives'].includes(tab)) tab = 'presets';
    libraryState.tab = tab;
    libraryState.selectedId = null;
    document.querySelectorAll('[data-library-tab]').forEach((btn) => {
      const active = btn.dataset.libraryTab === tab;
      btn.setAttribute('aria-selected', String(active));
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });
    loadLibrary();
    if (!opts.fromRoute && opts.push !== false) {
      const target = `#/library?tab=${tab}`;
      if (location.hash !== target) location.hash = target;
    }
  };

  const loadLibrary = async () => {
    const list = $('library-list');
    if (!list) return;
    try {
      const body = await api(LIBRARY_ENDPOINTS[libraryState.tab]);
      libraryState.items = Array.isArray(body.data) ? body.data : [];
    } catch (err) {
      libraryState.items = [];
      list.innerHTML = `<li class="library-empty">Could not load items: ${escapeHtml(err.message)}</li>`;
      return;
    }
    renderLibraryList();
  };

  const libraryItemName = (item) => item.name || item.id;

  const renderLibraryList = () => {
    const list = $('library-list');
    const empty = $('library-empty');
    const count = $('library-count');
    if (!list) return;
    const filter = libraryState.filter.trim().toLowerCase();
    const items = libraryState.items.filter((i) => !filter || libraryItemName(i).toLowerCase().includes(filter));
    list.textContent = '';
    if (count) count.textContent = `${items.length} of ${libraryState.items.length}`;
    if (items.length === 0) {
      if (empty) { empty.textContent = filter ? 'Nothing matches that filter.' : LIBRARY_EMPTY[libraryState.tab]; empty.hidden = false; }
      renderLibraryPanel(null);
      return;
    }
    if (empty) empty.hidden = true;
    items.forEach((item) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'library-item' + (item.id === libraryState.selectedId ? ' library-item--active' : '');
      btn.dataset.id = item.id;
      btn.setAttribute('aria-current', item.id === libraryState.selectedId ? 'true' : 'false');
      const meta = libraryItemMeta(item);
      btn.innerHTML = `<span class="library-item__name">${escapeHtml(libraryItemName(item))}</span><span class="library-item__meta">${meta}</span>`;
      btn.addEventListener('click', () => {
        libraryState.selectedId = item.id;
        renderLibraryList();
        renderLibraryPanel(item);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
    const selected = items.find((i) => i.id === libraryState.selectedId);
    renderLibraryPanel(selected || null);
  };

  const libraryItemMeta = (item) => {
    if (libraryState.tab === 'presets') return `${(item.stage1_fields || []).length} fields`;
    if (libraryState.tab === 'palettes') return `${(item.colors || []).length} colors · ${item.strength || 'moderate'}`;
    const tags = (item.tags || []).join(', ');
    return tags ? `${tags}` : `${(item.content || '').length} chars`;
  };

  const renderLibraryPanel = (item) => {
    const panel = $('library-panel');
    if (!panel) return;
    if (!item) {
      panel.innerHTML = '<p class="library-panel__placeholder">Select an item to see its details.</p>';
      return;
    }
    if (libraryState.tab === 'presets') renderPresetPanel(panel, item);
    else if (libraryState.tab === 'palettes') renderPalettePanel(panel, item);
    else renderDirectivePanel(panel, item);
  };

  const renderPresetPanel = (panel, preset) => {
    panel.innerHTML = `
      <form class="library-edit-form" data-kind="preset">
        <label for="library-preset-name" class="label">Name</label>
        <input type="text" id="library-preset-name" class="text-input" maxlength="100" value="${escapeHtml(preset.name)}" required>
        <label for="library-preset-stage1" class="label">Stage 1 system prompt <span class="label-hint">— how the image is analyzed</span></label>
        <textarea id="library-preset-stage1" class="textarea" rows="8" maxlength="5000">${escapeHtml(preset.stage1_system_prompt || '')}</textarea>
        <label for="library-preset-stage2" class="label">Stage 2 system prompt <span class="label-hint">— how the final prompt is synthesized</span></label>
        <textarea id="library-preset-stage2" class="textarea" rows="8" maxlength="5000">${escapeHtml(preset.stage2_system_prompt || '')}</textarea>
        <p class="label-hint">Stage 1 fields: ${(preset.stage1_fields || []).map((f) => escapeHtml(f)).join(', ')}</p>
        <div class="library-panel__actions">
          <button type="submit" class="btn-primary">Save changes</button>
          <button type="button" class="btn-secondary" data-action="use">Use in Create →</button>
          <button type="button" class="btn-danger-outline btn-secondary" data-action="delete">Delete</button>
          <span class="library-panel__status" role="status" aria-live="polite"></span>
        </div>
      </form>`;
    const form = panel.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = form.querySelector('.library-panel__status');
      try {
        await api(`/api/presets/${preset.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: $('library-preset-name').value,
            stage1_system_prompt: $('library-preset-stage1').value,
            stage2_system_prompt: $('library-preset-stage2').value
          })
        });
        status.textContent = 'Saved.';
        announce('Preset saved.');
        await loadLibrary();
      } catch (err) { status.textContent = err.message; }
    });
    form.querySelector('[data-action="use"]').addEventListener('click', () => {
      const sel = $('preset-select');
      if (sel) { sel.value = preset.id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      location.hash = '#/create';
    });
    form.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!window.confirm(`Delete preset "${preset.name}"? This cannot be undone.`)) return;
      try {
        await api(`/api/presets/${preset.id}`, { method: 'DELETE' });
        announce('Preset deleted.');
        libraryState.selectedId = null;
        await loadLibrary();
      } catch (err) {
        form.querySelector('.library-panel__status').textContent = err.message;
      }
    });
  };

  const renderPalettePanel = (panel, palette) => {
    const swatches = (palette.colors || [])
      .map((c) => {
        const color = c.hex || c.color || c;
        const name = c.name || color;
        return `<span class="library-swatch" style="background:${escapeHtml(color)}" title="${escapeHtml(name)}"></span>`;
      })
      .join('');
    panel.innerHTML = `
      <div class="library-detail">
        <p class="library-detail__swatches" aria-label="Palette colors">${swatches}</p>
        <p class="label-hint">
          Strength: ${escapeHtml(palette.strength || 'moderate')} ·
          Accent cap: ${escapeHtml(palette.accentMax != null ? palette.accentMax : '—')}
        </p>
        <p class="label-hint">
          The full editor — color order, accent flags, version history, distribution
          dashboard — lives in Create → Manage palettes… (deep editing stays there to
          keep this panel lean).
        </p>
        <div class="library-panel__actions">
          <button type="button" class="btn-primary" data-action="use">Use palette in Create →</button>
          <button type="button" class="btn-danger-outline btn-secondary" data-action="delete">Delete</button>
          <span class="library-panel__status" role="status" aria-live="polite"></span>
        </div>
      </div>`;
    panel.querySelector('[data-action="use"]').addEventListener('click', () => {
      const sel = $('palette-select');
      if (sel) { sel.value = palette.id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      location.hash = '#/create';
    });
    panel.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!window.confirm(`Delete palette "${palette.name}"? This cannot be undone.`)) return;
      try {
        await api(`/api/palettes/${palette.id}`, { method: 'DELETE' });
        announce('Palette deleted.');
        libraryState.selectedId = null;
        await loadLibrary();
      } catch (err) {
        panel.querySelector('.library-panel__status').textContent = err.message;
      }
    });
  };

  const renderDirectivePanel = (panel, directive) => {
    panel.innerHTML = `
      <form class="library-edit-form" data-kind="directive">
        <label for="library-directive-name" class="label">Name</label>
        <input type="text" id="library-directive-name" class="text-input" maxlength="60" value="${escapeHtml(directive.name)}" required>
        <label for="library-directive-tags" class="label">Tags (comma-separated)</label>
        <input type="text" id="library-directive-tags" class="text-input" value="${escapeHtml((directive.tags || []).join(', '))}">
        <label for="library-directive-content" class="label">Content</label>
        <textarea id="library-directive-content" class="textarea" rows="5" maxlength="1000" required>${escapeHtml(directive.content)}</textarea>
        <div class="library-panel__actions">
          <button type="submit" class="btn-primary">Save changes</button>
          <button type="button" class="btn-secondary" data-action="apply">Apply in Create →</button>
          <button type="button" class="btn-danger-outline btn-secondary" data-action="delete">Delete</button>
          <span class="library-panel__status" role="status" aria-live="polite"></span>
        </div>
      </form>`;
    const form = panel.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = form.querySelector('.library-panel__status');
      const tags = $('library-directive-tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      try {
        await api(`/api/directives/${directive.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: $('library-directive-name').value,
            tags,
            content: $('library-directive-content').value
          })
        });
        status.textContent = 'Saved.';
        announce('Directive saved.');
        await loadLibrary();
      } catch (err) { status.textContent = err.message; }
    });
    form.querySelector('[data-action="apply"]').addEventListener('click', () => {
      const box = $('directives-input');
      if (box) {
        box.value = directive.content;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
      location.hash = '#/create';
    });
    form.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!window.confirm(`Delete directive "${directive.name}"? This cannot be undone.`)) return;
      try {
        await api(`/api/directives/${directive.id}`, { method: 'DELETE' });
        announce('Directive deleted.');
        libraryState.selectedId = null;
        await loadLibrary();
      } catch (err) {
        form.querySelector('.library-panel__status').textContent = err.message;
      }
    });
  };

  const bindLibrary = () => {
    document.querySelectorAll('[data-library-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setLibraryTab(btn.dataset.libraryTab));
    });
    bindTablistKeyboard(document.querySelector('.library-tabs'), '.library-tab');
    const search = $('library-search');
    if (search) {
      search.addEventListener('input', () => {
        libraryState.filter = search.value;
        renderLibraryList();
      });
    }
    // Q2 resolution — import/export-all lives in Library. The preset import
    // file-input wiring is owned by app.js; we trigger it through its button.
    const importBtn = $('library-import-presets-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        const trigger = $('preset-import-btn');
        if (trigger) trigger.click();
      });
    }
  };

  // ─── §7 Chat view glue ───────────────────────────────────────────────────
  // Chat content (#step-chat) is owned by app.js — the shell only hosts it in
  // a first-class view. Cross-view seeding happens via the "Refine in chat"
  // links in the result panels (existing session contract, unchanged).

  // ─── §8 Settings view ────────────────────────────────────────────────────

  const STORAGE_KEYS = {
    model: 'i2p.state.model',
    variant: 'i2p.state.animaVariant',
    llmModel: 'i2p.state.llmModel',
    provider: 'i2p.state.provider'
  };

  const bindSettings = () => {
    const form = $('settings-form');
    if (!form) return;

    const hydrate = () => {
      try {
        const provider = localStorage.getItem(STORAGE_KEYS.provider);
        const llm = localStorage.getItem(STORAGE_KEYS.llmModel);
        const model = localStorage.getItem(STORAGE_KEYS.model);
        const variant = localStorage.getItem(STORAGE_KEYS.variant);
        if (provider) $('settings-provider').value = provider;
        if (llm) $('settings-llm-model').value = llm;
        if (model) {
          const radio = form.querySelector(`input[name="settings-model"][value="${model}"]`);
          if (radio) radio.checked = true;
        }
        if (variant) $('settings-anima-variant').value = variant;
      } catch (_) { /* localStorage unavailable */ }
    };
    hydrate();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const provider = $('settings-provider').value;
      const llm = $('settings-llm-model').value;
      const model = (form.querySelector('input[name="settings-model"]:checked') || {}).value || 'zimage_turbo';
      const variant = $('settings-anima-variant').value;
      try {
        localStorage.setItem(STORAGE_KEYS.provider, provider);
        localStorage.setItem(STORAGE_KEYS.llmModel, llm);
        localStorage.setItem(STORAGE_KEYS.model, model);
        localStorage.setItem(STORAGE_KEYS.variant, variant);
      } catch (_) { /* ignore */ }

      // Sync the live Create controls through app.js's own change handlers.
      const providerSel = $('provider-selector');
      if (providerSel && providerSel.value !== provider) {
        providerSel.value = provider;
        providerSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const llmSel = $('llm-model-selector');
      if (llmSel && llmSel.value !== llm) {
        llmSel.value = llm;
        llmSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const modelBtn = document.querySelector(`#model-selector [data-model="${model}"]`);
      if (modelBtn && modelBtn.getAttribute('aria-pressed') !== 'true') modelBtn.click();
      if (model === 'anima') {
        const variantBtn = document.querySelector(`#anima-variant-selector [data-anima-variant="${variant}"]`);
        if (variantBtn && variantBtn.getAttribute('aria-pressed') !== 'true') variantBtn.click();
      }

      updateCreateWarnings();
      const status = $('settings-status');
      if (status) status.textContent = 'Defaults saved.';
      announce('Defaults saved.');
      window.setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    });

    const subjectBtn = $('settings-subject-prompt-btn');
    if (subjectBtn) {
      subjectBtn.addEventListener('click', async () => {
        const modal = $('subject-prompt-modal');
        if (!modal) return;
        try {
          const body = await api('/api/subject-prompt');
          $('subject-prompt-input').value = body.prompt || '';
          const status = $('subject-prompt-status');
          if (status) status.textContent = body.is_default ? '— shipped default' : '— custom (edited)';
          modal.hidden = false;
        } catch (err) {
          announce(`Could not load the subject prompt: ${err.message}`);
        }
      });
    }
  };

  // ─── §9 Create-view extras ───────────────────────────────────────────────

  const updateFieldCompletion = () => {
    const container = $('analysis-fields');
    const meter = $('field-completion');
    if (!container || !meter) return;
    const rows = container.querySelectorAll('.field-row');
    if (rows.length === 0) { meter.hidden = true; return; }
    let filled = 0;
    rows.forEach((row) => {
      const controls = row.querySelectorAll('textarea, input[type="text"], select');
      const hasText = Array.from(controls).some((c) => String(c.value || '').trim().length > 0);
      const hasChip = row.querySelector('[aria-pressed="true"]');
      if (hasText || hasChip) filled += 1;
    });
    meter.hidden = false;
    $('field-completion-text').textContent = `${filled} / ${rows.length}`;
    const pct = rows.length ? Math.round((filled / rows.length) * 100) : 0;
    const bar = $('field-completion-bar');
    if (bar) bar.style.width = `${pct}%`;
  };

  const bindCreateExtras = () => {
    const fields = $('analysis-fields');
    if (fields) {
      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(() => { scheduled = false; updateFieldCompletion(); });
      };
      fields.addEventListener('input', schedule);
      fields.addEventListener('change', schedule);
      fields.addEventListener('click', schedule); // chip toggles
      new MutationObserver(schedule).observe(fields, { childList: true, subtree: true });
    }

    const providerSel = $('provider-selector');
    if (providerSel) providerSel.addEventListener('change', updateCreateWarnings);

    // Announce milestone state changes (AX5) without touching app.js internals.
    const watchAnnounce = (id, message) => {
      const el = $(id);
      if (!el) return;
      new MutationObserver(() => {
        if (!el.hidden && currentView === 'create') announce(message);
      }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    };
    watchAnnounce('step-result', 'Prompt generated. Copy it, or refine in chat.');
    watchAnnounce('step-anima-result', 'Anima prompt generated. Copy both parts, or refine in chat.');
    watchAnnounce('analysis-editor', 'Analysis complete. Edit any field, then generate.');
  };

  // ─── Init ────────────────────────────────────────────────────────────────

  const initShell = () => {
    bindTablistKeyboard($('nav-tablist'), '.nav-link');
    bindModalTraps();
    bindLibrary();
    bindSettings();
    bindCreateExtras();

    fetchProviders();
    window.setInterval(fetchProviders, 60000);
    window.addEventListener('focus', fetchProviders);

    if (!location.hash) {
      history.replaceState(null, '', '#/create');
    }
    window.addEventListener('hashchange', onRoute);
    onRoute();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShell);
  } else {
    initShell();
  }
})();
