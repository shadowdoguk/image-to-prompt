# Code Review — Slice K.8 — H5 close — Z-Image + Anima regenerate button spinners

**Slice:** K.8 (H5 close)
**Author:** goose
**Reviewer:** goose (self-review, two-axis)
**Date:** 2026-10-16
**Verdict:** **pass** (no blockers; no minor findings)

---

## 1. What this slice does

Closes the parallel cosmetic gap that K.6 left open: K.6 added
`<span class="btn-spinner" hidden aria-hidden="true">` markup
to the Krea-2 Regenerate button so the user sees a working
spinner during regeneration. The same gap exists on the
Z-Image and Anima Regenerate buttons — they fire the right
handlers and `setButtonLoading` updates the text, but no
spinner element exists so no spinner is visible. K.8 is a
tiny HTML-only fix: add `btn-text` + `btn-spinner` to both
buttons.

**Test count:** 722 → 725 (+3), all green, 0 fail.

---

## 2. Axis 1 — Standards review

| Standard | Met? | Evidence |
|----------|------|----------|
| **Append-only doc discipline** | ✅ | SPEC §30.6.3, ARCH §30 A12, PRE-MORTEM §30.6.3, SESSION-STATE row, BACKLOG H5 closure, Change Log row. No edits to existing prose. |
| **Inline two-axis review pattern** | ✅ | This file + matching `docs/POLISH-AUDIT-30-k8.md`. |
| **Per-slice file pattern** | ✅ | HTML in `src/index.html`; tests in `tests/run-all.js`; review + polish docs in `docs/`. No JS change. |
| **No new dependencies** | ✅ | Pure HTML. No new npm packages. |
| **No force-push / no reset --hard** | ✅ | Additive HTML edits. |
| **Conventional commit message** | ✅ | `fix(slice-k.8): add regenerate spinners to Z-Image + Anima (H5 close)` |
| **Slice marker convention** | ✅ | `Slice K.8` identifier present in `src/index.html` (2 places: Z-Image + Anima buttons) and in 3 new tests. |
| **Cross-reference discipline** | ✅ | Each new line carries a `<!-- Slice K.8 (H5 close) — ... -->` comment explaining the why-not-just-rewrite. |
| **722 baseline preserved** | ✅ | K.8 adds 3 new tests; no existing test was modified or removed. |
| **K.5 no-negative-envelope invariant preserved** | ✅ | No code change to the response envelope. HTML-only. |
| **K.7 chat-Apply + chat-show wiring unaffected** | ✅ | No code change. |
| **Per-model chat-session pattern preserved** | ✅ | No code change. |

### Standards findings

- **None blocking.**
- **None minor.** Pure HTML markup addition; nothing to
  document beyond the change itself.

---

## 3. Axis 2 — Spec review

| Spec requirement | Met? | Evidence |
|------------------|------|----------|
| Z-Image Regenerate button has `<span class="btn-text">` wrapping the label | ✅ | `src/index.html:259-263` (K.8 markup). Test `SPEC §30 K.8: src/index.html Z-Image regenerate button has btn-text + btn-spinner markup` passes. |
| Z-Image Regenerate button has `<span class="btn-spinner" hidden aria-hidden="true">` child | ✅ | `src/index.html:264` (K.8 markup). Test passes. |
| Anima Regenerate button has `<span class="btn-text">` wrapping the label | ✅ | `src/index.html:316-320` (K.8 markup). Test `SPEC §30 K.8: src/index.html Anima regenerate button has btn-text + btn-spinner markup` passes. |
| Anima Regenerate button has `<span class="btn-spinner" hidden aria-hidden="true">` child | ✅ | `src/index.html:321` (K.8 markup). Test passes. |
| Slice K.8 marker present in src/index.html | ✅ | Test `SPEC §30 K.8: H5 close — slice identifier present in src/index.html` passes. |
| No new endpoint / no new dependency / no new contract | ✅ | Only `src/index.html` modified. No server.js change, no package.json change, no SPEC contract change. |
| 3 new tests (722 → 725) | ✅ | tests/run-all.js tail block, 3 new tests. Total: 725 / 0 green. |

### Spec findings

- **None blocking.**
- **None minor.** All 7 spec requirements met; all 3
  test targets locked.

---

## 4. Test review

3 new tests, all use the existing K.6 test pattern
(`fs.readFileSync` + regex on the relevant panel block).
The tests assert literal source patterns that were
independently derived from the K.6 Krea-2 markup. They
would catch a future regression that strips the
`btn-text` or `btn-spinner` markup from either button.

**No tautological tests. No implementation-coupled tests.**

---

## 5. Risk review

K.8 has no new risks. It is HTML-only; no JS change, no
state change, no contract change. The only risk is
"regression in K.6 markup" — which the K.6 test block
already locks.

---

## 6. Cross-references

- SPEC §30.6.3 (K.8 sub-slice spec) — `docs/SPEC.md`
- ARCH §30 A12 (K.8 wiring architecture) — `docs/ARCHITECTURE.md`
- PRE-MORTEM §30.6.3 (K.8 pre-mortem) — `docs/PRE-MORTEM.md`
- K.6 Krea-2 markup (the pattern K.8 mirrors) — `src/index.html:381-388`
- BACKLOG H5 closure — `docs/BACKLOG.md`

---

## Verdict

**pass.** Pure HTML fix; 725/0 green; no blockers, no
minor findings.
