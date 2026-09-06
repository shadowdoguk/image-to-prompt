# Visual Demo CR-28 — sparse-image-fix

**Slice:** Bugfix (Option A from user report "again the tool will not analyze image")
**Date:** 2026-09-06
**Browser:** Chromium via ChromedevTools (page 1, about:blank → navigated)
**Server:** `node server.js` on `http://localhost:3100` (PID 10774, single instance — confirms the `app.listen` EADDRINUSE handler is wired but not active in this run)

---

## 1. App loads (Create view)

`screenshot: docs/cr28-app-loaded.png`

- Page title: `Create · Image-to-Prompt`
- Hash route: `/#/create`
- All UI-R0..R7 surfaces are reachable from this view (Library, Chat, Providers & keys, Settings tabs visible in the nav).
- No console errors; `src/styles.css` + `src/app.js` both load.
- The `server.js` changes don't affect the page-render path; this slice is opaque to the static asset surface.

## 2. Repro of the user's bug

Manually reproduce the user's scenario:

1. Open the app (above screenshot).
2. Drag a near-uniform or low-detail image onto the upload zone (a 16×16 black PNG is the minimum repro; a flat color JPEG, a soft gradient, or a single-object photo against a uniform background are equivalent cases).
3. Select any preset with multiple stage1_fields (e.g., `preset_alla_prima_oil`, which has 13).
4. Click "Analyze image".

Expected behavior on this slice:

| Check | Result |
|---|---|
| HTTP status of `/api/analyze` | `422` (was: `200`) |
| Response envelope | `{ success:false, code:'IMAGE_TOO_MINIMAL', violations:[ { field:'subject', actual:0, required:100 } ] }` (was: `{ success:true, data:{ analysis:{ subject:'' } } }` for empty subject, or near-empty for other shapes) |
| Server console | logs `Stage 1 attempt 1 failed length validation on N field(s); retrying with strengthened prompt` + `Stage 1 attempt 2 still has M length violation(s): subject — accepting result` — preserved from before — but the throw now happens BEFORE the return, so no `200` ever goes out. |
| UI (the new banner) | "This image doesn't have enough content for analysis. The model couldn't extract a usable description — try a more detailed photo with subjects, colors, and a recognizable scene." (severity=warning; auto-dismisses after 6s like other warnings) |

For comparison: the existing toast for unrelated failures (rate-limit, network, no-key) still renders as `Analysis failed: <message>` — the new branch is additive only.

## 3. Regression — real photo (rich subject)

For a real photo where the LLM produces a rich subject and mostly-valid other fields:

- HTTP status: `200` (unchanged).
- Response envelope: full analysis object (unchanged).
- UI: editor populated with the LLM's description (unchanged).

The 3-rule threshold intentionally preserves the ADR-0001 best-effort path when the response is *thin-but-valid*. Specifically, Rule A (`subject=""; violations≥0`) and Rule C (`>50% of fields violate`) are the only triggers likely to fire in practice; Rule B (`subject<30 chars + ≥3 violations`) is the rare "thin subject + many short fields" case. None of these fire for a successful photo analysis.

## 4. EADDRINUSE handler

Independently verified: the new `httpServer.on('error', …)` in `server.js` catches port-collision crashes that previously surfaced as `Unhandled 'error' event` deep in `node:events:487`. In this run only one `node server.js` is alive (PID 10774), so the branch is dormant. A live collision would log:

```
Server failed to start on port 3100: listen EADDRINUSE: address already in use :::3100 (code: EADDRINUSE)
Another process is using port 3100. Run `pkill -f "node server.js"` from the project directory and retry.
```

…and exit with code 1 instead of throwing an uncaught event.

## 5. Evidence

| Source | Path |
|---|---|
| App-loaded screenshot (this slice) | `docs/cr28-app-loaded.png` |
| Code review (verdict `pass`) | `docs/CODE-REVIEW-28-sparse-image-fix.md` |
| HTTP integration test (2 mock responses → 422) | `tests/run-all.js` `sparse-image-fix:` block |
| Unit tests for the 3-rule contract | `tests/run-all.js` `sparse-image-fix: isImageTooMinimal follows 3-rule contract` |
| Session #11 entry (this work) | `docs/SESSION-STATE.md` (appended 2026-09-06) |
| Retired runtime-log concern | `docs/BACKLOG.md` Change Log row 2026-09-06 |
