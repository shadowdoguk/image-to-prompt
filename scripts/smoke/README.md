# Smoke tests

- `node scripts/smoke/chat-conversational-smoke.js` — exercise conversational draft endpoints (create session, discussion, proposal, `apply it`) against an in-process server with `chat/completions` mocked via `global.fetch`.