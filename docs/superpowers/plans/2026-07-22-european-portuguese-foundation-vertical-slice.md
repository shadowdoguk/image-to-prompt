# European Portuguese Learning Platform — Foundation + A1 Vertical Slice Roadmap

> **Status:** Approved in brainstorming 2026-07-22. Decomposes the approved spec
> (`docs/superpowers/specs/2026-07-22-european-portuguese-learning-platform-design.md`)
> into four independently testable implementation plans in dependency order.
> This is a roadmap. Detailed execution plans live in companion files:
>
> - Phase A: `docs/superpowers/plans/2026-07-22-european-portuguese-foundation-curriculum-api.md`
> - Phase B: `docs/superpowers/plans/2026-07-22-european-portuguese-practice-web.md` (future)
> - Phase C: `docs/superpowers/plans/2026-07-22-european-portuguese-reviewed-audio-android.md` (future)
> - Phase D: `docs/superpowers/plans/2026-07-22-european-portuguese-guided-conversation.md` (future)

## 1. Goal of the vertical slice

Deliver one accepted A1 unit (`a1-introductions`) end-to-end across web and
Android. The learner can log in, browse the unit, see vocabulary, grammar,
pronunciation, and one language island, and progress through Shadow, Recall,
Smart Review, filters, and a personal collection. They can also run one
guided text conversation linked to the unit, and audio, Android, and
conversation all reuse the same progress record.

## 2. Cross-phase constraints (apply to every phase)

- Node `>=24.0.0`, npm `>=11.0.0`. Root stays CommonJS so the legacy
  `scripts/session-init.js` and `tests/run-all.js` keep working. Each new
  workspace (`apps/*`, `packages/*`) sets its own `type: module`.
- All new code lives under `apps/` and `packages/`. Never modify
  `server.js`, `src/`, `tests/run-all.js`, or any file under `data/`.
  The uncommitted `data/presets.json` stays as-is.
- Provider keys (MiniMax, Azure Speech) live server-side only. Tests use
  deterministic fakes.
- European Portuguese only. Every audio and content fixture declares
  `locale: "pt-PT"`. Zod schemas reject other locales for learner surface.
- Atomic curriculum publish: one Drizzle transaction per version, partial
  unique DB index on `(level, active=true)` so only one active version
  per level exists. Learners only see `status: "published"`.
- Authentication uses Argon2id. Access and refresh tokens are random
  opaque strings stored only as SHA-256 hashes in `auth_sessions`. No
  opaque tokens held only as SHA-256 hashes. No JWT package in phase
  A. Phase C layers Android bearer
  transport on the same primitives.
- Web cookies are HttpOnly + SameSite=Lax + Secure in production. Path
  is `/` so every API request carries them.
- Rate limits apply to login, refresh, and every mutating route.
- No commits during automation. Every commit is a review-only checkpoint
  that fires only after explicit user authorization.
- Code snippets in plans exclude comments.

## 3. Workspace target (locked by phase A, preserved by every later phase)

```
apps/
  web/          React 19 + Vite 8 SPA (phase A starts it, phase B finishes it)
  api/          Express 5 + Drizzle 0.45 + PostgreSQL 16 in Docker
  android/      Capacitor 8 wrapper (phase C)
packages/
  contracts/    Zod 4 schemas for API and content (phase A)
  domain/       Pure learning rules (phase A)
  content/      Source JSON + Zod validators + compiler (phase A: schema + draft)
  tooling/      Audio + conversation adapters (phase C, D)
```

`packages/ui` is not introduced; YAGNI.

## 4. Dependency graph

```
Phase A ──▶ Phase B ──▶ Phase C ──▶ Phase D
   │           │           │           │
   └───────────┴───────────┴───────────┘
                  │
              Phase D also depends on Phase C (Android transport).
```

Phase A produces a stable backend and a minimal authenticated React page
that lists `a1-introductions`. Phase B adds the practice surface on top
of that page. Phase C adds audio + Android. Phase D adds the conversation
provider and scenario UI.

## 5. Phase A — Foundation + curriculum API tracer

**Goal:** Stand up the monorepo, contracts, domain, PostgreSQL, secure
auth, atomic content publish, and a minimal authenticated React page
that lists the A1 unit. No audio, no Android, no practice, no AI.

**Inputs (from spec §9, §10, §13.3):**
- `Curriculum`, `CEFR Level`, `Unit`, `Vocabulary`, `Grammar`, `Pronunciation`,
  `Language Island`, `Conversation Scenario`, `Practice Rating`,
  `Collection`, `User Settings`, `Auth Session`.
- Single-owner local development, no public registration.
- Local Docker PostgreSQL 16.

**Outputs:**
- npm workspaces root with CommonJS top-level.
- `packages/contracts/` Zod schemas (error envelope, curriculum entities,
  practice, settings, audio, conversation). Curriculum entity schemas
  are reusable from the content package.
- `packages/domain/` pure rules (ratings, mastery, review ordering,
  progress, collections, filters, recorder interface, conversation
  context). No HTTP, no DB.
- `packages/content/` source Zod schemas, `validate(folder)`,
  `compile({ db, manifest })` with deterministic version ID
  `cv_<sha256(level+version+sourceChecksum)[:16]>`.
- `apps/api/` Express 5 + Drizzle 0.45 + `pg` 8.22.
  - Drizzle schema for the 21 tables listed in the spec.
  - Migration runner applies SQL files inside one transaction.
  - `auth_sessions` stores `access_token_hash`, `refresh_token_hash`,
    `access_expires_at`, `refresh_expires_at`, `revoked_at`. Tokens are
    random 32-byte hex, returned once on issue, never logged.
  - Argon2id parameters: `memoryCost: 19456, timeCost: 2, parallelism: 1`.
  - Routes: `GET /api/health`, `POST /api/auth/login`,
    `POST /api/auth/refresh`, `POST /api/auth/logout`,
    `GET /api/auth/session`, `GET /api/curriculum`,
    `GET /api/curriculum/levels/:levelId`,
    `GET /api/curriculum/units/:unitId`. `requireAuth` explicitly
    guards every curriculum route.
  - Rate limit middleware on `/api/auth/login`, `/api/auth/refresh`,
    and every mutating route. Default: 10 requests / minute / IP for
    login, 30 requests / minute / user for mutations.
  - Error envelope: `{ error: { code, message, correlationId, details? } }`
    with `code` from a fixed enum.
  - `apps/api/src/cli/compile-content.ts` constructs the Drizzle client
    and calls `compile({ db, manifest })` from the content package.
- `apps/web/` minimal React 19 + Vite 8 + React Router 7 SPA:
  - Vite dev proxy: `/api` → `http://localhost:8787`, so cookies stay
    same-origin.
  - Single authenticated route at `/` that calls
    `GET /api/curriculum/levels/A1` and renders the unit list using
    shared `<a>` tags. No hard-coded curriculum.
  - Login form posts to `/api/auth/login`; no `localStorage` for tokens.
- `docker-compose.yml` PostgreSQL 16 service on `localhost:5433`.
- `scripts/dev-up.sh`, `scripts/dev-down.sh`, `scripts/test-api.sh`.
- `docs/adr/0021-foundation-vertical-slice.md`,
  `docs/adr/0022-shared-credentials-and-android-secure-storage.md`
  (auth section only; mobile section is added in phase C).
- `scripts/session-init.js` V11 scanner + new `CONTEXT.md` /
  `AGENTS.md` notes identifying the new product while preserving the
  existing issue tracker, triage, and domain references.

**Tests:**
- Workspace test (root deps, engines).
- Schema migration test (every required table + check constraint).
- Contract tests (Zod).
- Domain tests (ratings, review, filters, collections, progress,
  recorder, conversation).
- Auth integration tests (login, refresh, logout, cookie path, bearer
  path, rate limit, opaque token persistence).
- Curriculum integration tests (`/api/curriculum/levels/A1` returns the
  synthetic published fixture; `/api/curriculum/levels/A1` does not
  return draft content).
- Compile integration test (deterministic version ID, partial unique
  index, atomic publish).
- React component test (login form, `/` lists the unit, no token in
  localStorage).
- Session-init V11 (workspace scaffold).

**Gates:**
- Human expert review of the real `a1-introductions` `manifest.json`
  is the only path to flip the file from `draft` to `expert_reviewed`.
  This gate is recorded in `docs/adr/0021-...md` and verified by a
  Vitest test that asserts the real manifest status is `draft` until a
  human updates it.
- Automated API tests run against a separate synthetic `published`
  fixture in `packages/content/src/fixtures/a1-introductions-published/`
  so they can pass without falsely claiming human review.

**Out of scope (deferred to later phases):**
- TTS, audio assets, listening review.
- Android build, Capacitor sync, microphone permissions, secure
  storage.
- Practice depth (Shadow, Recall, Smart Review), collections beyond
  schema, ratings beyond `practice_ratings` table presence.
- AI conversation provider, scenarios beyond the schema.
- Coolify descriptor, full production deployment.
- Fake media bytes or fixtures that pretend to be audio.

## 6. Phase B — Practice web experience

**Goal:** Turn the minimal page into a usable A1 unit practice flow on
web: Listen & Repeat, Active Recall, ratings, Smart Review, settings,
search filters, collections, progress. No audio files yet, just the
`/api/curriculum/audio/:audioAssetId` route that 404s until phase C
publishes assets.

**Consumes from Phase A:** contracts, domain, schema, auth, curriculum
endpoints, React shell with proxy.

**Outputs:**
- New API routes: `POST /api/practice/sessions`, ratings, events,
  complete; `GET /api/review/queue`; `GET /api/progress` and
  `/api/progress/units/:unitId`; `GET /api/settings`, `PUT /api/settings`;
  full collections CRUD.
- New web pages: `ListenAndRepeatPage`, `ActiveRecallPage`,
  `ReviewPage`, `CollectionsPage`, `CollectionDetailPage`,
  `SettingsPage`, `VocabularyPage`, `ProgressPage`. They all consume
  the contracts and call the API through `apps/web/src/app/api.ts`.
- Settings page writes the user settings row; learner-side settings
  sync through the account.
- Smart Review ordering verified by integration test.

**Tests:**
- Practice session happy path, idempotent rating, optimistic
  retry-pending UI state.
- Smart Review integration test (lowest first, then oldest, then
  orderIndex; 5-star excluded unless `includeMastered=true`).
- Filters integration test (OR default, AND when Match all is on).
- Collections integration test (unique sentence references, no
  duplicate ratings carried across).
- Settings persistence test.
- React tests for the new pages (reveal, star rating keyboard
  accessibility, settings controls, search debounce).

**Gates:**
- Phase A gates still pass.
- No audio or AI code added. Audio buttons render disabled when
  `/api/curriculum/audio/:id` returns 404.
- Vite dev server + API start with one command and pass e2e.

**Out of scope:** Audio files, Android, AI provider, Microphone
recording, audio settings (still numeric only).

## 7. Phase C — Reviewed audio + Android Capacitor

**Goal:** Pre-generate reviewed pt-PT audio for the A1 unit, add a
working microphone record/playback flow on web and Android, ship the
Capacitor 8 Android wrapper, and synchronize the same progress record
across both clients.

**Consumes from Phase A + B:** schema, contracts, domain, all web
pages, settings.

**Outputs:**
- `packages/tooling/src/tts/azure.ts` Azure Speech adapter,
  `packages/tooling/src/tts/fake.ts` deterministic fake,
  `packages/tooling/src/audio/generate.ts` CLI, plus the
  pt-PT evaluation corpus script. Azure key/region are read from env
  and the adapter refuses to construct without them. Generated files
  land in `apps/api/storage/audio/{contentHash}.wav`.
- `audio_assets` rows are populated only for `status = "published"`
  sentences. `GET /api/curriculum/audio/:id` streams the file with
  `Content-Type: audio/wav`.
- Web `useRecorder` wires `MediaRecorder` with the browser's
  WebView `getUserMedia` flow. The Android `RECORD_AUDIO` permission
  is declared in `AndroidManifest.xml`, the runtime permission prompt
  is presented through the platform's documented permission UI, and
  the WebView falls back to a manual-explain-then-render UI when the
  user denies the prompt. Ratings still work without recording.
- `apps/android/` Capacitor 8 workspace with `webDir: "../web/dist"`,
  `compileSdk = targetSdk = 36`, `minSdk = 24`, Java 21.
- **Phase C must select and verify a Capacitor-8-compatible
  microphone permission mechanism from the current official/plugin docs
  before implementation.** Approved behavior remains WebView
  `getUserMedia`/MediaRecorder, `RECORD_AUDIO` declared in
  `AndroidManifest.xml`, explicit runtime permission UI, and
  physical-device testing. Phase C does not name a specific plugin
  helper until that verification is complete.
- Android uses opaque refresh held in `@aparajita/capacitor-secure-storage`
  under the key `ptp_refresh_v1`, short-lived bearer access token in
  memory. `POST /api/auth/refresh` rotates the refresh; logout
  revokes server-side.
- `tools/check-android-prereqs.ts` fails loudly when `java -version`
  reports < 21 or no `adb` is on PATH. Documented in
  `docs/agents/european-portuguese-foundation.md`.
- `Coolify` stack descriptor (deferred production target only).

**Tests:**
- Azure adapter config test (refuses without creds, calls SDK with
  expected SSML and voice when present).
- Fake adapter content-hash determinism test.
- Audio manifest + streaming integration test.
- Web recorder hook test (mocked `MediaRecorder`).
- Android build smoke (`./gradlew :app:assembleDebug`) on a
  developer machine that satisfies the prereq gate.

**Gates:**
- Human native-speaker listening review of every audio asset before it
  is published. Without that review the file stays off the published
  manifest; API tests use a separate `audio` test fixture.
- Appium/Detox device smoke (or a Playwright mobile emulation +
  manual check) verifies touch targets, microphone permission
  prompt, and progress sync.

**Out of scope:** Full Coolify release, offline downloads, background
sync, voice AI, evaluation corpus size > 50 items.

## 8. Phase D — Guided conversation

**Goal:** Add the text conversation provider, the MiniMax adapter
gated by a pt-PT evaluation corpus, and a guided scenario UI for the
A1 unit.

**Consumes from Phase A + B + C:** contracts, schema, settings,
domain `buildConversationContext`, Android transport, settings sync.

**Outputs:**
- `packages/tooling/src/conversation/{fake,minimax}.ts` and
  `packages/tooling/src/eval/ptpt-corpus.ts` (10+ items, blocked on
  the same human gate as audio).
- `apps/api/src/modules/conversation/` service + routes for scenario
  list, session start, message turn, summary, retrieval. Provider
  keys server-side; refusal to start without `CONVERSATION_PROVIDER`
  and `CONVERSATION_API_KEY`.
- `apps/web/src/features/conversation/` pages (list + active
  conversation). Bounded context via `buildConversationContext`.
- Fail-soft behaviour: AI provider failure does not block non-AI
  learning (settings/Shadow/Recall keep working).

**Tests:**
- Fake provider deterministic reply test.
- MiniMax adapter refuses without `CONVERSATION_PROVIDER=minimax` and
  key.
- pt-PT corpus: every item must include at least one `pt-PT` marker
  and exclude Brazilian markers.
- Conversation integration test (start, post turn, complete, summary
  shape).
- React test: `ConversationPage` shows the opening message, accepts a
  reply, renders the assistant response, and shows a temporary
  unavailability banner when the provider returns 503.

**Gates:**
- The pt-PT evaluation corpus is reviewed and signed off by a native
  speaker before the MiniMax adapter is enabled in any non-test
  environment.

**Out of scope:** Live voice AI, voice replies, conversation history
export, multi-scenario bundles, B1+.

## 9. Acceptance criteria for the full vertical slice

The four phases together satisfy the spec §13.3 first-vertical-slice
gate:

- All six learning stages render for `a1-introductions`.
- Reviewed vocabulary, grammar, pronunciation, sentences, and one
  Language Island.
- Approved European Portuguese audio.
- Listen & Repeat with settings and temporary microphone
  record/playback.
- Active Recall with reveal and independent rating.
- Smart Review behaviour matches the spec.
- Search/filter and a personal collection.
- One constrained text AI role-play.
- Shared progress between desktop web and a physical Android phone.
- Automated tests and deployment smoke checks passing.

## 10. Risks and open questions

- Coolify is out of scope until phase C acceptance. The first private
  release is a Coolify deployment, but phase A only needs local
  Docker.
- The legacy image-to-prompt application must keep booting for
  `scripts/session-init.js` to validate. The new V11 scanner is
  read-only and never mutates legacy files.
- The pt-PT evaluation corpus is a human gate, not an automated test
  pass. We track this as a checklist in
  `docs/agents/european-portuguese-foundation.md`.

## 11. Commit checkpoints

Every task in every phase ends with an "Optional commit" step that
**never runs** without explicit user authorization. CI never commits.

## 12. Hand-off

When phase A is approved, open the detailed plan
`docs/superpowers/plans/2026-07-22-european-portuguese-foundation-curriculum-api.md`
and use `subagent-driven-development` or `executing-plans` to execute
it. The other three phase plans will be created after phase A
acceptance so their scope is anchored to the real Phase A surface.
