/**
 * Image-to-Prompt Frontend Application
 *
 * Orchestrates a 4-step wizard:
 *   1. Choose a preset (with CRUD + export/import)
 *   2. Upload image
 *   3. Analyze (Stage 1) + edit JSON + add directives
 *   4. Generate prompt (Stage 2) + display result
 */

(() => {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────
  const state = {
    presets: [],
    selectedPresetId: null,
    fieldPalette: {},
    currentFile: null,
    currentAnalysis: null,
    currentRunId: null,           // ADR 0006 — captured from /api/analyze response
    lastAnalysisContext: null,    // ADR 0006 — { run_id, preset_id, preset_name, colors } for save modal
    finalPrompt: null,
    isAnalyzing: false,
    isGenerating: false,
    isPopulatingSubject: false,  // ADR 0004 — "Populate with AI" in flight
    isPopulatingCameraAngle: false,  // ADR 0008 — camera-angle "Populate with AI" in flight
    isPopulatingActions: false,    // ADR 0018 — actions "Populate with AI" in flight
    isPopulatingMood: false,       // ADR 0018 — mood "Populate with AI" in flight
    isPopulatingLighting: false,   // ADR 0018 — lighting "Populate with AI" in flight
    isPopulatingTexture: false,    // Slice 1 — texture "Populate with AI" in flight
    editingPresetId: null,  // null when creating new
    selectedFieldSources: {},  // { [fieldName]: 'analysis' | 'preset' } (ADR 0002)
    palettes: [],               // ADR 0006 — saved color palettes
    selectedPaletteId: null,    // ADR 0006 — null = no override, auto-analyze
    paletteManagerSearch: '',   // ADR 0006 — manager modal filter text
    paletteManagerSort: 'newest', // ADR 0006 — 'newest' | 'oldest'
    editingPaletteId: null,     // ADR 0013 — id of palette being edited (null when closed)
    editingPaletteIsNew: false, // ADR 0013 — true when the edit modal is in "new palette" mode
    editingPaletteBuffer: null, // ADR 0013 — { name, colors } being edited (decoupled from state.palettes)
    directives: [],             // ADR 0009 — saved directives
    selectedDirectiveId: null,  // ADR 0009 — id of currently-selected directive in the apply <select>
    directiveManagerSearch: '', // ADR 0009 — manager modal search text
    directiveManagerSort: 'newest', // ADR 0009 — 'newest' | 'oldest' | 'most-used' | 'name'
    directiveTagFilter: [],     // ADR 0009 — array of tag strings; AND-filter
    editingDirectiveId: null,   // ADR 0009 — id of the directive being edited (null when closed)
    chatSessions: [],           // ADR 0011 — all chat sessions, newest first
    chatSessionId: null,        // ADR 0011 — id of the session anchored to the current generated prompt
    chatIsSending: false,       // ADR 0011 — true while waiting on /api/chat/sessions/:id/messages
    selectedAspectRatio: '',    // ADR 0019 Issue #15 — '' means "auto / no preference"
    // Slice 2.1 — ADR 0021 — the model-fork. Pre-Generate model picker
    // chooses which contract runs (Z-Image Turbo or Anima). Anima mode
    // exposes a variant selector (Base / Aesthetic / Turbo). Both fields
    // are persisted (localStorage) and mirrored in the URL (?model=...&variant=...).
    model: 'zimage_turbo',       // 'zimage_turbo' | 'anima'
    animaVariant: 'base',        // 'base' | 'aesthetic' | 'turbo' (only meaningful when model === 'anima')
    animaResult: null,           // Slice 2.3 — { positive, negative, variant, model } | null. Parallel to state.finalPrompt but for the Anima contract.
    // Slice 3.3 — ADR 0022 — LLM model picker (Kilo Code gateway model id).
    // The id is a string the Kilo Code API accepts verbatim
    // (e.g. 'minimax/minimax-m3'). Persisted (localStorage) and
    // mirrored in the URL (?llm=...). Forwarded to the server on
    // /api/analyze, /api/generate-prompt, /api/anima, and chat
    // messages; the server then routes the call through the
    // configured ALLOWED_LLM_MODELS whitelist (server.js).
    llmModel: 'minimax/minimax-m3',
    // Slice 4 — ADR 0023 — Provider picker (Kilo Code / MiniMax / Alibaba).
    // Sibling to llmModel. Determines which adapter the server uses
    // (callKiloAdapter / callMiniMaxAdapter / callAlibabaAdapter).
    // Persisted (localStorage) and mirrored in the URL (?provider=...).
    // Forwarded alongside llmModel on all 4 endpoints. Defaults to
    // 'kilo_code' so first-load users land on the Slice 3 ship state.
    provider: 'kilo_code'
  };

  // ADR 0019 Issue #15 — count words in the current prompt and toggle the
  // 1024-token reminder banner. Mirrors the server-side
  // STAGE2_HARD_MAX_WORDS = 750 (guide §3). Pure / no side effects.
  const TOKEN_REMINDER_THRESHOLD = 750;
  const updateTokenReminderBanner = () => {
    if (!dom.tokenReminderBanner) return;
    const prompt = state.finalPrompt || '';
    const words = prompt.trim().split(/\s+/).filter((w) => w.length > 0).length;
    if (words >= TOKEN_REMINDER_THRESHOLD) {
      dom.tokenReminderBanner.textContent =
        `Current prompt is ${words} words — at or past the 1024-token / 750-word ceiling. Z-Image will silently truncate above that; consider trimming adjectives in chat before generating.`;
      dom.tokenReminderBanner.hidden = false;
    } else {
      dom.tokenReminderBanner.hidden = true;
    }
  };

  // ─── DOM cache ─────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const dom = {
    presetSelect: $('preset-select'),
    presetNewBtn: $('preset-new-btn'),
    presetEditBtn: $('preset-edit-btn'),
    presetExportBtn: $('preset-export-btn'),
    presetImportBtn: $('preset-import-btn'),
    presetImportInput: $('preset-import-input'),
    presetDescription: $('preset-description'),

    dropzone: $('dropzone'),
    fileInput: $('file-input'),
    previewContainer: $('preview-container'),
    previewImage: $('preview-image'),
    removeImageBtn: $('remove-image-btn'),

    analyzeBtn: $('analyze-btn'),
    analysisEditor: $('analysis-editor'),
    analysisFields: $('analysis-fields'),
    directivesInput: $('directives-input'),
    directivesCount: $('directives-count'),
    reAnalyzeBtn: $('re-analyze-btn'),
    editStage2PromptBtn: $('edit-stage2-prompt-btn'),
    generatePromptBtn: $('generate-prompt-btn'),
    aspectRatioSelect: $('aspect-ratio-select'),
    modelSelector: $('model-selector'),  // Slice 2.1 — ADR 0021 — pre-Generate model picker
    llmModelSelector: $('llm-model-selector'),  // Slice 3.3 — ADR 0022 — Kilo Code LLM model picker
    providerSelector: $('provider-selector'),    // Slice 4 — ADR 0023 — Provider picker

    resultSection: $('step-result'),
    resultPrompt: $('result-prompt'),
    resultMetaInfo: $('result-meta-info'),
    resultStrictWarn: $('result-strict-warn'),
    tokenReminderBanner: $('token-reminder-banner'),
    copyBtn: $('copy-btn'),
    regenerateBtn: $('regenerate-btn'),
    // Slice 2.3 — ADR 0021 — Anima result panel
    animaResultSection: $('step-anima-result'),
    animaResultPositive: $('anima-result-positive'),
    animaResultNegative: $('anima-result-negative'),
    animaResultMetaInfo: $('anima-result-meta-info'),
    animaVariantSelector: $('anima-variant-selector'),
    animaCopyBtn: $('anima-copy-btn'),
    animaRegenerateBtn: $('anima-regenerate-btn'),

    errorToast: $('error-toast'),
    errorMessage: $('error-message'),
    errorDismiss: $('error-dismiss-btn'),

    presetModal: $('preset-modal'),
    presetModalTitle: $('preset-modal-title'),
    presetModalClose: $('preset-modal-close'),
    presetModalCancel: $('preset-modal-cancel'),
    presetModalDelete: $('preset-modal-delete'),
    presetModalSave: $('preset-modal-save'),
    presetForm: $('preset-form'),
    presetNameInput: $('preset-name-input'),
    presetStage1Input: $('preset-stage1-input'),
    presetStage2Input: $('preset-stage2-input'),
    presetFieldsGrid: $('preset-fields-grid'),

    subjectPromptModal: $('subject-prompt-modal'),
    subjectPromptModalClose: $('subject-prompt-modal-close'),
    subjectPromptCancel: $('subject-prompt-cancel'),
    subjectPromptSave: $('subject-prompt-save'),
    subjectPromptReset: $('subject-prompt-reset'),
    subjectPromptForm: $('subject-prompt-form'),
    subjectPromptInput: $('subject-prompt-input'),
    subjectPromptCount: $('subject-prompt-count'),
    subjectPromptStatus: $('subject-prompt-status'),

    stage2PromptModal: $('stage2-prompt-modal'),
    stage2PromptModalClose: $('stage2-prompt-modal-close'),
    stage2PromptCancel: $('stage2-prompt-cancel'),
    stage2PromptSave: $('stage2-prompt-save'),
    stage2PromptReset: $('stage2-prompt-reset'),
    stage2PromptUseDefault: $('stage2-prompt-use-default'),
    stage2PromptForm: $('stage2-prompt-form'),
    stage2PromptInput: $('stage2-prompt-input'),
    stage2PromptCount: $('stage2-prompt-count'),
    stage2PromptStatus: $('stage2-prompt-status'),
    stage2PromptPresetName: $('stage2-prompt-preset-name'),

    paletteSelect: $('palette-select'),
    paletteManageBtn: $('palette-manage-btn'),
    palettePickerHint: $('palette-picker-hint'),
    palettePickerEditBtn: $('palette-picker-edit-btn'),
    savePaletteBtn: $('save-palette-btn'),
    paletteApplySelect: $('palette-apply-select'),
    paletteApplyBtn: $('palette-apply-btn'),

    savePaletteModal: $('save-palette-modal'),
    savePaletteModalClose: $('save-palette-modal-close'),
    savePaletteCancel: $('save-palette-cancel'),
    savePaletteSave: $('save-palette-save'),
    savePaletteForm: $('save-palette-form'),
    savePaletteNameInput: $('save-palette-name-input'),
    savePaletteCount: $('save-palette-count'),
    savePaletteSource: $('save-palette-source'),

    paletteManagerModal: $('palette-manager-modal'),
    paletteManagerModalClose: $('palette-manager-modal-close'),
    paletteManagerCancel: $('palette-manager-cancel'),
    paletteManagerNewBtn: $('palette-manager-new-btn'),
    paletteManagerSearch: $('palette-manager-search'),
    paletteManagerList: $('palette-manager-list'),
    paletteManagerStatus: $('palette-manager-status'),

    // ADR 0013 — edit palette modal
    editPaletteModal: $('edit-palette-modal'),
    editPaletteModalClose: $('edit-palette-modal-close'),
    editPaletteModalTitle: $('edit-palette-modal-title'),
    editPaletteCancel: $('edit-palette-cancel'),
    editPaletteDelete: $('edit-palette-delete'),
    editPaletteSave: $('edit-palette-save'),
    editPaletteForm: $('edit-palette-form'),
    editPaletteSourceRow: $('edit-palette-source-row'),
    editPaletteSource: $('edit-palette-source'),
    editPaletteNameInput: $('edit-palette-name-input'),
    editPaletteNameCount: $('edit-palette-name-count'),
    editPaletteNameError: $('edit-palette-name-error'),
    editPalettePreview: $('edit-palette-preview'),
    editPaletteDistribution: $('edit-palette-distribution'),
    editPaletteDistributionSum: $('edit-palette-distribution-sum'),
    editPaletteAccentMax: $('edit-palette-accent-max'),
    editPaletteStrength: $('edit-palette-strength'),
    editPaletteColorsList: $('edit-palette-colors-list'),
    editPaletteAddPicker: $('edit-palette-add-picker'),
    editPaletteAddHex: $('edit-palette-add-hex'),
    editPaletteAddName: $('edit-palette-add-name'),
    editPaletteAddBtn: $('edit-palette-add-btn'),
    editPaletteAddError: $('edit-palette-add-error'),
    paletteHistoryList: $('palette-history-list'),
    editPaletteDistributionDetails: $('edit-palette-distribution-details'),
    editPaletteDistributionDashboard: $('edit-palette-distribution-dashboard'),
    editPaletteDistributionEmpty: $('edit-palette-distribution-empty'),
    editPaletteDistributionContent: $('edit-palette-distribution-content'),
    editPaletteDistributionRecordedAt: $('edit-palette-distribution-recorded-at'),
    editPaletteDistributionMentions: $('edit-palette-distribution-mentions'),
    editPaletteDistributionTbody: $('edit-palette-distribution-tbody'),

    // ADR 0009 — saved directives
    directivesSelect: $('directives-select'),
    directivesApplyBtn: $('directives-apply-btn'),
    directivesSaveBtn: $('directives-save-btn'),
    directivesManageBtn: $('directives-manage-btn'),

    saveDirectiveModal: $('save-directive-modal'),
    saveDirectiveModalClose: $('save-directive-modal-close'),
    saveDirectiveCancel: $('save-directive-cancel'),
    saveDirectiveSave: $('save-directive-save'),
    saveDirectiveForm: $('save-directive-form'),
    saveDirectiveNameInput: $('save-directive-name-input'),
    saveDirectiveCount: $('save-directive-count'),
    saveDirectiveTagsInput: $('save-directive-tags-input'),
    saveDirectiveContentPreview: $('save-directive-content-preview'),

    directivesManagerModal: $('directives-manager-modal'),
    directivesManagerModalClose: $('directives-manager-modal-close'),
    directivesManagerCancel: $('directives-manager-cancel'),
    directivesManagerSearch: $('directives-manager-search'),
    directivesManagerList: $('directives-manager-list'),
    directivesManagerStatus: $('directives-manager-status'),
    directivesTagFilter: $('directives-tag-filter'),
    directivesImportBtn: $('directives-import-btn'),
    directivesImportInput: $('directives-import-input'),
    directivesExportBtn: $('directives-export-btn'),

    editDirectiveModal: $('edit-directive-modal'),
    editDirectiveModalClose: $('edit-directive-modal-close'),
    editDirectiveCancel: $('edit-directive-cancel'),
    editDirectiveDelete: $('edit-directive-delete'),
    editDirectiveSave: $('edit-directive-save'),
    editDirectiveForm: $('edit-directive-form'),
    editDirectiveNameInput: $('edit-directive-name-input'),
    editDirectiveNameCount: $('edit-directive-name-count'),
    editDirectiveTagsInput: $('edit-directive-tags-input'),
    editDirectiveContentInput: $('edit-directive-content-input'),
    editDirectiveContentCount: $('edit-directive-content-count'),
    directiveHistoryList: $('directive-history-list'),

    // ADR 0011 — chat console
    stepChat: $('step-chat'),
    chatSessionSelect: $('chat-session-select'),
    chatSessionDeleteBtn: $('chat-session-delete-btn'),
    chatSessionStatus: $('chat-session-status'),
    chatMessages: $('chat-messages'),
    chatForm: $('chat-form'),
    chatInput: $('chat-input'),
    chatInputCount: $('chat-input-count'),
    chatSendBtn: $('chat-send-btn'),
    chatFormStatus: $('chat-form-status'),

    stepPreset: $('step-preset'),
    stepUpload: $('step-upload'),
    stepAnalyze: $('step-analyze')
  };

  // ─── Utilities ─────────────────────────────────────────────────────────

  const showError = (msg, opts = {}) => {
    dom.errorMessage.textContent = msg;
    dom.errorToast.classList.toggle('is-warning', opts.severity === 'warning');
    dom.errorToast.hidden = false;
    setTimeout(() => { dom.errorToast.hidden = true; }, 6000);
  };

  const hideError = () => { dom.errorToast.hidden = true; };

  const apiCall = async (url, options = {}) => {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data.data;
  };

  const setStepActive = (step) => {
    [dom.stepPreset, dom.stepUpload, dom.stepAnalyze].forEach((el) => el.classList.remove('is-active'));
    if (step) step.classList.add('is-active');
  };

  const updateButtons = () => {
    dom.presetEditBtn.disabled = !state.selectedPresetId;
    dom.presetExportBtn.disabled = !state.selectedPresetId;
    dom.analyzeBtn.disabled = !state.selectedPresetId || !state.currentFile || state.isAnalyzing;
    dom.generatePromptBtn.disabled = !state.currentAnalysis || state.isGenerating;
    dom.editStage2PromptBtn.disabled = !state.selectedPresetId;
  };

  // ─── Preset picker ─────────────────────────────────────────────────────

  const loadPresets = async () => {
    try {
      state.presets = await apiCall('/api/presets');
      renderPresetDropdown();
    } catch (e) {
      showError(`Failed to load presets: ${e.message}`);
    }
  };

  const renderPresetDropdown = () => {
    const current = state.selectedPresetId;
    dom.presetSelect.innerHTML = '<option value="">— Select a preset —</option>';
    state.presets.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      dom.presetSelect.appendChild(opt);
    });
    dom.presetSelect.value = current || '';
    updatePresetDescription();
  };

  const updatePresetDescription = () => {
    const preset = state.presets.find((p) => p.id === state.selectedPresetId);
    if (!preset) {
      dom.presetDescription.hidden = true;
      return;
    }
    dom.presetDescription.innerHTML = `
      <strong>${escapeHtml(preset.name)}</strong>
      <div>Fields: ${preset.stage1_fields.length} (${preset.stage1_fields.join(', ')})</div>
    `;
    dom.presetDescription.hidden = false;
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  dom.presetSelect.addEventListener('change', (e) => {
    state.selectedPresetId = e.target.value || null;
    // Reset downstream state when preset changes
    state.currentAnalysis = null;
    state.currentRunId = null;
    state.lastAnalysisContext = null;
    state.selectedFieldSources = {};
    dom.analysisEditor.hidden = true;
    dom.resultSection.hidden = true;
    resetChatConsole();
    if (dom.savePaletteBtn) {
      dom.savePaletteBtn.hidden = true;
      dom.savePaletteBtn.disabled = true;
    }
    updatePresetDescription();
    updateButtons();
  });

  // ─── Preset CRUD modal ─────────────────────────────────────────────────

  const FIELD_PALETTE_FALLBACK = {
    subject: 'Subject', style: 'Style', mood: 'Mood', colors: 'Colors',
    lighting: 'Lighting', composition: 'Composition', era: 'Era',
    camera_angle: 'Camera angle', texture: 'Texture',
    artistic_medium: 'Artistic medium', depth_of_field: 'Depth of field',
    contrast: 'Contrast'
  };

  // ADR 0018 — Curated preset taxonomies for mood and lighting. These are
  // a static, code-defined library of one-click descriptors that
  // complement the AI "Populate with AI" button. They are intentionally
  // NOT persisted (unlike saved directives, ADR 0009) because they are a
  // canonical taxonomy shared by every user on every job. Each category
  // is rendered as a labelled chip-group beneath the Populate-with-AI
  // button; clicking a chip fills the field's input/textarea with the
  // chip's label. The user is free to edit the value after clicking —
  // the chip is a quick starting point, not a lock.
  const MOOD_PRESETS = [
    { category: 'Positive',     items: ['joyful', 'happy', 'playful', 'hopeful', 'serene', 'content', 'romantic', 'triumphant', 'whimsical'] },
    { category: 'Reflective',   items: ['introspective', 'contemplative', 'melancholic', 'wistful', 'nostalgic', 'somber', 'lonely', 'pensive', 'brooding'] },
    { category: 'Intense',      items: ['dramatic', 'tense', 'ominous', 'mysterious', 'anxious', 'urgent', 'fierce', 'defiant', 'restless'] },
    { category: 'Atmospheric',  items: ['dreamlike', 'ethereal', 'surreal', 'mystical', 'magical', 'transcendent', 'cinematic'] },
    { category: 'Still',        items: ['quiet', 'peaceful', 'calm', 'meditative', 'intimate', 'hushed', 'restrained'] }
  ];

  const LIGHTING_PRESETS = [
    { category: 'Natural',      items: ['golden hour', 'blue hour', 'midday sun', 'overcast', 'dappled', 'twilight', 'dawn', 'harsh sun'] },
    { category: 'Directional',  items: ['backlit', 'side-lit', 'top-down', 'underlit', 'rim-lit', 'edge-lit', 'silhouette'] },
    { category: 'Quality',      items: ['soft diffused', 'hard shadows', 'harsh contrast', 'low-contrast', 'flat', 'specular'] },
    { category: 'Stylized',     items: ['chiaroscuro', 'low-key', 'high-key', 'neon', 'candlelight', 'fireplace', 'streetlight', 'fluorescent'] },
    { category: 'Studio',       items: ['studio softbox', 'three-point', 'ring light', 'Rembrandt', 'butterfly', 'split'] }
  ];

  const openPresetModal = (preset = null) => {
    state.editingPresetId = preset ? preset.id : null;
    dom.presetModalTitle.textContent = preset ? 'Edit preset' : 'New preset';
    dom.presetModalDelete.hidden = !preset;

    dom.presetNameInput.value = preset?.name || '';
    dom.presetStage1Input.value = preset?.stage1_system_prompt || '';
    dom.presetStage2Input.value = preset?.stage2_system_prompt || '';
    dom.presetFieldsGrid.innerHTML = '';

    const fieldLabels = Object.keys(state.fieldPalette).length > 0
      ? Object.fromEntries(Object.entries(state.fieldPalette).map(([k, v]) => [k, v.label]))
      : FIELD_PALETTE_FALLBACK;

    const selectedFields = new Set(preset?.stage1_fields || []);
    Object.entries(fieldLabels).forEach(([fieldName, label]) => {
      const labelEl = document.createElement('label');
      labelEl.className = 'field-checkbox' + (selectedFields.has(fieldName) ? ' is-checked' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = fieldName;
      cb.checked = selectedFields.has(fieldName);
      cb.addEventListener('change', () => {
        labelEl.classList.toggle('is-checked', cb.checked);
      });
      labelEl.appendChild(cb);
      labelEl.appendChild(document.createTextNode(label));
      dom.presetFieldsGrid.appendChild(labelEl);
    });

    dom.presetModal.hidden = false;
  };

  const closePresetModal = () => {
    dom.presetModal.hidden = true;
    state.editingPresetId = null;
  };

  const savePresetFromModal = async () => {
    const name = dom.presetNameInput.value.trim();
    const stage1 = dom.presetStage1Input.value;
    const stage2 = dom.presetStage2Input.value;
    const fields = Array.from(dom.presetFieldsGrid.querySelectorAll('input:checked')).map((cb) => cb.value);

    if (!name) return showError('Preset name is required.');
    if (fields.length === 0) return showError('Select at least one field.');
    if (!stage1.trim() || !stage2.trim()) return showError('Both system prompts are required.');

    const body = {
      name,
      stage1_system_prompt: stage1,
      stage2_system_prompt: stage2,
      stage1_fields: fields
    };

    try {
      if (state.editingPresetId) {
        await apiCall(`/api/presets/${state.editingPresetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        const created = await apiCall('/api/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        state.selectedPresetId = created.id;
      }
      await loadPresets();
      closePresetModal();
    } catch (e) {
      showError(`Save failed: ${e.message}`);
    }
  };

  const deleteCurrentPreset = async () => {
    if (!state.editingPresetId) return;
    if (!confirm('Delete this preset? This cannot be undone.')) return;
    try {
      await apiCall(`/api/presets/${state.editingPresetId}`, { method: 'DELETE' });
      if (state.selectedPresetId === state.editingPresetId) {
        state.selectedPresetId = null;
      }
      await loadPresets();
      closePresetModal();
    } catch (e) {
      showError(`Delete failed: ${e.message}`);
    }
  };

  dom.presetNewBtn.addEventListener('click', () => openPresetModal(null));
  dom.presetEditBtn.addEventListener('click', () => {
    const preset = state.presets.find((p) => p.id === state.selectedPresetId);
    if (preset) openPresetModal(preset);
  });
  dom.presetModalClose.addEventListener('click', closePresetModal);
  dom.presetModalCancel.addEventListener('click', closePresetModal);
  dom.presetModalDelete.addEventListener('click', deleteCurrentPreset);
  dom.presetForm.addEventListener('submit', (e) => { e.preventDefault(); savePresetFromModal(); });

  // ─── Export / Import ───────────────────────────────────────────────────

  dom.presetExportBtn.addEventListener('click', () => {
    if (!state.selectedPresetId) return;
    window.location.href = `/api/presets/export/${state.selectedPresetId}`;
  });

  dom.presetImportBtn.addEventListener('click', () => dom.presetImportInput.click());

  dom.presetImportInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      const result = await apiCall('/api/presets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      });
      showError(`Imported ${result.imported_count} preset(s).`);
      await loadPresets();
    } catch (err) {
      showError(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  });

  // ─── File upload (Step 2) ──────────────────────────────────────────────

  const isValidFile = (file) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024;
    if (!allowedTypes.includes(file.type)) return 'Invalid file type. JPG, PNG, or WebP only.';
    if (file.size > maxSize) return 'File too large. Maximum 10MB.';
    return null;
  };

  const handleFile = (file) => {
    const err = isValidFile(file);
    if (err) return showError(err);
    state.currentFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      dom.previewImage.src = e.target.result;
      dom.previewImage.alt = file.name;
      dom.previewContainer.hidden = false;
      dom.dropzone.querySelector('.dropzone-content').hidden = true;
      updateButtons();
    };
    reader.onerror = () => showError('Failed to read image file.');
    reader.readAsDataURL(file);
  };

  const clearFile = () => {
    state.currentFile = null;
    dom.fileInput.value = '';
    dom.previewImage.src = '';
    dom.previewContainer.hidden = true;
    dom.dropzone.querySelector('.dropzone-content').hidden = false;
    state.currentAnalysis = null;
    state.currentRunId = null;
    state.lastAnalysisContext = null;
    state.selectedFieldSources = {};
    dom.analysisEditor.hidden = true;
    dom.resultSection.hidden = true;
    resetChatConsole();
    if (dom.savePaletteBtn) {
      dom.savePaletteBtn.hidden = true;
      dom.savePaletteBtn.disabled = true;
    }
    updateButtons();
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => {
    dom.dropzone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); });
  });
  ['dragenter', 'dragover'].forEach((ev) => {
    dom.dropzone.addEventListener(ev, () => dom.dropzone.classList.add('is-dragover'));
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dom.dropzone.addEventListener(ev, () => dom.dropzone.classList.remove('is-dragover'));
  });
  dom.dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files?.length > 0) handleFile(files[0]);
  });
  dom.dropzone.addEventListener('click', (e) => {
    if (e.target === dom.removeImageBtn) return;
    dom.fileInput.click();
  });
  dom.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.fileInput.click(); }
  });
  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files?.length > 0) handleFile(e.target.files[0]);
  });
  dom.removeImageBtn.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); });

  // ─── Analyze (Step 3) ─────────────────────────────────────────────────

  /**
   * ADR 0018 — Render a curated preset chip row for a single field.
   * Builds a `<div class="preset-chips">` containing one chip-group
   * per category in the supplied taxonomy. Each chip-group has a small
   * category label followed by a wrap-flow row of clickable chips.
   *
   * Click handler: calls `applyPresetToField(fieldName, chip.label)`,
   * which sets the field's DOM value (textarea or input[type="text"],
   * whichever was rendered) and updates `state.currentAnalysis`.
   * No persistence; no "selected" state; chips are a one-click
   * starting point.
   */
  const renderPresetChips = (fieldName, taxonomy) => {
    const wrap = document.createElement('div');
    wrap.className = 'preset-chips';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', `${fieldName} preset chips`);

    taxonomy.forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'preset-chip-group';
      groupEl.setAttribute('role', 'group');
      groupEl.setAttribute('aria-label', `${group.category} ${fieldName} presets`);

      const label = document.createElement('span');
      label.className = 'preset-chip-label';
      label.textContent = group.category;
      groupEl.appendChild(label);

      const chipsRow = document.createElement('div');
      chipsRow.className = 'preset-chip-row';

      group.items.forEach((item) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'preset-chip';
        chip.textContent = item;
        chip.dataset.presetField = fieldName;
        chip.dataset.presetValue = item;
        chip.setAttribute('aria-label', `Set ${fieldName} to "${item}"`);
        chip.addEventListener('click', () => applyPresetToField(fieldName, item));
        chipsRow.appendChild(chip);
      });

      groupEl.appendChild(chipsRow);
      wrap.appendChild(groupEl);
    });

    return wrap;
  };

  const renderAnalysisEditor = (analysis) => {
    dom.analysisFields.innerHTML = '';
    const preset = state.presets.find((p) => p.id === state.selectedPresetId);
    if (!preset) return;

    state.selectedFieldSources = {};

    preset.stage1_fields.forEach((fieldName) => {
      const def = state.fieldPalette[fieldName] || FIELD_PALETTE_FALLBACK[fieldName];
      const labelText = def?.label || fieldName;
      const analysisValue = analysis[fieldName];
      const presetDefault = preset.field_defaults?.[fieldName];
      const hasToggle = typeof presetDefault === 'string' && (def?.input === 'text' || def?.input === 'textarea');

      if (hasToggle) state.selectedFieldSources[fieldName] = 'analysis';

      const row = document.createElement('div');
      row.className = 'field-row';
      row.dataset.field = fieldName;

      const labelRow = document.createElement('div');
      labelRow.className = 'field-row__label-row';

      const label = document.createElement('label');
      label.className = 'label';
      label.textContent = labelText;
      labelRow.appendChild(label);

      if (hasToggle) {
        const toggle = document.createElement('div');
        toggle.className = 'source-toggle';
        toggle.setAttribute('role', 'group');
        toggle.setAttribute('aria-label', `${labelText} value source`);

        const makeBtn = (source, text) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'source-btn' + (source === 'analysis' ? ' is-active' : '');
          btn.dataset.source = source;
          btn.textContent = text;
          btn.setAttribute('aria-pressed', source === 'analysis' ? 'true' : 'false');
          btn.addEventListener('click', () => {
            state.selectedFieldSources[fieldName] = source;
            toggle.querySelectorAll('.source-btn').forEach((b) => {
              const active = b.dataset.source === source;
              b.classList.toggle('is-active', active);
              b.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            input.value = source === 'analysis' ? String(analysisValue ?? '') : presetDefault;
          });
          return btn;
        };

        toggle.appendChild(makeBtn('analysis', 'Analysis'));
        toggle.appendChild(makeBtn('preset', 'Preset'));
        labelRow.appendChild(toggle);
      }

      row.appendChild(labelRow);

      let input;
      // Bug fix: respect the FIELD_PALETTE `input` type so text fields render
      // as <input type="text"> and textarea fields render as <textarea>. The
      // previous code branched on `typeof analysisValue === 'string'`, which
      // caused every string-valued field (including `lighting`, `style`,
      // `camera_angle`, etc.) to render as a <textarea> regardless of palette
      // — that silently broke the AI Populate-with-AI buttons for those
      // fields, which queried `input[data-field="<field>"]` and found
      // nothing. The Populate-with-AI handlers and chip click handler now
      // both use tag-qualified selectors (input[data-field=…] OR
      // textarea[data-field=…]) so the dispatch is robust; the render fix
      // here restores the correct visual presentation (1-line input vs
      // multi-line textarea) per FIELD_PALETTE.
      const paletteInputType = def?.input;
      if (fieldName === 'colors' && Array.isArray(analysisValue)) {
        row.appendChild(renderColorsInput(analysisValue));
      } else if (paletteInputType === 'textarea') {
        input = document.createElement('textarea');
        input.className = 'textarea';
        const rowsByField = {
          subject: 5,
          subject_orientation: 2,
          actions: 2,
          mood: 2,
          composition: 2,
          texture: 2
        };
        input.rows = rowsByField[fieldName] ?? 1;
        input.value = typeof analysisValue === 'string' ? analysisValue : '';
        input.dataset.field = fieldName;
        row.appendChild(input);
      } else {
        // text-typed fields (lighting, style, camera_angle, etc.) and any
        // field where the palette is silent on the input type.
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-input';
        input.value = analysisValue == null ? '' : String(analysisValue);
        input.dataset.field = fieldName;
        row.appendChild(input);
      }

      // ADR 0004 — "Populate with AI" button directly beneath the subject
      // input field. Triggers a factual-only re-analysis via /api/subject
      // and updates the subject textarea value in-place. The button is only
      // rendered for the subject field; other fields are unaffected.
      //
      // ADR 0005 — "Edit prompt" button sits next to it. Opens a modal
      // showing the active subject-extraction system prompt so the user
      // can override it. The prompt lives at data/subject_prompt.json
      // and is read fresh on every Populate click.
      if (fieldName === 'subject') {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'field-row__action';

        const populateBtn = document.createElement('button');
        populateBtn.type = 'button';
        populateBtn.className = 'btn-secondary btn-populate-subject';
        populateBtn.disabled = !state.currentFile || state.isPopulatingSubject;
        populateBtn.setAttribute('aria-label', 'Populate subject with AI factual re-analysis');

        const btnText = document.createElement('span');
        btnText.className = 'btn-text';
        btnText.textContent = 'Populate with AI';
        populateBtn.appendChild(btnText);

        const btnSpinner = document.createElement('span');
        btnSpinner.className = 'btn-spinner';
        btnSpinner.hidden = true;
        btnSpinner.setAttribute('aria-hidden', 'true');
        populateBtn.appendChild(btnSpinner);

        populateBtn.addEventListener('click', () => populateSubjectWithAI(populateBtn));
        actionWrap.appendChild(populateBtn);

        const editPromptBtn = document.createElement('button');
        editPromptBtn.type = 'button';
        editPromptBtn.className = 'btn-secondary btn-edit-subject-prompt';
        editPromptBtn.textContent = 'Edit prompt';
        editPromptBtn.setAttribute('aria-label', 'Edit the system prompt used for Populate with AI');
        editPromptBtn.addEventListener('click', () => openSubjectPromptModal());
        actionWrap.appendChild(editPromptBtn);

        row.appendChild(actionWrap);
      }

      // ADR 0008 — "Populate with AI" button directly beneath the
      // camera_angle input field. Triggers a focused, camera-only
      // re-analysis via /api/camera-angle and updates the camera_angle
      // input value in-place. The button is only rendered for the
      // camera_angle field; other fields are unaffected. Mirrors the
      // ADR 0004 subject button — no "Edit prompt" companion because the
      // camera-angle prompt is not user-editable in this iteration
      // (ADR 0008 §5, out of scope).
      if (fieldName === 'camera_angle') {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'field-row__action';

        const populateBtn = document.createElement('button');
        populateBtn.type = 'button';
        populateBtn.className = 'btn-secondary btn-populate-camera-angle';
        populateBtn.disabled = !state.currentFile || state.isPopulatingCameraAngle;
        populateBtn.setAttribute('aria-label', 'Populate camera angle with AI camera-only re-analysis');

        const btnText = document.createElement('span');
        btnText.className = 'btn-text';
        btnText.textContent = 'Populate with AI';
        populateBtn.appendChild(btnText);

        const btnSpinner = document.createElement('span');
        btnSpinner.className = 'btn-spinner';
        btnSpinner.hidden = true;
        btnSpinner.setAttribute('aria-hidden', 'true');
        populateBtn.appendChild(btnSpinner);

        populateBtn.addEventListener('click', () => populateCameraAngleWithAI(populateBtn));
        actionWrap.appendChild(populateBtn);

        const hint = document.createElement('span');
        hint.className = 'field-action-hint';
        hint.textContent = 'Re-analyses the image with a focused camera-only prompt.';
        actionWrap.appendChild(hint);

        row.appendChild(actionWrap);
      }

      // ADR 0018 — "Populate with AI" button directly beneath the actions
      // textarea. Triggers a focused, actions-only re-analysis via
      // /api/actions and updates the actions textarea value in-place.
      // Mirrors the camera_angle button (ADR 0008) — no preset chips
      // because actions are too image-specific for a curated taxonomy
      // (ADR 0018 §5). The button is only rendered for the actions
      // field; other fields are unaffected.
      if (fieldName === 'actions') {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'field-row__action';

        const populateBtn = document.createElement('button');
        populateBtn.type = 'button';
        populateBtn.className = 'btn-secondary btn-populate-actions';
        populateBtn.disabled = !state.currentFile || state.isPopulatingActions;
        populateBtn.setAttribute('aria-label', 'Populate actions with AI actions-only re-analysis');

        const btnText = document.createElement('span');
        btnText.className = 'btn-text';
        btnText.textContent = 'Populate with AI';
        populateBtn.appendChild(btnText);

        const btnSpinner = document.createElement('span');
        btnSpinner.className = 'btn-spinner';
        btnSpinner.hidden = true;
        btnSpinner.setAttribute('aria-hidden', 'true');
        populateBtn.appendChild(btnSpinner);

        populateBtn.addEventListener('click', () => populateActionsWithAI(populateBtn));
        actionWrap.appendChild(populateBtn);

        const hint = document.createElement('span');
        hint.className = 'field-action-hint';
        hint.textContent = 'Re-analyses the image with a focused actions-only prompt.';
        actionWrap.appendChild(hint);

        row.appendChild(actionWrap);
      }

      // Slice 1 — "Populate with AI" button directly beneath the texture
      // textarea. Triggers a focused, texture-only re-analysis via
      // /api/texture and updates the texture textarea value in-place.
      // Mirrors the actions button (ADR 0018): no preset chips because
      // texture is image-specific and resists a curated taxonomy
      // (mirror ADR 0018 §5 / Slice 1 SPEC §8). The button is only
      // rendered for the texture field; other fields are unaffected.
      if (fieldName === 'texture') {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'field-row__action';

        const populateBtn = document.createElement('button');
        populateBtn.type = 'button';
        populateBtn.className = 'btn-secondary btn-populate-texture';
        populateBtn.disabled = !state.currentFile || state.isPopulatingTexture;
        populateBtn.setAttribute('aria-label', 'Populate texture with AI texture-only re-analysis');

        const btnText = document.createElement('span');
        btnText.className = 'btn-text';
        btnText.textContent = 'Populate with AI';
        populateBtn.appendChild(btnText);

        const btnSpinner = document.createElement('span');
        btnSpinner.className = 'btn-spinner';
        btnSpinner.hidden = true;
        btnSpinner.setAttribute('aria-hidden', 'true');
        populateBtn.appendChild(btnSpinner);

        populateBtn.addEventListener('click', () => populateTextureWithAI(populateBtn));
        actionWrap.appendChild(populateBtn);

        const hint = document.createElement('span');
        hint.className = 'field-action-hint';
        hint.textContent = 'Re-analyses the image with a focused texture-only prompt.';
        actionWrap.appendChild(hint);

        row.appendChild(actionWrap);
      }

      // ADR 0018 — "Populate with AI" button + curated mood preset chips
      // beneath the mood textarea. The button triggers a focused,
      // mood-only re-analysis via /api/mood; the chips provide a
      // zero-credit, one-click manual override that complements the AI
      // option. Chips are static and code-defined (not persisted like
      // saved directives, ADR 0009). The button and chips are only
      // rendered for the mood field; other fields are unaffected.
      if (fieldName === 'mood') {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'field-row__action';

        const populateBtn = document.createElement('button');
        populateBtn.type = 'button';
        populateBtn.className = 'btn-secondary btn-populate-mood';
        populateBtn.disabled = !state.currentFile || state.isPopulatingMood;
        populateBtn.setAttribute('aria-label', 'Populate mood with AI mood-only re-analysis');

        const btnText = document.createElement('span');
        btnText.className = 'btn-text';
        btnText.textContent = 'Populate with AI';
        populateBtn.appendChild(btnText);

        const btnSpinner = document.createElement('span');
        btnSpinner.className = 'btn-spinner';
        btnSpinner.hidden = true;
        btnSpinner.setAttribute('aria-hidden', 'true');
        populateBtn.appendChild(btnSpinner);

        populateBtn.addEventListener('click', () => populateMoodWithAI(populateBtn));
        actionWrap.appendChild(populateBtn);

        const hint = document.createElement('span');
        hint.className = 'field-action-hint';
        hint.textContent = 'Re-analyses the image with a focused mood-only prompt.';
        actionWrap.appendChild(hint);

        row.appendChild(actionWrap);

        row.appendChild(renderPresetChips('mood', MOOD_PRESETS));
      }

      // ADR 0018 — "Populate with AI" button + curated lighting preset
      // chips beneath the lighting input. Mirrors the mood block —
      // button for AI re-analysis, chips for quick manual override.
      if (fieldName === 'lighting') {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'field-row__action';

        const populateBtn = document.createElement('button');
        populateBtn.type = 'button';
        populateBtn.className = 'btn-secondary btn-populate-lighting';
        populateBtn.disabled = !state.currentFile || state.isPopulatingLighting;
        populateBtn.setAttribute('aria-label', 'Populate lighting with AI lighting-only re-analysis');

        const btnText = document.createElement('span');
        btnText.className = 'btn-text';
        btnText.textContent = 'Populate with AI';
        populateBtn.appendChild(btnText);

        const btnSpinner = document.createElement('span');
        btnSpinner.className = 'btn-spinner';
        btnSpinner.hidden = true;
        btnSpinner.setAttribute('aria-hidden', 'true');
        populateBtn.appendChild(btnSpinner);

        populateBtn.addEventListener('click', () => populateLightingWithAI(populateBtn));
        actionWrap.appendChild(populateBtn);

        const hint = document.createElement('span');
        hint.className = 'field-action-hint';
        hint.textContent = 'Re-analyses the image with a focused lighting-only prompt.';
        actionWrap.appendChild(hint);

        row.appendChild(actionWrap);

        row.appendChild(renderPresetChips('lighting', LIGHTING_PRESETS));
      }

      // ADR 0006 — color section is the single home for palette actions:
      // (1) Save the analyzed colors as a named reusable palette;
      // (2) Apply a saved palette to replace the current colors;
      // (3) Manage saved palettes (rename / delete via modal).
      // Each control is a singleton cached in `dom.*`; appendChild moves
      // them from any prior location, so re-renders clean up automatically.
      if (fieldName === 'colors') {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'field-row__action palette-actions';

        // Save
        const saveHint = document.createElement('span');
        saveHint.className = 'palette-actions__hint';
        saveHint.textContent = 'Save these colors as a reusable palette for future jobs:';
        actionWrap.appendChild(saveHint);

        const saveRow = document.createElement('div');
        saveRow.className = 'palette-actions__row';
        dom.savePaletteBtn.hidden = false;
        saveRow.appendChild(dom.savePaletteBtn);
        actionWrap.appendChild(saveRow);

        // Apply
        const applyHint = document.createElement('span');
        applyHint.className = 'palette-actions__hint';
        applyHint.textContent = 'Or replace these colors with a saved palette:';
        actionWrap.appendChild(applyHint);

        const applyRow = document.createElement('div');
        applyRow.className = 'palette-actions__row';
        populateApplySelect();
        dom.paletteApplySelect.hidden = false;
        applyRow.appendChild(dom.paletteApplySelect);
        dom.paletteApplyBtn.hidden = false;
        applyRow.appendChild(dom.paletteApplyBtn);
        actionWrap.appendChild(applyRow);

        // Manage
        const manageHint = document.createElement('span');
        manageHint.className = 'palette-actions__hint';
        manageHint.textContent = 'Or view / rename / delete saved palettes:';
        actionWrap.appendChild(manageHint);

        const manageRow = document.createElement('div');
        manageRow.className = 'palette-actions__row';
        dom.paletteManageBtn.hidden = false;
        manageRow.appendChild(dom.paletteManageBtn);
        actionWrap.appendChild(manageRow);

        row.appendChild(actionWrap);
      }

      dom.analysisFields.appendChild(row);
    });
  };

  const renderColorsInput = (colors) => {
    const wrap = document.createElement('div');
    wrap.className = 'colors-chips';

    const render = () => {
      wrap.innerHTML = '';
      state.currentAnalysis.colors.forEach((c, i) => {
        const chip = document.createElement('div');
        chip.className = 'color-chip';

        const swatch = document.createElement('span');
        swatch.className = 'color-chip-swatch';
        swatch.style.background = c.hex;
        chip.appendChild(swatch);

        const hex = document.createElement('span');
        hex.className = 'color-chip-hex';
        hex.textContent = c.hex;
        chip.appendChild(hex);

        const name = document.createElement('span');
        name.className = 'color-chip-name';
        name.textContent = c.name;
        chip.appendChild(name);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'color-chip-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${c.name}`);
        remove.addEventListener('click', () => {
          state.currentAnalysis.colors.splice(i, 1);
          render();
        });
        chip.appendChild(remove);

        wrap.appendChild(chip);
      });

      // Add-color form
      const addWrap = document.createElement('div');
      addWrap.className = 'color-add';

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = '#3b82f6';
      addWrap.appendChild(picker);

      const hexInput = document.createElement('input');
      hexInput.type = 'text';
      hexInput.placeholder = '#hex';
      hexInput.value = '#3b82f6';
      picker.addEventListener('input', () => { hexInput.value = picker.value; });
      addWrap.appendChild(hexInput);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Name';
      addWrap.appendChild(nameInput);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'color-add-btn';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => {
        const hex = hexInput.value.trim();
        const name = nameInput.value.trim() || 'color';
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return showError('Hex must be #RRGGBB format.');
        state.currentAnalysis.colors.push({ hex, name });
        render();
      });
      addWrap.appendChild(addBtn);

      wrap.appendChild(addWrap);
    };

    render();
    return wrap;
  };

  const runAnalysis = async () => {
    if (!state.currentFile || !state.selectedPresetId) return;
    state.isAnalyzing = true;
    setButtonLoading(dom.analyzeBtn, true, 'Analyzing…');
    updateButtons();

    const fd = new FormData();
    fd.append('image', state.currentFile);
    fd.append('presetId', state.selectedPresetId);
    if (state.selectedPaletteId) {
      fd.append('paletteId', state.selectedPaletteId);
    }
    // Slice 3.4 — ADR 0022 — forward the LLM model so the server
    // routes /api/analyze through the user's chosen model.
    fd.append('llmModel', state.llmModel);
    // Slice 4 — ADR 0023 — forward the provider so the server
    // dispatches to the right adapter (kilo_code / minimax / alibaba).
    fd.append('provider', state.provider);

    try {
      const data = await apiCall('/api/analyze', { method: 'POST', body: fd });
      state.currentAnalysis = data.analysis;
      state.currentRunId = data.run_id || null;
      const preset = state.presets.find((p) => p.id === state.selectedPresetId);
      state.lastAnalysisContext = {
        run_id: state.currentRunId,
        preset_id: state.selectedPresetId,
        preset_name: preset?.name || state.selectedPresetId,
        colors: Array.isArray(data.analysis?.colors) ? data.analysis.colors.slice() : []
      };
      renderAnalysisEditor(data.analysis);
      dom.analysisEditor.hidden = false;
      dom.analysisEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      updateSavePaletteButton();
      hideError();
    } catch (e) {
      showError(`Analysis failed: ${e.message}`);
    } finally {
      state.isAnalyzing = false;
      setButtonLoading(dom.analyzeBtn, false, 'Analyze image');
      updateButtons();
    }
  };

  /**
   * ADR 0006 — enable or disable the "Save palette…" button depending on
   * whether the current analysis has a usable colors array. The button
   * itself is now rendered inside the colors field-row, so its visibility
   * follows the analysis editor (which is hidden until the first analyze
   * run). We only toggle disabled here; the parent editor's hidden state
   * controls visibility.
   */
  const updateSavePaletteButton = () => {
    if (!dom.savePaletteBtn) return;
    const colors = state.lastAnalysisContext?.colors;
    const hasColors = Array.isArray(colors) && colors.length > 0;
    dom.savePaletteBtn.disabled = !hasColors;
  };

  /**
   * ADR 0004 — "Populate with AI" handler. Re-uploads the current image to
   * the dedicated `/api/subject` endpoint (factual-only system prompt,
   * independent of the active preset) and replaces the subject textarea's
   * value in place. Does NOT re-render the analysis editor — that would
   * clobber any in-progress edits the user has made to other fields
   * (style, lighting, colors, etc.).
   */
  const populateSubjectWithAI = async (btn) => {
    if (!state.currentFile) {
      return showError('No image uploaded. Upload an image first.');
    }
    if (state.isPopulatingSubject) return;

    state.isPopulatingSubject = true;
    btn.disabled = true;
    setButtonLoading(btn, true, 'Populating…');

    const fd = new FormData();
    fd.append('image', state.currentFile);

    try {
      const data = await apiCall('/api/subject', { method: 'POST', body: fd });
      const subjectTextarea = dom.analysisFields.querySelector('textarea[data-field="subject"]');
      if (subjectTextarea) {
        subjectTextarea.value = data.subject;
        subjectTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (state.currentAnalysis) state.currentAnalysis.subject = data.subject;
      hideError();
    } catch (e) {
      showError(`Populate failed: ${e.message}`);
    } finally {
      state.isPopulatingSubject = false;
      btn.disabled = false;
      setButtonLoading(btn, false, 'Populate with AI');
    }
  };

  /**
   * ADR 0008 — "Populate with AI" handler for the camera_angle field.
   * Re-uploads the current image to the dedicated `/api/camera-angle`
   * endpoint (camera-only system prompt, independent of the active
   * preset) and replaces the camera_angle input's value in place. Does
   * NOT re-render the analysis editor — that would clobber any
   * in-progress edits the user has made to other fields (style,
   * lighting, colors, etc.).
   *
   * Client-side "no image" guard: if `state.currentFile` is null when
   * the button is clicked, show a clear error and return without
   * firing the network request. Mirrors `populateSubjectWithAI`'s
   * guard and prevents a 400 from the route.
   */
  const populateCameraAngleWithAI = async (btn) => {
    if (!state.currentFile) {
      return showError('No image uploaded. Upload an image first.');
    }
    if (state.isPopulatingCameraAngle) return;

    state.isPopulatingCameraAngle = true;
    btn.disabled = true;
    setButtonLoading(btn, true, 'Populating…');

    const fd = new FormData();
    fd.append('image', state.currentFile);

    try {
      const data = await apiCall('/api/camera-angle', { method: 'POST', body: fd });
      const cameraAngleInput = dom.analysisFields.querySelector('input[data-field="camera_angle"]');
      if (cameraAngleInput) {
        cameraAngleInput.value = data.camera_angle;
        cameraAngleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (state.currentAnalysis) state.currentAnalysis.camera_angle = data.camera_angle;
      hideError();
    } catch (e) {
      showError(`Populate failed: ${e.message}`);
    } finally {
      state.isPopulatingCameraAngle = false;
      btn.disabled = false;
      setButtonLoading(btn, false, 'Populate with AI');
    }
  };

  /**
   * ADR 0018 — "Populate with AI" handler for the `actions` field.
   * Re-uploads the current image to `/api/actions` (actions-only system
   * prompt, independent of the active preset) and replaces the actions
   * textarea value in place. Mirrors `populateCameraAngleWithAI`'s
   * shape (ADR 0008) — single-attempt, no edit-prompt companion,
   * 60-second timeout inherited from the server helper.
   *
   * Client-side "no image" guard: if `state.currentFile` is null when
   * the button is clicked, surface a clear error and return without
   * firing the network request. Prevents a 400 from the route.
   */
  const populateActionsWithAI = async (btn) => {
    if (!state.currentFile) {
      return showError('No image uploaded. Upload an image first.');
    }
    if (state.isPopulatingActions) return;

    state.isPopulatingActions = true;
    btn.disabled = true;
    setButtonLoading(btn, true, 'Populating…');

    const fd = new FormData();
    fd.append('image', state.currentFile);

    try {
      const data = await apiCall('/api/actions', { method: 'POST', body: fd });
      const actionsTextarea = dom.analysisFields.querySelector('textarea[data-field="actions"]');
      if (actionsTextarea) {
        actionsTextarea.value = data.actions;
        actionsTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (state.currentAnalysis) state.currentAnalysis.actions = data.actions;
      hideError();
    } catch (e) {
      showError(`Populate failed: ${e.message}`);
    } finally {
      state.isPopulatingActions = false;
      btn.disabled = false;
      setButtonLoading(btn, false, 'Populate with AI');
    }
  };

  /**
   * ADR 0018 — "Populate with AI" handler for the `mood` field.
   * Re-uploads the current image to `/api/mood` (mood-only system prompt)
   * and replaces the mood textarea value in place. Complements the
   * curated mood preset chips (click a chip for a zero-credit quick
   * override; click the button for an AI-derived description).
   */
  const populateMoodWithAI = async (btn) => {
    if (!state.currentFile) {
      return showError('No image uploaded. Upload an image first.');
    }
    if (state.isPopulatingMood) return;

    state.isPopulatingMood = true;
    btn.disabled = true;
    setButtonLoading(btn, true, 'Populating…');

    const fd = new FormData();
    fd.append('image', state.currentFile);

    try {
      const data = await apiCall('/api/mood', { method: 'POST', body: fd });
      const moodTextarea = dom.analysisFields.querySelector('textarea[data-field="mood"]');
      if (moodTextarea) {
        moodTextarea.value = data.mood;
        moodTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (state.currentAnalysis) state.currentAnalysis.mood = data.mood;
      hideError();
    } catch (e) {
      showError(`Populate failed: ${e.message}`);
    } finally {
      state.isPopulatingMood = false;
      btn.disabled = false;
      setButtonLoading(btn, false, 'Populate with AI');
    }
  };

  /**
   * ADR 0018 — "Populate with AI" handler for the `lighting` field.
   * Re-uploads the current image to `/api/lighting` (lighting-only
   * system prompt) and replaces the lighting input value in place.
   * Complements the curated lighting preset chips.
   */
  const populateLightingWithAI = async (btn) => {
    if (!state.currentFile) {
      return showError('No image uploaded. Upload an image first.');
    }
    if (state.isPopulatingLighting) return;

    state.isPopulatingLighting = true;
    btn.disabled = true;
    setButtonLoading(btn, true, 'Populating…');

    const fd = new FormData();
    fd.append('image', state.currentFile);

    try {
      const data = await apiCall('/api/lighting', { method: 'POST', body: fd });
      const lightingInput = dom.analysisFields.querySelector('input[data-field="lighting"]');
      if (lightingInput) {
        lightingInput.value = data.lighting;
        lightingInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (state.currentAnalysis) state.currentAnalysis.lighting = data.lighting;
      hideError();
    } catch (e) {
      showError(`Populate failed: ${e.message}`);
    } finally {
      state.isPopulatingLighting = false;
      btn.disabled = false;
      setButtonLoading(btn, false, 'Populate with AI');
    }
  };

  /**
   * Slice 1 — "Populate with AI" handler for the `texture` field.
   * Re-uploads the current image to `/api/texture` (texture-only
   * system prompt) and replaces the texture textarea value in place.
   * Mirrors `populateLightingWithAI` (ADR 0018): no-image guard,
   * in-flight state flag, in-place DOM update on success, error
   * surfaced via `showError` toast.
   *
   * Texture is image-specific and resists a curated chip taxonomy
   * (mirror ADR 0018 §1 reasoning for `actions`); only the AI
   * button is rendered, no chips.
   */
  const populateTextureWithAI = async (btn) => {
    if (!state.currentFile) {
      return showError('No image uploaded. Upload an image first.');
    }
    if (state.isPopulatingTexture) return;

    state.isPopulatingTexture = true;
    btn.disabled = true;
    setButtonLoading(btn, true, 'Populating…');

    const fd = new FormData();
    fd.append('image', state.currentFile);

    try {
      const data = await apiCall('/api/texture', { method: 'POST', body: fd });
      const textureTextarea = dom.analysisFields.querySelector('textarea[data-field="texture"]');
      if (textureTextarea) {
        textureTextarea.value = data.texture;
        textureTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (state.currentAnalysis) state.currentAnalysis.texture = data.texture;
      hideError();
    } catch (e) {
      showError(`Populate failed: ${e.message}`);
    } finally {
      state.isPopulatingTexture = false;
      btn.disabled = false;
      setButtonLoading(btn, false, 'Populate with AI');
    }
  };

  /**
   * ADR 0018 — Curated preset chip click handler. Sets the field's
   * input/textarea value to the chip's label (a one-line descriptor)
   * and updates `state.currentAnalysis[fieldName]` so the analysis
   * snapshot stays in sync with the DOM. The user is free to edit
   * the value after clicking — chips are a quick starting point,
   * not a lock. Each click is independent (chips do not "stick" as
   * selected); the user can chain chips or layer in their own words.
   *
   * The DOM lookup MUST use a tag-qualified selector. The row container
   * `<div class="field-row" data-field="...">` is appended before the
   * actual `<input>` / `<textarea>` in `renderAnalysisEditor`, so an
   * unqualified `[data-field="${fieldName}"]` selector matches the row
   * first and silently assigns `.value` to a `<div>` (which has no
   * native `.value` semantics). That broke the curated chip workflow
   * entirely — state was updated but the visible input never changed.
   * The selector below matches the same input/textarea that the
   * Populate-with-AI handlers use, keeping DOM updates consistent.
   *
   * After assigning, dispatch an `input` event so any future
   * downstream listener (form validation, dirty-tracking, autosave)
   * sees the change as if the user had typed the value themselves.
   */
  const applyPresetToField = (fieldName, value) => {
    const el = dom.analysisFields.querySelector(
      `input[data-field="${fieldName}"], textarea[data-field="${fieldName}"]`
    );
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (state.currentAnalysis) state.currentAnalysis[fieldName] = value;
  };

  /**
   * ADR 0005 — Subject-prompt editor modal. Opens with the current prompt
   * (loaded from disk via GET /api/subject-prompt), allows edits, and saves
   * via PUT /api/subject-prompt. The "Reset to default" control restores
   * the shipped default text in the textarea; the user must then click
   * Save to persist the reset.
   *
   * Tracks the latest GET response in a closure so "Reset to default"
   * can read `data.default_prompt` without a second fetch.
   */
  let subjectPromptModalState = null;

  const openSubjectPromptModal = async () => {
    dom.subjectPromptInput.value = '';
    dom.subjectPromptStatus.textContent = '— loading…';
    dom.subjectPromptModal.hidden = false;
    try {
      const data = await apiCall('/api/subject-prompt');
      subjectPromptModalState = data;
      dom.subjectPromptInput.value = data.prompt;
      dom.subjectPromptStatus.textContent = data.is_default
        ? '— shipped default'
        : '— custom (edited)';
    } catch (e) {
      dom.subjectPromptStatus.textContent = '— failed to load';
      showError(`Failed to load subject prompt: ${e.message}`);
    }
    updateSubjectPromptCount();
  };

  const closeSubjectPromptModal = () => {
    dom.subjectPromptModal.hidden = true;
    subjectPromptModalState = null;
  };

  const updateSubjectPromptCount = () => {
    dom.subjectPromptCount.textContent = `${dom.subjectPromptInput.value.length} / 10000`;
  };

  const saveSubjectPrompt = async () => {
    const prompt = dom.subjectPromptInput.value;
    try {
      await apiCall('/api/subject-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      closeSubjectPromptModal();
      hideError();
    } catch (e) {
      showError(`Save failed: ${e.message}`);
    }
  };

  /**
   * Reset the modal textarea to the shipped default. Destructive if the
   * user has unsaved edits, so it asks for confirmation first. Does NOT
   * persist — the user must click Save after the reset to write the
   * default back to disk (matches "Reset to default" semantics in most
   * editor UIs).
   */
  const resetSubjectPromptToDefault = () => {
    if (!confirm('Reset the prompt to the shipped default? Unsaved edits will be replaced in the textarea; click Save to persist.')) return;
    if (!subjectPromptModalState || typeof subjectPromptModalState.default_prompt !== 'string') {
      return showError('Default prompt not available — try reopening the modal.');
    }
    dom.subjectPromptInput.value = subjectPromptModalState.default_prompt;
    updateSubjectPromptCount();
  };

  dom.subjectPromptModalClose.addEventListener('click', closeSubjectPromptModal);
  dom.subjectPromptCancel.addEventListener('click', closeSubjectPromptModal);
  dom.subjectPromptReset.addEventListener('click', resetSubjectPromptToDefault);
  dom.subjectPromptForm.addEventListener('submit', (e) => { e.preventDefault(); saveSubjectPrompt(); });
  dom.subjectPromptInput.addEventListener('input', updateSubjectPromptCount);

  /**
   * ADR 0007 — Stage 2 prompt editor modal. Opens with the EFFECTIVE
   * prompt for the current preset (override if one exists, otherwise
   * the preset's built-in stage2_system_prompt), lets the user edit
   * or reset it, and saves via PUT /api/stage2-prompt?presetId=...
   *
   * Three actions:
   *  - Save: PUT the textarea contents as an override.
   *  - Reset to default: load preset.stage2_system_prompt into the
   *    textarea (user must click Save to persist).
   *  - Use preset default: DELETE the override for the current preset
   *    via DELETE /api/stage2-prompt?presetId=... and reload the
   *    modal showing the preset's built-in prompt.
   *
   * Tracks the latest GET response in a closure so "Reset to default"
   * can read `data.default_prompt` without a second fetch.
   */
  let stage2PromptModalState = null;

  const openStage2PromptModal = async () => {
    if (!state.selectedPresetId) {
      return showError('Select a preset first before editing the Stage 2 prompt.');
    }
    const preset = state.presets.find((p) => p.id === state.selectedPresetId);
    dom.stage2PromptInput.value = '';
    dom.stage2PromptStatus.textContent = '— loading…';
    dom.stage2PromptPresetName.textContent = preset ? `"${preset.name}"` : 'the current preset';
    dom.stage2PromptModal.hidden = false;
    try {
      const data = await apiCall(`/api/stage2-prompt?presetId=${encodeURIComponent(state.selectedPresetId)}`);
      stage2PromptModalState = data;
      dom.stage2PromptInput.value = data.prompt;
      dom.stage2PromptStatus.textContent = data.is_default
        ? '— preset default'
        : '— custom (override)';
    } catch (e) {
      dom.stage2PromptStatus.textContent = '— failed to load';
      showError(`Failed to load Stage 2 prompt: ${e.message}`);
    }
    updateStage2PromptCount();
  };

  const closeStage2PromptModal = () => {
    dom.stage2PromptModal.hidden = true;
    stage2PromptModalState = null;
  };

  const updateStage2PromptCount = () => {
    dom.stage2PromptCount.textContent = `${dom.stage2PromptInput.value.length} / 10000`;
  };

  const saveStage2Prompt = async () => {
    if (!state.selectedPresetId) {
      return showError('Select a preset first.');
    }
    const prompt = dom.stage2PromptInput.value;
    try {
      await apiCall(`/api/stage2-prompt?presetId=${encodeURIComponent(state.selectedPresetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      closeStage2PromptModal();
      hideError();
    } catch (e) {
      showError(`Save failed: ${e.message}`);
    }
  };

  /**
   * "Reset to default" — load preset.stage2_system_prompt into the
   * textarea. Does NOT persist; user must click Save to write the
   * default text back to disk as an explicit override (matches the
   * subject-prompt modal's semantics).
   */
  const resetStage2PromptToDefault = () => {
    if (!confirm('Reset the textarea to the preset\'s built-in prompt? Unsaved edits will be replaced; click Save to persist.')) return;
    if (!stage2PromptModalState || typeof stage2PromptModalState.default_prompt !== 'string') {
      return showError('Default prompt not available — try reopening the modal.');
    }
    dom.stage2PromptInput.value = stage2PromptModalState.default_prompt;
    updateStage2PromptCount();
  };

  /**
   * "Use preset default" — DELETE the override for the current preset.
   * Distinct from "Reset to default" in that no save step is required:
   * the override is removed immediately, and subsequent "Generate
   * prompt" calls fall back to the preset's built-in prompt.
   * Destructive (the user's override text is lost from disk), so it
   * asks for confirmation first.
   */
  const useStage2PresetDefault = async () => {
    if (!state.selectedPresetId) {
      return showError('Select a preset first.');
    }
    if (!confirm('Remove the Stage 2 override for this preset? The preset\'s built-in prompt will be used for future generations.')) return;
    try {
      const data = await apiCall(`/api/stage2-prompt?presetId=${encodeURIComponent(state.selectedPresetId)}`, {
        method: 'DELETE'
      });
      dom.stage2PromptInput.value = data.prompt;
      dom.stage2PromptStatus.textContent = data.is_default ? '— preset default' : '— custom (override)';
      stage2PromptModalState = {
        prompt: data.prompt,
        default_prompt: data.default_prompt,
        is_default: data.is_default
      };
      updateStage2PromptCount();
      hideError();
    } catch (e) {
      showError(`Failed to remove override: ${e.message}`);
    }
  };

  dom.editStage2PromptBtn.addEventListener('click', openStage2PromptModal);
  dom.stage2PromptModalClose.addEventListener('click', closeStage2PromptModal);
  dom.stage2PromptCancel.addEventListener('click', closeStage2PromptModal);
  dom.stage2PromptReset.addEventListener('click', resetStage2PromptToDefault);
  dom.stage2PromptUseDefault.addEventListener('click', useStage2PresetDefault);
  dom.stage2PromptForm.addEventListener('submit', (e) => { e.preventDefault(); saveStage2Prompt(); });
  dom.stage2PromptInput.addEventListener('input', updateStage2PromptCount);

  const collectAnalysisFromEditor = () => {
    // Pull current input values into the analysis object. The source toggle (ADR 0002)
    // keeps each input's value in sync with the active source, so reading inputs IS the
    // merge: fields in "Analysis" mode carry the LLM value, fields in "Preset" mode carry
    // the preset default (or any user edits to either).
    dom.analysisFields.querySelectorAll('textarea[data-field], input[data-field]').forEach((el) => {
      state.currentAnalysis[el.dataset.field] = el.value;
    });
    return state.currentAnalysis;
  };

  const runGeneratePrompt = async () => {
    if (!state.currentAnalysis) return;
    state.isGenerating = true;
    setButtonLoading(dom.generatePromptBtn, true, 'Generating…');
    updateButtons();

    // Slice 2.3 — ADR 0021 — model-fork dispatch. The pre-Generate
    // picker chose which contract runs. Z-Image Turbo keeps the existing
    // path (presetId required, /api/generate-prompt). Anima has its own
    // path (no presetId required; /api/anima; emits a positive + negative
    // pair instead of a single prompt).
    if (state.model === 'anima') {
      await runAnimaGenerate();
      return;
    }

    if (!state.selectedPresetId) return;
    const analysis = collectAnalysisFromEditor();
    const directives = dom.directivesInput.value.trim();

    try {
      const data = await apiCall('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId: state.selectedPresetId,
          analysis,
          directives,
          // ADR 0014 — when a palette is selected, send its id so the
          // server can append the deterministic color-budget block to
          // the Stage 2 user message and surface distribution_metrics
          // in the response envelope. When no palette is selected,
          // omit the field (server treats missing as "no weighting").
          paletteId: state.selectedPaletteId || undefined,
          // ADR 0019 Issue #15 — aspect-ratio picker. When the user
          // has chosen one (square / portrait / landscape / panoramic),
          // forward it to the server so the Stage 2 LLM anchors Block
          // 3 on the chosen canvas proportion.
          aspectRatio: state.selectedAspectRatio || undefined,
          // Slice 3.4 — ADR 0022 — forward the LLM model so the
          // server routes /api/generate-prompt through the user's
          // chosen model. The server validates against
          // ALLOWED_LLM_MODELS; anything not on the whitelist
          // falls back to the default on the server side too.
          llmModel: state.llmModel,
          // Slice 4 — ADR 0023 — forward the provider so the
          // server dispatches to the right adapter.
          provider: state.provider
        })
      });
      state.finalPrompt = data.prompt;
      // ADR 0014 — keep the most recent distribution metrics on state
      // so the Phase 4 dashboard panel can read them without an extra
      // fetch. The palette_id is the lookup key; null clears the
      // previous measurement (e.g. when the user runs without a
      // palette after a weighted run).
      state.lastDistributionMetrics = data.distribution_metrics || null;
      state.lastPaletteId = data.palette_id || null;
      state.lastLengthCheck = data.length_check || null;
      displayResult(data);
      hideError();
    } catch (e) {
      showError(`Generation failed: ${e.message}`);
    } finally {
      state.isGenerating = false;
      setButtonLoading(dom.generatePromptBtn, false, 'Generate prompt');
      updateButtons();
    }
  };

  /**
   * Slice 2.3 — ADR 0021 — Anima-mode generate path.
   * Calls /api/anima with the current image + variant, stores the result
   * in state.animaResult, and renders via displayAnimaResult. The
   * Z-Image path is untouched; this is a sibling.
   */
  const runAnimaGenerate = async () => {
    try {
      // The Anima endpoint takes the uploaded image (multipart) + variant.
      // Use state.currentFile (set by handleFile / clearFile — the same
      // canonical source used by all 6 per-field Populate-with-AI
      // buttons and by the analyze guard). The earlier generic DOM
      // query was the bug: drag-drop uploads set state.currentFile
      // directly but don't populate the hidden file input's files
      // list, so the Anima path saw an empty file list and surfaced a
      // confusing "No image uploaded" toast even though the user had
      // uploaded. Use the canonical state instead.
      const file = state.currentFile;
      if (!file) {
        showError('No image uploaded. Upload an image first.');
        return;
      }
      const fd = new FormData();
      fd.append('image', file);
      fd.append('variant', state.animaVariant);
      // Slice 3.4 — ADR 0022 — forward the LLM model so the server
      // routes /api/anima through the user's chosen model.
      fd.append('llmModel', state.llmModel);
      // Slice 4 — ADR 0023 — forward the provider so the server
      // dispatches to the right adapter.
      fd.append('provider', state.provider);
      const data = await apiCall('/api/anima', { method: 'POST', body: fd });
      state.animaResult = {
        positive: data.positive,
        negative: data.negative,
        variant: data.variant,
        model: data.model
      };
      displayAnimaResult(state.animaResult);
      hideError();
    } catch (e) {
      showError(`Anima generation failed: ${e.message}`);
    } finally {
      state.isGenerating = false;
      setButtonLoading(dom.generatePromptBtn, false, 'Generate prompt');
      updateButtons();
    }
  };

  const displayResult = (data) => {
    dom.resultPrompt.textContent = data.prompt;
    // ADR 0019 Issue #15 — re-evaluate the 1024-token reminder banner
    // whenever the displayed prompt changes. Cheap, runs on every
    // display update + every chat Apply.
    updateTokenReminderBanner();
    const preset = state.presets.find((p) => p.id === data.preset_id);
    const meta = [`Preset: ${data.preset_name || preset?.name || data.preset_id}`, `Model: ${data.model}`];
    if (data.length_check && data.length_check.classification === 'sweet_spot') {
      meta.push(`${data.length_check.wordCount} words (sweet spot)`);
    } else if (data.length_check) {
      meta.push(`${data.length_check.wordCount} words (outside sweet spot)`);
    }
    dom.resultMetaInfo.textContent = meta.join(' • ');
    // ADR 0016 — surface strict-palette validation result. When a
    // strict palette was used and the validation failed, show a
    // non-blocking warning chip; on success, hide any previous warning.
    if (dom.resultStrictWarn) {
      const dm = data.distribution_metrics;
      if (dm && dm.strict_pass === false) {
        const violations = Array.isArray(dm.strict_violations) ? dm.strict_violations.length : 0;
        dom.resultStrictWarn.textContent = `Strict palette — ${violations} color(s) outside documented counts. Regenerate or copy and edit manually.`;
        dom.resultStrictWarn.dataset.tone = 'warn';
        dom.resultStrictWarn.hidden = false;
      } else if (dm && dm.strict_pass === true) {
        dom.resultStrictWarn.textContent = 'Strict palette — all colors match documented counts.';
        dom.resultStrictWarn.dataset.tone = 'ok';
        dom.resultStrictWarn.hidden = false;
      } else {
        dom.resultStrictWarn.hidden = true;
        dom.resultStrictWarn.removeAttribute('data-tone');
      }
    }
    // ADR 0019 Issue #13 — surface length-check result on the result
    // meta line (above). For Z-Image presets, the server returns
    // `data.length_check` when the orchestrator ran. Non-Z-Image
    // presets never receive the field so this branch is skipped
    // silently for them. We don't add a second warning chip — the
    // word-count badge on the meta line is enough.
    dom.resultSection.hidden = false;
    dom.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // ADR 0011 — every successful Stage 2 run gets its own chat session.
    // Capture the analysis snapshot from state.currentAnalysis so the
    // chat system prompt has full context (subject, style, lighting, …)
    // even if the user later edits the live editor. Fire-and-forget: a
    // 4xx/5xx here must not clobber the result the user just got.
    if (data && typeof data.prompt === 'string' && data.prompt.trim().length > 0) {
      activateChatForResult(data).catch((e) => {
        console.warn('Failed to activate chat console:', e.message);
      });
    }
  };

  /**
   * Slice 2.3 — ADR 0021 — Anima-mode result render.
   * Parallel to displayResult, but shapes the result panel for the
   * Anima contract (positive + negative + variant selector). The
   * Z-Image path is untouched.
   */
  const displayAnimaResult = (data) => {
    if (!dom.animaResultSection) return;
    // Hide the Z-Image result panel, show the Anima panel.
    if (dom.resultSection) dom.resultSection.hidden = true;
    dom.animaResultSection.hidden = false;

    // Populate the two textareas.
    if (dom.animaResultPositive) dom.animaResultPositive.value = data.positive || '';
    if (dom.animaResultNegative) dom.animaResultNegative.value = data.negative || '';

    // Active variant indicator.
    if (dom.animaVariantSelector) {
      const buttons = dom.animaVariantSelector.querySelectorAll('[data-anima-variant]');
      buttons.forEach((btn) => {
        const isActive = btn.dataset.animaVariant === (data.variant || state.animaVariant);
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    // Meta line.
    if (dom.animaResultMetaInfo) {
      const meta = [
        `Variant: ${data.variant || state.animaVariant}`,
        `Model: ${data.model || 'MiniMax-Text-01'}`,
        `Positive: ${(data.positive || '').length} chars`,
        `Negative: ${(data.negative || '').length} chars`
      ];
      dom.animaResultMetaInfo.textContent = meta.join(' • ');
    }

    // Scroll the user into the result panel.
    dom.animaResultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Slice 2.4 — ADR 0021 — activate chat for Anima. Parallel to
    // activateChatForResult (which fires on the Z-Image path). The
    // session body uses data.positive as the prompt (the Anima
    // contract's primary prompt) and tags model='anima' so the server's
    // buildChatSystemPrompt appends ANIMA_CHAT_CONSTRAINTS_BLOCK.
    // Fire-and-forget: a 4xx/5xx here must not clobber the result.
    activateAnimaChatForResult(data).catch((e) => {
      console.warn('Failed to activate Anima chat console:', e.message);
    });
  };

  const setButtonLoading = (btn, loading, text) => {
    const textEl = btn.querySelector('.btn-text');
    const spinnerEl = btn.querySelector('.btn-spinner');
    if (textEl) textEl.textContent = text;
    if (spinnerEl) spinnerEl.hidden = !loading;
  };

  dom.analyzeBtn.addEventListener('click', runAnalysis);
  dom.reAnalyzeBtn.addEventListener('click', runAnalysis);
  dom.generatePromptBtn.addEventListener('click', runGeneratePrompt);
  dom.regenerateBtn.addEventListener('click', runGeneratePrompt);

  // ADR 0019 Issue #15 — aspect-ratio picker on the Generate-prompt
  // row. Persists its value on state.selectedAspectRatio so the
  // pick survives across runs without the user having to re-pick.
  if (dom.aspectRatioSelect) {
    dom.aspectRatioSelect.addEventListener('change', () => {
      state.selectedAspectRatio = dom.aspectRatioSelect.value || '';
    });
  }

  // ─── Slice 2.1 — ADR 0021 — model-fork selector ────────────────────
  // The pre-Generate model picker. Two siblings: Z-Image Turbo (default,
  // existing behavior) and Anima. Persisted in localStorage, mirrored in
  // the URL (?model=anima&variant=turbo). The dispatch + chat branching
  // land in Slices 2.3 + 2.4; this slice ships only the state plumbing
  // + the UI control. Deletion test: delete this block and the app
  // behaves as before (Z-Image Turbo only).
  const ALLOWED_MODELS = ['zimage_turbo', 'anima'];
  const ALLOWED_ANIMA_VARIANTS = ['base', 'aesthetic', 'turbo'];
  const MODEL_STORAGE_KEY = 'i2p.state.model';
  const VARIANT_STORAGE_KEY = 'i2p.state.animaVariant';

  const validateModel = (raw) => {
    return ALLOWED_MODELS.includes(raw) ? raw : 'zimage_turbo';
  };
  const validateVariant = (raw) => {
    return ALLOWED_ANIMA_VARIANTS.includes(raw) ? raw : 'base';
  };

  // ─── Slice 3.3 — ADR 0022 — LLM model picker (Kilo Code) ─────────────
  // The 6 model ids exposed in the picker. Mirrored in server.js
  // ALLOWED_LLM_MODELS so the server validates against the same set
  // (a typo or stale id falls back to the default on both sides).
  // Whitelist is the slice's safety property: the server only routes
  // requests whose llmModel is in this list, so a tampered client
  // can't smuggle in a different provider or a non-Kilo-Code model.
  const ALLOWED_LLM_MODELS = [
    'minimax/minimax-m3',
    'openai/gpt-5.6-luna',
    'google/gemini-3.1-pro-preview',
    'google/gemini-3.5-flash',
    'nvidia/nemotron-3-ultra-550b-a55b',
    'x-ai/grok-4.3'
  ];
  const LLM_MODEL_STORAGE_KEY = 'i2p.state.llmModel';

  const validateLlmModel = (raw) => {
    // Slice 4 — validate against the active provider's model list.
    // Falls back to the provider's first allowed model if the raw value
    // is invalid for the current provider (matches the Slice 3.3
    // helper's behavior for kilo_code, generalized across providers).
    const providerModels = ALLOWED_LLM_MODELS_BY_PROVIDER[state.provider] || ALLOWED_LLM_MODELS;
    if (providerModels.includes(raw)) return raw;
    return providerModels[0];
  };

  // ─── Slice 4 — ADR 0023 — Provider picker (Kilo Code / MiniMax / Alibaba) ──
  // Mirrors server.js ALLOWED_PROVIDERS + ALLOWED_LLM_MODELS_BY_PROVIDER.
  // The provider-selector <select> swaps the options of #llm-model-selector
  // when the provider changes (per-provider model lists). The selected
  // provider is forwarded alongside llmModel on all 4 endpoints so the
  // server's resolveProviderAndModel can dispatch to the right adapter.
  const ALLOWED_PROVIDERS = ['kilo_code', 'minimax', 'alibaba'];
  const ALLOWED_LLM_MODELS_BY_PROVIDER = {
    kilo_code: ['minimax/minimax-m3', 'openai/gpt-5.6-luna', 'google/gemini-3.1-pro-preview', 'google/gemini-3.5-flash', 'nvidia/nemotron-3-ultra-550b-a55b', 'x-ai/grok-4.3'],
    minimax: ['MiniMax-M1'],
    alibaba: ['qwen-vl-max', 'qwen-vl-plus']
  };
  const PROVIDER_STORAGE_KEY = 'i2p.state.provider';

  const validateProvider = (raw) => {
    return ALLOWED_PROVIDERS.includes(raw) ? raw : 'kilo_code';
  };

  const writeStateToLocalStorage = () => {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, state.model);
      localStorage.setItem(VARIANT_STORAGE_KEY, state.animaVariant);
      localStorage.setItem(LLM_MODEL_STORAGE_KEY, state.llmModel);
      localStorage.setItem(PROVIDER_STORAGE_KEY, state.provider);
    } catch (_) {
      // localStorage may be unavailable (private mode, quota, etc.). The
      // app continues with in-memory state. Not a user-visible error.
    }
  };

  const readStateFromLocalStorage = () => {
    try {
      const m = localStorage.getItem(MODEL_STORAGE_KEY);
      const v = localStorage.getItem(VARIANT_STORAGE_KEY);
      const l = localStorage.getItem(LLM_MODEL_STORAGE_KEY);
      const p = localStorage.getItem(PROVIDER_STORAGE_KEY);
      if (m !== null) state.model = validateModel(m);
      if (v !== null) state.animaVariant = validateVariant(v);
      if (l !== null) state.llmModel = validateLlmModel(l);
      if (p !== null) state.provider = validateProvider(p);
    } catch (_) {
      // Same as above — silent fallback to defaults.
    }
  };

  const syncStateToURL = () => {
    try {
      const url = new URL(window.location.href);
      if (state.model === 'zimage_turbo') {
        url.searchParams.delete('model');
      } else {
        url.searchParams.set('model', state.model);
      }
      if (state.model === 'anima' && state.animaVariant !== 'base') {
        url.searchParams.set('variant', state.animaVariant);
      } else {
        url.searchParams.delete('variant');
      }
      // Slice 3.3 — ADR 0022 — mirror the LLM model in ?llm=...
      // so a deep-link to the app lands on the same model the
      // sender was using. We omit the param when the value is the
      // default to keep URLs canonical.
      if (state.llmModel === 'minimax/minimax-m3') {
        url.searchParams.delete('llm');
      } else {
        url.searchParams.set('llm', state.llmModel);
      }
      // Slice 4 — ADR 0023 — mirror the provider in ?provider=...
      // Sibling to the ?llm= mirror. Omitted when default so a
      // first-load URL stays canonical (/, no params).
      if (state.provider === 'kilo_code') {
        url.searchParams.delete('provider');
      } else {
        url.searchParams.set('provider', state.provider);
      }
      window.history.replaceState(null, '', url.toString());
    } catch (_) {
      // history.replaceState / URL parsing may fail; the in-memory state
      // is still authoritative for the current session.
    }
  };

  const readStateFromURL = () => {
    try {
      const url = new URL(window.location.href);
      const m = url.searchParams.get('model');
      const v = url.searchParams.get('variant');
      const l = url.searchParams.get('llm');
      const p = url.searchParams.get('provider');
      if (m !== null) state.model = validateModel(m);
      if (v !== null) state.animaVariant = validateVariant(v);
      if (l !== null) state.llmModel = validateLlmModel(l);
      if (p !== null) state.provider = validateProvider(p);
    } catch (_) {
      // Silently fall back to defaults.
    }
  };

  /**
   * Restore state at app boot. Precedence (highest first):
   *   1. URL query string (?model=anima&variant=turbo)
   *   2. localStorage (last-used value)
   *   3. Hard-coded defaults (state initialised at the top of init())
   *
   * Order matters: URL overrides localStorage, which overrides defaults.
   * After hydration, the URL is canonicalised (deletes redundant params)
   * and localStorage is updated to mirror the resolved state.
   */
  const restoreStateFromUrlOrStorage = () => {
    // 1. Pull defaults (state already initialised at the top).
    // 2. Apply localStorage on top.
    readStateFromLocalStorage();
    // 3. Apply URL on top of that.
    readStateFromURL();
    // 4. Persist the resolved state back to localStorage so next boot
    //    sees the same value, and rewrite the URL so it stays in sync.
    writeStateToLocalStorage();
    syncStateToURL();
  };

  /**
   * Render the model picker (a button group). The Anima variant selector
   * is rendered separately (Slice 2.3 puts it in the result panel).
   * Here we only render the two-way picker.
   */
  const renderModelSelector = () => {
    if (!dom.modelSelector) return;
    const buttons = dom.modelSelector.querySelectorAll('[data-model]');
    buttons.forEach((btn) => {
      const isActive = btn.dataset.model === state.model;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const onModelChange = (nextModel) => {
    const validated = validateModel(nextModel);
    if (validated === state.model) return;
    const previousModel = state.model;
    state.model = validated;
    writeStateToLocalStorage();
    syncStateToURL();
    renderModelSelector();

    // Slice 2.4 — ADR 0021 — chat history is per-model. Switching
    // model ends the current chat session and starts a new one on
    // the next generate. This is the resolution of SPEC §14.11 Q3
    // (option a): per-model sessions, not shared history. The two
    // contracts (Z-Image pastel-focal-glow vs. Anima Danbooru-tag
    // rules) have different default-system-prompts; mixing them in
    // a single session would produce inconsistent revisions.
    if (previousModel !== validated && state.chatSessionId) {
      state.chatSessionId = null;
      if (typeof renderChatSessionSelect === 'function') renderChatSessionSelect();
      if (typeof updateChatSendButton === 'function') updateChatSendButton();
    }
  };

  if (dom.modelSelector) {
    dom.modelSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-model]');
      if (!btn) return;
      onModelChange(btn.dataset.model);
    });
  }

  // ─── Slice 4 — ADR 0023 — Provider selector (native <select>) ─────────
  // Sibling to the LLM model selector. Picks the underlying vendor
  // (kilo_code / minimax / alibaba). When the provider changes, the
  // LLM model <select>'s option list is rebuilt from
  // ALLOWED_LLM_MODELS_BY_PROVIDER[state.provider] — the previously
  // selected model is preserved if it's valid for the new provider,
  // otherwise it falls back to the new provider's first allowed model.
  // The rebuild also runs on init() so a deep-link like
  // /?provider=alibaba lands on Alibaba's model list (not the static
  // HTML list which only covers kilo_code).
  const rebuildLlmModelSelectorOptions = () => {
    if (!dom.llmModelSelector) return;
    const allowedModels = ALLOWED_LLM_MODELS_BY_PROVIDER[state.provider] || ALLOWED_LLM_MODELS;
    dom.llmModelSelector.innerHTML = '';
    for (const modelId of allowedModels) {
      const opt = document.createElement('option');
      opt.value = modelId;
      opt.textContent = modelId;
      dom.llmModelSelector.appendChild(opt);
    }
    // If the current llmModel isn't in the new list, fall back.
    if (!allowedModels.includes(state.llmModel)) state.llmModel = allowedModels[0];
  };

  const renderProviderSelector = () => {
    if (!dom.providerSelector) return;
    // First-load deep-link case: state.provider may have been resolved
    // to a non-default provider by readStateFromURL. The static HTML
    // only has kilo_code's 6 options — rebuild for the active provider.
    rebuildLlmModelSelectorOptions();
    dom.providerSelector.value = validateProvider(state.provider);
  };

  const onProviderChange = (nextProvider) => {
    const validated = validateProvider(nextProvider);
    if (validated === state.provider) return;
    const prevProvider = state.provider;
    state.provider = validated;
    rebuildLlmModelSelectorOptions();
    writeStateToLocalStorage();
    syncStateToURL();
    renderProviderSelector();
    renderLlmModelSelector();
    if (prevProvider !== validated) {
      console.log(`[provider] switched ${prevProvider} → ${validated}`);
    }
  };

  if (dom.providerSelector) {
    dom.providerSelector.addEventListener('change', () => {
      onProviderChange(dom.providerSelector.value);
    });
  }

  // ─── Slice 3.3 — ADR 0022 — LLM model selector (native <select>) ──
  // Renders by reflecting state.llmModel onto the <select>'s value;
  // the <option> elements are static in index.html for the default
  // provider (kilo_code) and rebuilt dynamically by onProviderChange
  // when the provider changes. Falls back silently if the cached
  // value isn't in the whitelist (the default then re-asserts itself
  // via validateLlmModel on next read).
  const renderLlmModelSelector = () => {
    if (!dom.llmModelSelector) return;
    dom.llmModelSelector.value = validateLlmModel(state.llmModel);
  };

  const onLlmModelChange = (nextModel) => {
    const validated = validateLlmModel(nextModel);
    if (validated === state.llmModel) return;
    state.llmModel = validated;
    writeStateToLocalStorage();
    syncStateToURL();
    renderLlmModelSelector();
  };

  if (dom.llmModelSelector) {
    dom.llmModelSelector.addEventListener('change', () => {
      onLlmModelChange(dom.llmModelSelector.value);
    });
  }

  // ─── Slide 2.3 — Anima variant selector (in the result panel) ──────
  // Sibling to the model selector. Event delegation via closest. The
  // change only writes to state.animaVariant — the actual prompt
  // generation happens on the next Generate click (no auto-regenerate).
  const onAnimaVariantChange = (nextVariant) => {
    const validated = validateVariant(nextVariant);
    if (validated === state.animaVariant) return;
    state.animaVariant = validated;
    writeStateToLocalStorage();
    syncStateToURL();
    // Re-render the variant selector (toggles .is-active).
    if (dom.animaVariantSelector) {
      const buttons = dom.animaVariantSelector.querySelectorAll('[data-anima-variant]');
      buttons.forEach((btn) => {
        const isActive = btn.dataset.animaVariant === state.animaVariant;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }
  };

  if (dom.animaVariantSelector) {
    dom.animaVariantSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-anima-variant]');
      if (!btn) return;
      onAnimaVariantChange(btn.dataset.animaVariant);
    });
  }

  // Slice 2.3 — Anima regenerate button re-uses the same dispatch path.
  if (dom.animaRegenerateBtn) {
    dom.animaRegenerateBtn.addEventListener('click', runAnimaGenerate);
  }

  // Slice 2.3 — Anima copy button copies both positive + negative as
  // a single block so the user can paste either side independently.
  if (dom.animaCopyBtn) {
    dom.animaCopyBtn.addEventListener('click', async () => {
      const pos = dom.animaResultPositive ? dom.animaResultPositive.value : '';
      const neg = dom.animaResultNegative ? dom.animaResultNegative.value : '';
      const text = `Positive:\n${pos}\n\nNegative:\n${neg}\n`;
      try {
        await navigator.clipboard.writeText(text);
        const orig = dom.animaCopyBtn.textContent;
        dom.animaCopyBtn.textContent = 'Copied!';
        setTimeout(() => { dom.animaCopyBtn.textContent = orig; }, 1500);
      } catch (e) {
        showError(`Copy failed: ${e.message}`);
      }
    });
  }

  // ─── Wire up model selector end ──────────────────────────────────────

  // Directives counter
  dom.directivesInput.addEventListener('input', () => {
    dom.directivesCount.textContent = `${dom.directivesInput.value.length} / 1000`;
  });

  // ─── Copy to clipboard ─────────────────────────────────────────────────

  // ADR 0019 / Issue #12 — when the canonical Z-Image Stage 2 contract is
  // active, the LLM response is a single flowing-paragraph of 150-300
  // words. As a safety net against any future regression (or against a
  // user-pasted Stage 2 override that still emits section markers),
  // strip any leading `== SECTION A ==` header and any trailing
  // `== SECTION B ==` block before copying. The artist pastes this into
  // InvokeAI's prompt field — only the prose paragraph is conditioning;
  // section markers, audit metadata, and labels would be silently fed
  // to the Z-Image encoder as text-in-image glyphs.
  const stripSectionMarkers = (raw) => {
    if (typeof raw !== 'string') return '';
    let text = raw.trim();
    if (!text) return text;
    const sectionA = text.indexOf('== SECTION A ==');
    const sectionB = text.indexOf('== SECTION B ==');
    if (sectionA !== -1) {
      text = text.slice(sectionA + '== SECTION A =='.length);
    }
    if (sectionB !== -1) {
      text = text.slice(0, sectionB);
    }
    return text.trim();
  };

  dom.copyBtn.addEventListener('click', async () => {
    try {
      const cleaned = stripSectionMarkers(dom.resultPrompt.textContent);
      await navigator.clipboard.writeText(cleaned);
      const original = dom.copyBtn.textContent;
      dom.copyBtn.textContent = 'Copied!';
      setTimeout(() => { dom.copyBtn.textContent = original; }, 2000);
    } catch {
      showError('Failed to copy to clipboard.');
    }
  });

  // Expose the stripper on `window` so smoke tests in tests/*.js can reach
  // it without tearing apart the IIFE closure that wraps this file.
  if (typeof window !== 'undefined') window.__imageToPromptCopyStrip = stripSectionMarkers;

  // ─── Error dismissal ───────────────────────────────────────────────────

  dom.errorDismiss.addEventListener('click', hideError);

  // ─── Saved color palettes (ADR 0006) ─────────────────────────────────

  const renderPalettePicker = () => {
    if (!dom.paletteSelect) return;
    const previousValue = state.selectedPaletteId || '';
    dom.paletteSelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '— Auto-analyze colors —';
    dom.paletteSelect.appendChild(defaultOpt);

    state.palettes.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.colors.length} colors)`;
      dom.paletteSelect.appendChild(opt);
    });

    // Restore selection if the palette still exists; otherwise clear.
    const stillExists = previousValue && state.palettes.some((p) => p.id === previousValue);
    dom.paletteSelect.value = stillExists ? previousValue : '';

    if (!stillExists && previousValue) {
      state.selectedPaletteId = null;
    }

    updatePalettePickerHint();
    updatePalettePickerEditBtn();
  };

  const updatePalettePickerHint = () => {
    if (!dom.palettePickerHint) return;
    if (!state.selectedPaletteId) {
      dom.palettePickerHint.hidden = true;
      dom.palettePickerHint.textContent = '';
      return;
    }
    const palette = state.palettes.find((p) => p.id === state.selectedPaletteId);
    if (!palette) {
      dom.palettePickerHint.hidden = true;
      dom.palettePickerHint.textContent = '';
      return;
    }
    const preset = state.presets.find((p) => p.id === palette.source_preset_id);
    const source = preset ? `extracted from "${preset.name}"` : `extracted from ${palette.source_preset_id}`;
    dom.palettePickerHint.hidden = false;
    dom.palettePickerHint.textContent = `Will replace the auto-analyzed colors with ${palette.colors.length} saved color${palette.colors.length === 1 ? '' : 's'} (${source}).`;
  };

  /**
   * Step 1 access to palette editing — the only place the user can pick
   * a saved palette before running an analysis. The button label and
   * disabled state reflect the current picker state:
   *   • no palettes exist           → "Manage palettes…"  (opens manager; useful for creating the first one)
   *   • a palette is selected       → "Edit palette…"     (opens the edit modal for that palette, ADR 0013)
   *   • palettes exist, none picked → "Manage palettes…"  (opens manager so the user can browse / edit / delete)
   * The behavior matches the user's wording "modify the color palettes":
   * selecting a palette gives a one-click path into the per-color editor;
   * otherwise the manager is the right landing surface.
   */
  const updatePalettePickerEditBtn = () => {
    if (!dom.palettePickerEditBtn) return;
    const id = state.selectedPaletteId;
    const palette = id ? state.palettes.find((p) => p.id === id) : null;
    dom.palettePickerEditBtn.disabled = false;
    if (palette) {
      dom.palettePickerEditBtn.textContent = 'Edit palette…';
      dom.palettePickerEditBtn.dataset.mode = 'edit';
      dom.palettePickerEditBtn.dataset.paletteId = palette.id;
      dom.palettePickerEditBtn.setAttribute('aria-label', `Edit the saved palette "${palette.name}"`);
    } else {
      dom.palettePickerEditBtn.textContent = 'Manage palettes…';
      dom.palettePickerEditBtn.dataset.mode = 'manage';
      delete dom.palettePickerEditBtn.dataset.paletteId;
      const any = state.palettes.length > 0;
      dom.palettePickerEditBtn.setAttribute(
        'aria-label',
        any
          ? 'Browse, rename, or delete saved color palettes'
          : 'Create or manage saved color palettes'
      );
    }
  };

  const loadPalettes = async () => {
    // Direct fetch (not apiCall) so we can distinguish a 404 (server is
    // running an older build that doesn't have the palette routes) from
    // a real failure. A 404 is not fatal — the picker just stays empty
    // and the user can proceed without palettes. Surface a clear
    // console hint + a single toast so the operator knows to restart
    // the server to enable the feature.
    try {
      const res = await fetch('/api/palettes');
      if (res.status === 404) {
        console.warn(
          '[palettes] GET /api/palettes returned 404 — the server is running an older ' +
          'build without palette routes. Restart the server (npm start) to enable ' +
          'saved color palettes.'
        );
        showError('Palette endpoints unavailable — restart the server to enable saved palettes.');
        state.palettes = [];
        renderPalettePicker();
        populateApplySelect();
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      state.palettes = data.data || [];
      renderPalettePicker();
      populateApplySelect();
    } catch (e) {
      showError(`Failed to load palettes: ${e.message}`);
    }
  };

  dom.paletteSelect.addEventListener('change', (e) => {
    state.selectedPaletteId = e.target.value || null;
    updatePalettePickerHint();
    updatePalettePickerEditBtn();
  });

  if (dom.palettePickerEditBtn) {
    dom.palettePickerEditBtn.addEventListener('click', () => {
      if (dom.palettePickerEditBtn.dataset.mode === 'edit'
          && dom.palettePickerEditBtn.dataset.paletteId) {
        openEditPaletteModal(dom.palettePickerEditBtn.dataset.paletteId);
      } else {
        openPaletteManagerModal();
      }
    });
  }

  dom.paletteManageBtn.addEventListener('click', () => openPaletteManagerModal());

  // ─── Apply palette (color section) ─────────────────────────────────

  /**
   * Fill the Apply `<select>` in the color section with the current
   * saved palettes. Called on render and after any save / delete so
   * the dropdown stays in sync with /api/palettes.
   */
  const populateApplySelect = () => {
    if (!dom.paletteApplySelect) return;
    const previousValue = dom.paletteApplySelect.value;
    dom.paletteApplySelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.palettes.length === 0
      ? '— No saved palettes —'
      : '— Choose a palette —';
    dom.paletteApplySelect.appendChild(placeholder);

    state.palettes.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.colors.length} colors)`;
      dom.paletteApplySelect.appendChild(opt);
    });

    // Restore previous selection if still valid.
    if (previousValue && state.palettes.some((p) => p.id === previousValue)) {
      dom.paletteApplySelect.value = previousValue;
    }

    updateApplyControls();
  };

  /**
   * Enable / disable the Apply button + select based on whether there
   * are any saved palettes to apply. Mirrors updateSavePaletteButton.
   */
  const updateApplyControls = () => {
    if (!dom.paletteApplySelect || !dom.paletteApplyBtn) return;
    const hasPalettes = state.palettes.length > 0;
    dom.paletteApplySelect.disabled = !hasPalettes;
    dom.paletteApplyBtn.disabled = !hasPalettes || !dom.paletteApplySelect.value;
  };

  /**
   * Replace the current analysis colors with the selected saved palette.
   * Mutates state.currentAnalysis.colors in place (so the chips re-render
   * with the new values) and updates state.lastAnalysisContext so the
   * Save modal would save the NEW colors if the user clicks it next.
   */
  const applySelectedPalette = () => {
    if (!dom.paletteApplySelect) return;
    const paletteId = dom.paletteApplySelect.value;
    if (!paletteId) {
      return showError('Pick a saved palette first.');
    }
    const palette = state.palettes.find((p) => p.id === paletteId);
    if (!palette) {
      return showError('That palette no longer exists.');
    }
    if (!state.currentAnalysis) {
      return showError('Run an analysis first — there are no colors to replace.');
    }

    state.currentAnalysis.colors = palette.colors.map((c) => ({
      hex: typeof c.hex === 'string' ? c.hex.toLowerCase() : c.hex,
      name: typeof c.name === 'string' ? c.name : ''
    }));

    if (state.lastAnalysisContext) {
      state.lastAnalysisContext.colors = state.currentAnalysis.colors.slice();
    }

    // Re-render just the colors input. Calling the full render would
    // clobber any in-progress edits the user has made to other fields
    // (style, lighting, subject, etc.) — same rationale as the
    // Populate-with-AI button.
    const colorsRow = dom.analysisFields.querySelector('.field-row[data-field="colors"]');
    if (colorsRow) {
      const oldChips = colorsRow.querySelector('.colors-chips');
      if (oldChips && typeof window !== 'undefined') {
        // The renderColorsInput closure already mutates state.currentAnalysis.colors
        // and listens for click events on its children. Replace the DOM node
        // wholesale; re-render the chip list inside it.
        const newChips = renderColorsInput(state.currentAnalysis.colors);
        oldChips.replaceWith(newChips);
      }
    }

    showError(`Applied palette "${palette.name}" (${palette.colors.length} colors).`);
  };

  dom.paletteApplyBtn.addEventListener('click', applySelectedPalette);
  dom.paletteApplySelect.addEventListener('change', updateApplyControls);

  // ─── Save palette modal ──────────────────────────────────────────────

  const openSavePaletteModal = () => {
    if (!state.lastAnalysisContext) {
      return showError('Run an analysis first — there is no palette to save yet.');
    }
    const ctx = state.lastAnalysisContext;
    dom.savePaletteNameInput.value = '';
    updateSavePaletteCount();
    const sourcePreset = state.presets.find((p) => p.id === ctx.preset_id);
    const sourceLabel = sourcePreset ? sourcePreset.name : ctx.preset_id;
    dom.savePaletteSource.textContent =
      `Source: preset "${sourceLabel}", ${ctx.colors.length} color${ctx.colors.length === 1 ? '' : 's'}. ` +
      `Run ${ctx.run_id || 'unknown'}.`;
    dom.savePaletteModal.hidden = false;
    dom.savePaletteNameInput.focus();
  };

  const closeSavePaletteModal = () => {
    dom.savePaletteModal.hidden = true;
  };

  const updateSavePaletteCount = () => {
    if (!dom.savePaletteCount) return;
    const len = dom.savePaletteNameInput.value.length;
    dom.savePaletteCount.textContent = `${len} / 60`;
  };

  const savePalette = async () => {
    const ctx = state.lastAnalysisContext;
    if (!ctx) return showError('No analysis context to save from.');
    const name = dom.savePaletteNameInput.value.trim();
    if (!name) return showError('Palette name is required.');
    if (name.length > 60) return showError('Palette name must be 60 characters or fewer.');

    const body = {
      name,
      colors: ctx.colors.map((c) => ({ hex: c.hex, name: c.name || '' })),
      source_run_id: ctx.run_id,
      source_preset_id: ctx.preset_id
    };

    try {
      await apiCall('/api/palettes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      closeSavePaletteModal();
      await loadPalettes();
      hideError();
    } catch (e) {
      showError(`Save failed: ${e.message}`);
    }
  };

  dom.savePaletteBtn.addEventListener('click', openSavePaletteModal);
  dom.savePaletteModalClose.addEventListener('click', closeSavePaletteModal);
  dom.savePaletteCancel.addEventListener('click', closeSavePaletteModal);
  dom.savePaletteForm.addEventListener('submit', (e) => { e.preventDefault(); savePalette(); });
  dom.savePaletteNameInput.addEventListener('input', updateSavePaletteCount);

  // ─── Palette manager modal ──────────────────────────────────────────

  const openPaletteManagerModal = async () => {
    dom.paletteManagerSearch.value = state.paletteManagerSearch;
    state.paletteManagerSort = state.paletteManagerSort || 'newest';
    Array.from(document.querySelectorAll('input[name="palette-sort"]')).forEach((r) => {
      r.checked = r.value === state.paletteManagerSort;
    });
    dom.paletteManagerStatus.textContent = 'Loading…';
    dom.paletteManagerStatus.hidden = false;
    dom.paletteManagerList.hidden = true;
    dom.paletteManagerList.innerHTML = '';
    dom.paletteManagerModal.hidden = false;
    dom.paletteManagerSearch.focus();

    try {
      state.palettes = await apiCall('/api/palettes');
      renderPaletteManagerList();
    } catch (e) {
      dom.paletteManagerStatus.textContent = `Failed to load palettes: ${e.message}`;
    }
  };

  const closePaletteManagerModal = () => {
    dom.paletteManagerModal.hidden = true;
    state.paletteManagerSearch = '';
  };

  const formatRelativeDate = (iso) => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = Date.now() - then;
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.round(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    const yr = Math.round(mo / 12);
    return `${yr}y ago`;
  };

  const renderPaletteManagerList = () => {
    const term = state.paletteManagerSearch.trim().toLowerCase();
    const sort = state.paletteManagerSort || 'newest';

    const filtered = state.palettes
      .filter((p) => !term || (p.name || '').toLowerCase().includes(term))
      .sort((a, b) => {
        const at = new Date(a.created_at || 0).getTime();
        const bt = new Date(b.created_at || 0).getTime();
        return sort === 'oldest' ? at - bt : bt - at;
      });

    dom.paletteManagerList.innerHTML = '';

    if (state.palettes.length === 0) {
      dom.paletteManagerStatus.textContent = 'No saved palettes yet. Run an analysis and click "Save palette…" to create one.';
      dom.paletteManagerStatus.hidden = false;
      dom.paletteManagerList.hidden = true;
      return;
    }
    if (filtered.length === 0) {
      dom.paletteManagerStatus.textContent = `No palettes match "${term}".`;
      dom.paletteManagerStatus.hidden = false;
      dom.paletteManagerList.hidden = true;
      return;
    }

    dom.paletteManagerStatus.hidden = true;
    dom.paletteManagerList.hidden = false;

    filtered.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'palette-manager-item';
      li.dataset.paletteId = p.id;

      const main = document.createElement('div');
      main.className = 'palette-manager-item__main';

      const name = document.createElement('div');
      name.className = 'palette-manager-item__name';
      name.textContent = p.name;
      main.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'palette-manager-item__meta';
      const swatches = document.createElement('span');
      swatches.className = 'palette-manager-item__swatches';
      swatches.setAttribute('aria-hidden', 'true');
      (p.colors || []).slice(0, 12).forEach((c) => {
        const sw = document.createElement('span');
        sw.className = 'palette-manager-item__swatch';
        sw.style.background = c.hex;
        sw.title = `${c.name || ''} ${c.hex}`.trim();
        swatches.appendChild(sw);
      });
      meta.appendChild(swatches);
      const count = document.createElement('span');
      count.textContent = `${(p.colors || []).length} color${(p.colors || []).length === 1 ? '' : 's'}`;
      meta.appendChild(count);
      const when = document.createElement('span');
      when.textContent = formatRelativeDate(p.created_at);
      meta.appendChild(when);
      main.appendChild(meta);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'palette-manager-item__edit';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit palette ${p.name}`);
      edit.addEventListener('click', () => openEditPaletteModal(p.id));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'palette-manager-item__delete';
      del.textContent = 'Delete';
      del.setAttribute('aria-label', `Delete palette ${p.name}`);
      del.addEventListener('click', () => deletePalette(p.id, p.name));

      li.appendChild(main);
      li.appendChild(edit);
      li.appendChild(del);
      dom.paletteManagerList.appendChild(li);
    });
  };

  const deletePalette = async (id, name) => {
    if (!confirm(`Delete saved palette "${name}"? This cannot be undone.`)) return;
    try {
      await apiCall(`/api/palettes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      // Refresh picker list + manager list. If the deleted palette was the
      // selected one, clear the selection so /api/analyze falls back to
      // auto-analysis.
      if (state.selectedPaletteId === id) {
        state.selectedPaletteId = null;
      }
      await loadPalettes();
      renderPaletteManagerList();
    } catch (e) {
      showError(`Delete failed: ${e.message}`);
    }
  };

  dom.paletteManagerModalClose.addEventListener('click', closePaletteManagerModal);
  dom.paletteManagerCancel.addEventListener('click', closePaletteManagerModal);
  dom.paletteManagerSearch.addEventListener('input', (e) => {
    state.paletteManagerSearch = e.target.value;
    renderPaletteManagerList();
  });
  document.querySelectorAll('input[name="palette-sort"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      state.paletteManagerSort = e.target.value;
      renderPaletteManagerList();
    });
  });

  // ─── Edit palette modal (ADR 0013) ───────────────────────────────────

  /**
   * Mirror the server's parseColorInput for client-side preview only.
   * Returns `{ hex }` on success or `{ error }` on failure. Used to
   * keep the live swatch + the saved form in sync as the user types.
   *
   * The server's parseColorInput is the source of truth — this client
   * helper just prevents the UI from showing fake success on an input
   * the server would reject. If the rules ever diverge, the server
   * 400 is still the final word.
   */
  const clientParseColorInput = (raw) => {
    if (typeof raw !== 'string') return { error: 'color value must be a string' };
    const s = raw.trim().toLowerCase();
    if (s.length === 0) return { error: 'color value must not be empty' };

    if (/^#?[0-9a-f]{3}$/.test(s)) {
      const d = s.replace(/^#/, '');
      return { hex: `#${d[0]}${d[0]}${d[1]}${d[1]}${d[2]}${d[2]}` };
    }
    if (/^#?[0-9a-f]{6}$/.test(s)) {
      return { hex: `#${s.replace(/^#/, '')}` };
    }

    const rgbMatch = s.match(/^rgba?\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\)$/);
    if (rgbMatch) {
      if (s.startsWith('rgba(')) return { error: 'rgba() not supported' };
      const r = +rgbMatch[1], g = +rgbMatch[2], b = +rgbMatch[3];
      if ([r, g, b].some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
        return { error: 'rgb() channels must be 0..255' };
      }
      const toHex = (n) => n.toString(16).padStart(2, '0');
      return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}` };
    }

    const hslMatch = s.match(/^hsla?\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)%\s*,\s*([+-]?[\d.]+)%\s*\)$/);
    if (hslMatch) {
      if (s.startsWith('hsla(')) return { error: 'hsla() not supported' };
      const h = +hslMatch[1], sPct = +hslMatch[2], lPct = +hslMatch[3];
      if (!Number.isFinite(h) || h < 0 || h > 360) return { error: 'hsl() hue must be 0..360' };
      if (!Number.isFinite(sPct) || sPct < 0 || sPct > 100) return { error: 'hsl() sat must be 0..100%' };
      if (!Number.isFinite(lPct) || lPct < 0 || lPct > 100) return { error: 'hsl() light must be 0..100%' };
      const sn = sPct / 100, ln = lPct / 100;
      const c = (1 - Math.abs(2 * ln - 1)) * sn;
      const hh = h / 60;
      const x = c * (1 - Math.abs((hh % 2) - 1));
      let r1 = 0, g1 = 0, b1 = 0;
      if (hh < 1) [r1, g1, b1] = [c, x, 0];
      else if (hh < 2) [r1, g1, b1] = [x, c, 0];
      else if (hh < 3) [r1, g1, b1] = [0, c, x];
      else if (hh < 4) [r1, g1, b1] = [0, x, c];
      else if (hh < 5) [r1, g1, b1] = [x, 0, c];
      else [r1, g1, b1] = [c, 0, x];
      const m = ln - c / 2;
      const clamp = (n) => Math.max(0, Math.min(255, n));
      const toHex = (n) => clamp(Math.round((n + m) * 255)).toString(16).padStart(2, '0');
      return { hex: `#${toHex(r1)}${toHex(g1)}${toHex(b1)}` };
    }

    return { error: 'expected #hex, rgb(), or hsl()' };
  };

  /**
   * Client-side mirror of server `prioritiesFromOrder` (ADR 0017).
   * Returns `{ colors, priorities, displayPct }` so the preview bar
   * chart can render the same target distribution the server will
   * compute when the budget block is built. The server is still the
   * source of truth — this client helper just lets the bar widths
   * update live without a round-trip.
   *
   * Priority is the array index (1-based, top = highest). Shares are
   * uniform 1/N (rounded); the proportional control surface lives in
   * the palette-level `strength` knob, not in per-color data.
   */
  const clientNormalizeColorWeights = (colors) => {
    if (!Array.isArray(colors) || colors.length === 0) {
      return { colors: [], priorities: [], displayPct: [] };
    }
    const safe = colors.map((c) => ({
      hex: c && typeof c.hex === 'string' ? c.hex : '',
      name: c && typeof c.name === 'string' ? c.name : '',
      accent: !!(c && c.accent === true),
      placement: (c && typeof c.placement === 'string') ? c.placement : ''
    }));
    const priorities = safe.map((_, i) => i + 1);
    const equalPct = Math.round(100 / safe.length);
    const displayPct = safe.map(() => equalPct);
    return { colors: safe, priorities, displayPct };
  };

  const updateEditPaletteNameCount = () => {
    if (!dom.editPaletteNameCount || !dom.editPaletteNameInput) return;
    dom.editPaletteNameCount.textContent = `${dom.editPaletteNameInput.value.length} / 60`;
  };

  /**
   * Re-render the live preview row at the top of the edit modal.
   * Reads from `state.editingPaletteBuffer.colors` — never from a DOM
   * field that hasn't been committed to the buffer. Also renders the
   * target-distribution bar chart directly below the swatches so the
   * user sees the fractions their weight/accent choices produce
   * before saving (ADR 0014 §6b).
   */
  const renderEditPalettePreview = () => {
    if (!dom.editPalettePreview) return;
    dom.editPalettePreview.innerHTML = '';
    const buf = state.editingPaletteBuffer;
    const colors = (buf && Array.isArray(buf.colors)) ? buf.colors : [];
    if (colors.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'palette-preview__empty';
      empty.textContent = 'No colors yet — add one below.';
      dom.editPalettePreview.appendChild(empty);
      renderEditPaletteDistributionBars([], 0);
      return;
    }
    colors.forEach((c) => {
      const sw = document.createElement('span');
      sw.className = 'palette-preview__swatch';
      sw.style.background = c.hex;
      sw.title = `${c.name || ''} ${c.hex}`.trim();
      dom.editPalettePreview.appendChild(sw);
    });
    const norm = clientNormalizeColorWeights(colors);
    renderEditPaletteDistributionBars(norm.colors, norm.displayPct);
  };

  /**
   * Render the target-distribution bar chart directly below the
   * preview swatches. One row per color: a coloured bar whose width
   * is proportional to the normalised fraction, followed by the
   * display percentage and the color name. Accent colors get a `★`
   * glyph and a coloured outline via `[data-accent="true"]`.
   *
   * The sum annotation is honest about rounding — display percentages
   * may not sum to 100 after rounding (e.g. three equal weights →
   * 33+33+33=99). The UI surfaces this as "Sum: 99% (rounded)" so
   * the user isn't surprised.
   */
  const renderEditPaletteDistributionBars = (colors, displayPct) => {
    const barHost = dom.editPaletteDistribution;
    const sumHost = dom.editPaletteDistributionSum;
    if (!barHost) return;
    barHost.innerHTML = '';
    if (!Array.isArray(colors) || colors.length === 0) {
      if (sumHost) sumHost.textContent = '';
      return;
    }
    colors.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'palette-preview__bar-row';
      row.dataset.colorIndex = String(i);
      if (c.accent === true) row.dataset.accent = 'true';

      const barWrap = document.createElement('div');
      barWrap.className = 'palette-preview__bar-track';
      const bar = document.createElement('div');
      bar.className = 'palette-preview__bar';
      if (c.accent === true) bar.dataset.accent = 'true';
      bar.style.background = c.hex;
      const pct = (Array.isArray(displayPct) && Number.isFinite(displayPct[i]))
        ? displayPct[i] : 0;
      bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(pct));
      // ADR 0017 — bar label includes the priority rank instead of (or
      // alongside) the percent. Both are shown because the percent is
      // still useful at-a-glance even though it no longer drives the
      // LLM directly.
      bar.setAttribute('aria-label',
        `${c.name || 'color'}: priority ${i + 1}, ${pct} percent target${c.accent ? ' (accent)' : ''}`);
      barWrap.appendChild(bar);
      row.appendChild(barWrap);

      const label = document.createElement('span');
      label.className = 'palette-preview__bar-label';
      const star = c.accent === true ? ' <span class="palette-preview__bar-star" aria-hidden="true">★</span>' : '';
      label.innerHTML = `Priority ${i + 1} · ${pct}% · ${c.name || ''}${star}`;
      row.appendChild(label);
      barHost.appendChild(row);
    });
    if (sumHost) {
      const sum = (displayPct || []).reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0);
      sumHost.textContent = sum === 100 ? 'Sum: 100%' : `Sum: ${sum}% (rounded)`;
    }
  };

  /**
   * Re-render the in-line color editor rows. Reads from
   * `state.editingPaletteBuffer.colors`. Each row binds back to the
   * buffer on input (text), input (color picker), and click (remove).
   * The hex text input is validated live — invalid entries mark
   * `aria-invalid="true"` and show an inline error, but the buffer
   * only changes when the entry is valid (the previous valid hex is
   * preserved in the swatch + the actual stored value until then).
   */
  const renderEditPaletteColors = () => {
    if (!dom.editPaletteColorsList) return;
    dom.editPaletteColorsList.innerHTML = '';
    const buf = state.editingPaletteBuffer;
    if (!buf) return;
    buf.colors.forEach((c, i) => {
      const row = document.createElement('li');
      row.className = 'edit-palette-color-row';
      row.dataset.colorIndex = String(i);
      // ADR 0017 — priority is the row's index in the buffer. Top of
      // list = priority 1 (highest). Removed: the per-color `weight`
      // integer and its slider.
      const currentAccent = c.accent === true;
      const currentPlacement = (typeof c.placement === 'string') ? c.placement : '';
      if (currentAccent) row.dataset.accent = 'true';

      // Priority chip (read-only — the live number flips on reorder).
      const priority = document.createElement('span');
      priority.className = 'edit-palette-color-row__priority';
      priority.setAttribute('aria-label', `Priority ${i + 1} of ${buf.colors.length}`);
      priority.textContent = String(i + 1);
      row.appendChild(priority);

      // Drag handle — the sole draggable target. Click-drag (or touch)
      // via SortableJS moves the row.
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'edit-palette-color-row__handle';
      handle.setAttribute('aria-label', `Reorder ${c.name || `color ${i + 1}`} — currently priority ${i + 1}. Use Space then Arrow Up/Down.`);
      handle.title = 'Drag to reorder';
      handle.textContent = '⋮⋮';
      row.appendChild(handle);

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = c.hex;
      picker.className = 'edit-palette-color-row__picker';
      picker.setAttribute('aria-label', `Pick color for ${c.name || `entry ${i + 1}`}`);
      picker.addEventListener('input', () => {
        buf.colors[i] = {
          hex: picker.value, name: c.name || '',
          accent: currentAccent, placement: currentPlacement
        };
        hex.value = picker.value;
        name.value = c.name || '';
        row.removeAttribute('data-invalid');
        if (hexError) hexError.hidden = true;
        hex.removeAttribute('aria-invalid');
        renderEditPalettePreview();
      });
      row.appendChild(picker);

      const hex = document.createElement('input');
      hex.type = 'text';
      hex.value = c.hex;
      hex.placeholder = '#d97706 / rgb(245,158,11) / hsl(36,91%,56%)';
      hex.className = 'text-input edit-palette-color-row__hex';
      hex.setAttribute('aria-label', `Hex/rgb/hsl for ${c.name || `entry ${i + 1}`}`);
      const hexError = document.createElement('span');
      hexError.className = 'edit-palette-color-row__hex-error';
      hexError.setAttribute('role', 'alert');
      hexError.hidden = true;
      hex.addEventListener('input', () => {
        const parsed = clientParseColorInput(hex.value);
        if (parsed.error) {
          hex.setAttribute('aria-invalid', 'true');
          row.dataset.invalid = 'true';
          hexError.textContent = parsed.error;
          hexError.hidden = false;
          return;
        }
        hex.removeAttribute('aria-invalid');
        row.removeAttribute('data-invalid');
        hexError.hidden = true;
        buf.colors[i] = {
          hex: parsed.hex, name: c.name || '',
          accent: currentAccent, placement: currentPlacement
        };
        picker.value = parsed.hex;
        renderEditPalettePreview();
      });
      row.appendChild(hex);
      row.appendChild(hexError);

      const name = document.createElement('input');
      name.type = 'text';
      name.value = c.name || '';
      name.placeholder = 'Color name';
      name.maxLength = 60;
      name.className = 'text-input edit-palette-color-row__name';
      name.setAttribute('aria-label', `Name for color ${i + 1}`);
      name.addEventListener('input', () => {
        buf.colors[i] = {
          hex: c.hex, name: name.value,
          accent: currentAccent, placement: currentPlacement
        };
      });
      row.appendChild(name);

      // ADR 0014 — accent checkbox. When checked, the row gets
      // data-accent="true" (handled by CSS) and the accent count vs cap
      // is reflected in the distribution chart (handled by
      // renderEditPalettePreview).
      const accentLabel = document.createElement('label');
      accentLabel.className = 'edit-palette-color-row__accent-label';
      const accent = document.createElement('input');
      accent.type = 'checkbox';
      accent.checked = currentAccent;
      accent.className = 'edit-palette-color-row__accent';
      accent.id = `edit-palette-color-accent-${i}`;
      accent.setAttribute('aria-describedby', 'edit-palette-accent-max-hint');
      accent.addEventListener('change', () => {
        const v = accent.checked === true;
        if (v) row.dataset.accent = 'true';
        else row.removeAttribute('data-accent');
        if (placementWrap) {
          if (v) placementWrap.style.display = '';
          else { placementWrap.style.display = 'none'; placementInput.value = ''; }
        }
        buf.colors[i] = {
          hex: c.hex, name: c.name || '',
          accent: v,
          placement: v ? currentPlacement : ''
        };
        renderEditPalettePreview();
      });
      accentLabel.appendChild(accent);
      const accentText = document.createElement('span');
      accentText.textContent = 'Accent';
      accentLabel.appendChild(accentText);
      accentLabel.setAttribute('for', accent.id);
      row.appendChild(accentLabel);

      // ADR 0016 — per-color placement region input. Rendered for every
      // row but visually hidden when accent is off.
      const placementWrap = document.createElement('div');
      placementWrap.className = 'edit-palette-color-row__placement-wrap';
      placementWrap.style.display = currentAccent ? '' : 'none';
      const placementLabel = document.createElement('label');
      placementLabel.className = 'edit-palette-color-row__placement-label';
      placementLabel.textContent = 'Placement';
      placementLabel.setAttribute('for', `edit-palette-color-placement-${i}`);
      const placementInput = document.createElement('input');
      placementInput.type = 'text';
      placementInput.value = currentPlacement;
      placementInput.placeholder = 'e.g. upper-left quadrant';
      placementInput.maxLength = 60;
      placementInput.className = 'text-input edit-palette-color-row__placement';
      placementInput.id = `edit-palette-color-placement-${i}`;
      placementInput.setAttribute('aria-label', `Placement region for ${c.name || `color ${i + 1}`}`);
      placementInput.addEventListener('input', () => {
        const v = placementInput.value;
        buf.colors[i] = {
          hex: c.hex, name: c.name || '',
          accent: currentAccent, placement: v
        };
      });
      placementWrap.appendChild(placementLabel);
      placementWrap.appendChild(placementInput);
      row.appendChild(placementWrap);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'edit-palette-color-row__remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove color ${c.name || `entry ${i + 1}`}`);
      remove.addEventListener('click', () => {
        buf.colors.splice(i, 1);
        renderEditPaletteColors();
        renderEditPalettePreview();
      });
      row.appendChild(remove);

      dom.editPaletteColorsList.appendChild(row);
    });

    // ADR 0017 — wire SortableJS for drag-and-drop reordering. The
    // library supports pointer drag + touch drag + keyboard
    // accessibility (Tab to handle, Space to pick up, Arrow Up/Down
    // to move, Space to drop, Escape to cancel — all OOTB).
    wireEditPaletteColorsSortable();
  };

  /**
   * Initialize (or re-initialize) SortableJS on the colors list. We
   * recreate the instance on every render so the data-color-index
   * attributes stay in sync with the new DOM. The onEnd handler
   * rebuilds `state.editingPaletteBuffer.colors` from the new DOM
   * order so the priority chips + preview bars re-render correctly.
   */
  let editPaletteSortable = null;
  const wireEditPaletteColorsSortable = () => {
    if (!dom.editPaletteColorsList) return;
    if (typeof Sortable === 'undefined') return; // script not loaded yet
    if (editPaletteSortable && typeof editPaletteSortable.destroy === 'function') {
      editPaletteSortable.destroy();
    }
    editPaletteSortable = Sortable.create(dom.editPaletteColorsList, {
      handle: '.edit-palette-color-row__handle',
      animation: 150,
      // Don't hijack clicks on the colour picker / hex / name / accent /
      // placement / remove. Note: we deliberately EXCLUDE `button` from
      // this filter — the drag handle IS a <button>. If we listed
      // button here, SortableJS would call preventDefault on every
      // mousedown on the handle and the drag would never start (we hit
      // this exact bug in the cross-browser Playwright run; see
      // tests-runner's dnd-cross-browser.js).
      filter: 'input,textarea,select,label',
      preventOnFilter: false,
      // Hold-and-drag on the handle for touch / keyboard accessibility.
      delay: 0,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      // Force the pointer-event fallback on browsers whose HTML5 native
      // DnD either skips events (headless Chromium under Playwright) or
      // has weird event timing (Firefox 115+ treats dragstart as
      // permission-gated). The pointer-event fallback uses
      // mousemove/touchmove to compute drag position, which Playwright's
      // mouse API drives deterministically. ADR 0017.
      forceFallback: true,
      fallbackOnBody: true,
      // Distinguish genuine drag intent from a slightly-trembling
      // click: Sortable only starts the drag after the pointer has
      // moved this many pixels in any direction. ADRs 0014 / 0016 used
      // an active input gesture; we keep a forgiving threshold so the
      // keyboard accessibility path (Tab → handle → Space → Arrow)
      // still wins without a real pointer move first.
      fallbackTolerance: 3,
      onEnd: () => {
        const buf = state.editingPaletteBuffer;
        if (!buf) return;
        // Rebuild buffer.colors from new DOM order. Each <li> has a
        // data-colorIndex attribute pointing into the pre-reorder array;
        // reading them in DOM order gives the new priority order.
        const newOrder = Array.from(dom.editPaletteColorsList.children)
          .map((li) => parseInt(li.dataset.colorIndex, 10))
          .filter((n) => Number.isInteger(n));
        if (newOrder.length !== buf.colors.length) return;
        buf.colors = newOrder.map((idx) => buf.colors[idx]);
        renderEditPaletteColors();
        renderEditPalettePreview();
      }
    });

    // Test hook — a custom DOM event lets the cross-browser Playwright
    // sweep drive the same buffer rebuild path that real Sortable
    // drag ends would. Used only by the headless test harness when
    // sub-frame pointer events don't deliver to SortableJS (Firefox /
    // mobile Chromium under Playwright can drop sub-frame events).
    if (!editPaletteColorsSortableTestHook) {
      editPaletteColorsSortableTestHook = true;
      dom.editPaletteColorsList.addEventListener('test:sortable:end', () => {
        const buf = state.editingPaletteBuffer;
        if (!buf) return;
        const newOrder = Array.from(dom.editPaletteColorsList.children)
          .map((li) => parseInt(li.dataset.colorIndex, 10))
          .filter((n) => Number.isInteger(n));
        if (newOrder.length !== buf.colors.length) return;
        buf.colors = newOrder.map((idx) => buf.colors[idx]);
        renderEditPaletteColors();
        renderEditPalettePreview();
      });
    }
  };
  let editPaletteColorsSortableTestHook = false;

  /**
   * Render the version history list. Each entry shows version + relative
   * time + a row of swatches; non-current entries expose a Restore
   * button. The current entry (highest version) is marked.
   */
  const renderPaletteHistoryList = (palette) => {
    if (!dom.paletteHistoryList) return;
    dom.paletteHistoryList.innerHTML = '';
    const history = Array.isArray(palette.history) ? palette.history : [];
    if (history.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'palette-history-item palette-history-item--empty';
      empty.textContent = 'No history yet.';
      dom.paletteHistoryList.appendChild(empty);
      return;
    }
    const sorted = history.slice().sort((a, b) => b.version - a.version);
    const latest = Math.max(...history.map((h) => h.version));
    sorted.forEach((h) => {
      const li = document.createElement('li');
      li.className = 'palette-history-item';
      if (h.version === latest) li.classList.add('is-current');

      const v = document.createElement('span');
      v.className = 'palette-history-item__version';
      v.textContent = `v${h.version}${h.version === latest ? ' (current)' : ''}`;
      li.appendChild(v);

      const when = document.createElement('span');
      when.className = 'palette-history-item__when';
      when.textContent = formatRelativeDate(h.saved_at);
      li.appendChild(when);

      const swatches = document.createElement('span');
      swatches.className = 'palette-history-item__swatches';
      swatches.setAttribute('aria-hidden', 'true');
      (h.colors || []).forEach((c) => {
        const sw = document.createElement('span');
        sw.className = 'palette-history-item__swatch';
        sw.style.background = c.hex;
        sw.title = `${c.name || ''} ${c.hex}`.trim();
        swatches.appendChild(sw);
      });
      li.appendChild(swatches);

      if (h.version !== latest) {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn-secondary palette-history-item__restore';
        restore.textContent = 'Restore';
        restore.setAttribute('aria-label', `Restore version ${h.version} from ${formatRelativeDate(h.saved_at)}`);
        restore.addEventListener('click', () => restorePaletteVersion(h.version));
        li.appendChild(restore);
      }

      dom.paletteHistoryList.appendChild(li);
    });
  };

  /**
   * Render the distribution dashboard panel inside the edit modal.
   * ADR 0014 Phase 4 — fetches the latest telemetry entry from
   * GET /api/palettes/:id/distribution and renders a target vs
   * measured comparison table. Falls back to an "empty" message when
   * the palette has no recorded runs yet (404 from the endpoint).
   *
   * The dashboard panel is hidden in "new palette" mode (no id yet,
   * nothing to query) and shown in "edit existing" mode.
   */
  const renderDistributionPanel = async (paletteId) => {
    const details = dom.editPaletteDistributionDetails;
    const empty = dom.editPaletteDistributionEmpty;
    const content = dom.editPaletteDistributionContent;
    if (!details || !empty || !content) return;

    if (!paletteId) {
      details.hidden = true;
      return;
    }
    details.hidden = false;
    empty.hidden = true;
    content.hidden = true;
    if (dom.editPaletteDistributionRecordedAt) dom.editPaletteDistributionRecordedAt.textContent = '';
    if (dom.editPaletteDistributionMentions) dom.editPaletteDistributionMentions.textContent = '';
    if (dom.editPaletteDistributionTbody) dom.editPaletteDistributionTbody.innerHTML = '';

    let data;
    try {
      const res = await apiCall(`/api/palettes/${encodeURIComponent(paletteId)}/distribution`);
      data = res;
    } catch (e) {
      // 404 (no runs yet) is the expected state for newly-saved
      // palettes; surface it as the empty message. Anything else is a
      // genuine error and gets a small inline status note.
      if (/not found|no distribution/i.test(e.message || '')) {
        empty.hidden = false;
        return;
      }
      empty.textContent = `Failed to load distribution: ${e.message}`;
      empty.hidden = false;
      return;
    }

    if (!data || !data.metrics || !Array.isArray(data.metrics.counts)) {
      empty.hidden = false;
      return;
    }

    // Compute target fractions from the palette's stored colors (using
    // the same clientNormalizeColorWeights as the live preview, so
    // target bars in the dashboard line up with the bars above).
    const targetNorm = clientNormalizeColorWeights(data.colors || []);
    const counts = data.metrics.counts;
    const totalWords = Number.isFinite(data.metrics.totalWords) ? data.metrics.totalWords : 0;
    const totalMentions = Number.isFinite(data.metrics.totalMentions) ? data.metrics.totalMentions : 0;

    if (dom.editPaletteDistributionRecordedAt) {
      const when = formatRelativeDate(data.recorded_at);
      dom.editPaletteDistributionRecordedAt.textContent = `Last run ${when}`;
    }
    if (dom.editPaletteDistributionMentions) {
      dom.editPaletteDistributionMentions.textContent =
        `${totalMentions} mention${totalMentions === 1 ? '' : 's'} across ${totalWords} word${totalWords === 1 ? '' : 's'}`;
    }
    if (dom.editPaletteDistributionTbody) {
      dom.editPaletteDistributionTbody.innerHTML = '';
      targetNorm.colors.forEach((c, i) => {
        const target = targetNorm.displayPct[i] || 0;
        const measured = (counts[i] && Number.isFinite(counts[i].totalCount))
          ? counts[i].totalCount : 0;
        const accentTag = c.accent === true ? ' <span class="palette-distribution-accent-mark" aria-hidden="true">★</span>' : '';
        const tr = document.createElement('tr');
        if (c.accent === true) tr.dataset.accent = 'true';
        // ADR 0017 — target column is "Priority N (~NN% share)" so the
        // dashboard surfaces the order AND the residual uniform share.
        tr.innerHTML = `
          <th scope="row">
            <span class="palette-distribution-swatch" style="background:${c.hex}" aria-hidden="true"></span>
            ${c.name || ''}${accentTag}
          </th>
          <td class="palette-distribution-target-cell">priority ${i + 1} (~${target}% share)</td>
          <td class="palette-distribution-measured-cell">${measured}</td>
        `;
        dom.editPaletteDistributionTbody.appendChild(tr);
      });
    }
    content.hidden = false;
  };

  /**
   * Open the edit modal in "edit existing palette" mode.
   * Loads the palette by id, copies its current state into the buffer,
   * and re-fetches in the background so a parallel editor's changes
   * surface (mirrors the directive pattern).
   */
  const openEditPaletteModal = async (id) => {
    let palette = state.palettes.find((p) => p.id === id);
    if (!palette) {
      showError('That palette no longer exists.');
      return;
    }
    state.editingPaletteId = id;
    state.editingPaletteIsNew = false;
    populateEditPaletteBuffer(palette);
    paintEditPaletteModal();
    dom.editPaletteModal.hidden = false;
    dom.editPaletteNameInput.focus();

    try {
      const fresh = await apiCall(`/api/palettes/${encodeURIComponent(id)}`);
      const idx = state.palettes.findIndex((p) => p.id === id);
      if (idx !== -1) state.palettes[idx] = fresh;
      // Only re-populate if the modal is still open and editing this id
      // (user may have closed it during the fetch).
      if (!dom.editPaletteModal.hidden && state.editingPaletteId === id) {
        populateEditPaletteBuffer(fresh);
        paintEditPaletteModal();
      }
    } catch (e) {
      console.warn('Failed to refresh palette in edit modal:', e.message);
    }
  };

  /**
   * Open the edit modal in "new palette" mode (empty fields, no history).
   * The save path goes through `POST /api/palettes/custom`.
   */
  const openNewPaletteModal = () => {
    state.editingPaletteId = null;
    state.editingPaletteIsNew = true;
    state.editingPaletteBuffer = { name: '', colors: [], accent_max_mentions: 2, strength: 'moderate' };
    paintEditPaletteModal();
    dom.editPaletteModal.hidden = false;
    dom.editPaletteNameInput.focus();
  };

  const closeEditPaletteModal = () => {
    dom.editPaletteModal.hidden = true;
    state.editingPaletteId = null;
    state.editingPaletteIsNew = false;
    state.editingPaletteBuffer = null;
  };

  /**
   * Copy a palette's current state into the edit buffer. We deep-copy
   * the colors (ADR 0017 — drop the per-color `weight` field; keep
   * accent + ADR 0016 placement) so user edits don't mutate the cached
   * palette until Save commits.
   */
  const populateEditPaletteBuffer = (palette) => {
    state.editingPaletteBuffer = {
      name: palette.name || '',
      colors: (palette.colors || []).map((c) => ({
        hex: c.hex,
        name: c.name || '',
        accent: c.accent === true,
        placement: (typeof c.placement === 'string') ? c.placement : ''
      })),
      accent_max_mentions: (Number.isInteger(palette.accent_max_mentions)
                              && palette.accent_max_mentions >= 1
                              && palette.accent_max_mentions <= 5)
        ? palette.accent_max_mentions : 2,
      strength: ['subtle', 'moderate', 'strong', 'strict'].includes(palette.strength)
        ? palette.strength : 'moderate'
    };
  };

  /**
   * Push the current buffer into the form fields and re-render the
   * dynamic sub-views (preview, color editor, history). Called on
   * open and after a Restore.
   */
  const paintEditPaletteModal = () => {
    const buf = state.editingPaletteBuffer;
    const palette = state.editingPaletteId
      ? state.palettes.find((p) => p.id === state.editingPaletteId)
      : null;

    if (state.editingPaletteIsNew) {
      dom.editPaletteModalTitle.textContent = 'New palette';
      dom.editPaletteDelete.hidden = true;
      if (dom.editPaletteSourceRow) dom.editPaletteSourceRow.hidden = true;
    } else {
      dom.editPaletteModalTitle.textContent = 'Edit palette';
      dom.editPaletteDelete.hidden = false;
      if (dom.editPaletteSourceRow && palette) {
        const parts = [];
        if (palette.source_preset_id) parts.push(`preset ${palette.source_preset_id}`);
        if (palette.source_run_id) parts.push(`run ${palette.source_run_id}`);
        else parts.push('custom');
        dom.editPaletteSource.textContent = parts.join(' · ');
        dom.editPaletteSourceRow.hidden = false;
      }
    }

    dom.editPaletteNameInput.value = (buf && buf.name) || '';
    updateEditPaletteNameCount();
    dom.editPaletteNameError.hidden = true;
    dom.editPaletteNameError.textContent = '';
    // ADR 0014 — accent cap input. Set from the buffer (or 2 default).
    if (dom.editPaletteAccentMax) {
      const cap = (buf && Number.isInteger(buf.accent_max_mentions)
                    && buf.accent_max_mentions >= 1
                    && buf.accent_max_mentions <= 5)
        ? buf.accent_max_mentions : 2;
      dom.editPaletteAccentMax.value = String(cap);
    }
    // ADR 0016 — strength dropdown. Defaults to 'moderate' when the
    // buffer is missing/invalid (mirrors the readPalettes synthesis).
    if (dom.editPaletteStrength) {
      const allowed = ['subtle', 'moderate', 'strong', 'strict'];
      const s = (buf && allowed.includes(buf.strength)) ? buf.strength : 'moderate';
      dom.editPaletteStrength.value = s;
    }
    renderEditPaletteColors();
    renderEditPalettePreview();
    if (dom.editPaletteAddError) {
      dom.editPaletteAddError.hidden = true;
      dom.editPaletteAddError.textContent = '';
    }
    if (palette) renderPaletteHistoryList(palette);
    else renderPaletteHistoryList({ history: [] });
    // ADR 0014 Phase 4 — fetch + render the distribution dashboard.
    // Only meaningful when editing an existing palette (paletteId is
    // set). For "new palette" mode, renderDistributionPanel hides the
    // details block entirely.
    renderDistributionPanel(state.editingPaletteId);
  };

  /**
   * Save handler — branches between "new" (POST /api/palettes/custom)
   * and "edit" (PUT /api/palettes/:id). Client-side validates first so
   * we never fire a request that the server would 400 on a basic
   * shape check.
   */
  const submitEditPalette = async () => {
    const buf = state.editingPaletteBuffer;
    if (!buf) return;

    hideError();
    if (dom.editPaletteNameError) {
      dom.editPaletteNameError.hidden = true;
      dom.editPaletteNameError.textContent = '';
    }
    if (dom.editPaletteAddError) {
      dom.editPaletteAddError.hidden = true;
      dom.editPaletteAddError.textContent = '';
    }

    const name = (buf.name || '').trim();
    if (!name) {
      if (dom.editPaletteNameError) {
        dom.editPaletteNameError.textContent = 'Palette name is required.';
        dom.editPaletteNameError.hidden = false;
      }
      dom.editPaletteNameInput.focus();
      return;
    }
    if (name.length > 60) {
      if (dom.editPaletteNameError) {
        dom.editPaletteNameError.textContent = 'Palette name must be 60 characters or fewer.';
        dom.editPaletteNameError.hidden = false;
      }
      return;
    }
    if (!Array.isArray(buf.colors) || buf.colors.length === 0) {
      if (dom.editPaletteAddError) {
        dom.editPaletteAddError.textContent = 'At least one color is required.';
        dom.editPaletteAddError.hidden = false;
      }
      return;
    }
    if (buf.colors.length > 50) {
      if (dom.editPaletteAddError) {
        dom.editPaletteAddError.textContent = 'A palette can have at most 50 colors.';
        dom.editPaletteAddError.hidden = false;
      }
      return;
    }
    for (let i = 0; i < buf.colors.length; i++) {
      const c = buf.colors[i];
      if (!c || typeof c.hex !== 'string' || !/^#[0-9a-f]{6}$/.test(c.hex)) {
        if (dom.editPaletteAddError) {
          dom.editPaletteAddError.textContent = `Color ${i + 1}: invalid hex "${c && c.hex}"`;
          dom.editPaletteAddError.hidden = false;
        }
        return;
      }
      // ADR 0017 — per-color `weight` is no longer accepted. Any legacy
      // entries that still carry it are silently stripped on save so
      // the body sent to the server is clean. Belt-and-braces: if a
      // builder ever reintroduces the field, the server rejects with 400.
      if (c.weight !== undefined) {
        const { weight: _discardWeight, ...clean } = c;
        buf.colors[i] = clean;
      }
      if (c.accent !== undefined && typeof c.accent !== 'boolean') {
        if (dom.editPaletteAddError) {
          dom.editPaletteAddError.textContent = `Color ${i + 1}: accent must be true or false (got ${typeof c.accent})`;
          dom.editPaletteAddError.hidden = false;
        }
        return;
      }
    }
    // ADR 0014 — palette-level accent cap range check (matches the
    // server's validatePaletteAccentMaxMentions: integer 1..5).
    const accentMaxMentions = (buf && Number.isInteger(buf.accent_max_mentions))
      ? buf.accent_max_mentions : 2;
    if (accentMaxMentions < 1 || accentMaxMentions > 5) {
      if (dom.editPaletteAddError) {
        dom.editPaletteAddError.textContent = `Accent cap must be between 1 and 5 (got ${accentMaxMentions}).`;
        dom.editPaletteAddError.hidden = false;
      }
      return;
    }
    // ADR 0016 — palette-level strength (defaults to 'moderate' so the
    // server receives a defined value).
    const allowedStrengths = ['subtle', 'moderate', 'strong', 'strict'];
    const strength = (buf && allowedStrengths.includes(buf.strength))
      ? buf.strength : 'moderate';

    try {
      let saved;
      const body = {
        name,
        colors: buf.colors,
        accent_max_mentions: accentMaxMentions,
        strength
      };
      if (state.editingPaletteIsNew) {
        saved = await apiCall('/api/palettes/custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        const id = state.editingPaletteId;
        if (!id) return;
        saved = await apiCall(`/api/palettes/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }
      const idx = state.palettes.findIndex((p) => p.id === saved.id);
      if (idx !== -1) state.palettes[idx] = saved;
      else state.palettes.push(saved);
      renderPalettePicker();
      populateApplySelect();
      renderPaletteManagerList();
      closeEditPaletteModal();
    } catch (e) {
      const msg = (e && e.message) || 'Save failed.';
      if (/name/i.test(msg) && /already in use/i.test(msg)) {
        if (dom.editPaletteNameError) {
          dom.editPaletteNameError.textContent = msg;
          dom.editPaletteNameError.hidden = false;
        }
      } else if (/colors/i.test(msg) || /accent_max_mentions/i.test(msg)) {
        if (dom.editPaletteAddError) {
          dom.editPaletteAddError.textContent = msg;
          dom.editPaletteAddError.hidden = false;
        }
      } else {
        showError(`Save failed: ${msg}`);
      }
    }
  };

  const deletePaletteFromEdit = async () => {
    const id = state.editingPaletteId;
    if (!id) return;
    const palette = state.palettes.find((p) => p.id === id);
    if (!palette) return;
    await deletePalette(id, palette.name);
    if (!dom.paletteManagerModal.hidden) {
      renderPaletteManagerList();
    }
    closeEditPaletteModal();
  };

  const restorePaletteVersion = async (version) => {
    const id = state.editingPaletteId;
    if (!id) return;
    if (!confirm(`Restore version ${version}? The current values will be saved as a new version before the rollback takes effect.`)) return;
    try {
      const updated = await apiCall(`/api/palettes/${encodeURIComponent(id)}/restore/${encodeURIComponent(version)}`, { method: 'POST' });
      const idx = state.palettes.findIndex((p) => p.id === id);
      if (idx !== -1) state.palettes[idx] = updated;
      populateEditPaletteBuffer(updated);
      paintEditPaletteModal();
      renderPalettePicker();
      populateApplySelect();
      hideError();
    } catch (e) {
      showError(`Restore failed: ${e.message}`);
    }
  };

  /**
   * Wire the add-color row at the bottom of the edit modal. The color
   * picker and the hex text input stay in sync; on Add we parse the
   * text (any of the three formats) and append to the buffer.
   */
  const wireAddColorRow = () => {
    if (!dom.editPaletteAddPicker) return;
    dom.editPaletteAddPicker.addEventListener('input', () => {
      dom.editPaletteAddHex.value = dom.editPaletteAddPicker.value;
      if (dom.editPaletteAddError) {
        dom.editPaletteAddError.hidden = true;
        dom.editPaletteAddError.textContent = '';
      }
    });
    dom.editPaletteAddHex.addEventListener('input', () => {
      const parsed = clientParseColorInput(dom.editPaletteAddHex.value);
      if (!parsed.error && dom.editPaletteAddPicker) {
        dom.editPaletteAddPicker.value = parsed.hex;
      }
      if (dom.editPaletteAddError) {
        if (parsed.error) {
          dom.editPaletteAddError.textContent = parsed.error;
          dom.editPaletteAddError.hidden = false;
        } else {
          dom.editPaletteAddError.hidden = true;
          dom.editPaletteAddError.textContent = '';
        }
      }
    });
    dom.editPaletteAddBtn.addEventListener('click', () => {
      const hexRaw = dom.editPaletteAddHex.value;
      const parsed = clientParseColorInput(hexRaw);
      if (parsed.error) {
        if (dom.editPaletteAddError) {
          dom.editPaletteAddError.textContent = parsed.error;
          dom.editPaletteAddError.hidden = false;
        }
        return;
      }
      const name = dom.editPaletteAddName.value.trim() || 'color';
      const buf = state.editingPaletteBuffer;
      if (!buf.colors) buf.colors = [];
      if (buf.colors.length >= 50) {
        if (dom.editPaletteAddError) {
          dom.editPaletteAddError.textContent = 'A palette can have at most 50 colors.';
          dom.editPaletteAddError.hidden = false;
        }
        return;
      }
      buf.colors.push({ hex: parsed.hex, name, accent: false });
      dom.editPaletteAddHex.value = '#3b82f6';
      dom.editPaletteAddName.value = '';
      if (dom.editPaletteAddPicker) dom.editPaletteAddPicker.value = '#3b82f6';
      if (dom.editPaletteAddError) {
        dom.editPaletteAddError.hidden = true;
        dom.editPaletteAddError.textContent = '';
      }
      renderEditPaletteColors();
      renderEditPalettePreview();
    });
  };

  // Wire the edit modal once at startup.
  if (dom.editPaletteModalClose) dom.editPaletteModalClose.addEventListener('click', closeEditPaletteModal);
  if (dom.editPaletteCancel) dom.editPaletteCancel.addEventListener('click', closeEditPaletteModal);
  if (dom.editPaletteDelete) dom.editPaletteDelete.addEventListener('click', deletePaletteFromEdit);
  if (dom.editPaletteForm) dom.editPaletteForm.addEventListener('submit', (e) => { e.preventDefault(); submitEditPalette(); });
  if (dom.editPaletteNameInput) {
    dom.editPaletteNameInput.addEventListener('input', () => {
      if (state.editingPaletteBuffer) state.editingPaletteBuffer.name = dom.editPaletteNameInput.value;
      updateEditPaletteNameCount();
    });
  }
  // ADR 0014 — accent cap input: integer 1..5. Clamps out-of-range
  // values back into the valid range so the buffer stays clean for
  // the next submit.
  if (dom.editPaletteAccentMax) {
    dom.editPaletteAccentMax.addEventListener('input', () => {
      if (!state.editingPaletteBuffer) return;
      const raw = parseInt(dom.editPaletteAccentMax.value, 10);
      const clamped = Math.max(1, Math.min(5, Number.isInteger(raw) ? raw : 2));
      state.editingPaletteBuffer.accent_max_mentions = clamped;
      if (dom.editPaletteAccentMax.value !== String(clamped)) {
        dom.editPaletteAccentMax.value = String(clamped);
      }
    });
  }
  // ADR 0016 — palette strength dropdown. Server validates membership
  // in ['subtle','moderate','strong','strict']; we filter invalid
  // values back to the default to keep the buffer clean.
  if (dom.editPaletteStrength) {
    dom.editPaletteStrength.addEventListener('change', () => {
      if (!state.editingPaletteBuffer) return;
      const v = dom.editPaletteStrength.value;
      const allowed = ['subtle', 'moderate', 'strong', 'strict'];
      state.editingPaletteBuffer.strength = allowed.includes(v) ? v : 'moderate';
    });
  }
  wireAddColorRow();
  if (dom.paletteManagerNewBtn) dom.paletteManagerNewBtn.addEventListener('click', () => openNewPaletteModal());

  // ─── Saved directives (ADR 0009) ────────────────────────────────────

  /**
   * Tag normalization — mirrors the server's normalizeDirectiveTags
   * rules so the client-side preview + filter behave identically to
   * what the server will accept on POST/PUT. Lowercase, kebab-case,
   * non-empty, <= 24 chars.
   */
  const clientNormalizeTag = (raw) => {
    if (typeof raw !== 'string') return null;
    const t = raw.trim().toLowerCase();
    if (t.length === 0) return null;
    if (t.length > 24) return null;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) return null;
    return t;
  };

  const clientNormalizeTagsInput = (raw) => {
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => clientNormalizeTag(s))
      .filter((t) => t !== null);
  };

  /**
   * Fetch all saved directives from the server. Like palettes, a 404
   * is treated as "feature unavailable — server is on an older build",
   * not a fatal error. The select stays empty and the user can still
   * type into the textarea.
   */
  const loadDirectives = async () => {
    try {
      const res = await fetch('/api/directives');
      if (res.status === 404) {
        console.warn(
          '[directives] GET /api/directives returned 404 — the server is running an older ' +
          'build without directive routes. Restart the server (npm start) to enable saved directives.'
        );
        showError('Directive endpoints unavailable — restart the server to enable saved directives.');
        state.directives = [];
        renderDirectivesSelect();
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      state.directives = Array.isArray(data.data) ? data.data : [];
      renderDirectivesSelect();
    } catch (e) {
      showError(`Failed to load directives: ${e.message}`);
    }
  };

  /**
   * Repopulate the "Choose a saved directive" <select> from
   * state.directives. Called on init, after every save, after delete,
   * and after import. Preserves the previous selection if the
   * directive still exists.
   */
  const renderDirectivesSelect = () => {
    if (!dom.directivesSelect) return;
    const previous = state.selectedDirectiveId || '';
    dom.directivesSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.directives.length === 0
      ? '— No saved directives —'
      : '— Choose a saved directive —';
    dom.directivesSelect.appendChild(placeholder);

    state.directives.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      const uses = d.usage_count || 0;
      const useLabel = uses === 1 ? '1 use' : `${uses} uses`;
      opt.textContent = `${d.name} (${useLabel})`;
      dom.directivesSelect.appendChild(opt);
    });

    if (previous && state.directives.some((d) => d.id === previous)) {
      dom.directivesSelect.value = previous;
    } else {
      state.selectedDirectiveId = null;
    }
    updateDirectivesActions();
  };

  /**
   * Enable / disable Apply + Save buttons based on current state.
   *   - Apply needs a selection in the <select>
   *   - Save needs a non-empty (trimmed) textarea
   */
  const updateDirectivesActions = () => {
    if (dom.directivesApplyBtn) {
      dom.directivesApplyBtn.disabled = !state.selectedDirectiveId;
    }
    if (dom.directivesSaveBtn) {
      const hasContent = !!(dom.directivesInput.value || '').trim();
      dom.directivesSaveBtn.disabled = !hasContent;
    }
  };

  /**
   * Load the selected directive's content into the textarea and
   * record usage on the server. Closes the manager modal if open so
   * the user sees the textarea update.
   */
  const applySelectedDirective = async () => {
    if (!state.selectedDirectiveId) {
      return showError('Pick a saved directive first.');
    }
    const directive = state.directives.find((d) => d.id === state.selectedDirectiveId);
    if (!directive) {
      return showError('That directive no longer exists.');
    }
    dom.directivesInput.value = directive.content || '';
    dom.directivesInput.dispatchEvent(new Event('input'));
    hideError();
    if (!dom.directivesManagerModal.hidden) {
      closeDirectivesManagerModal();
    }
    try {
      await apiCall(`/api/directives/${encodeURIComponent(directive.id)}/apply`, { method: 'POST' });
      // Refresh local state so the next open of the manager reflects
      // the new usage count. Failure to update stats is non-fatal —
      // the user has already applied the directive.
      const refreshed = state.directives.find((d) => d.id === directive.id);
      if (refreshed) {
        refreshed.usage_count = (refreshed.usage_count || 0) + 1;
        refreshed.last_used_at = new Date().toISOString();
        renderDirectivesSelect();
      }
    } catch (e) {
      // Don't block on apply-tracking failure — the content is in the
      // textarea. Surface as a warning.
      console.warn('Failed to record directive usage:', e.message);
    }
    showError(`Applied directive "${directive.name}".`);
  };

  // ─── Save directive modal ──────────────────────────────────────────

  const openSaveDirectiveModal = () => {
    const content = (dom.directivesInput.value || '').trim();
    if (!content) {
      return showError('Type something in the directives box first — there is nothing to save.');
    }
    dom.saveDirectiveNameInput.value = '';
    dom.saveDirectiveTagsInput.value = '';
    dom.saveDirectiveContentPreview.textContent = dom.directivesInput.value;
    updateSaveDirectiveCount();
    dom.saveDirectiveModal.hidden = false;
    dom.saveDirectiveNameInput.focus();
  };

  const closeSaveDirectiveModal = () => {
    dom.saveDirectiveModal.hidden = true;
  };

  const updateSaveDirectiveCount = () => {
    if (!dom.saveDirectiveCount) return;
    const len = dom.saveDirectiveNameInput.value.length;
    dom.saveDirectiveCount.textContent = `${len} / 60`;
  };

  const saveDirective = async () => {
    const name = dom.saveDirectiveNameInput.value.trim();
    if (!name) return showError('Directive name is required.');
    if (name.length > 60) return showError('Directive name must be 60 characters or fewer.');

    const content = dom.directivesInput.value;
    if (!content.trim()) return showError('Directive content is empty.');
    if (content.length > 1000) return showError('Directive content must be 1000 characters or fewer.');

    const tags = clientNormalizeTagsInput(dom.saveDirectiveTagsInput.value);

    try {
      const created = await apiCall('/api/directives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, tags })
      });
      closeSaveDirectiveModal();
      // Optimistically add to local state and re-render the select,
      // then refresh from the server in the background.
      state.directives.push(created);
      state.selectedDirectiveId = created.id;
      renderDirectivesSelect();
      hideError();
      loadDirectives();
    } catch (e) {
      showError(`Save failed: ${e.message}`);
    }
  };

  dom.directivesSaveBtn.addEventListener('click', openSaveDirectiveModal);
  dom.saveDirectiveModalClose.addEventListener('click', closeSaveDirectiveModal);
  dom.saveDirectiveCancel.addEventListener('click', closeSaveDirectiveModal);
  dom.saveDirectiveForm.addEventListener('submit', (e) => { e.preventDefault(); saveDirective(); });
  dom.saveDirectiveNameInput.addEventListener('input', updateSaveDirectiveCount);

  // Apply button
  dom.directivesApplyBtn.addEventListener('click', applySelectedDirective);
  dom.directivesSelect.addEventListener('change', (e) => {
    state.selectedDirectiveId = e.target.value || null;
    updateDirectivesActions();
  });

  // Save / Apply enable state on textarea edits
  dom.directivesInput.addEventListener('input', updateDirectivesActions);

  // ─── Manage directives modal ───────────────────────────────────────

  const openDirectivesManagerModal = async () => {
    state.directiveManagerSearch = state.directiveManagerSearch || '';
    state.directiveManagerSort = state.directiveManagerSort || 'newest';
    state.directiveTagFilter = Array.isArray(state.directiveTagFilter) ? state.directiveTagFilter : [];

    dom.directivesManagerSearch.value = state.directiveManagerSearch;
    Array.from(document.querySelectorAll('input[name="directive-sort"]')).forEach((r) => {
      r.checked = r.value === state.directiveManagerSort;
    });
    dom.directivesManagerStatus.textContent = 'Loading…';
    dom.directivesManagerStatus.hidden = false;
    dom.directivesManagerList.hidden = true;
    dom.directivesManagerList.innerHTML = '';
    dom.directivesManagerModal.hidden = false;
    dom.directivesManagerSearch.focus();

    try {
      state.directives = await apiCall('/api/directives');
      renderDirectivesManagerList();
    } catch (e) {
      dom.directivesManagerStatus.textContent = `Failed to load directives: ${e.message}`;
    }
  };

  const closeDirectivesManagerModal = () => {
    dom.directivesManagerModal.hidden = true;
    state.directiveManagerSearch = '';
    state.directiveTagFilter = [];
  };

  /**
   * Compute the union of all tags across the current directive list
   * with usage counts. Returns a Map<tag, count> sorted by count desc,
   * then alphabetical.
   */
  const computeTagUnion = () => {
    const counts = new Map();
    for (const d of state.directives) {
      for (const t of (d.tags || [])) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    const entries = Array.from(counts.entries());
    entries.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    return entries;
  };

  /**
   * Render the tag-filter chip row. Each chip is a toggle button;
   * active chips are visually distinct. The chip filter is AND: a
   * directive must contain ALL active tags to be visible.
   */
  const renderDirectiveTagFilter = () => {
    const union = computeTagUnion();
    if (union.length === 0) {
      dom.directivesTagFilter.hidden = true;
      dom.directivesTagFilter.innerHTML = '';
      return;
    }
    dom.directivesTagFilter.hidden = false;
    dom.directivesTagFilter.innerHTML = '';

    const label = dom.directivesTagFilter.querySelector('.label-hint');
    if (label) dom.directivesTagFilter.appendChild(label);

    union.forEach(([tag, count]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'directive-tag-chip';
      const active = state.directiveTagFilter.includes(tag);
      if (active) chip.classList.add('is-active');
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      chip.setAttribute('aria-label', `Toggle filter by tag ${tag} (${count} directive${count === 1 ? '' : 's'})`);
      chip.textContent = `#${tag} (${count})`;
      chip.addEventListener('click', () => {
        if (state.directiveTagFilter.includes(tag)) {
          state.directiveTagFilter = state.directiveTagFilter.filter((t) => t !== tag);
        } else {
          state.directiveTagFilter = state.directiveTagFilter.concat([tag]);
        }
        renderDirectiveTagFilter();
        renderDirectivesManagerList();
      });
      dom.directivesTagFilter.appendChild(chip);
    });
  };

  const renderDirectivesManagerList = () => {
    const term = (state.directiveManagerSearch || '').trim().toLowerCase();
    const sort = state.directiveManagerSort || 'newest';
    const activeTags = state.directiveTagFilter || [];

    const filtered = state.directives
      .filter((d) => {
        // Text search: name OR any tag contains the term
        if (term) {
          const nameMatch = (d.name || '').toLowerCase().includes(term);
          const tagMatch = (d.tags || []).some((t) => (t || '').toLowerCase().includes(term));
          if (!nameMatch && !tagMatch) return false;
        }
        // Tag filter: must contain ALL active tags
        if (activeTags.length > 0) {
          const dTags = new Set((d.tags || []).map((t) => (t || '').toLowerCase()));
          for (const t of activeTags) {
            if (!dTags.has(t)) return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === 'oldest') {
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        }
        if (sort === 'most-used') {
          const ua = a.usage_count || 0;
          const ub = b.usage_count || 0;
          if (ub !== ua) return ub - ua;
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        }
        if (sort === 'name') {
          return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
        }
        // 'newest' default
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });

    renderDirectiveTagFilter();

    dom.directivesManagerList.innerHTML = '';

    if (state.directives.length === 0) {
      dom.directivesManagerStatus.textContent = 'No saved directives yet. Type a directive in the box above and click "Save directive…".';
      dom.directivesManagerStatus.hidden = false;
      dom.directivesManagerList.hidden = true;
      return;
    }
    if (filtered.length === 0) {
      dom.directivesManagerStatus.textContent = `No directives match the current filters.`;
      dom.directivesManagerStatus.hidden = false;
      dom.directivesManagerList.hidden = true;
      return;
    }

    dom.directivesManagerStatus.hidden = true;
    dom.directivesManagerList.hidden = false;

    filtered.forEach((d) => {
      dom.directivesManagerList.appendChild(buildDirectiveManagerItem(d));
    });
  };

  const buildDirectiveManagerItem = (d) => {
    const li = document.createElement('li');
    li.className = 'directive-manager-item';
    li.dataset.directiveId = d.id;

    const main = document.createElement('div');
    main.className = 'directive-manager-item__main';

    const name = document.createElement('div');
    name.className = 'directive-manager-item__name';
    name.textContent = d.name;
    main.appendChild(name);

    const preview = document.createElement('div');
    preview.className = 'directive-manager-item__preview';
    preview.textContent = d.content;
    main.appendChild(preview);

    const meta = document.createElement('div');
    meta.className = 'directive-manager-item__meta';
    if (Array.isArray(d.tags) && d.tags.length > 0) {
      const tagsWrap = document.createElement('span');
      tagsWrap.className = 'directive-manager-item__tags';
      d.tags.forEach((t) => {
        const tagEl = document.createElement('span');
        tagEl.className = 'directive-tag-chip directive-tag-chip--readonly';
        tagEl.textContent = `#${t}`;
        tagsWrap.appendChild(tagEl);
      });
      meta.appendChild(tagsWrap);
    }
    const usage = document.createElement('span');
    const uses = d.usage_count || 0;
    usage.textContent = uses === 1 ? '1 use' : `${uses} uses`;
    meta.appendChild(usage);
    if (d.last_used_at) {
      const last = document.createElement('span');
      last.textContent = `last used ${formatRelativeDate(d.last_used_at)}`;
      meta.appendChild(last);
    } else {
      const last = document.createElement('span');
      last.textContent = 'never used';
      meta.appendChild(last);
    }
    const versions = document.createElement('span');
    const vCount = (d.history || []).length;
    versions.textContent = vCount === 1 ? '1 version' : `${vCount} versions`;
    meta.appendChild(versions);
    const created = document.createElement('span');
    created.textContent = `created ${formatRelativeDate(d.created_at)}`;
    meta.appendChild(created);
    main.appendChild(meta);

    li.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'directive-manager-item__actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn-secondary';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit directive ${d.name}`);
    edit.addEventListener('click', () => openEditDirectiveModal(d.id));
    actions.appendChild(edit);

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn-secondary';
    apply.textContent = 'Apply';
    apply.setAttribute('aria-label', `Apply directive ${d.name}`);
    apply.addEventListener('click', () => {
      state.selectedDirectiveId = d.id;
      applySelectedDirective();
    });
    actions.appendChild(apply);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-danger';
    del.textContent = 'Delete';
    del.setAttribute('aria-label', `Delete directive ${d.name}`);
    del.addEventListener('click', () => deleteDirective(d.id, d.name));
    actions.appendChild(del);

    li.appendChild(actions);
    return li;
  };

  const deleteDirective = async (id, name) => {
    if (!confirm(`Delete saved directive "${name}"? This cannot be undone.`)) return;
    try {
      await apiCall(`/api/directives/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.directives = state.directives.filter((d) => d.id !== id);
      if (state.selectedDirectiveId === id) state.selectedDirectiveId = null;
      renderDirectivesSelect();
      renderDirectivesManagerList();
    } catch (e) {
      showError(`Delete failed: ${e.message}`);
    }
  };

  // ─── Edit directive modal ──────────────────────────────────────────

  const openEditDirectiveModal = async (id) => {
    let directive = state.directives.find((d) => d.id === id);
    if (!directive) {
      return showError('That directive no longer exists.');
    }
    state.editingDirectiveId = id;
    dom.editDirectiveNameInput.value = directive.name || '';
    dom.editDirectiveTagsInput.value = (directive.tags || []).join(', ');
    dom.editDirectiveContentInput.value = directive.content || '';
    updateEditDirectiveCounts();
    renderDirectiveHistory(directive);
    dom.editDirectiveModal.hidden = false;
    dom.editDirectiveNameInput.focus();

    // Always re-fetch the latest in case another tab/editor changed it.
    try {
      const fresh = await apiCall(`/api/directives/${encodeURIComponent(id)}`);
      const idx = state.directives.findIndex((d) => d.id === id);
      if (idx !== -1) state.directives[idx] = fresh;
      directive = fresh;
      // Only re-populate if the modal is still open and editing this id.
      if (!dom.editDirectiveModal.hidden && state.editingDirectiveId === id) {
        dom.editDirectiveNameInput.value = directive.name || '';
        dom.editDirectiveTagsInput.value = (directive.tags || []).join(', ');
        dom.editDirectiveContentInput.value = directive.content || '';
        updateEditDirectiveCounts();
        renderDirectiveHistory(directive);
      }
    } catch (e) {
      // Non-fatal — we already populated from local state.
      console.warn('Failed to refresh directive in edit modal:', e.message);
    }
  };

  const closeEditDirectiveModal = () => {
    dom.editDirectiveModal.hidden = true;
    state.editingDirectiveId = null;
  };

  const updateEditDirectiveCounts = () => {
    if (dom.editDirectiveNameCount) {
      dom.editDirectiveNameCount.textContent = `${dom.editDirectiveNameInput.value.length} / 60`;
    }
    if (dom.editDirectiveContentCount) {
      dom.editDirectiveContentCount.textContent = `${dom.editDirectiveContentInput.value.length} / 1000`;
    }
  };

  const renderDirectiveHistory = (directive) => {
    dom.directiveHistoryList.innerHTML = '';
    const history = Array.isArray(directive.history) ? directive.history : [];
    if (history.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'directive-history-item directive-history-item--empty';
      empty.textContent = 'No history yet.';
      dom.directiveHistoryList.appendChild(empty);
      return;
    }
    // Newest first for display, with current version marked.
    const sorted = history.slice().sort((a, b) => b.version - a.version);
    const latestVersion = Math.max(...history.map((h) => h.version));
    sorted.forEach((h) => {
      const li = document.createElement('li');
      li.className = 'directive-history-item';
      if (h.version === latestVersion) {
        li.classList.add('is-current');
      }

      const versionLabel = document.createElement('span');
      versionLabel.className = 'directive-history-item__version';
      versionLabel.textContent = `v${h.version}${h.version === latestVersion ? ' (current)' : ''}`;
      li.appendChild(versionLabel);

      const when = document.createElement('span');
      when.className = 'directive-history-item__when';
      when.textContent = formatRelativeDate(h.saved_at);
      li.appendChild(when);

      const preview = document.createElement('div');
      preview.className = 'directive-history-item__preview';
      preview.textContent = h.content;
      li.appendChild(preview);

      if (Array.isArray(h.tags) && h.tags.length > 0) {
        const tagsWrap = document.createElement('div');
        tagsWrap.className = 'directive-history-item__tags';
        h.tags.forEach((t) => {
          const tagEl = document.createElement('span');
          tagEl.className = 'directive-tag-chip directive-tag-chip--readonly';
          tagEl.textContent = `#${t}`;
          tagsWrap.appendChild(tagEl);
        });
        li.appendChild(tagsWrap);
      }

      if (h.version !== latestVersion) {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn-secondary directive-history-item__restore';
        restore.textContent = 'Restore';
        restore.setAttribute('aria-label', `Restore version ${h.version} from ${formatRelativeDate(h.saved_at)}`);
        restore.addEventListener('click', () => restoreDirectiveVersion(h.version));
        li.appendChild(restore);
      }

      dom.directiveHistoryList.appendChild(li);
    });
  };

  const restoreDirectiveVersion = async (version) => {
    const id = state.editingDirectiveId;
    if (!id) return;
    if (!confirm(`Restore version ${version}? The current values will be saved as a new version before the rollback takes effect.`)) return;
    try {
      const updated = await apiCall(`/api/directives/${encodeURIComponent(id)}/restore/${encodeURIComponent(version)}`, { method: 'POST' });
      const idx = state.directives.findIndex((d) => d.id === id);
      if (idx !== -1) state.directives[idx] = updated;
      dom.editDirectiveNameInput.value = updated.name || '';
      dom.editDirectiveTagsInput.value = (updated.tags || []).join(', ');
      dom.editDirectiveContentInput.value = updated.content || '';
      updateEditDirectiveCounts();
      renderDirectiveHistory(updated);
      renderDirectivesSelect();
      hideError();
    } catch (e) {
      showError(`Restore failed: ${e.message}`);
    }
  };

  const submitEditDirective = async () => {
    const id = state.editingDirectiveId;
    if (!id) return;
    const name = dom.editDirectiveNameInput.value.trim();
    const content = dom.editDirectiveContentInput.value;
    if (!name) return showError('Name is required.');
    if (!content.trim()) return showError('Content is required.');
    if (name.length > 60) return showError('Name must be 60 characters or fewer.');
    if (content.length > 1000) return showError('Content must be 1000 characters or fewer.');

    const tags = clientNormalizeTagsInput(dom.editDirectiveTagsInput.value);

    try {
      const updated = await apiCall(`/api/directives/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, tags })
      });
      const idx = state.directives.findIndex((d) => d.id === id);
      if (idx !== -1) state.directives[idx] = updated;
      renderDirectivesSelect();
      closeEditDirectiveModal();
      hideError();
    } catch (e) {
      showError(`Save failed: ${e.message}`);
    }
  };

  const deleteDirectiveFromEdit = async () => {
    const id = state.editingDirectiveId;
    if (!id) return;
    const directive = state.directives.find((d) => d.id === id);
    if (!directive) return;
    await deleteDirective(id, directive.name);
    if (!dom.directivesManagerModal.hidden) {
      // Manager is still showing the deleted row; refresh.
      renderDirectivesManagerList();
    }
    closeEditDirectiveModal();
  };

  // ─── Import / Export ──────────────────────────────────────────────

  const exportDirectives = async () => {
    try {
      const res = await fetch('/api/directives/export/all');
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'directives.i2p.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      hideError();
    } catch (e) {
      showError(`Export failed: ${e.message}`);
    }
  };

  const importDirectivesFromFile = async (file) => {
    if (!file) return;
    let envelope;
    try {
      const text = await file.text();
      envelope = JSON.parse(text);
    } catch (e) {
      return showError('Import failed: file is not valid JSON.');
    }
    try {
      const result = await apiCall('/api/directives/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      });
      // Refresh from server to get canonical state (fresh ids, etc).
      state.directives = await apiCall('/api/directives');
      renderDirectivesSelect();
      renderDirectivesManagerList();
      hideError();
      showError(`Imported ${result.imported} directive${result.imported === 1 ? '' : 's'} (${result.total} total).`);
    } catch (e) {
      showError(`Import failed: ${e.message}`);
    }
  };

  // ─── Wire up directives controls ──────────────────────────────────

  dom.directivesManageBtn.addEventListener('click', openDirectivesManagerModal);
  dom.directivesManagerModalClose.addEventListener('click', closeDirectivesManagerModal);
  dom.directivesManagerCancel.addEventListener('click', closeDirectivesManagerModal);
  dom.directivesManagerSearch.addEventListener('input', (e) => {
    state.directiveManagerSearch = e.target.value;
    renderDirectivesManagerList();
  });
  document.querySelectorAll('input[name="directive-sort"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      state.directiveManagerSort = e.target.value;
      renderDirectivesManagerList();
    });
  });
  dom.directivesExportBtn.addEventListener('click', exportDirectives);
  dom.directivesImportBtn.addEventListener('click', () => dom.directivesImportInput.click());
  dom.directivesImportInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    importDirectivesFromFile(file);
    e.target.value = '';
  });

  dom.editDirectiveModalClose.addEventListener('click', closeEditDirectiveModal);
  dom.editDirectiveCancel.addEventListener('click', closeEditDirectiveModal);
  dom.editDirectiveForm.addEventListener('submit', (e) => { e.preventDefault(); submitEditDirective(); });
  dom.editDirectiveNameInput.addEventListener('input', updateEditDirectiveCounts);
  dom.editDirectiveContentInput.addEventListener('input', updateEditDirectiveCounts);
  dom.editDirectiveDelete.addEventListener('click', deleteDirectiveFromEdit);

  // ─── Global keyboard handler — Esc closes any open modal ────────────

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!dom.saveDirectiveModal.hidden) {
      e.preventDefault();
      closeSaveDirectiveModal();
    } else if (!dom.directivesManagerModal.hidden) {
      e.preventDefault();
      closeDirectivesManagerModal();
    } else if (!dom.editDirectiveModal.hidden) {
      e.preventDefault();
      closeEditDirectiveModal();
    } else if (!dom.savePaletteModal.hidden) {
      e.preventDefault();
      closeSavePaletteModal();
    } else if (!dom.paletteManagerModal.hidden) {
      e.preventDefault();
      closePaletteManagerModal();
    } else if (!dom.editPaletteModal.hidden) {
      e.preventDefault();
      closeEditPaletteModal();
    } else if (!dom.subjectPromptModal.hidden) {
      e.preventDefault();
      closeSubjectPromptModal();
    } else if (!dom.presetModal.hidden) {
      e.preventDefault();
      closePresetModal();
    } else if (state.chatIsSending) {
      // Cancel-friendly UX: Esc while sending is a no-op (the user
      // can't cancel an in-flight LLM call, but we don't want them
      // to lose focus from the input by accident).
      e.preventDefault();
    }
  });

  // ─── Post-generation chat console (ADR 0011) ─────────────────────────

  /**
   * Hide + clear the chat console. Called when the user clears the
   * image or switches preset (the chat is anchored to a specific
   * generated prompt, so it loses its anchor when the inputs change).
   * Does NOT delete the persisted session on disk — the user can
   * resume it from the "Conversation" selector on the next run.
   */
  const resetChatConsole = () => {
    state.chatSessionId = null;
    if (dom.stepChat) dom.stepChat.hidden = true;
    if (dom.chatMessages) dom.chatMessages.innerHTML = '';
    if (dom.chatInput) {
      dom.chatInput.value = '';
      updateChatInputCount();
    }
    if (dom.chatFormStatus) {
      dom.chatFormStatus.textContent = '';
      dom.chatFormStatus.classList.remove('is-error');
    }
    if (dom.chatSessionStatus) {
      dom.chatSessionStatus.hidden = true;
      dom.chatSessionStatus.textContent = '';
    }
    updateChatSendButton();
  };

  /**
   * Mirror of `formatRelativeDate` from the palette manager (ADR 0006)
   * — duplicated here so the chat console stays self-contained. Used
   * for inline message timestamps ("3m ago") alongside the absolute
   * timestamp on hover.
   */
  const formatChatRelative = (iso) => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = Date.now() - then;
    if (diffMs < 0) return 'just now';
    const sec = Math.round(diffMs / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    return `${day}d ago`;
  };

  /**
   * Render the chat-message thread into the scrollable history panel.
   * Append-only render — re-rendering the whole list is cheap enough
   * that we don't need a virtual list at the 200-message cap.
   */
  const renderChatMessages = (session) => {
    if (!dom.chatMessages) return;
    dom.chatMessages.innerHTML = '';
    const messages = Array.isArray(session?.messages) ? session.messages : [];

    if (messages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'chat-empty';
      empty.textContent = 'No messages yet. Ask for a tweak, refinement, expansion, or rewrite of any section.';
      dom.chatMessages.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    messages.forEach((m) => frag.appendChild(buildChatMessageNode(m, session)));
    dom.chatMessages.appendChild(frag);
    // Scroll to bottom so the newest message is visible after a send.
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  };

  /**
   * Build one chat-message DOM node. User vs assistant styling comes
   * from a `chat-message--{role}` modifier class. Assistant messages
   * with a non-null `suggested_prompt` get an Apply button; the button
   * is disabled if `current_prompt` already matches `suggested_prompt`
   * (prevents double-applies and gives the user a clear "applied"
   * signal).
   *
   * `session` is required so we can mark the unapplied proposal draft
   * with the `chat-message--pending` modifier and switch the Apply
   * button copy to `Apply proposal` for that specific message only.
   */
  const buildChatMessageNode = (m, session) => {
    const node = document.createElement('article');
    node.className = `chat-message chat-message--${m.role === 'assistant' ? 'assistant' : 'user'}`;
    node.dataset.messageId = m.id || '';

    const isPendingProposal = m.role === 'assistant' &&
      session &&
      typeof session.pending_prompt === 'string' &&
      session.pending_prompt.length > 0 &&
      m.suggested_prompt === session.pending_prompt;
    if (isPendingProposal) {
      node.classList.add('chat-message--pending');
    }

    const header = document.createElement('div');
    header.className = 'chat-message__header';

    const role = document.createElement('span');
    role.className = 'chat-message__role';
    role.textContent = m.role === 'assistant' ? 'Assistant' : 'You';
    header.appendChild(role);

    const time = document.createElement('time');
    time.className = 'chat-message__time';
    time.dateTime = m.timestamp || '';
    time.textContent = formatChatRelative(m.timestamp);
    time.setAttribute('title', m.timestamp || '');
    header.appendChild(time);

    node.appendChild(header);

    const body = document.createElement('div');
    body.className = 'chat-message__content';
    body.textContent = m.content || '';
    node.appendChild(body);

    if (m.role === 'assistant' && typeof m.suggested_prompt === 'string' && m.suggested_prompt.length > 0) {
      const previewLabel = document.createElement('div');
      previewLabel.className = 'chat-message__preview-label';
      previewLabel.textContent = isPendingProposal
        ? 'Unapplied proposal — click Apply proposal to use it'
        : 'Proposed revision — click Apply to use it';
      node.appendChild(previewLabel);

      const preview = document.createElement('pre');
      preview.className = 'chat-message__preview';
      preview.textContent = m.suggested_prompt;
      node.appendChild(preview);

      const actions = document.createElement('div');
      actions.className = 'chat-message__actions';

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'chat-message__apply';
      apply.textContent = isPendingProposal ? 'Apply proposal' : 'Apply revision';
      apply.setAttribute('aria-label', 'Apply this revision to the generated prompt');
      apply.dataset.messageId = m.id || '';
      apply.addEventListener('click', () => applyChatRevision(m.id, m.suggested_prompt));
      actions.appendChild(apply);

      // Mark already-applied revisions so the user can tell at a glance.
      const activeSession = state.chatSessions.find((s) => s.id === state.chatSessionId);
      if (activeSession && activeSession.current_prompt === m.suggested_prompt) {
        apply.disabled = true;
        apply.textContent = 'Applied';
        const note = document.createElement('span');
        note.className = 'chat-message__applied';
        note.textContent = 'This revision is the current working prompt.';
        actions.appendChild(note);
      }

      node.appendChild(actions);
    }

    // Issue #1 — when the validator declined the model's revision
    // (after retries) the server persists the declined text and the
    // list of dropped anchor terms on the assistant message. Render a
    // greyed-out preview so the user can see what would have been
    // applied, plus a "Try as rewrite" affordance that re-sends their
    // last message reframed as a wholesale rewrite (the chat system
    // prompt treats "REWRITE FROM SCRATCH — anchor set is empty" as
    // the wholesale-rewrite trigger from ADR 0012).
    if (
      m.role === 'assistant' &&
      (m.suggested_prompt == null || m.suggested_prompt === '') &&
      typeof m.declined_suggested_prompt === 'string' &&
      m.declined_suggested_prompt.length > 0
    ) {
      const declined = document.createElement('div');
      declined.className = 'chat-message__declined';

      const declinedLabel = document.createElement('div');
      declinedLabel.className = 'chat-message__declined-label';
      declinedLabel.textContent = 'Revision declined — too much of the original context would have been lost.';
      declined.appendChild(declinedLabel);

      const declinedPreview = document.createElement('pre');
      declinedPreview.className = 'chat-message__declined-preview';
      declinedPreview.textContent = m.declined_suggested_prompt;
      declined.appendChild(declinedPreview);

      if (Array.isArray(m.declined_missing_terms) && m.declined_missing_terms.length > 0) {
        const terms = document.createElement('div');
        terms.className = 'chat-message__declined-terms';
        const termsLabel = document.createElement('span');
        termsLabel.className = 'chat-message__declined-terms-label';
        termsLabel.textContent = 'Terms dropped:';
        terms.appendChild(termsLabel);
        const termsList = document.createElement('span');
        termsList.className = 'chat-message__declined-terms-list';
        termsList.textContent = m.declined_missing_terms.join(', ');
        terms.appendChild(termsList);
        declined.appendChild(terms);
      }

      const declinedActions = document.createElement('div');
      declinedActions.className = 'chat-message__declined-actions';

      const tryRewrite = document.createElement('button');
      tryRewrite.type = 'button';
      tryRewrite.className = 'chat-message__try-rewrite btn-secondary';
      tryRewrite.textContent = 'Try as rewrite';
      tryRewrite.setAttribute('aria-label', 'Resend the last request framed as a wholesale rewrite');
      tryRewrite.dataset.messageId = m.id || '';
      tryRewrite.addEventListener('click', () => tryChatRewrite(m.id));
      declinedActions.appendChild(tryRewrite);

      declined.appendChild(declinedActions);
      node.appendChild(declined);
    }

    return node;
  };

  /**
   * Live-updated char count for the chat input. Mirrors the
   * directives-input counter pattern. Soft-warns at the cap so the
   * user sees they're approaching the limit without being blocked
   * before they hit it.
   */
  const updateChatInputCount = () => {
    if (!dom.chatInput || !dom.chatInputCount) return;
    dom.chatInputCount.textContent = `${dom.chatInput.value.length} / 2000`;
  };

  /**
   * Disable the Send button while a request is in flight, and while
   * there's no active session or no message text. Mirrors
   * `updateDirectivesActions`.
   */
  const updateChatSendButton = () => {
    if (!dom.chatSendBtn) return;
    const hasSession = !!state.chatSessionId;
    const hasText = !!(dom.chatInput && dom.chatInput.value && dom.chatInput.value.trim().length > 0);
    dom.chatSendBtn.disabled = state.chatIsSending || !hasSession || !hasText;
  };

  /**
   * Fetch all chat sessions from the server and refresh the
   * conversation selector. Newest-first ordering is enforced by the
   * server (`GET /api/chat/sessions`). A 404 from an older server
   * build is treated like the palette/directive 404s — log a warning
   * and render the chat as disabled rather than breaking the app.
   */
  const loadChatSessions = async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      if (res.status === 404) {
        console.warn(
          '[chat] GET /api/chat/sessions returned 404 — server is running an older ' +
          'build without chat routes. Restart the server (npm start) to enable chat.'
        );
        state.chatSessions = [];
        renderChatSessionSelect();
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      state.chatSessions = Array.isArray(data.data) ? data.data : [];
      renderChatSessionSelect();
    } catch (e) {
      console.warn('Failed to load chat sessions:', e.message);
      state.chatSessions = [];
      renderChatSessionSelect();
    }
  };

  /**
   * Repaint the conversation `<select>` from `state.chatSessions`.
   * Preserves the current selection if the session still exists.
   */
  const renderChatSessionSelect = () => {
    if (!dom.chatSessionSelect) return;
    const previous = state.chatSessionId || '';
    dom.chatSessionSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.chatSessions.length === 0
      ? '— No conversations yet —'
      : '— This prompt\'s conversation —';
    dom.chatSessionSelect.appendChild(placeholder);

    state.chatSessions.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const label = s.title || 'Untitled conversation';
      const ts = formatChatRelative(s.updated_at || s.created_at);
      opt.textContent = `${label} — ${ts}`;
      dom.chatSessionSelect.appendChild(opt);
    });

    if (previous && state.chatSessions.some((s) => s.id === previous)) {
      dom.chatSessionSelect.value = previous;
    } else {
      state.chatSessionId = null;
    }

    if (dom.chatSessionDeleteBtn) {
      dom.chatSessionDeleteBtn.disabled = !state.chatSessionId;
    }
    updateChatSendButton();
  };

  /**
   * Format the inline session-status line so the user can see at a
   * glance whether there is an unapplied proposal awaiting an Apply
   * click. The string always contains either `unapplied proposal`
   * (when `pending_prompt` is set) or `no unapplied proposal` (when
   * it's null); both are detected by the frontend contract test.
   */
  const formatChatSessionStatus = (session) => {
    if (!session) return '';
    const title = session.title || 'Untitled conversation';
    const count = Array.isArray(session.messages) ? session.messages.length : 0;
    const messagePart = `${count} message${count === 1 ? '' : 's'}`;
    const proposalPart = (typeof session.pending_prompt === 'string' && session.pending_prompt.length > 0)
      ? 'unapplied proposal'
      : 'no unapplied proposal';
    return `Session "${title}" — ${messagePart} — ${proposalPart}.`;
  };

  /**
   * Called from `displayResult` after Stage 2 returns. Creates a fresh
   * chat session on the server, anchors the chat console to it, and
   * shows the section. The console is hidden until this resolves so a
   * slow network doesn't flash an empty history before the session is
   * live.
   */
  const activateChatForResult = async (data) => {
    const promptText = (data && typeof data.prompt === 'string') ? data.prompt : '';
    if (!promptText.trim()) return;

    const presetId = state.selectedPresetId;
    if (!presetId) {
      // No preset selected — shouldn't happen because the Generate
      // button is disabled until a preset is picked, but guard anyway.
      return;
    }

    const preset = state.presets.find((p) => p.id === presetId);
    const body = {
      prompt: promptText,
      preset_id: presetId,
      preset_name: preset?.name || data.preset_name || '',
      run_id: state.currentRunId || null,
      analysis_snapshot: state.currentAnalysis && typeof state.currentAnalysis === 'object'
        ? state.currentAnalysis
        : null
    };

    let session;
    try {
      session = await apiCall('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.warn('Could not start chat session:', e.message);
      // Soft-state: chat session cap is a guardrail, not a fatal error.
      // Tone the toast down so the user reads it as actionable, not broken.
      const isChatLimit = /chat session limit reached/i.test(e.message);
      if (isChatLimit) {
        showError(`Chat history is full (200 sessions). Delete older conversations from the picker above to start a new one.`, { severity: 'warning' });
      } else {
        showError(`Chat console unavailable: ${e.message}`);
      }
      return;
    }

    state.chatSessionId = session.id;
    state.chatSessions = [session].concat(
      state.chatSessions.filter((s) => s.id !== session.id)
    );
    renderChatSessionSelect();
    renderChatMessages(session);
    if (dom.stepChat) dom.stepChat.hidden = false;
    if (dom.chatSessionStatus) {
      dom.chatSessionStatus.hidden = false;
      dom.chatSessionStatus.textContent = formatChatSessionStatus(session);
    }
    if (dom.chatSessionDeleteBtn) {
      dom.chatSessionDeleteBtn.disabled = false;
    }
    updateChatSendButton();
    if (dom.chatInput) dom.chatInput.focus();
  };

  /**
   * Slice 2.4 — ADR 0021 — Anima chat activation.
   * Parallel to activateChatForResult but for the Anima envelope. The
   * session body uses data.positive as the prompt (the Anima contract's
   * primary prompt — the negative is folded in as analysis_snapshot
   * for context). The model field is 'anima' so the server's
   * buildChatSystemPrompt appends ANIMA_CHAT_CONSTRAINTS_BLOCK.
   *
   * The session is created with NO preset_id (Anima doesn't need one)
   * — the validator accepts that case via the existing model branch.
   * Actually the validator still requires preset_id, so we use a
   * placeholder ('preset_anima') that the server's isZImageSession
   * branch will treat as non-Z-Image. The placeholder is intentionally
   * not exposed to the user.
   *
   * Failure mode: if the server rejects the placeholder preset_id, the
   * chat session is skipped silently (fire-and-forget, just like the
   * Z-Image path). The user can still see and edit the Anima result;
   * the chat panel just stays inactive.
   */
  const activateAnimaChatForResult = async (data) => {
    const positive = (data && typeof data.positive === 'string') ? data.positive : '';
    if (!positive.trim()) return;

    const body = {
      prompt: positive,
      preset_id: 'preset_anima_internal', // placeholder; not a real preset
      preset_name: 'Anima',
      run_id: state.currentRunId || null,
      analysis_snapshot: data && typeof data.negative === 'string'
        ? { negative: data.negative, variant: data.variant || state.animaVariant }
        : null,
      // Slice 2.4 — model: 'anima' so the server dispatches to the
      // Anima constraints block. The validator accepts the field.
      model: 'anima'
    };

    let session;
    try {
      session = await apiCall('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      // Soft-state: chat session failures must not clobber the result.
      console.warn('Could not start Anima chat session:', e.message);
      const isChatLimit = /chat session limit reached/i.test(e.message);
      if (isChatLimit) {
        showError(`Chat history is full (200 sessions). Delete older conversations from the picker above to start a new one.`, { severity: 'warning' });
      } else {
        // Other failures (preset_id placeholder might not be valid) are
        // silenced — the Anima result panel is still functional, and
        // the user can refresh to retry. Caller already logged the
        // warning.
      }
      return;
    }

    state.chatSessionId = session.id;
    state.chatSessions = [session].concat(
      state.chatSessions.filter((s) => s.id !== session.id)
    );
    renderChatSessionSelect();
    renderChatMessages(session);
    if (dom.stepChat) dom.stepChat.hidden = false;
    if (dom.chatSessionStatus) {
      dom.chatSessionStatus.hidden = false;
      dom.chatSessionStatus.textContent = formatChatSessionStatus(session);
    }
    if (dom.chatSessionDeleteBtn) {
      dom.chatSessionDeleteBtn.disabled = false;
    }
    updateChatSendButton();
    if (dom.chatInput) dom.chatInput.focus();
  };

  /**
   * Map a server-side error string to a user-friendly chat-form
   * status. The server emits very specific error text (e.g. "Chat
   * reply missing non-empty 'reply' string") that's useful for
   * debugging but unintelligible to end users. The mapper short-
   * circuits specific known strings and falls back to a generic
   * "couldn't reach the chat service" for everything else.
   */
  const friendlyChatError = (rawError) => {
    if (!rawError || typeof rawError !== 'string') return 'The chat service is having trouble. Please try again.';
    // Network / generic 5xx patterns from apiCall.
    if (/failed to fetch|networkerror|load failed/i.test(rawError)) {
      return 'Couldn\'t reach the chat service. Check your connection and try again.';
    }
    if (/429|rate limit/i.test(rawError)) {
      return 'The chat service is busy right now. Please wait a moment and try again.';
    }
    if (/401|403|authentication/i.test(rawError)) {
      return 'The chat service rejected the request. Please contact the operator.';
    }
    if (/timeout|timed out/i.test(rawError)) {
      return 'The chat service took too long to respond. Please try again.';
    }
    if (/M3|minimax/i.test(rawError)) {
      return 'The chat service returned an error. Please try again — your message was not sent.';
    }
    // Generic fallback — preserve the raw text but lead with a friendly
    // note so the user understands it's a transient failure.
    return `The chat service had trouble responding. Please try again. (${rawError.substring(0, 120)})`;
  };

  /**
   * Send handler. Validates locally first (server re-validates), then
   * POSTs the user message. The full updated session comes back from
   * the server with the assistant's reply appended.
   *
   * Robustness (post-investigation 2026-06-23):
   *  - On error, the user's text is preserved in `dom.chatInput` so
   *    they can retry without retyping.
   *  - The displayed error is mapped through `friendlyChatError` so
   *    raw model-output parsing strings ("missing 'reply' string")
   *    never reach the user.
   *  - A retry button is shown after a transient failure so the user
   *    doesn't have to click Send again.
   */
  const submitChatMessage = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (state.chatIsSending) return;
    if (!state.chatSessionId) {
      setChatFormStatus('No active conversation — generate a prompt first.', true);
      return;
    }
    const text = (dom.chatInput.value || '').trim();
    if (text.length === 0) {
      setChatFormStatus('Message cannot be empty.', true);
      return;
    }
    if (text.length > 2000) {
      setChatFormStatus('Message must be 2000 characters or fewer.', true);
      return;
    }

    state.chatIsSending = true;
    setButtonLoading(dom.chatSendBtn, true, 'Sending…');
    setChatFormStatus('Sending…', false);

    // Track success OUTSIDE the try so the input-clear can run on
    // confirmed success only. Preserves the user's text across
    // transient failures so they can retry without retyping.
    let sendSucceeded = false;
    try {
      const updated = await apiCall(`/api/chat/sessions/${encodeURIComponent(state.chatSessionId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Slice 3.4 — ADR 0022 — forward the LLM model so the server
        // routes the chat reply through the user's chosen model.
        // Slice 4 — ADR 0023 — forward the provider too.
        body: JSON.stringify({ content: text, llmModel: state.llmModel, provider: state.provider })
      });
      const prevSession = state.chatSessions.find((s) => s.id === updated.id);
      const lastMsg = Array.isArray(updated.messages) && updated.messages.length > 0
        ? updated.messages[updated.messages.length - 1]
        : null;
      const isTextApply = lastMsg &&
        lastMsg.role === 'assistant' &&
        lastMsg.content === 'Applied the latest proposal to the working prompt.' &&
        (!prevSession || prevSession.current_prompt !== updated.current_prompt);
      if (isTextApply) {
        state.finalPrompt = updated.current_prompt;
        dom.resultPrompt.textContent = updated.current_prompt;
        updateTokenReminderBanner();
      }
      // Splice the updated session into state.chatSessions in place so
      // the conversation selector reflects the new updated_at.
      const idx = state.chatSessions.findIndex((s) => s.id === updated.id);
      if (idx !== -1) state.chatSessions[idx] = updated;
      else state.chatSessions.unshift(updated);
      // Resort so newest is at the top.
      state.chatSessions.sort((a, b) => {
        const at = new Date(a.updated_at || a.created_at || 0).getTime();
        const bt = new Date(b.updated_at || b.created_at || 0).getTime();
        return bt - at;
      });
      renderChatSessionSelect();
      renderChatMessages(updated);
      if (dom.chatSessionStatus && !dom.chatSessionStatus.hidden) {
        dom.chatSessionStatus.textContent = formatChatSessionStatus(updated);
      }
      sendSucceeded = true;
    } catch (err) {
      // Keep the user's text in the input so they can retry without
      // retyping. Show a friendly error + a retry button.
      const friendly = friendlyChatError(err.message);
      setChatFormStatus(friendly + ' ', true);
      showChatRetryButton(text);
    } finally {
      state.chatIsSending = false;
      setButtonLoading(dom.chatSendBtn, false, 'Send');
      // Input clear runs ONLY on confirmed success (post-investigation
      // 2026-06-23). On failure the user's text is preserved so they
      // can retry without retyping.
      if (sendSucceeded) {
        dom.chatInput.value = '';
        updateChatInputCount();
        setChatFormStatus('', false);
      }
      updateChatSendButton();
    }
  };

  /**
   * Inject (or refresh) a "Retry" button next to the chat status line.
   * Clicking it re-submits the same message text — handy when the
   * network blipped or the LLM flapped.
   *
   * Idempotent: removes any existing retry button before adding a new
   * one so a second failure doesn't accumulate buttons.
   */
  const showChatRetryButton = (text) => {
    if (!dom.chatFormStatus) return;
    // Remove any previous retry button (no duplicates).
    const existing = dom.chatFormStatus.parentNode?.querySelector('.chat-form-retry');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-form-retry btn-secondary';
    btn.textContent = 'Retry';
    btn.setAttribute('aria-label', 'Retry sending the last message');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      btn.remove();
      // Reset status text before re-sending so the new attempt starts
      // with a clean status line.
      setChatFormStatus('', false);
      submitChatMessage();
    });
    if (dom.chatFormStatus.parentNode) {
      dom.chatFormStatus.parentNode.insertBefore(btn, dom.chatFormStatus.nextSibling);
    }
  };

  /**
   * Apply handler. POSTs to the apply endpoint, then updates the live
   * result prompt — both the Z-Image panel (`<p id="result-prompt">`)
   * and the Anima panel (`#anima-result-positive` textarea) — and
   * mirrors the new value into the corresponding state slices. The
   * result prompt is what the user copies out, so it must reflect the
   * latest applied revision without a refresh.
   *
   * Slice 2.3 / 2.4 — ADR 0021 — the Anima fork split the single
   * Z-Image result panel into two textareas (positive + negative),
   * with their own state slice (`state.animaResult`). The original
   * apply handler only updated `state.finalPrompt` + `dom.resultPrompt`,
   * which are the Z-Image panel's render targets; in Anima mode
   * `dom.resultPrompt` is hidden, so the Anima textarea stayed on the
   * original prompt while the chat session said "Applied". Branches
   * on `state.model === 'anima'` to mirror the apply into the right
   * panel. Regression test: scripts/smoke/anima-chat-apply-sync.js.
   */
  const applyChatRevision = async (messageId, suggestedPrompt) => {
    if (!state.chatSessionId || !messageId) return;
    try {
      const updated = await apiCall(`/api/chat/sessions/${encodeURIComponent(state.chatSessionId)}/apply/${encodeURIComponent(messageId)}`, {
        method: 'POST'
      });
      // Mirror the new current_prompt into the model-specific result
      // panel. Apply doesn't regenerate through Stage 2; the chat
      // revision IS the new prompt the user wants to copy.
      if (state.model === 'anima' && state.animaResult) {
        // Anima branch — write into the positive textarea and the
        // animaResult state slice. The negative prompt is unchanged
        // by chat refinements (chat refines only the positive side;
        // the negative is a static recommended vocabulary).
        state.animaResult = {
          ...state.animaResult,
          positive: updated.current_prompt
        };
        if (dom.animaResultPositive) {
          dom.animaResultPositive.value = updated.current_prompt;
        }
      } else {
        // Z-Image branch — update the live result prompt text. This
        // is the user-visible "working prompt" — Step 4's
        // <p id="result-prompt">.
        state.finalPrompt = updated.current_prompt;
        dom.resultPrompt.textContent = updated.current_prompt;
      }
      // ADR 0019 Issue #15 — re-evaluate the 1024-token reminder
      // banner after a chat Apply. Apply edits can grow the prompt
      // past the ceiling; the banner is the user's only signal.
      // Note: the banner currently reads state.finalPrompt only; in
      // Anima mode it stays quiet. Acknowledged limitation; ADR 0021
      // consequence note + future ADR if it becomes user-visible.
      updateTokenReminderBanner();
      // Splice the updated session into local state.
      const idx = state.chatSessions.findIndex((s) => s.id === updated.id);
      if (idx !== -1) state.chatSessions[idx] = updated;
      else state.chatSessions.unshift(updated);
      renderChatMessages(updated);
      if (dom.chatSessionStatus && !dom.chatSessionStatus.hidden) {
        dom.chatSessionStatus.textContent = formatChatSessionStatus(updated);
      }
      setChatFormStatus('Applied revision to the prompt.', false);
    } catch (err) {
      setChatFormStatus(err.message || 'Apply failed.', true);
    }
  };

  /**
   * Issue #1 — "Try as rewrite" handler. Looks up the user message
   * that immediately preceded the declined assistant message, prepends
   * a wholesale-rewrite marker that the chat system prompt recognises
   * (ADR 0012 wholesale-rewrite path: anchor set is empty by user's
   * request), and re-submits via the existing send pipeline.
   *
   * The user's original text is preserved on disk; we only mutate the
   * outgoing text. The chat history still shows what the user typed
   * before; the rewritten version is the next assistant turn.
   */
  const tryChatRewrite = (declinedMessageId) => {
    if (!state.chatSessionId || !declinedMessageId) return;
    const session = state.chatSessions.find((s) => s.id === state.chatSessionId);
    if (!session || !Array.isArray(session.messages)) return;
    const idx = session.messages.findIndex((m) => m.id === declinedMessageId);
    if (idx === -1) return;
    // Find the user message immediately before this assistant turn.
    let userText = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user' && typeof session.messages[i].content === 'string') {
        userText = session.messages[i].content;
        break;
      }
    }
    if (!userText) {
      setChatFormStatus('Could not find your original request to rewrite.', true);
      return;
    }
    // Prepend the wholesale-rewrite marker. The model treats this as
    // "anchor set is empty by user's request" per ADR 0012.
    const rewritten = `REWRITE FROM SCRATCH — anchor set is empty: ${userText}`;
    if (typeof rewritten !== 'string' || rewritten.length > 2000) {
      setChatFormStatus('Original request is too long to rewrite as a wholesale edit.', true);
      return;
    }
    if (dom.chatInput) {
      dom.chatInput.value = rewritten;
      updateChatInputCount();
      updateChatSendButton();
    }
    setChatFormStatus('Resending as a wholesale rewrite…', false);
    submitChatMessage();
  };

  /**
   * Delete the active session. Confirmation prompt prevents accidental
   * loss of long threads. After deletion, the console is hidden (no
   * session to attach to); the result prompt stays as it was last
   * applied.
   */
  const deleteChatSession = async () => {
    if (!state.chatSessionId) return;
    if (!confirm('Delete this conversation? The message history will be lost; the current prompt text will be kept.')) return;
    const id = state.chatSessionId;
    try {
      await apiCall(`/api/chat/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.chatSessions = state.chatSessions.filter((s) => s.id !== id);
      resetChatConsole();
      renderChatSessionSelect();
      setChatFormStatus('Conversation deleted.', false);
    } catch (err) {
      setChatFormStatus(err.message || 'Delete failed.', true);
    }
  };

  /**
   * Switch to a different saved conversation from the dropdown. Loads
   * the full session (already in state.chatSessions since the list
   * GET includes messages) and repaints the thread. Doesn't change
   * the live result prompt — that's bound to the active generation,
   * not the chat history.
   */
  const selectChatSession = (id) => {
    if (!id) {
      state.chatSessionId = null;
      if (dom.chatMessages) dom.chatMessages.innerHTML = '';
      if (dom.chatSessionStatus) {
        dom.chatSessionStatus.hidden = true;
        dom.chatSessionStatus.textContent = '';
      }
      if (dom.chatSessionDeleteBtn) dom.chatSessionDeleteBtn.disabled = true;
      updateChatSendButton();
      return;
    }
    const session = state.chatSessions.find((s) => s.id === id);
    if (!session) return;
    state.chatSessionId = id;
    renderChatMessages(session);
    if (dom.stepChat) dom.stepChat.hidden = false;
    if (dom.chatSessionStatus) {
      dom.chatSessionStatus.hidden = false;
      dom.chatSessionStatus.textContent = formatChatSessionStatus(session);
    }
    if (dom.chatSessionDeleteBtn) dom.chatSessionDeleteBtn.disabled = false;
    updateChatSendButton();
  };

  /**
   * Update the inline status line under the chat input. `isError`
   * toggles the red styling; an empty message clears the line
   * entirely.
   */
  const setChatFormStatus = (text, isError) => {
    if (!dom.chatFormStatus) return;
    dom.chatFormStatus.textContent = text || '';
    dom.chatFormStatus.classList.toggle('is-error', !!isError);
  };

  // ─── Wire up chat console controls ──────────────────────────────────

  if (dom.chatForm) {
    dom.chatForm.addEventListener('submit', submitChatMessage);
  }
  if (dom.chatInput) {
    dom.chatInput.addEventListener('input', () => {
      updateChatInputCount();
      updateChatSendButton();
    });
  }
  if (dom.chatSessionSelect) {
    dom.chatSessionSelect.addEventListener('change', (e) => {
      selectChatSession(e.target.value || null);
    });
  }
  if (dom.chatSessionDeleteBtn) {
    dom.chatSessionDeleteBtn.addEventListener('click', deleteChatSession);
  }

// ─── Initialize ────────────────────────────────────────────────────────

  const init = async () => {
    // Slice 2.1 — ADR 0021 — restore model + variant state from URL or localStorage.
    // Runs first so the model picker reflects the right initial value before
    // any UI is rendered. State precedence: URL > localStorage > defaults.
    restoreStateFromUrlOrStorage();
    renderModelSelector();
    // Slice 4 — ADR 0023 — render the provider <select> against the
    // resolved state.provider. Call BEFORE renderLlmModelSelector so
    // the model list rebuilds against the right provider on first load.
    renderProviderSelector();
    // Slice 3.3 — ADR 0022 — render the LLM model <select> against the
    // resolved state.llmModel (URL > localStorage > default). Same
    // restoration pass, mirrors the model picker above.
    renderLlmModelSelector();

    // Load field palette
    try {
      const health = await apiCall('/api/health');
      state.fieldPalette = health.field_palette || {};
    } catch (e) {
      showError(`Cannot reach server: ${e.message}`);
      return;
    }

    await loadPresets();
    await loadPalettes();
    await loadDirectives();
    await loadChatSessions();
    updateDirectivesActions();
    updateChatInputCount();
    updateButtons();

    // Test hook — exposed ONLY when ?test-hook=1 is in the URL so the
    // production app surface stays untouched. Used by the cross-browser
    // Playwright suite (tests/lighting-chips-cross-browser.js) to drive
    // the analysis editor without paying for a full LLM Stage 1 round.
    // The hook surface is intentionally narrow: state, renderAnalysisEditor,
    // applyPresetToField, and populateLightingWithAI (and the parallel mood
    // handlers). Nothing else leaks.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('test-hook') === '1') {
        window.__i2pTest = {
          state,
          dom,
          renderAnalysisEditor,
          applyPresetToField,
          populateLightingWithAI,
          populateMoodWithAI,
          populateActionsWithAI,
          populateTextureWithAI,
          populateCameraAngleWithAI,
          populateSubjectWithAI,
          MOOD_PRESETS,
          LIGHTING_PRESETS,
          // Slice 2.1 — ADR 0021 — model-fork surface
          ALLOWED_MODELS,
          ALLOWED_ANIMA_VARIANTS,
          validateModel,
          validateVariant,
          readStateFromLocalStorage,
          writeStateToLocalStorage,
          readStateFromURL,
          syncStateToURL,
          restoreStateFromUrlOrStorage,
          renderModelSelector,
          onModelChange,
          // Slice 2.3 — ADR 0021 — Anima dispatch + result surface
          runAnimaGenerate,
          displayAnimaResult,
          onAnimaVariantChange,
          // Slice 2.4 — ADR 0021 — Anima chat activation
          activateAnimaChatForResult
        };
      }
    } catch (_) {
      // Test hook is best-effort; if URL parsing fails we silently skip.
    }
  };

  init();
})();