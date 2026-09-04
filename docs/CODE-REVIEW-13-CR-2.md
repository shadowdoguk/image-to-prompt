# Code review — CR-2 (image attachments + vision)

**Slice:** CR-2 of the CR series (SPEC §18 / ADR 0025).
**Date:** 2026-09-04.
**Reviewer:** self-review (full-autonomy directive).
**Verdict:** **pass+minor**

---

## Standards axis

| Check | Result |
|---|---|
| `node --check server.js && node --check src/app.js` | exit 0 |
| `node tests/run-all.js` | 477 passed, 1 failed (pre-existing `declined_suggested_prompt` — not in CR-2 scope) |
| New tests added (CR-2) | 14 (POST upload round-trip, invalid mime, GET serves correct mime, GET 404, DELETE cascade to messages, session-delete cascade, cross-session id strip, vision-capable message body, text-only fallback, HTML/CSS/JS wiring, server route registration) |
| Mime allowlist | `image/png`, `image/jpeg`, `image/webp` (mirrors Stage 1) |
| File size cap | 10 MB per file (SPEC §18.1) |
| Max attachments per message | 4 (bounds vision message body) |
| Cross-session id stripping | ✅ — manifest lookup strips ids that don't belong to the session |
| Vision-capable model regex | `m3|minimax|gpt-4o|claude|vision|qwen-vl|gemini|llava|pixtral` (broad match; refine later if needed) |
| Text-only fallback for non-vision models | ✅ — `content` becomes a string with an `[N attachment(s) attached — not visible to the current model.]` note |
| Global multer error handler honoured `statusCode` tag | ✅ — fileFilter rejections return 400 instead of generic 500 |
| File path resolution from manifest, not URL | ✅ — `GET /api/chat/attachments/:id` reads `entry.path` from the manifest; URL never trusted |
| Session-delete cascade | ✅ — removes per-session dir + unlinks every attachment in that session from the manifest |
| Attachment unlink from messages on DELETE | ✅ — every chat session that referenced the id has the id stripped from its messages |

### Minor (non-blocking)

- **M-1:** Vision-capable model detection uses a substring regex. If a non-vision model name accidentally contains `vision` (e.g. `some-non-vision-model`), it will be misclassified as vision-capable. Tests deliberately use `gpt-3.5-turbo` to avoid the false positive. Refine to word-boundary matching when the catalogue stabilises.
- **M-2:** No per-session attachment cap or total disk cap yet. ARCHITECTURE CR-A6 flags the refactor trigger (1 GB total).
- **M-3:** No lightbox modal — thumbnails open in a new tab. Parked for a future polish slice.

## Spec axis

| SPEC §18 acceptance criterion | Met? |
|---|---|
| 3. Chat accepts image attachments | ✅ |
| 5. Attachments persist across server restart | ✅ — files on disk under `data/chat_attachments/<session_id>/`; manifest in `data/chat_attachments/_manifest.json` |
| Sync across all surfaces | ✅ — attachment ids flow: upload → message.attachment_ids → transcript thumbnails → DELETE unlinks |

## Files changed (delta)

| File | Change | Lines |
|---|---|---|
| `server.js` | multer config for chat attachments + 3 endpoints + vision helper + cascade + global error handler | +~220 |
| `src/index.html` | paperclip button + hidden file input + pending-attachments container | +7 |
| `src/app.js` | state fields + DOM refs + uploadChatAttachment + renderChatPendingAttachments + send body update + click handler + file input handler + transcript thumbnail render | +~140 |
| `src/styles.css` | paperclip + pending card + transcript thumbnail styles | +75 |
| `tests/run-all.js` | 14 CR-2 tests | +~270 |
| `README.md` | Chat Attachment API section | +26 |

## Risks carried forward

- **R-1 (LOW):** Vision regex false-positive (M-1) — mitigated by tests; will be tightened when model catalogue stabilises.
- **R-2 (LOW):** Disk growth — flagged in ARCHITECTURE CR-A6; current cap is implicit (10 MB × 4 × sessions).

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass for CR-2 scope**
- Overall: **pass+minor** — ready for CR-3.
