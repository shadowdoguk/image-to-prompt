# Conversational Prompt Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make post-generation chat a reliable two-way conversation that can discuss the original prompt, refine an unapplied draft across turns, and commit changes only after explicit user confirmation.

**Architecture:** Keep the existing Express chat routes and vanilla frontend. Add `pending_prompt` beside the immutable `original_prompt` and committed `current_prompt`; bounded provider context uses the original, active draft, compact analysis, and recent history. Discussion turns do not mutate prompt state, proposal turns update only `pending_prompt`, and button/text Apply commits a proposal to `current_prompt`.

**Tech Stack:** Node.js 18+ CommonJS, Express 4, MiniMax chat-completions API, vanilla HTML/CSS/JavaScript, Node built-in `fetch`, `tests/run-all.js`.

## Global Constraints

- Apply the workflow to every preset; retain `ZIMAGE_CHAT_CONSTRAINTS_BLOCK` for Z-Image sessions.
- Preserve `original_prompt` as immutable and `current_prompt` as the last explicitly committed prompt.
- Use `pending_prompt` for the latest unapplied proposal; never update `current_prompt` on a recommendation or discussion turn.
- Keep `CHAT_CONTEXT_CHAR_BUDGET` exactly `20000` characters and keep provider history bounded within that budget.
- Use only existing dependencies; do not add a package or build step.
- Keep the MiniMax API key server-side and never log keys or raw provider secrets.
- Render user/model text with existing safe DOM APIs such as `textContent`.
- Do not add code comments.
- Run `node tests/run-all.js` and `node scripts/session-init.js` after implementation; there is no configured lint or typecheck command.
- Do not commit changes unless the user explicitly authorizes a commit; commit checkpoints in this plan are optional review points.

---

## File Map

| File | Responsibility in this change |
|---|---|
| `server.js` | Chat session normalization, commit-intent detection, bounded prompt/history construction, provider retry behavior, pending-draft route state, exports. |
| `src/app.js` | Render unapplied proposals, describe pending state, preserve Apply behavior across new session fields. |
| `src/index.html` | Explain discussion/proposal/commit behavior and update chat affordance copy. |
| `src/styles.css` | Style the unapplied proposal state without changing existing visual primitives. |
| `tests/run-all.js` | Pure helper, HTTP route, persistence, context-budget, fallback, and frontend regression coverage. |
| `package.json` | Point the existing `npm test` script at the canonical test suite. |
| `CONTEXT.md` | Document the conversational state model and bounded Stage 2.5 context. |
| `docs/adr/0020-conversational-prompt-drafts.md` | Record the new accepted architectural behavior after implementation; begin as Proposed. |

---

### Task 1: Add pending-draft state and deterministic commit intent

**Files:**
- Modify: `server.js:108-116` for chat constants.
- Modify: `server.js:5265-5294` for session reads and legacy normalization.
- Modify: `server.js:5914-5950` for session creation.
- Add tests: `tests/run-all.js` immediately after the existing chat persistence tests around line 5329.

**Interfaces:**
- Produces `CHAT_CONTEXT_CHAR_BUDGET = 20000` for later context tests.
- Produces `CHAT_HISTORY_CHAR_BUDGET = 6000` and `CHAT_HISTORY_MAX_MESSAGES = 12` for Task 2.
- Produces `normalizeChatSession(session) -> object` that supplies `pending_prompt: null` when absent.
- Produces `isExplicitChatCommit(content) -> boolean` for Task 3.
- Produces `findLatestChatProposalMessage(session) -> object|null` for Task 3.

- [ ] **Step 1: Write failing pure-helper and persistence tests.**

Add tests with concrete expectations:

```js
test('Chat drafts: legacy sessions normalize pending_prompt and explicit commit commands are narrow', () => {
  const {
    normalizeChatSession,
    isExplicitChatCommit,
    findLatestChatProposalMessage
  } = require(path.join(PROJECT_ROOT, 'server.js'));

  const legacy = normalizeChatSession({
    id: 'chat_legacy',
    original_prompt: 'original',
    current_prompt: 'current',
    messages: []
  });
  assertEqual(legacy.pending_prompt, null, 'legacy session gets null pending_prompt');

  for (const command of ['apply it', 'Apply that.', 'use the proposal', 'commit this']) {
    assertTrue(isExplicitChatCommit(command), `${command} is explicit`);
  }
  for (const message of ['I think we should use that approach', 'that looks good', 'please explain this']) {
    assertTrue(!isExplicitChatCommit(message), `${message} remains conversational`);
  }

  const session = {
    pending_prompt: 'new draft',
    messages: [
      { role: 'assistant', suggested_prompt: 'older draft' },
      { role: 'assistant', suggested_prompt: 'new draft' }
    ]
  };
  assertEqual(
    findLatestChatProposalMessage(session).suggested_prompt,
    'new draft',
    'latest pending proposal is found'
  );
});

test('Chat drafts: new sessions initialize pending_prompt to null', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'new prompt', preset_id: getFirstPresetId() })
    });
    assertEqual(created.status, 201, 'session create succeeds');
    assertEqual(created.body.data.pending_prompt, null, 'new pending prompt is null');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});
```

- [ ] **Step 2: Run the focused test command and verify failure.**

Run:

```bash
node tests/run-all.js
```

Expected: the existing suite runs, and the new tests fail because the constants and helpers are not exported and new sessions do not include `pending_prompt`.

- [ ] **Step 3: Implement normalization and commit-intent helpers.**

Add the constants and pure helpers in `server.js`:

```js
const CHAT_CONTEXT_CHAR_BUDGET = 20000;
const CHAT_HISTORY_CHAR_BUDGET = 6000;
const CHAT_HISTORY_MAX_MESSAGES = 12;

const normalizeChatSession = (session) => {
  if (!session || typeof session !== 'object') return session;
  if (!Object.prototype.hasOwnProperty.call(session, 'pending_prompt')) {
    session.pending_prompt = null;
  }
  if (typeof session.pending_prompt !== 'string' || session.pending_prompt.trim().length === 0) {
    session.pending_prompt = null;
  }
  return session;
};

const isExplicitChatCommit = (content) => {
  if (typeof content !== 'string') return false;
  const normalized = content.trim().toLowerCase().replace(/[.!?]+$/g, '');
  return new Set([
    'apply it',
    'apply that',
    'apply the proposal',
    'use it',
    'use that',
    'use the proposal',
    'commit this',
    'commit that',
    'commit the proposal'
  ]).has(normalized);
};

const findLatestChatProposalMessage = (session) => {
  const pending = typeof session?.pending_prompt === 'string'
    ? session.pending_prompt
    : '';
  if (!pending || !Array.isArray(session?.messages)) return null;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message?.role === 'assistant' && message.suggested_prompt === pending) {
      return message;
    }
  }
  return null;
};
```

Use `normalizeChatSession` on every valid session returned by `readChatSessions`, and initialize `pending_prompt: null` in the session object created by `POST /api/chat/sessions`. Export the constants and helpers with the existing chat exports.

- [ ] **Step 4: Run the focused suite and verify it passes.**

Run:

```bash
node tests/run-all.js
```

Expected: the new draft-state tests and all pre-existing tests pass.

- [ ] **Step 5: Review the diff.**

Run:

```bash
git diff -- server.js tests/run-all.js
```

Verify that only chat state, constants, exports, and the new tests changed. Do not commit without authorization.

---

### Task 2: Build bounded provider context and concise conversational contracts

**Files:**
- Modify: `server.js:5189-5245` to replace the one-purpose system contract with discussion/proposal/refinement rules.
- Modify: `server.js:5590-5678` for bounded history and parse-fallback correction retries.
- Modify: `server.js:5762-5904` for compact analysis and bounded live context.
- Modify: `server.js:6189-6330` for exports.
- Add tests: `tests/run-all.js` after the Task 1 tests.

**Interfaces:**
- Produces `compactChatAnalysisSnapshot(snapshot, maxFieldLength = 240) -> object`.
- Produces `buildBoundedChatHistory(messages, maxChars = CHAT_HISTORY_CHAR_BUDGET) -> Array<{role, content}>`.
- Produces `buildChatRequestContext(session) -> { systemPrompt: string, messages: Array<{role, content}> }`.
- Keeps `buildChatSystemPrompt(session) -> string` as the existing public helper.
- Keeps `extractChatReply(raw) -> { reply, suggested_prompt, fallback_reason }` compatible.

- [ ] **Step 1: Write failing context-budget tests.**

Add a long-session fixture and assert both state visibility and the hard budget:

```js
test('Chat context: compacts analysis and bounds provider input', () => {
  const {
    CHAT_CONTEXT_CHAR_BUDGET,
    CHAT_HISTORY_CHAR_BUDGET,
    compactChatAnalysisSnapshot,
    buildBoundedChatHistory,
    buildChatRequestContext
  } = require(path.join(PROJECT_ROOT, 'server.js'));

  const snapshot = {};
  for (let i = 0; i < 20; i++) snapshot[`field_${i}`] = 'x'.repeat(1000);
  const compact = compactChatAnalysisSnapshot(snapshot);
  assertTrue(JSON.stringify(compact).length < JSON.stringify(snapshot).length, 'analysis is compacted');

  const messages = Array.from({ length: 200 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i} ${'x'.repeat(1000)}`
  }));
  const history = buildBoundedChatHistory(messages);
  assertTrue(history.length <= 12, 'history message count is bounded');
  assertTrue(
    history.reduce((total, message) => total + message.content.length, 0) <= CHAT_HISTORY_CHAR_BUDGET,
    'history character budget is bounded'
  );

  const session = {
    preset_id: 'preset_968c0ccdf6fc6151',
    original_prompt: 'ORIGINAL '.repeat(500),
    current_prompt: 'CURRENT '.repeat(500),
    pending_prompt: 'PENDING '.repeat(500),
    analysis_snapshot: snapshot,
    messages
  };
  const context = buildChatRequestContext(session);
  const totalChars = context.systemPrompt.length + context.messages.reduce(
    (total, message) => total + message.content.length,
    0
  );
  assertTrue(totalChars <= CHAT_CONTEXT_CHAR_BUDGET, 'provider input fits the hard budget');
  assertTrue(context.systemPrompt.includes('ORIGINAL'), 'original prompt remains visible');
  assertTrue(context.systemPrompt.includes('PENDING'), 'pending prompt remains visible');
  assertTrue(context.systemPrompt.includes('Z-IMAGE CONTRACT'), 'Z-Image contract remains visible');

  const nonZImage = buildChatRequestContext({
    preset_id: 'preset_photorealistic',
    original_prompt: 'photo original',
    current_prompt: 'photo original',
    pending_prompt: null,
    analysis_snapshot: null,
    messages: []
  });
  assertTrue(!nonZImage.systemPrompt.includes('Z-IMAGE CONTRACT'), 'non-Z-Image sessions omit Z-Image contract');

  const presets = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'presets.json'), 'utf8'));
  for (const preset of presets) {
    const presetContext = buildChatRequestContext({
      preset_id: preset.id,
      original_prompt: 'preset prompt',
      current_prompt: 'preset prompt',
      pending_prompt: null,
      analysis_snapshot: null,
      messages: []
    });
    assertTrue(presetContext.systemPrompt.length > 0, `${preset.id} builds chat context`);
  }
});
```

- [ ] **Step 2: Run the focused suite and verify failure.**

Run:

```bash
node tests/run-all.js
```

Expected: the new test fails because the context helpers and budget export do not exist.

- [ ] **Step 3: Implement deterministic compaction and history selection.**

Implement these helpers without adding dependencies:

```js
const compactChatAnalysisSnapshot = (snapshot, maxFieldLength = 240) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const compact = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined || value === '') continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) continue;
    compact[key] = text.length > maxFieldLength
      ? `${text.slice(0, maxFieldLength - 1)}…`
      : text;
  }
  return compact;
};

const buildBoundedChatHistory = (messages, maxChars = CHAT_HISTORY_CHAR_BUDGET) => {
  if (!Array.isArray(messages)) return [];
  const selected = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && selected.length < CHAT_HISTORY_MAX_MESSAGES; i--) {
    const message = messages[i];
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (typeof message.content !== 'string' || message.content.length === 0) continue;
    if (chars + message.content.length > maxChars) break;
    selected.unshift({ role: message.role, content: message.content });
    chars += message.content.length;
  }
  return selected;
};
```

Rewrite the static chat contract so it explicitly says:

- answer discussion questions without emitting a proposal;
- emit a complete `suggested_prompt` only for a recommendation or requested change;
- use pending as the editing base when it exists;
- preserve original/current/pending distinctions;
- never commit from model output;
- return exactly the existing two-string JSON schema.

Keep the Z-Image block’s domain rules but remove duplicated examples and repeated explanation so it fits the budget.

Implement `buildChatRequestContext(session)` as the only route-facing context builder. It must construct the system prompt, calculate remaining budget, and pass that remainder into `buildBoundedChatHistory`. When original and current are identical, include the prompt once and label it as both original and committed. Compact the analysis snapshot before interpolation. Preserve the complete original prompt and complete active prompt whenever they fit; trim analysis detail first, then old history, then the committed current prompt to 2,000 characters when a pending prompt exists. Keep the final combined system plus history character count at or below `CHAT_CONTEXT_CHAR_BUDGET`.

- [ ] **Step 4: Add parse-fallback correction retries.**

In `callMiniMaxChat`, preserve the existing `baseOpenaiMessages` and, after a parse-level failure, retry with a fresh bounded array:

```js
const correction =
  'Your previous response was empty or malformed. Reply with exactly one JSON object containing a non-empty reply string and a suggested_prompt string. Use an empty suggested_prompt for discussion only. Do not include markdown or explanation outside the JSON object.';
openaiMessages = [
  ...baseOpenaiMessages,
  { role: 'user', content: correction }
];
```

Do not append a new correction on top of the previous correction. Keep fatal network/auth/timeout errors non-retriable. Keep preservation retries based on the active prompt passed in `options.currentPrompt`.

- [ ] **Step 5: Run context and existing tests.**

Run:

```bash
node tests/run-all.js
```

Expected: all tests pass, including the context budget test and existing parser/schema tests. The existing `max_tokens: 2400` and string-only `suggested_prompt` schema remain intact.

- [ ] **Step 6: Review provider request construction.**

Run:

```bash
git diff -- server.js tests/run-all.js
```

Verify no provider request can contain more than 20,000 characters across system and selected history, no full 200-message history is sent, and no API key is included in any diagnostic string. Do not commit without authorization.

---

### Task 3: Wire discussion, proposals, draft refinement, and text Apply into the routes

**Files:**
- Modify: `server.js:5993-6086` for message handling.
- Modify: `server.js:6094-6127` for selected proposal Apply.
- Add tests: `tests/run-all.js` after the existing HTTP chat integration tests around line 5639.

**Interfaces:**
- `POST /api/chat/sessions/:id/messages` returns the complete updated session with `pending_prompt`.
- Discussion responses leave `current_prompt` and `pending_prompt` unchanged.
- Proposal responses update only `pending_prompt`.
- `isExplicitChatCommit` handles text Apply before any provider call when a pending proposal exists.
- `POST /api/chat/sessions/:id/apply/:messageId` commits the selected assistant proposal and clears `pending_prompt`.

- [ ] **Step 1: Add a test-only MiniMax response shim in the test file.**

Add this helper near `startTestServer` so route tests do not call the real provider:

```js
const withMockChatProvider = async (responses, callback) => {
  const realFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return realFetch(url, options);
    const payload = responses.shift();
    if (!payload) throw new Error('mock chat response queue exhausted');
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    return await callback();
  } finally {
    global.fetch = realFetch;
  }
};
```

- [ ] **Step 2: Write failing HTTP tests for all conversation outcomes.**

Add one test that creates a session and exercises the full state machine:

```js
test('HTTP chat drafts: discussion, proposal, refinement, and text commit preserve state', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'original prompt', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    const responses = [
      { reply: 'The lighting was chosen to separate the subject from the background.', suggested_prompt: '' },
      { reply: 'I recommend a warmer, more directional treatment while keeping the subject unchanged.', suggested_prompt: 'original prompt with warmer directional lighting' },
      { reply: 'I kept the proposal and softened the warmth.', suggested_prompt: 'original prompt with softer warm directional lighting' }
    ];

    await withMockChatProvider(responses, async () => {
      const discussion = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Why is the lighting described this way?' })
      });
      assertEqual(discussion.status, 200, 'discussion succeeds');
      assertEqual(discussion.body.data.current_prompt, 'original prompt', 'discussion does not commit');
      assertEqual(discussion.body.data.pending_prompt, null, 'discussion has no pending draft');

      const proposal = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'What change would make the lighting warmer?' })
      });
      assertEqual(proposal.status, 200, 'proposal succeeds');
      assertEqual(proposal.body.data.current_prompt, 'original prompt', 'proposal does not commit');
      assertEqual(proposal.body.data.pending_prompt, 'original prompt with warmer directional lighting', 'proposal becomes pending');

      const refinement = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Keep the idea but make it softer.' })
      });
      assertEqual(refinement.status, 200, 'refinement succeeds');
      assertEqual(refinement.body.data.current_prompt, 'original prompt', 'refinement does not commit');
      assertEqual(refinement.body.data.pending_prompt, 'original prompt with softer warm directional lighting', 'refinement replaces pending draft');

      const committed = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'apply it' })
      });
      assertEqual(committed.status, 200, 'text Apply succeeds');
      assertEqual(committed.body.data.current_prompt, 'original prompt with softer warm directional lighting', 'text Apply commits latest draft');
      assertEqual(committed.body.data.pending_prompt, null, 'text Apply clears pending draft');
    });
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});
```

Add a second test where `I think we should use that approach` receives a discussion response and assert that `current_prompt` and `pending_prompt` remain unchanged. Add a third test that seeds a `pending_prompt`, submits a malformed provider response, and asserts that neither prompt field changes and the assistant fallback is persisted.

- [ ] **Step 3: Run the focused suite and verify failure.**

Run:

```bash
node tests/run-all.js
```

Expected: the new HTTP tests fail because the message route always calls MiniMax, does not update `pending_prompt`, and does not recognize text Apply.

- [ ] **Step 4: Implement the route state transitions.**

In the message route, normalize the loaded session and append the user message as today. Before building provider messages, handle explicit commit only when `session.pending_prompt` is non-null:

```js
if (isExplicitChatCommit(userMessage.content) && session.pending_prompt) {
  const proposal = findLatestChatProposalMessage(session);
  if (!proposal) {
    session.messages.pop();
    return res.status(409).json({ success: false, error: 'The pending proposal is no longer available. Ask the assistant for a new proposal.' });
  }
  session.current_prompt = session.pending_prompt;
  session.pending_prompt = null;
  session.messages.push({
    id: generateChatMessageId(),
    role: 'assistant',
    content: 'Applied the latest proposal to the working prompt.',
    suggested_prompt: null,
    timestamp: new Date().toISOString()
  });
  session.updated_at = new Date().toISOString();
  writeChatSessions(sessions);
  return res.json({ success: true, data: session });
}
```

Use `buildChatRequestContext(session)` after the user message is appended. Pass the active editing base into `callMiniMaxChat`:

```js
const context = buildChatRequestContext(session);
const activePrompt = session.pending_prompt || session.current_prompt;
parsedReply = await callMiniMaxChat(context.systemPrompt, context.messages, {
  currentPrompt: activePrompt,
  lastUserRequest: userMessage.content
});
```

After the provider returns, persist the assistant message as today. If `parsedReply.suggested_prompt` is a non-empty string, set `session.pending_prompt` to it. If it is null, preserve any existing pending draft. If preservation fails, preserve the existing declined metadata and leave `pending_prompt` unchanged. Keep fatal-error rollback behavior.

- [ ] **Step 5: Implement selected-button Apply.**

Keep the existing message validation, then set:

```js
session.current_prompt = message.suggested_prompt;
session.pending_prompt = null;
session.updated_at = new Date().toISOString();
writeChatSessions(sessions);
```

Do not allow Apply against a user message, empty proposal, or unknown message. Applying an older valid proposal intentionally replaces the pending draft with the selected message and clears pending state.

- [ ] **Step 6: Run the route tests and existing chat tests.**

Run:

```bash
node tests/run-all.js
```

Expected: discussion, initial proposal, chained refinement, text Apply, malformed response, persistence, apply validation, cap, delete, and no-ghost-message tests all pass.

- [ ] **Step 7: Review state transitions.**

Run:

```bash
git diff -- server.js tests/run-all.js
```

Verify that no route assigns `current_prompt` from model output except the explicit text/button Apply branches, and that all successful message responses include the normalized `pending_prompt` field. Do not commit without authorization.

---

### Task 4: Render pending proposals and commit status in the frontend

**Files:**
- Modify: `src/app.js:4047-4197` for message rendering.
- Modify: `src/app.js:4291-4349` and `src/app.js:4422-4459` for session/status updates.
- Modify: `src/app.js:4500-4525` for Apply state handling.
- Modify: `src/app.js:4600-4623` for restored-session status.
- Add tests: `tests/run-all.js` near the existing frontend chat tests around line 5945.

**Interfaces:**
- `buildChatMessageNode(message, session)` renders proposal state without trusting client text as HTML.
- `renderChatMessages(session)` passes the session state to each message node.
- `formatChatSessionStatus(session)` returns a status string containing either `unapplied proposal` or `no unapplied proposal`.
- Existing Apply, Retry, input-preservation, and session-selection behavior remains intact.

- [ ] **Step 1: Write failing frontend contract tests.**

Add static checks:

```js
test('Frontend chat: pending proposal state is rendered and described as unapplied', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'styles.css'), 'utf8');
  assertTrue(/pending_prompt/.test(js), 'frontend reads pending_prompt');
  assertTrue(/Apply proposal/.test(js), 'frontend exposes Apply proposal copy');
  assertTrue(/unapplied proposal/i.test(js), 'frontend labels unapplied state');
  assertTrue(/discuss|recommend|proposal/i.test(html), 'HTML explains conversational workflow');
  assertTrue(/chat-message--pending/.test(css), 'pending proposal style exists');
});
```

- [ ] **Step 2: Run the focused suite and verify failure.**

Run:

```bash
node tests/run-all.js
```

Expected: the new frontend test fails because the current code does not reference `pending_prompt`, use the new status copy, or define the pending class.

- [ ] **Step 3: Update message rendering and session status.**

Change the renderer signature and call site to pass the current session:

```js
const renderChatMessages = (session) => {
  messages.forEach((message) => frag.appendChild(buildChatMessageNode(message, session)));
};

const buildChatMessageNode = (m, session) => {
  const isPending = m.role === 'assistant' &&
    typeof session?.pending_prompt === 'string' &&
    session.pending_prompt.length > 0 &&
    m.suggested_prompt === session.pending_prompt;
  if (isPending) node.classList.add('chat-message--pending');
};
```

Add a small status helper that distinguishes a session with a pending proposal from a committed-only session. Use it in `activateChatForResult`, `selectChatSession`, and after successful sends. Keep the message input active for discussion after either state.

Ensure proposal labels say `Unapplied proposal` until the proposal is applied. The Apply button continues to call the existing endpoint; after success, update `state.finalPrompt`, `dom.resultPrompt.textContent`, the token reminder, local session state, and the message render.

- [ ] **Step 4: Update HTML and CSS.**

Change the hint and placeholder in `src/index.html` so they explicitly support discussion and proposals:

```html
<p class="chat-hint">
  Discuss the prompt, ask for recommendations, or request a change. Proposed revisions stay unapplied until you choose Apply proposal or say “apply it”.
</p>
```

Add only the pending modifier to `src/styles.css` using existing variables:

```css
.chat-message--pending {
  border-left-color: var(--warning);
  background: rgba(245, 158, 11, 0.08);
}

.chat-message--pending .chat-message__preview-label {
  color: var(--warning);
}
```

- [ ] **Step 5: Run frontend and full tests.**

Run:

```bash
node tests/run-all.js
```

Expected: all frontend static checks and existing chat tests pass. Verify the current input-preservation and Retry tests remain green.

- [ ] **Step 6: Review frontend behavior.**

Run:

```bash
git diff -- src/app.js src/index.html src/styles.css tests/run-all.js
```

Verify the result prompt changes only in `applyChatRevision`, the text command response, or existing Stage 2 generation; discussion and recommendation rendering never changes Step 4. Do not commit without authorization.

---

### Task 5: Align test command and record the architectural contract

**Files:**
- Modify: `package.json:7-12`.
- Modify: `CONTEXT.md:129-149` and `CONTEXT.md:169`.
- Create: `docs/adr/0020-conversational-prompt-drafts.md`.

**Interfaces:**
- `npm test` runs `node tests/run-all.js`.
- `CONTEXT.md` documents `pending_prompt`, explicit commit, and bounded provider history.
- ADR 0020 records the accepted conversational draft architecture after implementation verification.

- [ ] **Step 1: Write documentation and script assertions before changing files.**

Add these checks to `tests/run-all.js`:

```js
test('Project commands: npm test points at the canonical suite', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  assertEqual(packageJson.scripts.test, 'node tests/run-all.js', 'npm test uses canonical suite');
});

test('Chat contract documentation names the pending draft state', () => {
  const context = fs.readFileSync(path.join(PROJECT_ROOT, 'CONTEXT.md'), 'utf8');
  assertTrue(/pending_prompt/.test(context), 'CONTEXT documents pending_prompt');
  assertTrue(/explicit|Apply/i.test(context), 'CONTEXT documents explicit commit');
});
```

- [ ] **Step 2: Run tests and verify failure.**

Run:

```bash
node tests/run-all.js
```

Expected: the command-script and documentation checks fail against the current package and context text.

- [ ] **Step 3: Fix the test script.**

Change only the script entry:

```json
"test": "node tests/run-all.js"
```

- [ ] **Step 4: Update domain documentation.**

In `CONTEXT.md` Stage 2.5, state that chat has immutable original, committed current, and optional pending prompt states; discussion turns do not propose; proposals are refined against pending; and Apply is explicit. Update the Chat session entity row to include `pending_prompt` and the bounded recent-history provider context.

- [ ] **Step 5: Create the ADR.**

Create `docs/adr/0020-conversational-prompt-drafts.md` with this structure and no unresolved placeholders:

```markdown
# ADR 0020 — Conversational prompt drafts with explicit commit

## Status

Proposed until implementation verification completes.

## Context

The post-generation chat needed to support discussion and iterative refinement, while unbounded prompt/history context caused MiniMax parse fallbacks and the existing current_prompt-only model gave the user no unapplied draft state.

## Decision

Maintain original_prompt, current_prompt, and pending_prompt separately. Discussion does not mutate prompt state. Recommendations and refinements update pending_prompt only. A button or deterministic explicit text command commits the pending proposal to current_prompt. Provider context is bounded at 20,000 characters using compact analysis and recent history.

## Consequences

The session shape gains an optional pending_prompt field, old sessions remain readable, the existing route family remains in place, and users gain a safe multi-turn proposal workflow. Older chat messages retain suggested_prompt compatibility.

## Rejected alternatives

Automatically applying model proposals was rejected because conversational exploration must not alter the prompt unexpectedly. Sending all persisted history was rejected because it made reliability depend on conversation length.

## Verification

Implementation is accepted only after the canonical test suite, session initialization, and manual browser smoke test pass.
```

After implementation verification passes, change ADR status from `Proposed` to `Accepted. Implemented 2026-07-21.` and add the verification commands and result summary. Do not commit without authorization.

- [ ] **Step 6: Run documentation checks.**

Run:

```bash
npm test
```

Expected: the command resolves to `tests/run-all.js` and the new documentation checks pass.

---

### Task 6: Full verification and manual conversation smoke test

**Files:**
- Verify: `server.js`, `src/app.js`, `src/index.html`, `src/styles.css`, `tests/run-all.js`, `package.json`, `CONTEXT.md`, `docs/adr/0020-conversational-prompt-drafts.md`.

- [ ] **Step 1: Run the canonical suite through npm.**

Run:

```bash
npm test
```

Expected: the complete suite exits successfully with zero failed tests.

- [ ] **Step 2: Run the session acceptance gate.**

Run:

```bash
node scripts/session-init.js
```

Expected: validation reports `10/10 passed (100%)`, no high-severity drift, and no leftover uploads.

- [ ] **Step 3: Run syntax validation for every changed JavaScript file.**

Run:

```bash
node --check server.js && node --check src/app.js && node --check tests/run-all.js
```

Expected: the command exits with status 0 and prints no syntax errors.

- [ ] **Step 4: Check the working diff for accidental artifacts.**

Run:

```bash
git diff --check && git status --short
```

Expected: `git diff --check` prints no whitespace errors; only the planned files and `.opencode` session state are present. Do not include runtime data changes from tests.

- [ ] **Step 5: Start the local server for manual verification.**

Run:

```bash
npm start
```

Expected: the server reports its localhost URL and `MiniMax M3 configured: true` when a valid local key is configured. Do not print or copy the key.

- [ ] **Step 6: Verify the browser conversation manually.**

Use a generated prompt and perform this exact sequence:

1. Ask `Why did you choose this composition?`; verify an assistant answer appears with no proposal Apply action and the Step 4 prompt is unchanged.
2. Ask `What changes would make the focal subject stand out more?`; verify a proposal preview appears and Step 4 remains unchanged.
3. Ask `Keep the proposal but reduce the saturation`; verify the new preview replaces the pending preview without changing Step 4.
4. Click `Apply proposal`; verify Step 4, the token reminder, and the session status update.
5. Ask for another recommendation, then type `apply it`; verify the latest pending proposal commits and an assistant confirmation is added without an extra provider call.
6. Type `I think that is a good direction`; verify it does not commit anything automatically.
7. Repeat the flow with a Z-Image preset and a long prompt; verify the chat responds or shows Retry without the old generic fallback being produced solely by unbounded history.
8. Reload the browser, select the saved conversation, and verify original/current/pending state and message history remain readable.

- [ ] **Step 7: Update ADR status after successful verification.**

Change the status line in `docs/adr/0020-conversational-prompt-drafts.md` to:

```markdown
Accepted. Implemented 2026-07-21.
```

Add the actual `npm test`, `node scripts/session-init.js`, and manual smoke-test results. Do not claim completion until these commands have passed in the current workspace.

- [ ] **Step 8: Final review checkpoint.**

Run:

```bash
git diff --stat && git diff -- docs/superpowers/specs/2026-07-21-conversational-prompt-refinement-design.md docs/superpowers/plans/2026-07-21-conversational-prompt-refinement.md
```

Expected: the implementation matches the approved spec, no unrelated files changed, and no commit is created without explicit user authorization.
