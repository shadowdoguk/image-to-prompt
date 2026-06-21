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
    finalPrompt: null,
    isAnalyzing: false,
    isGenerating: false,
    editingPresetId: null  // null when creating new
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
    generatePromptBtn: $('generate-prompt-btn'),

    resultSection: $('step-result'),
    resultPrompt: $('result-prompt'),
    resultMetaInfo: $('result-meta-info'),
    copyBtn: $('copy-btn'),
    regenerateBtn: $('regenerate-btn'),

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

    stepPreset: $('step-preset'),
    stepUpload: $('step-upload'),
    stepAnalyze: $('step-analyze')
  };

  // ─── Utilities ─────────────────────────────────────────────────────────

  const showError = (msg) => {
    dom.errorMessage.textContent = msg;
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
    dom.analysisEditor.hidden = true;
    dom.resultSection.hidden = true;
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
    dom.analysisEditor.hidden = true;
    dom.resultSection.hidden = true;
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

  const renderAnalysisEditor = (analysis) => {
    dom.analysisFields.innerHTML = '';
    const preset = state.presets.find((p) => p.id === state.selectedPresetId);
    if (!preset) return;

    preset.stage1_fields.forEach((fieldName) => {
      const def = state.fieldPalette[fieldName] || FIELD_PALETTE_FALLBACK[fieldName];
      const labelText = def?.label || fieldName;
      const value = analysis[fieldName];

      const row = document.createElement('div');
      row.className = 'field-row';
      row.dataset.field = fieldName;

      const label = document.createElement('label');
      label.className = 'label';
      label.textContent = labelText;
      row.appendChild(label);

      if (fieldName === 'colors' && Array.isArray(value)) {
        row.appendChild(renderColorsInput(value));
      } else if (typeof value === 'string') {
        const input = document.createElement('textarea');
        input.className = 'textarea';
        input.rows = (labelText === 'Subject' || labelText === 'Mood' || labelText === 'Texture' || labelText === 'Composition') ? 2 : 1;
        input.value = value;
        input.dataset.field = fieldName;
        row.appendChild(input);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-input';
        input.value = value == null ? '' : String(value);
        input.dataset.field = fieldName;
        row.appendChild(input);
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

    try {
      const data = await apiCall('/api/analyze', { method: 'POST', body: fd });
      state.currentAnalysis = data.analysis;
      renderAnalysisEditor(data.analysis);
      dom.analysisEditor.hidden = false;
      dom.analysisEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      hideError();
    } catch (e) {
      showError(`Analysis failed: ${e.message}`);
    } finally {
      state.isAnalyzing = false;
      setButtonLoading(dom.analyzeBtn, false, 'Analyze image');
      updateButtons();
    }
  };

  const collectAnalysisFromEditor = () => {
    // Pull values from inputs/textareas in the editor
    dom.analysisFields.querySelectorAll('textarea[data-field], input[data-field]').forEach((el) => {
      state.currentAnalysis[el.dataset.field] = el.value;
    });
    return state.currentAnalysis;
  };

  const runGeneratePrompt = async () => {
    if (!state.currentAnalysis || !state.selectedPresetId) return;
    state.isGenerating = true;
    setButtonLoading(dom.generatePromptBtn, true, 'Generating…');
    updateButtons();

    const analysis = collectAnalysisFromEditor();
    const directives = dom.directivesInput.value.trim();

    try {
      const data = await apiCall('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId: state.selectedPresetId,
          analysis,
          directives
        })
      });
      state.finalPrompt = data.prompt;
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

  const displayResult = (data) => {
    dom.resultPrompt.textContent = data.prompt;
    const preset = state.presets.find((p) => p.id === data.preset_id);
    const meta = [`Preset: ${data.preset_name || preset?.name || data.preset_id}`, `Model: ${data.model}`];
    dom.resultMetaInfo.textContent = meta.join(' • ');
    dom.resultSection.hidden = false;
    dom.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  // Directives counter
  dom.directivesInput.addEventListener('input', () => {
    dom.directivesCount.textContent = `${dom.directivesInput.value.length} / 1000`;
  });

  // ─── Copy to clipboard ─────────────────────────────────────────────────

  dom.copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dom.resultPrompt.textContent);
      const original = dom.copyBtn.textContent;
      dom.copyBtn.textContent = 'Copied!';
      setTimeout(() => { dom.copyBtn.textContent = original; }, 2000);
    } catch {
      showError('Failed to copy to clipboard.');
    }
  });

  // ─── Error dismissal ───────────────────────────────────────────────────

  dom.errorDismiss.addEventListener('click', hideError);

  // ─── Initialize ────────────────────────────────────────────────────────

  const init = async () => {
    // Load field palette
    try {
      const health = await apiCall('/api/health');
      state.fieldPalette = health.field_palette || {};
    } catch (e) {
      showError(`Cannot reach server: ${e.message}`);
      return;
    }

    await loadPresets();
    updateButtons();
  };

  init();
})();