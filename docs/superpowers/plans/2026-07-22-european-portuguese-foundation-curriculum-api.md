# European Portuguese Foundation + Curriculum API Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the npm workspaces monorepo, Zod contracts, pure domain rules, PostgreSQL/Drizzle schema and migrations, Argon2id auth with truly opaque access/refresh tokens, the atomic content compiler (which Phase A exercises only against the synthetic published fixture; the real `a1-introductions` source stays `draft` and is never activated by Phase A), and a minimal authenticated React 19 + Vite 8 page that lists the A1 unit from the compiled fixture.

**Architecture:** Root `package.json` stays CommonJS so the legacy `scripts/session-init.js` and `tests/run-all.js` keep running. Each new workspace (`apps/*`, `packages/*`) sets its own `type: module`. The API is Express 5 + TypeScript with Drizzle ORM 0.45 against PostgreSQL 16 in a local Docker container. Auth uses Argon2id; access and refresh tokens are random 32-byte hex strings; only their SHA-256 hashes are stored in `auth_sessions`; the raw tokens are returned exclusively via Set-Cookie HttpOnly headers, never in the JSON body. The content compiler takes a `Db` interface injected by the API CLI; it derives a deterministic version ID `cv_<sha256(level+version+sourceChecksum)[:16]>` and refuses to publish a `draft` source. A partial unique DB index on `(level, active=true)` enforces one active version per level. The web SPA is React 19 + Vite 8 with a dev proxy that keeps cookies same-origin; the only authenticated route is `/`, which calls `GET /api/curriculum/levels/A1` and renders the unit list. No audio, no Android, no practice, no AI in this phase.

**Tech Stack:** Node 24.0.0, npm 11.12.1, TypeScript 6.0.3, React 19.2.8, Vite 8.1.5, @vitejs/plugin-react 6.0.4, @tanstack/react-query 5.101.4, React Router 7.18.1, Express 5.2.1, Zod 4.4.3, Drizzle ORM 0.45.2, drizzle-kit 0.31.10, `pg` 8.22.0, Vitest 4.1.10, @playwright/test 1.61.1, argon2 0.45.1, helmet 8.3.0, pino 10.3.1, pino-http 11.0.0, tsx 4.23.1, @types/react 19.2.17, @types/node 24.7.2, @typescript-eslint/parser 8.65.0, @typescript-eslint/eslint-plugin 8.65.0, eslint 9.39.0, npm-run-all2 9.0.2, wait-on 9.1.0, PostgreSQL 16 in Docker.

## Global Constraints

- Root `package.json` keeps `"type": "commonjs"`. Do not set `type: module` at the root. Each new workspace sets its own `type: module`.
- Every new TypeScript file uses ESM (`import`/`export`) and resolves `__dirname` via `fileURLToPath(import.meta.url)`. Never use the bare `__dirname` in new ESM files.
- The root preserves the legacy command under the new `test:legacy` script (`node tests/run-all.js`) and keeps the legacy `test` entry as an alias of `test:legacy` for backward compatibility. The canonical `test` script aggregates `test:legacy` and the new workspace suites through `npm-run-all2 --serial`. The legacy command remains the canonical name for the legacy test runner; do not remove or rename it.
- `tsconfig.base.json` is `composite: true`, `declaration: true`, `declarationMap: true`, with `noEmit: false`. Per-workspace `typecheck` scripts run `tsc --noEmit`; per-workspace `build` scripts run `tsc -p`. The root has no project-reference `tsc --noEmit`; it invokes each workspace typecheck via npm scripts and the build via `npm-run-all2 --serial build:contracts build:domain build:content build:api build:web`. Compiled output lands in `<workspace>/dist/`; `main`, `types`, and `exports` in every `packages/*/package.json` point at `dist/index.js` and `dist/index.d.ts`.
- Lock Node `>=24.0.0`, npm `>=11.0.0`. Add `packageManager: "npm@11.12.1"`.
- All new code lives under `apps/` and `packages/`. Never edit `server.js`, `src/`, `tests/run-all.js`, `data/presets.json`, `data/palettes.json`, or any other legacy file.
- The real `packages/content/src/sources/a1-introductions/manifest.json` stays `status: "draft"` until a human expert reviewer flips it. `content:compile` (production-style) refuses to publish a draft source and exits with `content_not_publishable`. The dev/local UI is powered by `content:compile:fixture`, which compiles the synthetic `published` fixture from `packages/content/src/fixtures/a1-introductions-published/`. The two source files (real `draft` and synthetic `published`) each contain only a `manifest.json`; no audio-manifest files exist in Phase A. Audio manifests are derived in Phase C from approved text + voice + SSML.
- Argon2id parameters are `memoryCost: 19456, timeCost: 2, parallelism: 1`. Access TTL is 15 minutes; refresh TTL is 30 days. Both tokens are random 32-byte hex. Only the SHA-256 hash of the token is persisted. Refresh rotation is atomic in a single Drizzle transaction: find the row by refresh hash, validate, mint the replacement, revoke the old row with `rotatedTo`, commit. The new `issueSession` accepts a transaction-capable executor so `rotateSession` does not nest transactions.
- Cookies are HttpOnly + SameSite=Lax + Secure in production + path `/`. No `localStorage` for tokens. The login and refresh JSON responses do not include the raw tokens; tokens travel exclusively in Set-Cookie headers.
- `authenticateRequest` accepts only the unexpired access cookie. The refresh cookie is consumed only by `POST /api/auth/refresh`; it never authorizes general API access.
- Rate limits: `POST /api/auth/login` 10 / minute / IP, `POST /api/auth/refresh` 30 / minute / IP, all mutating routes (including `POST /api/auth/logout`) 30 / minute / user.
- `requireAuth()` is applied explicitly to `GET /api/auth/session` and every `/api/curriculum/*` route. `GET /api/auth/session` returns the access cookie's stored expiry from `auth_sessions.access_expires_at`, not `Date.now() + TTL`.
- Tests run against a dedicated `pt_a1_test` database provisioned by the Docker init script and selected via `TEST_DATABASE_URL` when `NODE_ENV=test`. The test helper truncates tables and re-seeds the owner; it never DROP DATABASE on a live pool. Development and production never read or write the test database.
- The Drizzle schema uses `pgEnum`, `text`, `integer`, `jsonb`, `timestamp`, `boolean`, `unique`, `primaryKey`, and `index` from `drizzle-orm/pg-core`. Every text PK uses `text` with a stable ID convention (`usr_`, `sess_`, `cv_`, `unit_`, `les_`, `voc_`, `sen_`, `isl_`, `scn_`, `aud_`, `psess_`, `pe_`, `col_`, `csess_`, `cmsg_`, `up_`).
- All Drizzle transactions used by the content compiler must commit or roll back as one unit. The active pointer is updated only after every referenced row succeeds.
- The content package never imports from `apps/api/`. It only consumes the `CurriculumRepository` port defined in `packages/content/src/repository.ts`. The Drizzle adapter that implements that port lives in `apps/api/src/db/curriculumRepository.ts`; Drizzle schema imports stay inside `apps/api/`.
- API Vitest must run with `NODE_ENV=test` so `apps/api/src/config.ts` picks `TEST_DATABASE_URL`. `apps/api` ships a `vitest.config.ts` that calls `process.env.NODE_ENV = 'test'` in a `globalSetup` file before any app module loads. The same setup file runs `psql "$TEST_DATABASE_URL" -c "DROP TABLE IF EXISTS … CASCADE"` is forbidden; instead, the API test helper uses TRUNCATE on every table inside one connection. Direct API Vitest invocations from the shell use `NODE_ENV=test npx vitest run` (or `bash scripts/test-api.sh`).
- API and web tests that consume `@eup/contracts`, `@eup/domain`, or `@eup/content` are run after those packages are built. The root `test` script runs `npm-run-all2 --serial test:legacy test:contracts test:domain test:content test:api test:web`, and each workspace `test:api` / `test:web` script first calls `npm run build:contracts && npm run build:domain && npm run build:content` so the published `dist/` artifacts exist. Production runtime resolves the packages from the workspace's `node_modules` symlinks to the package's `dist/`, satisfying the `main`/`types`/`exports` contract.
- Phase A contains no JWT package, no JWT secret, and no JSON body that carries a raw token. ADR 0022 documents the Phase C addition of a dedicated mobile transport endpoint, not a JSON-body token.
- Code snippets in the plan exclude comments. Tests use only the test name and assertions.
- Commit steps are review-only. No commit fires without explicit user authorization.
- Shell scripts invoked from the repo root resolve the repo root via `$(cd "$(dirname "$0")/.." && pwd)` (or `git rev-parse --show-toplevel`) before any `cd` so they can be run from any working directory.

---

## File Map

| File | Responsibility in Phase A |
|---|---|
| `package.json` (root, **Modify**) | CommonJS root with `packageManager: "npm@11.12.1"`, dev deps for workspaces, top-level scripts including `test:legacy`, `test:contracts`, `test:domain`, `test:api`, `test:web`, `test`, `dev`, `build:contracts`, `build:domain`, `build:content`, `build:api`, `build:web`, `build`, `lint`, `typecheck`, `db:up`, `db:down`, `db:migrate`, `db:seed`, `content:compile`, `content:compile:fixture`, `prereq:android`. |
| `package-lock.json` | Pinned lockfile produced by `npm install`. |
| `tsconfig.base.json` (Modify) | Strict ES2023, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `composite: true`, `declaration: true`, `declarationMap: true`. |
| `tsconfig.json` (root) | Has no source files; orchestrates workspace typecheck and build via npm scripts. |
| `.npmrc` | `engine-strict=true`, `save-exact=true`, `fund=false`, `audit=false`. |
| `.editorconfig` | LF line endings, 2-space indent, final newline. |
| `.gitignore` (additions) | `apps/*/dist`, `packages/*/dist`, `coverage`, `apps/api/storage/audio/*` (with `.gitkeep`), `apps/web/public/audio/*` (with `.gitkeep`). Legacy entries preserved. |
| `.env.example` | `PORT=8787`, `DATABASE_URL=postgres://pt_a1:pt_a1_local@localhost:5433/pt_a1`, `TEST_DATABASE_URL=postgres://pt_a1:pt_a1_local@localhost:5433/pt_a1_test`, `WEB_ORIGIN=http://localhost:5173`, `COOKIE_DOMAIN=`, `NODE_ENV=development`, `LOG_LEVEL=info`. |
| `eslint.config.mjs` | Flat config: `@typescript-eslint` parser, plugin, react plugin for `apps/web`. |
| `docker-compose.yml` | `postgres:16` service on `localhost:5433` with healthcheck and `db/docker-entrypoint-initdb.d/01-create-test-db.sql` mounted as the init script. |
| `db/docker-entrypoint-initdb.d/01-create-test-db.sql` | `CREATE DATABASE pt_a1_test;` — runs once on the first container start. |
| `scripts/dev-up.sh` | Resolves repo root, then `docker compose up -d db && npm run db:migrate && npm run db:seed && npm run content:compile:fixture`. |
| `scripts/dev-down.sh` | Resolves repo root, then `docker compose down`. |
| `scripts/test-api.sh` | Resolves repo root, then runs `docker compose up -d db`, `npm run db:migrate:test`, `npm run db:seed:test`, `NODE_ENV=test npm --workspace apps/api test`. |
| `tools/check-android-prereqs.ts` | Fails loudly when Java < 21 or no Android SDK. |
| `docs/adr/0021-foundation-vertical-slice.md` (Proposed) | Records the new workspace, contracts, atomic publish, partial unique index. |
| `docs/adr/0022-shared-credentials-and-android-secure-storage.md` (Proposed) | Records the Phase A cookie + opaque-token design. Phase C will append a dedicated mobile transport entry after design validation. |
| `docs/agents/european-portuguese-foundation.md` | Read-only operator guide for the new product. |
| `packages/contracts/package.json` | ESM workspace; `main`/`types`/`exports` point at `dist/`. `build` runs `tsc -p`, `typecheck` runs `tsc --noEmit`, `test` runs `vitest run`. |
| `packages/contracts/tsconfig.json` | Extends base. `rootDir: src`, `outDir: dist`, `composite: true`. |
| `packages/contracts/src/index.ts` | Re-exports. |
| `packages/contracts/src/errors.ts` | `errorEnvelope`, `errorCodeSchema`. |
| `packages/contracts/src/curriculum.ts` | `levelSchema`, `unitSchema`, `lessonSchema`, `vocabularyItemSchema`, `sentenceSchema`, `islandSchema`, `curriculumManifestSchema`. |
| `packages/contracts/src/practice.ts` | `modeSchema`, `ratingSchema`, `practiceSettingsSchema`, `practiceSessionStartSchema`, `ratingRequestSchema`, `practiceEventSchema`, `reviewQuerySchema`, `reviewQueueItemSchema`, `reviewQueueSchema`. |
| `packages/contracts/src/settings.ts` | `settingsSchema`. |
| `packages/contracts/src/audio.ts` | `audioAssetSchema` (forces `locale: "pt-PT"`). |
| `packages/contracts/src/conversation.ts` | `conversationScenarioSchema`, `conversationMessageRequestSchema`, `conversationMessageResponseSchema`, `conversationSummarySchema`. |
| `packages/contracts/src/auth.ts` | `loginRequestSchema`, `loginResponseSchema` (no token fields), `refreshResponseSchema` (no token fields), `sessionResponseSchema`. |
| `packages/contracts/src/__tests__/contracts.test.ts` | Vitest cases for every Zod schema. |
| `packages/domain/package.json` | ESM workspace; `main`/`types`/`exports` point at `dist/`. |
| `packages/domain/tsconfig.json` | Extends base; `composite: true`. |
| `packages/domain/src/index.ts` | Re-exports. |
| `packages/domain/src/ratings.ts` | `isMastered`, `downgradeMastery`, `summarizeMode`. |
| `packages/domain/src/review.ts` | `buildReviewQueue` ordering. |
| `packages/domain/src/progress.ts` | `summarizeUnit`, `summarizeLevel`, `STAGE_ORDER`. |
| `packages/domain/src/curriculum.ts` | `nextUnit`, `nextStage`. |
| `packages/domain/src/collections.ts` | `addCollectionItem`, `removeCollectionItem`. |
| `packages/domain/src/filters.ts` | `parseFilterQuery`, `filterSentencesByTokens`. |
| `packages/domain/src/recorder.ts` | `Recorder`, `RecordingHandle`, `createInMemoryRecorder`. |
| `packages/domain/src/conversation.ts` | `buildConversationContext`. |
| `packages/domain/src/__tests__/*.test.ts` | Vitest cases for every module. |
| `packages/content/package.json` | ESM workspace; `main`/`types`/`exports` point at `dist/`. `compile` and `compile:fixture` scripts invoke the API CLI. |
| `packages/content/tsconfig.json` | Extends base; `composite: true`. |
| `packages/content/src/index.ts` | Re-exports. |
| `packages/content/src/schemas/source.ts` | Zod schemas for raw source files. |
| `packages/content/src/validate.ts` | `validateSource(folder)`. |
| `packages/content/src/compile.ts` | `compile({ repository, manifest, sourceChecksum })` consuming the `CurriculumRepository` port. |
| `packages/content/src/repository.ts` | Domain port: `CurriculumRepository` + `CurriculumTransaction` with semantic methods (deactivateLevel, insertVersion, insertUnit, insertLesson, insertVocabularyItem, insertSentence, insertIsland, linkIslandSentence, insertScenario) and shared insert types. |
| `packages/content/src/__tests__/repository.inMemory.ts` | In-memory `CurriculumRepository` double used by the content test suite. |
| `packages/content/src/errors.ts` | `ContentNotPublishableError`, `CompileValidationError`. |
| `packages/content/src/fixtures/a1-introductions-published/manifest.json` | Synthetic `published` fixture used by `content:compile:fixture` and by tests. The fixture manifest keeps the `unit_a1_introductions` ID; before any expert-reviewed real publication, the test database is reset so both cannot coexist. |
| `packages/content/src/sources/a1-introductions/manifest.json` | Real `draft` content reviewed by a human. `content:compile` refuses to activate it. |
| `packages/content/src/__tests__/validate.test.ts` | Validates the synthetic published fixture and the real draft fixture. |
| `packages/content/src/__tests__/compile.test.ts` | Verifies deterministic version ID + atomic publish against a test Db. |
| `apps/api/package.json` | ESM Express workspace; `main`/`types`/`exports` point at `dist/`. |
| `apps/api/tsconfig.json` | Extends base, `rootDir: src`, `outDir: dist`, `composite: true`. |
| `apps/api/vitest.config.ts` | Vitest config with `setupFiles` and `globalSetup` that set `process.env.NODE_ENV='test'` before any app module loads. |
| `apps/api/vitest.globalSetup.ts` | `process.env.NODE_ENV = 'test'` set at the very start of the test run. |
| `apps/api/vitest.setup.ts` | `process.env.NODE_ENV = 'test'` set inside every test file. |
| `apps/api/drizzle.config.ts` | Points at `src/db/schema.ts`, output `migrations`. |
| `apps/api/migrations/0000_init.sql` | Initial DDL. |
| `apps/api/src/server.ts` | Boots Express, mounts routes, applies helmet. |
| `apps/api/src/app.ts` | `createApp()` factory (no listen) used by tests. |
| `apps/api/src/config.ts` | Zod-validated env. Picks `TEST_DATABASE_URL` when `NODE_ENV=test`. |
| `apps/api/src/logger.ts` | Pino with redaction. |
| `apps/api/src/db/client.ts` | Drizzle client factory; `getDb()` returns the same client in dev/test, and a per-call client when `NODE_ENV=test`. |
| `apps/api/src/db/schema.ts` | Drizzle table definitions. |
| `apps/api/src/db/migrate.ts` | Applies every SQL file inside one transaction. |
| `apps/api/src/db/seed.ts` | Seeds the single owner and default settings. |
| `apps/api/src/db/curriculumRepository.ts` | DrizzleCurriculumRepository adapter that implements the `CurriculumRepository` port from `@eup/content`. Drizzle schema imports live here. |
| `apps/api/src/middleware/correlationId.ts` | Reads or mints `x-request-id`. |
| `apps/api/src/middleware/errorEnvelope.ts` | Uniform error envelope. |
| `apps/api/src/middleware/requireAuth.ts` | Reads only the unexpired access cookie; attaches `req.auth`. |
| `apps/api/src/middleware/rateLimit.ts` | Token-bucket middleware. |
| `apps/api/src/middleware/validate.ts` | Zod body/query/params validator. |
| `apps/api/src/modules/auth/service.ts` | `hashPassword`, `verifyPassword`, `issueSession(executor, opts)`, `rotateSession(executor, refreshToken)`, `revokeSession`, `authenticateRequest`, `currentUser`, `accessExpiryOf`. |
| `apps/api/src/modules/auth/routes.ts` | `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/session`. |
| `apps/api/src/modules/curriculum/service.ts` | `getActiveCurriculum`, `getLevel`, `getUnit`. |
| `apps/api/src/modules/curriculum/routes.ts` | `GET /api/curriculum`, `GET /api/curriculum/levels/:levelId`, `GET /api/curriculum/units/:unitId`. |
| `apps/api/src/cli/compile-content.ts` | Constructs the Drizzle client, calls `compileFixture()` for `compile:fixture` and `compileSource()` for `content:compile`. Refuses draft sources. |
| `apps/api/src/test/db.ts` | Test helper: connects to `TEST_DATABASE_URL`, truncates tables, re-seeds the owner, exposes `withTestDb()`. |
| `apps/api/src/test/factories.ts` | Builds synthetic sentences and ratings; loads the published fixture. |
| `apps/api/src/test/session.test.ts` | Cookie auth tests. |
| `apps/api/src/test/curriculum.test.ts` | Curriculum API integration tests. |
| `apps/api/src/test/compileContent.test.ts` | Compile integration test. |
| `apps/api/src/test/rateLimit.test.ts` | Login and refresh rate-limit tests. |
| `apps/web/package.json` | ESM React workspace; `main`/`types`/`exports` point at `dist/`. |
| `apps/web/tsconfig.json` | Extends base, `jsx: "react-jsx"`, `module: "ESNext"`, `moduleResolution: "Bundler"`. |
| `apps/web/vite.config.ts` | React plugin, dev proxy `/api` → `http://localhost:8787`. Uses `defineConfig` from `vitest/config`. |
| `apps/web/index.html` | Mounts `<div id="root">`. |
| `apps/web/src/main.tsx` | Renders `<App />` inside providers. |
| `apps/web/src/router.tsx` | Routes for `/login` and `/`. |
| `apps/web/src/app/QueryProvider.tsx` | TanStack Query client. |
| `apps/web/src/app/api.ts` | Typed fetch wrappers using Zod. |
| `apps/web/src/app/AuthProvider.tsx` | `useAuth()` hook. |
| `apps/web/src/features/auth/LoginPage.tsx` | Login form (no localStorage, empty default email). |
| `apps/web/src/features/home/HomePage.tsx` | Lists `a1-introductions` from the API. |
| `apps/web/src/features/layout/RequireAuth.tsx` | Redirects to `/login`. |
| `apps/web/src/test/login.test.tsx` | Login form test; restores mocked `fetch` in `afterEach`. |
| `apps/web/src/test/home.test.tsx` | Home page lists the unit. |
| `scripts/session-init.js` (Modify) | Add V11 scanner, add the new entry to the existing scanners object, and add a single V11 check inside the existing `runValidationChecks` array. V1–V10 logic stays exactly as today. |
| `docs/agents/session-init.md` (update) | Document V11. |
| `docs/agents/success-criteria.md` (update) | Add V11 to the table. |
| `CONTEXT.md` (Modify) | Add a new top-level section identifying the European Portuguese product; existing sections preserved. |
| `AGENTS.md` (Modify) | Reference the new doc and the foundation governance. |

### Tables (Drizzle, in `apps/api/src/db/schema.ts`)

| Table | Columns | Notes |
|---|---|---|
| `users` | `id` text PK, `email` text unique, `display_name` text, `password_hash` text, `created_at` timestamptz, `last_login_at` timestamptz | Single seeded owner. |
| `auth_sessions` | `id` text PK, `user_id` text FK, `access_token_hash` text unique, `refresh_token_hash` text unique, `access_expires_at` timestamptz, `refresh_expires_at` timestamptz, `revoked_at` timestamptz, `ip` text, `user_agent` text, `created_at` timestamptz, `rotated_to` text | Only token hashes; no JWT. |
| `user_settings` | `user_id` text PK FK, `audio_speed` text, `repetitions` int, `pause_ms` int, `text_size` text, `sort_order` text, `loop` bool, `updated_at` timestamptz | 1 row per user. |
| `curriculum_versions` | `id` text PK, `level` text, `version` int, `source_checksum` text, `status` text, `published_at` timestamptz, `active` bool, partial unique index on `(level) where active = true` | Deterministic ID derived in code. |
| `units` | `id` text PK, `curriculum_version_id` text FK, `level` text, `order_index` int, `slug` text, `title` text, `summary` text, `status` text | Ordered within level. |
| `lessons` | `id` text PK, `unit_id` text FK, `kind` text, `order_index` int, `title` text, `body_md` text | `kind ∈ {vocabulary, grammar, pronunciation}`. |
| `vocabulary_items` | `id` text PK, `lesson_id` text FK, `term` text, `translation` text, `gender` text, `article` text, `usage_notes` text, `example_sentence_id` text | |
| `sentences` | `id` text PK, `unit_id` text FK, `curriculum_version_id` text FK, `text_pt` text, `text_en` text, `tags` text[], `vocab_refs` text[], `grammar_refs` text[], `pronunciation_refs` text[], `island_refs` text[], `order_index` int, `status` text | |
| `islands` | `id` text PK, `unit_id` text FK, `kind` text, `title` text, `setting` text, `body_md` text | |
| `island_sentences` | composite PK (`island_id`, `sentence_id`) + `order_index` int | |
| `conversation_scenarios` | `id` text PK, `unit_id` text FK, `slug` text, `title` text, `objective` text, `setting` text, `roles` text, `allowed_difficulty` text, `expected_vocab` text[], `expected_grammar` text[], `opening_message` text, `completion_conditions` text, `correction_policy` text, `feedback_rubric` text, `status` text | |
| `audio_assets` | `id` text PK, `sentence_id` text FK, `voice_id` text, `engine` text, `locale` text, `ssml_version` text, `checksum` text, `file_path` text, `duration_ms` int, `sample_rate` int, `content_hash` text, `created_at` timestamptz | Phase C writes rows; phase A only defines the table. |
| `practice_ratings` | PK (`user_id`, `sentence_id`, `mode`), `rating` int with check (1..5), `last_practised_at` timestamptz, `client_mutation_id` text, `version` int | Phase A only asserts the table exists. |
| `practice_events` | `id` text PK, `user_id` text FK, `sentence_id` text FK, `session_id` text, `kind` text, `metadata` jsonb, `created_at` timestamptz | |
| `practice_sessions` | `id` text PK, `user_id` text FK, `mode` text, `scope` text, `scope_id` text, `started_at` timestamptz, `completed_at` timestamptz | |
| `collections` | `id` text PK, `user_id` text FK, `name` text, `created_at` timestamptz | |
| `collection_items` | PK (`collection_id`, `sentence_id`), `order_index` int, `added_at` timestamptz | |
| `conversation_sessions` | `id` text PK, `user_id` text FK, `scenario_id` text FK, `started_at` timestamptz, `completed_at` timestamptz, `summary` jsonb | |
| `conversation_messages` | `id` text PK, `session_id` text FK, `role` text, `content` text, `corrections` jsonb, `created_at` timestamptz | |
| `unit_progress` | PK (`user_id`, `unit_id`, `stage`), `completed_at` timestamptz | |
| `compiled_assets` | `id` text PK, `curriculum_version_id` text FK, `audio_id` text FK, `published` bool, unique on `audio_id` | Phase C uses it. |

### Endpoints (Phase A only)

| Method | Path | Auth | Body / Query | Response |
|---|---|---|---|---|
| `GET` | `/api/health` | none | – | `{ status, version, dbOk }` |
| `POST` | `/api/auth/login` | none, rate limit 10/min/IP | `{ email, password }` | Set-Cookie `ptp_access` (HttpOnly, SameSite=Lax, Secure in production, path `/`, 15 min) and `ptp_refresh` (HttpOnly, SameSite=Lax, Secure in production, path `/`, 30 d). JSON body: `{ accessExpiresAt, refreshExpiresAt, user }`. No raw tokens in the body. |
| `POST` | `/api/auth/refresh` | refresh cookie only, rate limit 30/min/IP | – | Set-Cookie rotates both tokens. JSON body: `{ accessExpiresAt, refreshExpiresAt, user }`. No raw tokens in the body. |
| `POST` | `/api/auth/logout` | rate limit 30/min/user; accepts either cookie | – | `204` (revokes session, clears both cookies). |
| `GET` | `/api/auth/session` | `requireAuth` (access cookie only) | – | `{ user, accessExpiresAt }` where `accessExpiresAt` is the stored `auth_sessions.access_expires_at` value, not `Date.now() + TTL`. |
| `GET` | `/api/curriculum` | `requireAuth` | – | `{ active: { level, versionId }, levels: [...] }` |
| `GET` | `/api/curriculum/levels/:levelId` | `requireAuth` | – | `{ id, units: [...] }` |
| `GET` | `/api/curriculum/units/:unitId` | `requireAuth` | – | `{ id, lessons, sentences, islands, scenarios, progress }` |

### Routes (web SPA, Phase A only)

| Path | Element | Auth |
|---|---|---|
| `/login` | `LoginPage` | none |
| `/` | `HomePage` (lists `a1-introductions`) | `RequireAuth` |
| `/logout` | redirect helper | n/a |

---

### Task 1: Workspace foundation, root CommonJS, locked versions, scripts, governance skeletons

**Files:**
- Modify: `package.json` (root), `tsconfig.base.json`, `.gitignore` (append lines), `docs/adr/0021-foundation-vertical-slice.md` (initial Proposed body), `docs/adr/0022-shared-credentials-and-android-secure-storage.md` (initial Proposed body).
- Create: `db/docker-entrypoint-initdb.d/01-create-test-db.sql`, `tsconfig.json` (root, project references), `.npmrc`, `.editorconfig`, `.env.example`, `eslint.config.mjs`, `tools/check-android-prereqs.ts`, `scripts/dev-up.sh`, `scripts/dev-down.sh`, `scripts/test-api.sh`, `docs/agents/european-portuguese-foundation.md`.
- Test: `apps/api/src/test/workspace.test.ts`, `tools/check-android-prereqs.test.ts`.

**Interfaces:**
- `checkAndroidPrereqs(opts?: { javaBin?: string; requireJava?: boolean; androidHome?: string }): Promise<{ ok: true; java: string; sdk: string } | { ok: false; missing: string[] }>`.
- Root `package.json` exposes scripts: `test:legacy`, `test:contracts`, `test:domain`, `test:api`, `test:web`, `test`, `dev`, `build:contracts`, `build:domain`, `build:content`, `build:api`, `build:web`, `build`, `lint`, `typecheck`, `db:up`, `db:down`, `db:migrate`, `db:migrate:test`, `db:seed`, `db:seed:test`, `content:compile`, `content:compile:fixture`, `prereq:android`.
- Root `package.json` keeps `"type": "commonjs"`.

- [ ] **Step 1: Write the failing workspace test**

`apps/api/src/test/workspace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

describe('workspace', () => {
  it('keeps the root package as CommonJS', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { type?: string };
    expect(pkg.type).toBe('commonjs');
  });

  it('declares Node >=24, npm >=11, and packageManager npm@11.12.1', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      engines: { node: string; npm: string };
      packageManager: string;
    };
    expect(pkg.engines.node).toBe('>=24.0.0');
    expect(pkg.engines.npm).toBe('>=11.0.0');
    expect(pkg.packageManager).toBe('npm@11.12.1');
  });

  it('keeps the legacy test:legacy script and the canonical test entry', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test:legacy']).toBe('node tests/run-all.js');
    expect(pkg.scripts.test).toContain('run-all');
  });

  it('pins every required top-level dev dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    const required = [
      'typescript',
      'vitest',
      'eslint',
      '@typescript-eslint/parser',
      '@typescript-eslint/eslint-plugin',
      'npm-run-all2',
      'wait-on',
      'drizzle-kit',
      'drizzle-orm',
      'pg',
      'zod',
      'argon2',
      'helmet',
      'pino',
      'tsx',
      'react',
      'react-dom',
      'react-router',
      '@tanstack/react-query',
      'express',
      '@vitejs/plugin-react',
      '@types/react',
      '@types/node',
      '@playwright/test',
    ];
    for (const dep of required) {
      expect(pkg.devDependencies[dep], dep).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('exposes the new build and content:compile scripts', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:contracts']).toBe('npm --workspace packages/contracts run build');
    expect(pkg.scripts['build:domain']).toBe('npm --workspace packages/domain run build');
    expect(pkg.scripts['build:content']).toBe('npm --workspace packages/content run build');
    expect(pkg.scripts['build:api']).toBe('npm --workspace apps/api run build');
    expect(pkg.scripts['build:web']).toBe('npm --workspace apps/web run build');
    expect(pkg.scripts['content:compile:fixture']).toContain('content:compile:fixture');
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/workspace.test.ts
```

Expected: the `exposes the new build and content:compile scripts` test fails because the new scripts are not yet on the root `package.json`. The legacy `test` script and engines already pass.

- [ ] **Step 3: Author the root `package.json`**

Write `package.json` (root, CommonJS) with this exact content. The legacy top-level fields (`name`, `version`, `dependencies`, `engines`) stay; the new file replaces the legacy `scripts` block, removes the broken `typecheck` that used a project-references file, and adds the per-workspace build and content:compile scripts:

```json
{
  "name": "european-portuguese-learning-platform",
  "private": true,
  "version": "0.1.0",
  "type": "commonjs",
  "packageManager": "npm@11.12.1",
  "engines": {
    "node": ">=24.0.0",
    "npm": ">=11.0.0"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "test:legacy": "node tests/run-all.js",
    "test:contracts": "npm --workspace packages/contracts test",
    "test:domain": "npm --workspace packages/domain test",
    "test:api": "npm run build:contracts && npm run build:domain && npm run build:content && npm --workspace apps/api test",
    "test:web": "npm run build:contracts && npm run build:domain && npm run build:content && npm --workspace apps/web test",
    "test": "npm-run-all2 --serial test:legacy test:contracts test:domain test:api test:web",
    "dev": "npm-run-all2 --parallel dev:api dev:web",
    "dev:api": "npm --workspace apps/api run dev",
    "dev:web": "npm --workspace apps/web run dev",
    "build": "npm-run-all2 --serial build:contracts build:domain build:content build:api build:web",
    "build:contracts": "npm --workspace packages/contracts run build",
    "build:domain": "npm --workspace packages/domain run build",
    "build:content": "npm --workspace packages/content run build",
    "build:api": "npm --workspace apps/api run build",
    "build:web": "npm --workspace apps/web run build",
    "lint": "eslint .",
    "typecheck": "npm-run-all2 --serial typecheck:contracts typecheck:domain typecheck:content typecheck:api typecheck:web",
    "typecheck:contracts": "npm --workspace packages/contracts run typecheck",
    "typecheck:domain": "npm --workspace packages/domain run typecheck",
    "typecheck:content": "npm --workspace packages/content run typecheck",
    "typecheck:api": "npm --workspace apps/api run typecheck",
    "typecheck:web": "npm --workspace apps/web run typecheck",
    "db:up": "docker compose up -d db",
    "db:down": "docker compose down",
    "db:migrate": "NODE_ENV=development npm --workspace apps/api run db:migrate",
    "db:migrate:test": "NODE_ENV=test npm --workspace apps/api run db:migrate",
    "db:seed": "NODE_ENV=development npm --workspace apps/api run db:seed",
    "db:seed:test": "NODE_ENV=test npm --workspace apps/api run db:seed",
    "content:compile": "NODE_ENV=development npm --workspace apps/api run content:compile",
    "content:compile:fixture": "NODE_ENV=development npm --workspace apps/api run content:compile:fixture",
    "prereq:android": "tsx tools/check-android-prereqs.ts"
  },
  "devDependencies": {
    "@playwright/test": "1.61.1",
    "@tanstack/react-query": "5.101.4",
    "@types/node": "24.7.2",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.17",
    "@typescript-eslint/eslint-plugin": "8.65.0",
    "@typescript-eslint/parser": "8.65.0",
    "@vitejs/plugin-react": "6.0.4",
    "argon2": "0.45.1",
    "drizzle-kit": "0.31.10",
    "drizzle-orm": "0.45.2",
    "eslint": "9.39.0",
    "express": "5.2.1",
    "helmet": "8.3.0",
    "npm-run-all2": "9.0.2",
    "pg": "8.22.0",
    "pino": "10.3.1",
    "pino-http": "11.0.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "react-router": "7.18.1",
    "tsx": "4.23.1",
    "typescript": "6.0.3",
    "vite": "8.1.5",
    "vitest": "4.1.10",
    "wait-on": "9.1.0",
    "zod": "4.4.3"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`, root `tsconfig.json`, `.npmrc`, `.editorconfig`, and `.gitignore` additions**

`tsconfig.base.json` (replace the existing file with this content; `composite`/`declaration`/`declarationMap` replace the previous `noEmit: true`):

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "useDefineForClassFields": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

`tsconfig.json` (root, project references only; no broken root `tsc --noEmit`):

```json
{
  "files": [],
  "references": [
    { "path": "./packages/contracts" },
    { "path": "./packages/domain" },
    { "path": "./packages/content" },
    { "path": "./apps/api" },
    { "path": "./apps/web" }
  ]
}
```

Each per-workspace `tsconfig.json` extends the base, sets `rootDir`/`outDir`, and lets `composite: true` imply emit. Example for `packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`.npmrc`:

```text
engine-strict=true
save-exact=true
fund=false
audit=false
```

`.editorconfig`:

```text
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

Append to the existing `.gitignore` (do not delete legacy entries):

```text

# New monorepo additions
apps/*/dist
packages/*/dist
coverage
apps/api/storage/audio/*
!apps/api/storage/audio/.gitkeep
apps/web/public/audio/*
!apps/web/public/audio/.gitkeep
```

- [ ] **Step 5: Create `.env.example`, `eslint.config.mjs`, and helper scripts**

`.env.example`:

```text
PORT=8787
DATABASE_URL=postgres://pt_a1:pt_a1_local@localhost:5433/pt_a1
TEST_DATABASE_URL=postgres://pt_a1:pt_a1_local@localhost:5433/pt_a1_test
WEB_ORIGIN=http://localhost:5173
COOKIE_DOMAIN=
NODE_ENV=development
LOG_LEVEL=info
```

`eslint.config.mjs`:

```js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/web/dist/**', 'apps/api/dist/**', 'data/**', 'tests/run-all.js', 'server.js', 'src/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    rules: { 'react/jsx-uses-react': 'off', 'react/react-in-jsx-scope': 'off' },
  },
];
```

`scripts/dev-up.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run content:compile:fixture
echo "Stack ready. Run: npm run dev"
```

`scripts/dev-down.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
docker compose down
```

`scripts/test-api.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
docker compose up -d db
npm run db:migrate:test
npm run db:seed:test
NODE_ENV=test npm --workspace apps/api test
```

```bash
chmod +x scripts/dev-up.sh scripts/dev-down.sh scripts/test-api.sh
```

- [ ] **Step 6: Write the failing Android prereq test**

`tools/check-android-prereqs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkAndroidPrereqs } from './check-android-prereqs.js';

describe('android prereqs', () => {
  it('returns a missing list when java is unavailable', async () => {
    const result = await checkAndroidPrereqs({ requireJava: true, javaBin: 'java-not-here' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain('java');
  });
});
```

- [ ] **Step 7: Implement the prereq check**

`tools/check-android-prereqs.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface PrereqOptions {
  requireJava?: boolean;
  javaBin?: string;
  androidHome?: string;
}

export type PrereqResult =
  | { ok: true; java: string; sdk: string }
  | { ok: false; missing: string[] };

const MIN_STUDIO = '2025.2.1';

function readVersion(bin: string, args: string[]): string | null {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return ((result.stdout || result.stderr) as string).trim();
}

export async function checkAndroidPrereqs(opts: PrereqOptions = {}): Promise<PrereqResult> {
  const missing: string[] = [];
  const java = readVersion(opts.javaBin ?? 'java', ['-version']);
  const javaOk = Boolean(java && /"(\d+)\.(\d+)\.(\d+)"/.test(java) && Number(RegExp.$1) >= 21);
  if (opts.requireJava !== false && !javaOk) missing.push('java');
  const androidHome = opts.androidHome ?? process.env.ANDROID_HOME ?? join(homedir(), 'Android', 'Sdk');
  if (!existsSync(androidHome)) missing.push('android-sdk');
  const studioVersion = process.env.ANDROID_STUDIO_VERSION ?? MIN_STUDIO;
  if (!studioVersion) missing.push('android-studio');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, java: java ?? '', sdk: androidHome };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkAndroidPrereqs();
  if (!result.ok) {
    console.error('Android prerequisites missing:', result.missing.join(', '));
    process.exit(1);
  }
  console.log(`Android prerequisites OK (java=${result.java}, sdk=${result.sdk})`);
}
```

- [ ] **Step 8: Author governance skeletons**

`docs/adr/0021-foundation-vertical-slice.md`:

```markdown
# ADR 0021 — Foundation and A1 vertical slice architecture

## Status

Proposed

## Context

The image-to-prompt application does not satisfy the European Portuguese
learning platform requirements. A new modular workspace is needed that
preserves the legacy application for reference while enabling parallel
greenfield development and a shared progress record.

## Decision

Adopt an npm workspaces monorepo with `apps/web`, `apps/api`, and
`packages/{contracts,domain,content,tooling}`. Use React 19 + Vite 8
for the SPA, Express 5 + Drizzle ORM 0.45 against PostgreSQL 16 in
Docker. Lock dependency versions to the floors listed in the
implementation plan.

The root package stays CommonJS so the legacy `scripts/session-init.js`
and `tests/run-all.js` keep running. Each new workspace sets its own
`type: module`.

Curriculum is versioned JSON validated with Zod and compiled into
`curriculum_versions` in one Drizzle transaction. The active pointer
is protected by a partial unique index `(level) where active = true`
so only one active version per level exists. Only `status =
"published"` content is exposed to learner endpoints.

The real `a1-introductions` manifest stays `status: "draft"` until a
human expert reviewer flips it. Tests use a separate synthetic
`published` fixture.

## Consequences

The legacy image-to-prompt files are untouched. New learners, ratings,
collections, and conversation state live in the new PostgreSQL
database. The platform is single-tenant and single-owner in this
phase, but the schema supports multiple users later.

## Rejected alternatives

Lifting the legacy Express app into the new monorepo was rejected
because its domain model is unrelated. Reusing the legacy chat router
for the conversation module was rejected for the same reason.

## Verification

Implementation is accepted only after the workspace tests, the
full vitest suite, and the session-init pass rate return green.
Audio, Android, practice depth, and AI are out of scope for phase A
and recorded in companion plans.
```

`docs/adr/0022-shared-credentials-and-android-secure-storage.md`:

```markdown
# ADR 0022 — Shared credentials with web cookies and Android secure storage

## Status

Proposed

## Context

Web and Android must share the same learning record. Web browsers can
rely on HttpOnly cookies. Capacitor Android cannot rely on cookies for
WebView fetch calls without same-origin quirks, so a different
transport applies on mobile.

## Decision

Authentication uses Argon2id with `memoryCost: 19456, timeCost: 2,
parallelism: 1`. Sessions are opaque: the API mints two random 32-byte
hex tokens per session and stores only their SHA-256 hashes in
`auth_sessions`. Access TTL is 15 minutes; refresh TTL is 30 days.
Rotation of the refresh token writes a new hash and revokes the old
one inside one transaction.

Web receives both tokens as HttpOnly, SameSite=Lax, Secure (in
production) cookies named `ptp_access` and `ptp_refresh` with path
`/`. The API also returns the tokens in the JSON body for future
mobile transport. No token is ever stored in `localStorage`.

`POST /api/auth/refresh` rotates both tokens. `POST /api/auth/logout`
revokes the active session and clears both cookies.

## Consequences

The web client can survive a tab reload without any explicit
refresh; cookies do the work. The Android transport is layered on the
same primitives in phase C and is not part of phase A.

## Verification

Phase A exercises the cookie path through Supertest. The Android
happy path is documented in phase C and uses the same opaque tokens
held in `@aparajita/capacitor-secure-storage`.
```

`docs/agents/european-portuguese-foundation.md`:

```markdown
# European Portuguese Foundation

The European Portuguese learning platform lives under `apps/` and
`packages/`. The legacy image-to-prompt application is reference only
and is not part of the new product.

## New commands

- `npm install`
- `npm run db:up && npm run db:migrate && npm run db:seed`
- `npm run content:compile`
- `npm run dev`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run prereq:android` (fails fast if Java < 21 or Android SDK
  is missing)
- `bash scripts/dev-up.sh`
- `bash scripts/dev-down.sh`
- `bash scripts/test-api.sh`

## What NOT to do

- Do not edit `server.js`, `src/`, `tests/run-all.js`, or any file
  under `data/`. Those belong to the legacy application.
- Do not introduce a new database engine. PostgreSQL 16 in Docker is
  the source of truth.
- Do not commit without explicit user authorization. Commit steps in
  the plan are review-only.
- Do not log provider keys or recording bytes.
- Do not flip `packages/content/src/sources/a1-introductions/manifest.json`
  from `draft` to `expert_reviewed` without a human expert review.
  Automated API tests use the synthetic published fixture under
  `packages/content/src/fixtures/a1-introductions-published/`.
```

- [ ] **Step 9: Install dependencies and run the workspace tests**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npm install
npx vitest run apps/api/src/test/workspace.test.ts tools/check-android-prereqs.test.ts
node tests/run-all.js | tail -n 5
```

Expected: workspace tests pass; the legacy `node tests/run-all.js`
still runs and reports its existing pass count without regressions.
Do not commit without authorization.

---

### Task 2: Shared Zod contracts and error envelope

**Files:** Create the `packages/contracts` workspace and tests.

**Interfaces:**
- `errorCodeSchema = z.enum(['validation_error', 'unauthorized', 'forbidden', 'not_found', 'conflict', 'rate_limited', 'provider_unavailable', 'internal'])`.
- `errorEnvelope = z.object({ error: z.object({ code: errorCodeSchema, message: z.string(), correlationId: z.string(), details: z.unknown().optional() }) })`.
- `ratingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])`.
- `modeSchema = z.enum(['shadow', 'recall'])`.
- `practiceSettingsSchema = z.object({ audioSpeed: z.number().min(0.5).max(2), repetitions: z.number().int().min(1).max(5), pauseMs: z.union([z.literal(0), z.literal(500), z.literal(1000), z.literal(1500), z.literal(2000), z.literal(2500), z.literal(3000), z.literal(4000), z.literal(5000), z.literal(7000)]), textSize: z.enum(['small', 'default', 'large', 'extraLarge']), sortOrder: z.enum(['curriculum', 'easyToHard', 'hardToEasy']), loop: z.boolean() })`.
- `practiceSessionStartSchema = z.object({ mode: modeSchema, scope: z.enum(['unit', 'level', 'collection', 'review']), scopeId: z.string().min(1), settings: practiceSettingsSchema })`.
- `ratingRequestSchema = z.object({ sentenceId: z.string().min(1), rating: ratingSchema, clientMutationId: z.string().min(1) })`.
- `loginRequestSchema = z.object({ email: z.string().email(), password: z.string().min(1) })`.
- `loginResponseSchema = z.object({ accessExpiresAt: z.string(), refreshExpiresAt: z.string(), user: z.object({ id: z.string(), email: z.string().email(), displayName: z.string() }) })`. No raw tokens in the response body.
- `refreshResponseSchema = loginResponseSchema`.
- `sessionResponseSchema = z.object({ user: loginResponseSchema.shape.user, accessExpiresAt: z.string() })`.
- `audioAssetSchema = z.object({ id: z.string(), sentenceId: z.string(), voiceId: z.string(), engine: z.string(), locale: z.literal('pt-PT'), ssmlVersion: z.string(), checksum: z.string().length(64), filePath: z.string(), durationMs: z.number().int().nonnegative(), sampleRate: z.number().int().positive(), contentHash: z.string().length(64), createdAt: z.string() })`.
- `conversationScenarioSchema = z.object({ id: z.string(), unitId: z.string(), slug: z.string(), title: z.string(), objective: z.string(), setting: z.string(), roles: z.string(), allowedDifficulty: z.string(), expectedVocab: z.array(z.string()), expectedGrammar: z.array(z.string()), openingMessage: z.string(), completionConditions: z.string(), correctionPolicy: z.string(), feedbackRubric: z.string(), status: z.literal('published') })`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/src/__tests__/contracts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  errorEnvelope,
  ratingSchema,
  settingsSchema,
  practiceSessionStartSchema,
  conversationScenarioSchema,
  audioAssetSchema,
  loginRequestSchema,
  loginResponseSchema,
} from '../index.js';

describe('contracts', () => {
  it('rejects invalid rating values', () => {
    expect(ratingSchema.safeParse(0).success).toBe(false);
    expect(ratingSchema.safeParse(5).success).toBe(true);
  });

  it('round-trips a settings payload', () => {
    const parsed = settingsSchema.parse({
      settings: {
        audioSpeed: 1,
        repetitions: 3,
        pauseMs: 1500,
        textSize: 'default',
        sortOrder: 'curriculum',
        loop: false,
      },
    });
    expect(parsed.settings.audioSpeed).toBe(1);
  });

  it('rejects non-published scenarios in the learner surface', () => {
    expect(conversationScenarioSchema.safeParse({
      id: 'scn_x',
      unitId: 'unit_a',
      slug: 'cafe',
      title: 't',
      objective: 'o',
      setting: 's',
      roles: 'r',
      allowedDifficulty: 'a',
      expectedVocab: [],
      expectedGrammar: [],
      openingMessage: 'Olá!',
      completionConditions: 'done',
      correctionPolicy: 'gentle',
      feedbackRubric: 'rubric',
      status: 'draft',
    }).success).toBe(false);
  });

  it('forces pt-PT locale on audio assets', () => {
    expect(audioAssetSchema.safeParse({
      id: 'aud_x',
      sentenceId: 'sen_x',
      voiceId: 'v',
      engine: 'e',
      locale: 'pt-BR',
      ssmlVersion: '1',
      checksum: 'a'.repeat(64),
      filePath: '/x.wav',
      durationMs: 1000,
      sampleRate: 24000,
      contentHash: 'b'.repeat(64),
      createdAt: '2026-07-22T00:00:00Z',
    }).success).toBe(false);
  });

  it('shapes the error envelope', () => {
    const env = errorEnvelope.parse({ error: { code: 'internal', message: 'm', correlationId: 'cid' } });
    expect(env.error.code).toBe('internal');
  });

  it('requires a valid practice session start payload', () => {
    expect(practiceSessionStartSchema.safeParse({
      mode: 'shadow',
      scope: 'unit',
      scopeId: 'unit_a',
      settings: { audioSpeed: 1, repetitions: 3, pauseMs: 1500, textSize: 'default', sortOrder: 'curriculum', loop: false },
    }).success).toBe(true);
  });

  it('requires email in login', () => {
    expect(loginRequestSchema.safeParse({ email: 'x', password: 'pw' }).success).toBe(false);
  });

  it('login response has no token fields and only includes expiries + user', () => {
    const parsed = loginResponseSchema.parse({
      accessExpiresAt: '2030-01-01T00:00:00Z',
      refreshExpiresAt: '2030-02-01T00:00:00Z',
      user: { id: 'usr_owner', email: 'owner@local.test', displayName: 'Owner' },
    });
    expect((parsed as Record<string, unknown>).accessToken).toBeUndefined();
    expect((parsed as Record<string, unknown>).refreshToken).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run packages/contracts/src/__tests__/contracts.test.ts
```

Expected: failure with module not found.

- [ ] **Step 3: Scaffold the contracts workspace and add the schemas**

`packages/contracts/package.json`:

```json
{
  "name": "@eup/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": { "node": ">=24.0.0", "npm": ">=11.0.0" },
  "dependencies": {
    "zod": "4.4.3"
  },
  "scripts": {
    "build": "tsc -p",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`packages/contracts/src/errors.ts`:

```ts
import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'provider_unavailable',
  'internal',
]);

export const errorEnvelope = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    correlationId: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
```

`packages/contracts/src/curriculum.ts`:

```ts
import { z } from 'zod';

export const levelSchema = z.enum(['A1', 'A2']);

export const vocabularyItemSchema = z.object({
  id: z.string(),
  term: z.string(),
  translation: z.string(),
  gender: z.enum(['m', 'f', 'n/a']).optional(),
  article: z.string().optional(),
  usageNotes: z.string().optional(),
  exampleSentenceId: z.string().optional(),
});

export const sentenceSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  curriculumVersionId: z.string(),
  textPt: z.string(),
  textEn: z.string(),
  tags: z.array(z.string()).default([]),
  vocabRefs: z.array(z.string()).default([]),
  grammarRefs: z.array(z.string()).default([]),
  pronunciationRefs: z.array(z.string()).default([]),
  islandRefs: z.array(z.string()).default([]),
  orderIndex: z.number().int().nonnegative(),
  status: z.enum(['draft', 'expert_reviewed', 'audio_reviewed', 'published']),
});

export const lessonSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  kind: z.enum(['vocabulary', 'grammar', 'pronunciation']),
  orderIndex: z.number().int().nonnegative(),
  title: z.string(),
  bodyMd: z.string(),
  items: z.array(vocabularyItemSchema).default([]),
});

export const islandSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  kind: z.enum(['dialogue', 'story', 'standalone']),
  title: z.string(),
  setting: z.string(),
  bodyMd: z.string(),
  sentenceIds: z.array(z.string()),
});

export const unitSchema = z.object({
  id: z.string(),
  curriculumVersionId: z.string(),
  level: levelSchema,
  orderIndex: z.number().int().nonnegative(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  status: z.enum(['draft', 'expert_reviewed', 'audio_reviewed', 'published']),
  lessonIds: z.array(z.string()),
  sentenceIds: z.array(z.string()),
  islandIds: z.array(z.string()),
  scenarioIds: z.array(z.string()),
});

export const curriculumManifestSchema = z.object({
  id: z.string(),
  level: levelSchema,
  version: z.number().int().positive(),
  status: z.enum(['draft', 'expert_reviewed', 'audio_reviewed', 'published']),
  units: z.array(unitSchema),
});

export type Level = z.infer<typeof levelSchema>;
export type Sentence = z.infer<typeof sentenceSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type Island = z.infer<typeof islandSchema>;
export type CurriculumManifest = z.infer<typeof curriculumManifestSchema>;
```

`packages/contracts/src/practice.ts`:

```ts
import { z } from 'zod';

export const modeSchema = z.enum(['shadow', 'recall']);
export const ratingSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);

export const practiceSettingsSchema = z.object({
  audioSpeed: z.number().min(0.5).max(2),
  repetitions: z.number().int().min(1).max(5),
  pauseMs: z.union([
    z.literal(0), z.literal(500), z.literal(1000), z.literal(1500), z.literal(2000),
    z.literal(2500), z.literal(3000), z.literal(4000), z.literal(5000), z.literal(7000),
  ]),
  textSize: z.enum(['small', 'default', 'large', 'extraLarge']),
  sortOrder: z.enum(['curriculum', 'easyToHard', 'hardToEasy']),
  loop: z.boolean(),
});

export const practiceSessionStartSchema = z.object({
  mode: modeSchema,
  scope: z.enum(['unit', 'level', 'collection', 'review']),
  scopeId: z.string().min(1),
  settings: practiceSettingsSchema,
});

export const ratingRequestSchema = z.object({
  sentenceId: z.string().min(1),
  rating: ratingSchema,
  clientMutationId: z.string().min(1),
});

export const practiceEventSchema = z.object({
  sentenceId: z.string().min(1),
  kind: z.enum(['played', 'recorded', 'rated', 'revealed', 'completed']),
  metadata: z.record(z.unknown()).default({}),
  clientMutationId: z.string().min(1),
});

export const reviewQuerySchema = z.object({
  mode: modeSchema,
  scope: z.enum(['unit', 'level', 'collection']),
  scopeId: z.string().min(1),
  includeMastered: z.boolean().default(false),
});

export const reviewQueueItemSchema = z.object({
  sentenceId: z.string(),
  rating: ratingSchema,
  lastPractisedAt: z.string(),
});

export const reviewQueueSchema = z.object({
  items: z.array(reviewQueueItemSchema),
});

export type Mode = z.infer<typeof modeSchema>;
export type Rating = z.infer<typeof ratingSchema>;
export type PracticeSettings = z.infer<typeof practiceSettingsSchema>;
export type PracticeSessionStart = z.infer<typeof practiceSessionStartSchema>;
export type RatingRequest = z.infer<typeof ratingRequestSchema>;
export type ReviewQueue = z.infer<typeof reviewQueueSchema>;
```

`packages/contracts/src/auth.ts`:

```ts
import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
});

export const loginResponseSchema = z.object({
  accessExpiresAt: z.string(),
  refreshExpiresAt: z.string(),
  user: userSchema,
});

export const refreshResponseSchema = loginResponseSchema;

export const sessionResponseSchema = z.object({
  user: userSchema,
  accessExpiresAt: z.string(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
```

`packages/contracts/src/settings.ts`:

```ts
import { z } from 'zod';
import { practiceSettingsSchema } from './practice.js';

export const settingsSchema = z.object({ settings: practiceSettingsSchema });
export type Settings = z.infer<typeof settingsSchema>;
```

`packages/contracts/src/audio.ts`:

```ts
import { z } from 'zod';

export const audioAssetSchema = z.object({
  id: z.string(),
  sentenceId: z.string(),
  voiceId: z.string(),
  engine: z.string(),
  locale: z.literal('pt-PT'),
  ssmlVersion: z.string(),
  checksum: z.string().length(64),
  filePath: z.string(),
  durationMs: z.number().int().nonnegative(),
  sampleRate: z.number().int().positive(),
  contentHash: z.string().length(64),
  createdAt: z.string(),
});

export type AudioAsset = z.infer<typeof audioAssetSchema>;
```

`packages/contracts/src/conversation.ts`:

```ts
import { z } from 'zod';

export const curriculumLevelUnitSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  orderIndex: z.number().int().nonnegative(),
});

export const curriculumLevelResponseSchema = z.object({
  id: z.enum(['A1', 'A2']),
  units: z.array(curriculumLevelUnitSchema),
});

export const conversationScenarioSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  slug: z.string(),
  title: z.string(),
  objective: z.string(),
  setting: z.string(),
  roles: z.string(),
  allowedDifficulty: z.string(),
  expectedVocab: z.array(z.string()),
  expectedGrammar: z.array(z.string()),
  openingMessage: z.string(),
  completionConditions: z.string(),
  correctionPolicy: z.string(),
  feedbackRubric: z.string(),
  status: z.literal('published'),
});

export const conversationStartResponseSchema = z.object({
  sessionId: z.string(),
  openingMessage: z.string(),
});

export const conversationMessageRequestSchema = z.object({
  content: z.string().min(1).max(800),
  clientMutationId: z.string().min(1),
});

export const conversationMessageResponseSchema = z.object({
  reply: z.string(),
  corrections: z.array(z.object({ original: z.string(), suggestion: z.string(), note: z.string() })).default([]),
  suggestions: z.array(z.string()).default([]),
});

export const conversationSummarySchema = z.object({
  successful: z.array(z.string()),
  corrections: z.array(z.object({ original: z.string(), suggestion: z.string(), note: z.string() })).max(3),
  vocabulary: z.array(z.string()),
  nextPractice: z.string(),
});

export type ConversationScenario = z.infer<typeof conversationScenarioSchema>;
export type ConversationMessageResponse = z.infer<typeof conversationMessageResponseSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
```

`packages/contracts/src/index.ts`:

```ts
export * from './errors.js';
export * from './curriculum.js';
export * from './practice.js';
export * from './auth.js';
export * from './settings.js';
export * from './audio.js';
export * from './conversation.js';
```

- [ ] **Step 4: Run contract tests and verify they pass**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run packages/contracts/src/__tests__/contracts.test.ts
```

Expected: 8 tests pass. Do not commit without authorization.

---

### Task 3: Pure domain rules — ratings, review, progress, collections, filters, recorder, conversation

**Files:** Create the `packages/domain` workspace and tests.

**Interfaces:**
- `isMastered(rating: number | null | undefined): boolean` returns `rating === 5`.
- `downgradeMastery(previous: Rating | null, next: Rating): boolean` returns `previous === 5 && next < 5`.
- `summarizeMode(ratings: { sentenceId: string; rating: Rating }[], sentenceCount: number): { mastered: number; total: number; ratio: number }`.
- `buildReviewQueue(rows: ReviewRatingRow[], options: { includeMastered: boolean }): ReviewQueueItem[]` sorts by `(rating asc, lastPractisedAt asc, sentenceId asc)`, excludes unrated and 5-star when `includeMastered === false`.
- `summarizeUnit(unitId: string, progress: UnitProgressRow[], units: UnitRow[], ratings: RatingRow[]): UnitSummary`.
- `summarizeLevel(level: 'A1' | 'A2', units: UnitRow[], ratings: RatingRow[]): LevelSummary`.
- `parseFilterQuery(query: string, opts: { matchAll: boolean }): { tokens: string[]; mode: 'or' | 'and' }`.
- `filterSentencesByTokens(sentences: SentenceSearch[], tokens: string[], mode: 'or' | 'and'): SentenceSearch[]` searches `textPt`, `textEn`, `vocabRefs`, `grammarRefs`, `tags`.
- `addCollectionItem(items: CollectionItem[], sentenceId: string, orderIndex: number): CollectionItem[]` returns the same list when the sentence already exists.
- `removeCollectionItem(items: CollectionItem[], sentenceId: string): CollectionItem[]`.
- `Recorder` interface: `start()`, `stop()`, `cancel()`, `isSupported()`. `RecordingHandle` returns `{ id, mimeType, durationMs, createdAt, blob }`.
- `createInMemoryRecorder(): Recorder` returns a deterministic recorder used by tests.
- `buildConversationContext(scenario: ConversationScenario, recent: ConversationMessageRow[], learnerProgress: { mastered: number; total: number }, options: { maxChars: number }): { systemPrompt: string; userMessages: ConversationMessageRow[] }`.
- `nextUnit(completed, all)` and `nextStage(stage)`.

- [ ] **Step 1: Write the failing domain tests**

`packages/domain/src/__tests__/ratings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isMastered, summarizeMode, downgradeMastery } from '../ratings.js';

describe('ratings', () => {
  it('treats only 5 as mastered', () => {
    expect(isMastered(5)).toBe(true);
    expect(isMastered(4)).toBe(false);
    expect(isMastered(null)).toBe(false);
  });

  it('removes mastered status when rating drops below 5', () => {
    expect(downgradeMastery(5, 3)).toBe(false);
    expect(downgradeMastery(3, 5)).toBe(true);
  });

  it('computes mode progress against the scope total', () => {
    const result = summarizeMode([
      { sentenceId: 's1', rating: 5 as const },
      { sentenceId: 's2', rating: 4 as const },
    ], 4);
    expect(result.mastered).toBe(1);
    expect(result.total).toBe(4);
    expect(result.ratio).toBe(0.25);
  });
});
```

`packages/domain/src/__tests__/review.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReviewQueue } from '../review.js';

const rows = [
  { sentenceId: 's1', rating: 2 as const, lastPractisedAt: '2026-07-22T00:00:00Z', orderIndex: 1 },
  { sentenceId: 's2', rating: 1 as const, lastPractisedAt: '2026-07-20T00:00:00Z', orderIndex: 2 },
  { sentenceId: 's3', rating: 4 as const, lastPractisedAt: '2026-07-21T00:00:00Z', orderIndex: 3 },
  { sentenceId: 's4', rating: 5 as const, lastPractisedAt: '2026-07-19T00:00:00Z', orderIndex: 4 },
  { sentenceId: 's5', rating: null, lastPractisedAt: null, orderIndex: 5 },
];

describe('review ordering', () => {
  it('orders by rating asc, then oldest lastPractisedAt, then sentenceId', () => {
    expect(buildReviewQueue(rows, { includeMastered: false }).map((q) => q.sentenceId)).toEqual(['s2', 's1', 's3']);
  });

  it('excludes 5-star and unrated by default', () => {
    const queue = buildReviewQueue(rows, { includeMastered: false });
    expect(queue.find((q) => q.sentenceId === 's4')).toBeUndefined();
    expect(queue.find((q) => q.sentenceId === 's5')).toBeUndefined();
  });

  it('includes 5-star when includeMastered is true', () => {
    expect(buildReviewQueue(rows, { includeMastered: true }).find((q) => q.sentenceId === 's4')).toBeDefined();
  });
});
```

`packages/domain/src/__tests__/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFilterQuery, filterSentencesByTokens } from '../filters.js';

const sentences = [
  { id: 's1', textPt: 'A maçã é vermelha.', textEn: 'The apple is red.', vocabRefs: ['apple'], grammarRefs: [], tags: ['food'] },
  { id: 's2', textPt: 'O João dá um livro.', textEn: 'João gives a book.', vocabRefs: ['joao'], grammarRefs: [], tags: ['people'] },
  { id: 's3', textPt: 'Eu como uma maçã.', textEn: 'I eat an apple.', vocabRefs: ['apple'], grammarRefs: [], tags: ['food'] },
];

describe('filters', () => {
  it('treats comma-separated tokens as OR by default', () => {
    const { tokens, mode } = parseFilterQuery('maçã, dar, João', { matchAll: false });
    expect(mode).toBe('or');
    expect(filterSentencesByTokens(sentences, tokens, mode).map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('switches to AND when matchAll is on', () => {
    const { tokens, mode } = parseFilterQuery('maçã, João', { matchAll: true });
    expect(filterSentencesByTokens(sentences, tokens, mode)).toEqual([]);
  });

  it('matches textEn as well as textPt', () => {
    const { tokens, mode } = parseFilterQuery('apple', { matchAll: false });
    expect(filterSentencesByTokens(sentences, tokens, mode).map((s) => s.id).sort()).toEqual(['s1', 's3']);
  });
});
```

`packages/domain/src/__tests__/collections.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addCollectionItem, removeCollectionItem } from '../collections.js';

describe('collections', () => {
  it('does not duplicate sentence references', () => {
    const start = addCollectionItem([], 's1', 0);
    expect(addCollectionItem(start, 's1', 1).length).toBe(1);
  });

  it('removes by sentenceId', () => {
    const start = addCollectionItem([], 's1', 0);
    expect(removeCollectionItem(start, 's1')).toEqual([]);
  });
});
```

`packages/domain/src/__tests__/progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarizeLevel, summarizeUnit } from '../progress.js';

const units = [
  { id: 'u1', level: 'A1' as const, orderIndex: 1, sentenceIds: ['s1', 's2', 's3'] },
  { id: 'u2', level: 'A1' as const, orderIndex: 2, sentenceIds: ['s4'] },
];

describe('progress', () => {
  it('aggregates shadow and recall mastery per level', () => {
    const ratings = [
      { sentenceId: 's1', mode: 'shadow' as const, rating: 5 as const },
      { sentenceId: 's2', mode: 'shadow' as const, rating: 4 as const },
      { sentenceId: 's1', mode: 'recall' as const, rating: 5 as const },
    ];
    const summary = summarizeLevel('A1', units, ratings);
    expect(summary.shadow.mastered).toBe(1);
    expect(summary.shadow.total).toBe(4);
    expect(summary.recall.mastered).toBe(1);
  });

  it('reports stage completion for a unit', () => {
    const summary = summarizeUnit(
      'u1',
      [
        { stage: 'learn' as const, completedAt: '2026-07-22T00:00:00Z' },
        { stage: 'notice' as const, completedAt: '2026-07-22T00:00:00Z' },
      ],
      units,
      [],
    );
    expect(summary.stagesCompleted).toBe(2);
    expect(summary.totalStages).toBe(6);
  });
});
```

`packages/domain/src/__tests__/curriculum.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextUnit, nextStage } from '../curriculum.js';

describe('curriculum sequencing', () => {
  it('returns the first unit when none completed', () => {
    expect(nextUnit([], [{ id: 'u1', level: 'A1', orderIndex: 1 }])).toEqual({ id: 'u1' });
  });

  it('skips completed units in order', () => {
    expect(
      nextUnit(
        [{ id: 'u1', level: 'A1', orderIndex: 1 }],
        [
          { id: 'u1', level: 'A1', orderIndex: 1 },
          { id: 'u2', level: 'A1', orderIndex: 2 },
        ],
      ),
    ).toEqual({ id: 'u2' });
  });

  it('cycles through the six-stage loop', () => {
    expect(nextStage('learn')).toBe('notice');
    expect(nextStage('communicate')).toBe('learn');
  });
});
```

`packages/domain/src/__tests__/recorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createInMemoryRecorder } from '../recorder.js';

describe('in-memory recorder', () => {
  it('produces a recording handle and reports the mime type', async () => {
    const recorder = createInMemoryRecorder();
    expect(recorder.isSupported()).toBe(true);
    await recorder.start();
    const handle = await recorder.stop();
    expect(handle.blob.size).toBeGreaterThan(0);
    expect(handle.mimeType).toMatch(/audio/);
  });

  it('cancels a started recording without producing a handle', async () => {
    const recorder = createInMemoryRecorder();
    await recorder.start();
    await recorder.cancel();
  });
});
```

`packages/domain/src/__tests__/conversation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildConversationContext } from '../conversation.js';

const scenario = {
  id: 'scn_x',
  unitId: 'unit_a',
  slug: 'cafe',
  title: 'Pedir um café',
  objective: 'Order a coffee',
  setting: 'Café em Lisboa',
  roles: 'Cliente e empregado',
  allowedDifficulty: 'A1',
  expectedVocab: ['café', 'preço'],
  expectedGrammar: ['gostar de'],
  openingMessage: 'Olá! O que vai beber?',
  completionConditions: 'Order and pay',
  correctionPolicy: 'Gentle',
  feedbackRubric: 'Clarity and politeness',
  status: 'published' as const,
};

const recent = [
  { role: 'user' as const, content: 'Quero um café, por favor.' },
  { role: 'assistant' as const, content: 'Com ou sem açúcar?' },
];

describe('conversation context', () => {
  it('keeps the system prompt under the budget and includes scenario metadata', () => {
    const ctx = buildConversationContext(scenario, recent, { mastered: 1, total: 10 }, { maxChars: 4000 });
    expect(ctx.systemPrompt.length).toBeLessThanOrEqual(4000);
    expect(ctx.systemPrompt).toContain('pt-PT');
    expect(ctx.systemPrompt).toContain('Pedir um café');
  });
});
```

- [ ] **Step 2: Run the domain tests and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run packages/domain/src/__tests__
```

Expected: every test fails because the modules do not exist.

- [ ] **Step 3: Implement the domain modules**

`packages/domain/package.json`:

```json
{
  "name": "@eup/domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": { "node": ">=24.0.0", "npm": ">=11.0.0" },
  "scripts": { "build": "tsc -p", "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

`packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "lib": ["ES2023", "DOM"] },
  "include": ["src/**/*.ts"]
}
```

`packages/domain/src/ratings.ts`:

```ts
import type { Rating } from '@eup/contracts';

export function isMastered(rating: number | null | undefined): boolean {
  return rating === 5;
}

export function isNotMastered(rating: number | null | undefined): boolean {
  return !isMastered(rating);
}

export function downgradeMastery(previous: Rating | null, next: Rating): boolean {
  return previous === 5 && next < 5;
}

export interface ModeRating {
  sentenceId: string;
  rating: Rating;
}

export interface ModeSummary {
  mastered: number;
  total: number;
  ratio: number;
}

export function summarizeMode(ratings: ModeRating[], sentenceCount: number): ModeSummary {
  const mastered = ratings.filter((r) => r.rating === 5).length;
  return { mastered, total: sentenceCount, ratio: sentenceCount === 0 ? 0 : mastered / sentenceCount };
}
```

`packages/domain/src/review.ts`:

```ts
import type { Rating } from '@eup/contracts';

export interface ReviewRatingRow {
  sentenceId: string;
  rating: Rating | null;
  lastPractisedAt: string | null;
  orderIndex: number;
}

export interface ReviewQueueItem {
  sentenceId: string;
  rating: Rating;
  lastPractisedAt: string;
}

export interface ReviewOptions {
  includeMastered: boolean;
}

export function buildReviewQueue(rows: ReviewRatingRow[], options: ReviewOptions): ReviewQueueItem[] {
  const eligible = rows.filter((row): row is ReviewRatingRow & { rating: Rating; lastPractisedAt: string } => {
    if (row.rating === null || row.lastPractisedAt === null) return false;
    if (!options.includeMastered && row.rating === 5) return false;
    return true;
  });
  return eligible
    .map((row) => ({ sentenceId: row.sentenceId, rating: row.rating, lastPractisedAt: row.lastPractisedAt }))
    .sort((a, b) => {
      if (a.rating !== b.rating) return a.rating - b.rating;
      if (a.lastPractisedAt !== b.lastPractisedAt) return a.lastPractisedAt.localeCompare(b.lastPractisedAt);
      return a.sentenceId.localeCompare(b.sentenceId);
    });
}
```

`packages/domain/src/collections.ts`:

```ts
export interface CollectionItem {
  sentenceId: string;
  orderIndex: number;
  addedAt: string;
}

export function addCollectionItem(items: CollectionItem[], sentenceId: string, orderIndex: number): CollectionItem[] {
  if (items.some((i) => i.sentenceId === sentenceId)) return items;
  return [...items, { sentenceId, orderIndex, addedAt: new Date().toISOString() }];
}

export function removeCollectionItem(items: CollectionItem[], sentenceId: string): CollectionItem[] {
  return items.filter((i) => i.sentenceId !== sentenceId);
}
```

`packages/domain/src/filters.ts`:

```ts
export interface SentenceSearch {
  id: string;
  textPt: string;
  textEn: string;
  vocabRefs: string[];
  grammarRefs: string[];
  tags: string[];
}

export interface ParsedQuery {
  tokens: string[];
  mode: 'or' | 'and';
}

export function parseFilterQuery(query: string, opts: { matchAll: boolean }): ParsedQuery {
  const tokens = query.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  return { tokens, mode: opts.matchAll ? 'and' : 'or' };
}

function tokenInSentence(token: string, sentence: SentenceSearch): boolean {
  const lowered = token.toLowerCase();
  if (sentence.textPt.toLowerCase().includes(lowered)) return true;
  if (sentence.textEn.toLowerCase().includes(lowered)) return true;
  if (sentence.vocabRefs.some((v) => v.toLowerCase() === lowered)) return true;
  if (sentence.grammarRefs.some((g) => g.toLowerCase() === lowered)) return true;
  if (sentence.tags.some((t) => t.toLowerCase() === lowered)) return true;
  return false;
}

export function filterSentencesByTokens(sentences: SentenceSearch[], tokens: string[], mode: 'or' | 'and'): SentenceSearch[] {
  if (tokens.length === 0) return sentences;
  if (mode === 'or') return sentences.filter((s) => tokens.some((t) => tokenInSentence(t, s)));
  return sentences.filter((s) => tokens.every((t) => tokenInSentence(t, s)));
}
```

`packages/domain/src/progress.ts`:

```ts
import type { Rating } from '@eup/contracts';
import { summarizeMode, type ModeSummary } from './ratings.js';

export type Stage = 'learn' | 'notice' | 'shadow' | 'recall' | 'apply' | 'communicate';

export const STAGE_ORDER: Stage[] = ['learn', 'notice', 'shadow', 'recall', 'apply', 'communicate'];

export interface UnitRow {
  id: string;
  level: 'A1' | 'A2';
  orderIndex: number;
  sentenceIds: string[];
}

export interface UnitProgressRow {
  stage: Stage;
  completedAt: string;
}

export interface RatingRow {
  sentenceId: string;
  mode: 'shadow' | 'recall';
  rating: Rating;
}

export interface UnitSummary {
  stagesCompleted: number;
  totalStages: number;
  shadow: ModeSummary;
  recall: ModeSummary;
}

export function summarizeUnit(unitId: string, progress: UnitProgressRow[], units: UnitRow[], ratings: RatingRow[]): UnitSummary {
  const unit = units.find((u) => u.id === unitId);
  const sentenceIds = unit?.sentenceIds ?? [];
  const shadow = summarizeMode(
    ratings.filter((r) => r.mode === 'shadow' && sentenceIds.includes(r.sentenceId)),
    sentenceIds.length,
  );
  const recall = summarizeMode(
    ratings.filter((r) => r.mode === 'recall' && sentenceIds.includes(r.sentenceId)),
    sentenceIds.length,
  );
  return { stagesCompleted: progress.length, totalStages: STAGE_ORDER.length, shadow, recall };
}

export interface LevelSummary {
  shadow: ModeSummary;
  recall: ModeSummary;
  units: UnitRow[];
}

export function summarizeLevel(level: 'A1' | 'A2', units: UnitRow[], ratings: RatingRow[]): LevelSummary {
  const levelUnits = units.filter((u) => u.level === level);
  const sentenceIds = levelUnits.flatMap((u) => u.sentenceIds);
  const shadow = summarizeMode(
    ratings.filter((r) => r.mode === 'shadow' && sentenceIds.includes(r.sentenceId)),
    sentenceIds.length,
  );
  const recall = summarizeMode(
    ratings.filter((r) => r.mode === 'recall' && sentenceIds.includes(r.sentenceId)),
    sentenceIds.length,
  );
  return { shadow, recall, units: levelUnits };
}
```

`packages/domain/src/curriculum.ts`:

```ts
import type { Level } from '@eup/contracts';
import { STAGE_ORDER, type Stage } from './progress.js';

export interface UnitSummaryLite {
  id: string;
  level: Level;
  orderIndex: number;
}

export function nextUnit(completed: UnitSummaryLite[], all: UnitSummaryLite[]): { id: string } | null {
  const completedIds = new Set(completed.map((c) => c.id));
  const candidate = [...all].sort((a, b) => a.orderIndex - b.orderIndex).find((u) => !completedIds.has(u.id));
  return candidate ? { id: candidate.id } : null;
}

export function nextStage(stage: Stage): Stage {
  const idx = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER[(idx + 1) % STAGE_ORDER.length];
}
```

`packages/domain/src/recorder.ts`:

```ts
export interface RecordingHandle {
  readonly id: string;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly createdAt: string;
  readonly blob: Blob;
}

export interface Recorder {
  start(): Promise<void>;
  stop(): Promise<RecordingHandle>;
  cancel(): Promise<void>;
  isSupported(): boolean;
}

interface InMemoryRecorderState {
  startedAt: number | null;
  bytes: Uint8Array[];
  mimeType: string;
  idCounter: number;
}

export function createInMemoryRecorder(): Recorder {
  const state: InMemoryRecorderState = {
    startedAt: null,
    bytes: [],
    mimeType: 'audio/webm',
    idCounter: 0,
  };
  return {
    isSupported: () => true,
    async start() {
      state.startedAt = Date.now();
      state.bytes = [new TextEncoder().encode('silent-audio-frame')];
    },
    async stop() {
      const startedAt = state.startedAt ?? Date.now();
      const durationMs = Date.now() - startedAt;
      state.startedAt = null;
      const blob = new Blob(state.bytes, { type: state.mimeType });
      state.idCounter += 1;
      return {
        id: `rec_${state.idCounter}`,
        mimeType: state.mimeType,
        durationMs,
        createdAt: new Date().toISOString(),
        blob,
      };
    },
    async cancel() {
      state.startedAt = null;
      state.bytes = [];
    },
  };
}
```

`packages/domain/src/conversation.ts`:

```ts
import type { ConversationScenario } from '@eup/contracts';

export interface ConversationMessageRow {
  role: 'user' | 'assistant';
  content: string;
}

export interface LearnerProgressSummary {
  mastered: number;
  total: number;
}

export interface ConversationContext {
  systemPrompt: string;
  userMessages: ConversationMessageRow[];
}

export function buildConversationContext(
  scenario: ConversationScenario,
  recentMessages: ConversationMessageRow[],
  learnerProgress: LearnerProgressSummary,
  options: { maxChars: number },
): ConversationContext {
  const header = [
    'You are a European Portuguese (pt-PT) conversation partner.',
    'Locale: pt-PT. Never substitute Brazilian Portuguese.',
    `Scenario: ${scenario.title}`,
    `Objective: ${scenario.objective}`,
    `Setting: ${scenario.setting}`,
    `Roles: ${scenario.roles}`,
    `Allowed difficulty: ${scenario.allowedDifficulty}`,
    `Expected vocabulary: ${scenario.expectedVocab.join(', ')}`,
    `Expected grammar: ${scenario.expectedGrammar.join(', ')}`,
    `Correction policy: ${scenario.correctionPolicy}`,
    `Completion conditions: ${scenario.completionConditions}`,
    `Learner progress: ${learnerProgress.mastered}/${learnerProgress.total} mastered.`,
  ].join('\n');
  let systemPrompt = header;
  const trimmed: ConversationMessageRow[] = [];
  let used = systemPrompt.length;
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const m = recentMessages[i];
    if (!m) continue;
    if (used + m.content.length > options.maxChars) break;
    trimmed.unshift(m);
    used += m.content.length;
  }
  if (systemPrompt.length > options.maxChars) systemPrompt = systemPrompt.slice(0, options.maxChars);
  return { systemPrompt, userMessages: trimmed };
}
```

`packages/domain/src/index.ts`:

```ts
export * from './ratings.js';
export * from './review.js';
export * from './collections.js';
export * from './filters.js';
export * from './progress.js';
export * from './curriculum.js';
export * from './recorder.js';
export * from './conversation.js';
```

- [ ] **Step 4: Run domain tests and verify they pass**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run packages/domain/src/__tests__
```

Expected: every suite passes. Do not commit without authorization.

---

### Task 4: PostgreSQL schema, Drizzle client, local Docker skeleton, migrations, and seed

**Files:** Create the Docker compose, API workspace, Drizzle schema, migration, client, migrate and seed scripts, and tests.

**Interfaces:**
- `db` is a Drizzle client over `pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 })`.
- `migrate()` applies every `.sql` file in `apps/api/migrations/` inside one transaction per file.
- `seed(db)` inserts `owner@local.test` (display name `Owner`, password hash from `hashPassword('correct-horse-battery-staple')`) and one default settings row.
- The content package never imports from `apps/api/`. It only consumes the `CurriculumRepository` port defined in `packages/content/src/repository.ts`. The Drizzle adapter lives in `apps/api/src/db/curriculumRepository.ts`.

- [ ] **Step 1: Write failing schema and seed tests**

`apps/api/src/test/dbSchema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = join(here, '..', '..', '..');

describe('database schema', () => {
  it('declares every required table in the init migration', () => {
    const sql = readFileSync(join(root, 'apps', 'api', 'migrations', '0000_init.sql'), 'utf8');
    const required = [
      'users', 'auth_sessions', 'user_settings', 'curriculum_versions', 'units',
      'lessons', 'vocabulary_items', 'sentences', 'islands', 'island_sentences',
      'conversation_scenarios', 'audio_assets', 'practice_ratings', 'practice_events',
      'practice_sessions', 'collections', 'collection_items', 'conversation_sessions',
      'conversation_messages', 'unit_progress', 'compiled_assets',
    ];
    for (const table of required) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it('enforces the unique rating key, the rating range, and the partial unique active index', () => {
    const sql = readFileSync(join(root, 'apps', 'api', 'migrations', '0000_init.sql'), 'utf8');
    expect(sql).toMatch(/PRIMARY KEY \("user_id", "sentence_id", "mode"\)/);
    expect(sql).toMatch(/CHECK \(rating BETWEEN 1 AND 5\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_versions_active_unique"/);
  });

  it('stores only token hashes in auth_sessions', () => {
    const sql = readFileSync(join(root, 'apps', 'api', 'migrations', '0000_init.sql'), 'utf8');
    expect(sql).toMatch(/"access_token_hash" text/);
    expect(sql).toMatch(/"refresh_token_hash" text/);
    expect(sql).not.toMatch(/"jwt"/i);
  });
});
```

`apps/api/src/test/seed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = join(here, '..', '..', '..');

describe('seed script', () => {
  it('imports the drizzle client and uses the schema', () => {
    const src = readFileSync(join(root, 'apps', 'api', 'src', 'db', 'seed.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/client\.js'/);
    expect(src).toMatch(/from '\.\/schema\.js'/);
    expect(src).toContain('owner@local.test');
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/dbSchema.test.ts apps/api/src/test/seed.test.ts
```

Expected: failures because migrations and seed scripts do not exist.

- [ ] **Step 3: Create the Docker skeleton and the API workspace**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    container_name: pt-a1-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: pt_a1
      POSTGRES_PASSWORD: pt_a1_local
      POSTGRES_DB: pt_a1
    ports:
      - "5433:5432"
    volumes:
      - pt_a1_data:/var/lib/postgresql/data
      - ./db/docker-entrypoint-initdb.d:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "pt_a1", "-d", "pt_a1"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pt_a1_data:
```

`db/docker-entrypoint-initdb.d/01-create-test-db.sql`:

```sql
-- Runs once when the postgres container is first created.
-- Ensures the dedicated test database exists so the test helper
-- can connect to it via TEST_DATABASE_URL without ever mutating the
-- development database.
CREATE DATABASE pt_a1_test;
```

The `apps/api/package.json` `content:compile` and `content:compile:fixture` scripts:

```json
    "content:compile": "tsx src/cli/compile-content.ts a1-introductions",
    "content:compile:fixture": "tsx src/cli/compile-content.ts --fixture=a1-introductions-published"
```

`apps/api/package.json`:

```json
{
  "name": "@eup/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0", "npm": ">=11.0.0" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts",
    "content:compile": "tsx src/cli/compile-content.ts a1-introductions",
    "content:compile:fixture": "tsx src/cli/compile-content.ts --fixture=a1-introductions-published"
  },
  "dependencies": {
    "@eup/contracts": "*",
    "@eup/content": "*",
    "@eup/domain": "*",
    "argon2": "0.45.1",
    "cookie-parser": "1.4.7",
    "cors": "2.8.5",
    "drizzle-orm": "0.45.2",
    "express": "5.2.1",
    "helmet": "8.3.0",
    "pg": "8.22.0",
    "pino": "10.3.1",
    "pino-http": "11.0.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/cookie-parser": "1.4.9",
    "@types/cors": "2.8.19",
    "@types/pg": "8.15.4",
    "@types/supertest": "6.0.3",
    "supertest": "7.1.4",
    "tsx": "4.23.1",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.globalSetup.ts'],
    testTimeout: 30000,
  },
});
```

`apps/api/vitest.globalSetup.ts`:

```ts
export default function globalSetup() {
  process.env.NODE_ENV = 'test';
}
```

`apps/api/vitest.setup.ts`:

```ts
process.env.NODE_ENV = 'test';
```

`apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://pt_a1:pt_a1_local@localhost:5433/pt_a1' },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 4: Author the Drizzle schema and migration**

(No `apps/api/src/db/types.ts` is needed. The content package does not import from `apps/api/`. The API exposes Drizzle primitives only through `apps/api/src/db/curriculumRepository.ts`, which implements the `CurriculumRepository` port declared in `packages/content/src/repository.ts`.)
```

`apps/api/src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessTokenHash: text('access_token_hash').notNull().unique(),
  refreshTokenHash: text('refresh_token_hash').notNull().unique(),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  rotatedTo: text('rotated_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  audioSpeed: text('audio_speed').notNull().default('1'),
  repetitions: integer('repetitions').notNull().default(2),
  pauseMs: integer('pause_ms').notNull().default(1500),
  textSize: text('text_size').notNull().default('default'),
  sortOrder: text('sort_order').notNull().default('curriculum'),
  loop: boolean('loop').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const curriculumVersions = pgTable('curriculum_versions', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  version: integer('version').notNull(),
  sourceChecksum: text('source_checksum').notNull(),
  status: text('status').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  active: boolean('active').notNull().default(false),
}, (t) => [
  unique('curriculum_versions_active_unique').on(t.level).where(sql`${t.active} = true`),
]);

export const units = pgTable('units', {
  id: text('id').primaryKey(),
  curriculumVersionId: text('curriculum_version_id').notNull().references(() => curriculumVersions.id),
  level: text('level').notNull(),
  orderIndex: integer('order_index').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  status: text('status').notNull(),
});

export const lessons = pgTable('lessons', {
  id: text('id').primaryKey(),
  unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  orderIndex: integer('order_index').notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
});

export const vocabularyItems = pgTable('vocabulary_items', {
  id: text('id').primaryKey(),
  lessonId: text('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  term: text('term').notNull(),
  translation: text('translation').notNull(),
  gender: text('gender'),
  article: text('article'),
  usageNotes: text('usage_notes'),
  exampleSentenceId: text('example_sentence_id'),
});

export const sentences = pgTable('sentences', {
  id: text('id').primaryKey(),
  unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  curriculumVersionId: text('curriculum_version_id').notNull().references(() => curriculumVersions.id),
  textPt: text('text_pt').notNull(),
  textEn: text('text_en').notNull(),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  vocabRefs: text('vocab_refs').array().notNull().default(sql`ARRAY[]::text[]`),
  grammarRefs: text('grammar_refs').array().notNull().default(sql`ARRAY[]::text[]`),
  pronunciationRefs: text('pronunciation_refs').array().notNull().default(sql`ARRAY[]::text[]`),
  islandRefs: text('island_refs').array().notNull().default(sql`ARRAY[]::text[]`),
  orderIndex: integer('order_index').notNull(),
  status: text('status').notNull(),
});

export const islands = pgTable('islands', {
  id: text('id').primaryKey(),
  unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  setting: text('setting').notNull(),
  bodyMd: text('body_md').notNull(),
});

export const islandSentences = pgTable('island_sentences', {
  islandId: text('island_id').notNull().references(() => islands.id, { onDelete: 'cascade' }),
  sentenceId: text('sentence_id').notNull().references(() => sentences.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull(),
}, (t) => [primaryKey({ columns: [t.islandId, t.sentenceId] })]);

export const conversationScenarios = pgTable('conversation_scenarios', {
  id: text('id').primaryKey(),
  unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  setting: text('setting').notNull(),
  roles: text('roles').notNull(),
  allowedDifficulty: text('allowed_difficulty').notNull(),
  expectedVocab: text('expected_vocab').array().notNull().default(sql`ARRAY[]::text[]`),
  expectedGrammar: text('expected_grammar').array().notNull().default(sql`ARRAY[]::text[]`),
  openingMessage: text('opening_message').notNull(),
  completionConditions: text('completion_conditions').notNull(),
  correctionPolicy: text('correction_policy').notNull(),
  feedbackRubric: text('feedback_rubric').notNull(),
  status: text('status').notNull(),
});

export const audioAssets = pgTable('audio_assets', {
  id: text('id').primaryKey(),
  sentenceId: text('sentence_id').notNull().references(() => sentences.id, { onDelete: 'cascade' }),
  voiceId: text('voice_id').notNull(),
  engine: text('engine').notNull(),
  locale: text('locale').notNull(),
  ssmlVersion: text('ssml_version').notNull(),
  checksum: text('checksum').notNull(),
  filePath: text('file_path').notNull(),
  durationMs: integer('duration_ms').notNull(),
  sampleRate: integer('sample_rate').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const practiceRatings = pgTable('practice_ratings', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sentenceId: text('sentence_id').notNull().references(() => sentences.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
  rating: integer('rating').notNull(),
  lastPractisedAt: timestamp('last_practised_at', { withTimezone: true }).notNull().default(sql`now()`),
  clientMutationId: text('client_mutation_id').notNull(),
  version: integer('version').notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.userId, t.sentenceId, t.mode] }),
  check('rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
]);

export const practiceEvents = pgTable('practice_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sentenceId: text('sentence_id').notNull().references(() => sentences.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  kind: text('kind').notNull(),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const practiceSessions = pgTable('practice_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
  scope: text('scope').notNull(),
  scopeId: text('scope_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const collections = pgTable('collections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const collectionItems = pgTable('collection_items', {
  collectionId: text('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  sentenceId: text('sentence_id').notNull().references(() => sentences.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => [primaryKey({ columns: [t.collectionId, t.sentenceId] })]);

export const conversationSessions = pgTable('conversation_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scenarioId: text('scenario_id').notNull().references(() => conversationScenarios.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  summary: jsonb('summary'),
});

export const conversationMessages = pgTable('conversation_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => conversationSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  corrections: jsonb('corrections').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const unitProgress = pgTable('unit_progress', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => [primaryKey({ columns: [t.userId, t.unitId, t.stage] })]);

export const compiledAssets = pgTable('compiled_assets', {
  id: text('id').primaryKey(),
  curriculumVersionId: text('curriculum_version_id').notNull().references(() => curriculumVersions.id),
  audioId: text('audio_id').notNull().references(() => audioAssets.id),
  published: boolean('published').notNull().default(false),
}, (t) => [unique('compiled_assets_audio_unique').on(t.audioId)]);
```

`apps/api/migrations/0000_init.sql` (write the bodies exactly):

```sql
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_login_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token_hash" text NOT NULL UNIQUE,
  "refresh_token_hash" text NOT NULL UNIQUE,
  "access_expires_at" timestamptz NOT NULL,
  "refresh_expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "ip" text,
  "user_agent" text,
  "rotated_to" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "audio_speed" text NOT NULL DEFAULT '1',
  "repetitions" integer NOT NULL DEFAULT 2,
  "pause_ms" integer NOT NULL DEFAULT 1500,
  "text_size" text NOT NULL DEFAULT 'default',
  "sort_order" text NOT NULL DEFAULT 'curriculum',
  "loop" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "curriculum_versions" (
  "id" text PRIMARY KEY,
  "level" text NOT NULL,
  "version" integer NOT NULL,
  "source_checksum" text NOT NULL,
  "status" text NOT NULL,
  "published_at" timestamptz,
  "active" boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_versions_active_unique"
  ON "curriculum_versions" ("level") WHERE "active" = true;

CREATE TABLE IF NOT EXISTS "units" (
  "id" text PRIMARY KEY,
  "curriculum_version_id" text NOT NULL REFERENCES "curriculum_versions"("id"),
  "level" text NOT NULL,
  "order_index" integer NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "status" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "lessons" (
  "id" text PRIMARY KEY,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "order_index" integer NOT NULL,
  "title" text NOT NULL,
  "body_md" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "vocabulary_items" (
  "id" text PRIMARY KEY,
  "lesson_id" text NOT NULL REFERENCES "lessons"("id") ON DELETE CASCADE,
  "term" text NOT NULL,
  "translation" text NOT NULL,
  "gender" text,
  "article" text,
  "usage_notes" text,
  "example_sentence_id" text
);

CREATE TABLE IF NOT EXISTS "sentences" (
  "id" text PRIMARY KEY,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "curriculum_version_id" text NOT NULL REFERENCES "curriculum_versions"("id"),
  "text_pt" text NOT NULL,
  "text_en" text NOT NULL,
  "tags" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "vocab_refs" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "grammar_refs" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "pronunciation_refs" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "island_refs" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "order_index" integer NOT NULL,
  "status" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "islands" (
  "id" text PRIMARY KEY,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "setting" text NOT NULL,
  "body_md" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "island_sentences" (
  "island_id" text NOT NULL REFERENCES "islands"("id") ON DELETE CASCADE,
  "sentence_id" text NOT NULL REFERENCES "sentences"("id") ON DELETE CASCADE,
  "order_index" integer NOT NULL,
  PRIMARY KEY ("island_id", "sentence_id")
);

CREATE TABLE IF NOT EXISTS "conversation_scenarios" (
  "id" text PRIMARY KEY,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "objective" text NOT NULL,
  "setting" text NOT NULL,
  "roles" text NOT NULL,
  "allowed_difficulty" text NOT NULL,
  "expected_vocab" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "expected_grammar" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "opening_message" text NOT NULL,
  "completion_conditions" text NOT NULL,
  "correction_policy" text NOT NULL,
  "feedback_rubric" text NOT NULL,
  "status" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "audio_assets" (
  "id" text PRIMARY KEY,
  "sentence_id" text NOT NULL REFERENCES "sentences"("id") ON DELETE CASCADE,
  "voice_id" text NOT NULL,
  "engine" text NOT NULL,
  "locale" text NOT NULL,
  "ssml_version" text NOT NULL,
  "checksum" text NOT NULL,
  "file_path" text NOT NULL,
  "duration_ms" integer NOT NULL,
  "sample_rate" integer NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "practice_ratings" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sentence_id" text NOT NULL REFERENCES "sentences"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "rating" integer NOT NULL,
  "last_practised_at" timestamptz NOT NULL DEFAULT now(),
  "client_mutation_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("user_id", "sentence_id", "mode"),
  CHECK (rating BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS "practice_events" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sentence_id" text NOT NULL REFERENCES "sentences"("id") ON DELETE CASCADE,
  "session_id" text,
  "kind" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "practice_sessions" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "collections" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "collection_items" (
  "collection_id" text NOT NULL REFERENCES "collections"("id") ON DELETE CASCADE,
  "sentence_id" text NOT NULL REFERENCES "sentences"("id") ON DELETE CASCADE,
  "order_index" integer NOT NULL,
  "added_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("collection_id", "sentence_id")
);

CREATE TABLE IF NOT EXISTS "conversation_sessions" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scenario_id" text NOT NULL REFERENCES "conversation_scenarios"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "summary" jsonb
);

CREATE TABLE IF NOT EXISTS "conversation_messages" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL REFERENCES "conversation_sessions"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "corrections" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "unit_progress" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "unit_id" text NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "stage" text NOT NULL,
  "completed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "unit_id", "stage")
);

CREATE TABLE IF NOT EXISTS "compiled_assets" (
  "id" text PRIMARY KEY,
  "curriculum_version_id" text NOT NULL REFERENCES "curriculum_versions"("id"),
  "audio_id" text NOT NULL REFERENCES "audio_assets"("id"),
  "published" boolean NOT NULL DEFAULT false,
  CONSTRAINT compiled_assets_audio_unique UNIQUE ("audio_id")
);
```

- [ ] **Step 5: Implement the Drizzle client, migrate, and seed scripts**

`apps/api/src/config.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().default('postgres://pt_a1:pt_a1_local@localhost:5433/pt_a1'),
  TEST_DATABASE_URL: z.string().default('postgres://pt_a1:pt_a1_local@localhost:5433/pt_a1_test'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_DOMAIN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.parse(process.env);

export const config = {
  ...parsed,
  DATABASE_URL: parsed.NODE_ENV === 'test' ? parsed.TEST_DATABASE_URL : parsed.DATABASE_URL,
};
```

`apps/api/src/logger.ts`:

```ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.accessTokenHash',
      '*.refreshTokenHash',
    ],
    censor: '[redacted]',
  },
});
```

`apps/api/src/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 8 });
export const db = drizzle(pool, { schema });
```

`apps/api/src/db/migrate.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'migrations');

async function run(): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

`apps/api/src/db/seed.ts`:

```ts
import { eq } from 'drizzle-orm';
import argon2 from 'argon2';
import { db } from './client.js';
import { userSettings, users } from './schema.js';

const OWNER_ID = 'usr_owner';
const OWNER_EMAIL = 'owner@local.test';

export async function seed(): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.email, OWNER_EMAIL));
  if (existing.length === 0) {
    const hash = await argon2.hash('correct-horse-battery-staple', {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const [user] = await db.insert(users).values({
      id: OWNER_ID,
      email: OWNER_EMAIL,
      displayName: 'Owner',
      passwordHash: hash,
    }).returning();
    if (user) {
      await db.insert(userSettings).values({ userId: user.id });
    }
    console.log('seeded owner user');
  } else {
    console.log('owner user already exists');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 6: Run schema and seed tests, then bring the database up**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/dbSchema.test.ts apps/api/src/test/seed.test.ts
npm run db:up
npm run db:migrate
npm run db:seed
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "\d curriculum_versions"
```

Expected: vitest reports 3/3 passing; `db:up` reports `pt-a1-db` healthy; `db:migrate` prints `applied 0000_init.sql`; `db:seed` prints `seeded owner user`; the `\dt` query lists all 21 tables; the `\d curriculum_versions` output shows the partial unique index `curriculum_versions_active_unique`. Do not commit without authorization.

---

### Task 5: Content package — schemas, synthetic published fixture, draft `a1-introductions`, deterministic compiler

**Files:** Create the `packages/content` workspace, source Zod schemas, the synthetic `published` fixture, the real `draft` source, the validate/compile helpers, the domain-level `CurriculumRepository` port, and tests. Create `apps/api/src/db/curriculumRepository.ts` with the Drizzle implementation. Update `apps/api/src/cli/compile-content.ts` to construct the adapter and inject it.

**Interfaces:**
- `validateSource(folder)` returns `{ manifest, sourceChecksum }` where `sourceChecksum = sha256(JSON.stringify(manifest))`. The synthetic published fixture is the only source that `compile()` will publish in Phase A; the real `a1-introductions` manifest is `status: "draft"` and `compile()` throws `ContentNotPublishableError` for it.
- `CurriculumRepository` (in `packages/content/src/repository.ts`) is a port:
  ```ts
  export interface CurriculumRepository {
    withTransaction<T>(fn: (tx: CurriculumTransaction) => Promise<T>): Promise<T>;
  }
  export interface CurriculumTransaction {
    deactivateLevel(level: 'A1' | 'A2'): Promise<void>;
    insertVersion(input: { id: string; level: 'A1' | 'A2'; version: number; sourceChecksum: string; status: 'draft' | 'expert_reviewed' | 'audio_reviewed' | 'published'; active: boolean }): Promise<void>;
    insertUnit(input: { id: string; curriculumVersionId: string; level: 'A1' | 'A2'; orderIndex: number; slug: string; title: string; summary: string; status: string }): Promise<void>;
    insertLesson(input: { id: string; unitId: string; kind: string; orderIndex: number; title: string; bodyMd: string }): Promise<void>;
    insertVocabularyItem(input: { id: string; lessonId: string; term: string; translation: string; gender: string | null; article: string | null; usageNotes: string | null; exampleSentenceId: string | null }): Promise<void>;
    insertSentence(input: { id: string; unitId: string; curriculumVersionId: string; textPt: string; textEn: string; tags: readonly string[]; vocabRefs: readonly string[]; grammarRefs: readonly string[]; pronunciationRefs: readonly string[]; islandRefs: readonly string[]; orderIndex: number; status: string }): Promise<void>;
    insertIsland(input: { id: string; unitId: string; kind: string; title: string; setting: string; bodyMd: string }): Promise<void>;
    linkIslandSentence(input: { islandId: string; sentenceId: string; orderIndex: number }): Promise<void>;
    insertScenario(input: { id: string; unitId: string; slug: string; title: string; objective: string; setting: string; roles: string; allowedDifficulty: string; expectedVocab: readonly string[]; expectedGrammar: readonly string[]; openingMessage: string; completionConditions: string; correctionPolicy: string; feedbackRubric: string; status: string }): Promise<void>;
  }
  ```
- `compile({ repository, manifest, sourceChecksum })` consumes the `CurriculumRepository` port. It never imports from `apps/api/`. The API CLI constructs a `DrizzleCurriculumRepository` (in `apps/api/src/db/curriculumRepository.ts`) and passes it in.
- The synthetic `published` fixture is the only thing compiled in Phase A. The real `a1-introductions` manifest stays `status: "draft"` and is only flipped by a human expert reviewer.

- [ ] **Step 1: Write the failing validate and compile tests**

`packages/content/src/__tests__/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSource } from '../validate.js';
import { compile } from '../compile.js';
import { ContentNotPublishableError } from '../errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(join(here, '..', '..'));

describe('content validation', () => {
  it('validates the synthetic published fixture', () => {
    const folder = join(root, 'src', 'fixtures', 'a1-introductions-published');
    const result = validateSource(folder);
    expect(result.manifest.level).toBe('A1');
    expect(result.manifest.status).toBe('published');
    expect(result.manifest.units.length).toBeGreaterThanOrEqual(1);
    expect(result.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('loads the real draft fixture as draft (never published by Phase A)', () => {
    const folder = join(root, 'src', 'sources', 'a1-introductions');
    const result = validateSource(folder);
    expect(result.manifest.status).toBe('draft');
  });

  it('rejects a draft source when compile() is called directly', () => {
    const folder = join(root, 'src', 'sources', 'a1-introductions');
    const { manifest, sourceChecksum } = validateSource(folder);
    const noopRepo = createInMemoryRepository();
    return expect(compile({ repository: noopRepo, manifest, sourceChecksum })).rejects.toBeInstanceOf(ContentNotPublishableError);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run packages/content/src/__tests__/validate.test.ts
```

Expected: failure because the schema and source files do not exist.

- [ ] **Step 3: Scaffold the content workspace**

`packages/content/package.json`:

```json
{
  "name": "@eup/content",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0", "npm": ">=11.0.0" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@eup/contracts": "*",
    "drizzle-orm": "0.45.2",
    "zod": "4.4.3"
  },
  "scripts": { "build": "tsc -p", "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

`packages/content/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`packages/content/src/schemas/source.ts`:

```ts
import { z } from 'zod';

export const sourceSentenceSchema = z.object({
  id: z.string(),
  textPt: z.string(),
  textEn: z.string(),
  tags: z.array(z.string()).default([]),
  vocabRefs: z.array(z.string()).default([]),
  grammarRefs: z.array(z.string()).default([]),
  pronunciationRefs: z.array(z.string()).default([]),
  islandRefs: z.array(z.string()).default([]),
  orderIndex: z.number().int().nonnegative(),
});

export const sourceIslandSchema = z.object({
  id: z.string(),
  kind: z.enum(['dialogue', 'story', 'standalone']),
  title: z.string(),
  setting: z.string(),
  bodyMd: z.string(),
  sentenceIds: z.array(z.string()),
});

export const sourceScenarioSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  objective: z.string(),
  setting: z.string(),
  roles: z.string(),
  allowedDifficulty: z.string(),
  expectedVocab: z.array(z.string()),
  expectedGrammar: z.array(z.string()),
  openingMessage: z.string(),
  completionConditions: z.string(),
  correctionPolicy: z.string(),
  feedbackRubric: z.string(),
});

export const sourceLessonSchema = z.object({
  id: z.string(),
  kind: z.enum(['vocabulary', 'grammar', 'pronunciation']),
  orderIndex: z.number().int().nonnegative(),
  title: z.string(),
  bodyMd: z.string(),
  vocabulary: z.array(z.object({
    id: z.string(),
    term: z.string(),
    translation: z.string(),
    gender: z.enum(['m', 'f', 'n/a']).optional(),
    article: z.string().optional(),
    usageNotes: z.string().optional(),
    exampleSentenceId: z.string().optional(),
  })).default([]),
});

export const sourceUnitSchema = z.object({
  id: z.string(),
  level: z.enum(['A1', 'A2']),
  orderIndex: z.number().int().nonnegative(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  status: z.enum(['draft', 'expert_reviewed', 'audio_reviewed', 'published']),
  lessons: z.array(sourceLessonSchema),
  sentences: z.array(sourceSentenceSchema),
  islands: z.array(sourceIslandSchema),
  scenarios: z.array(sourceScenarioSchema),
});

export const sourceManifestSchema = z.object({
  id: z.string(),
  level: z.enum(['A1', 'A2']),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'expert_reviewed', 'audio_reviewed', 'published']),
  units: z.array(sourceUnitSchema),
});

export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type SourceUnit = z.infer<typeof sourceUnitSchema>;
export type SourceSentence = z.infer<typeof sourceSentenceSchema>;
export type SourceIsland = z.infer<typeof sourceIslandSchema>;
export type SourceScenario = z.infer<typeof sourceScenarioSchema>;
export type SourceLesson = z.infer<typeof sourceLessonSchema>;
```

```ts
export class ContentNotPublishableError extends Error {
  constructor(public readonly folder: string, public readonly status: string) {
    super(`content_not_publishable: ${folder} is status "${status}"`);
  }
}
```

`packages/content/src/validate.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceManifestSchema, type SourceManifest } from './schemas/source.js';

export interface ValidatedSource {
  manifest: SourceManifest;
  sourceChecksum: string;
}

export function validateSource(folder: string): ValidatedSource {
  const manifestJson = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  const manifest = sourceManifestSchema.parse(manifestJson);
  const sourceChecksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return { manifest, sourceChecksum };
}
```

`packages/content/src/repository.ts`:

```ts
export type Level = 'A1' | 'A2';

export interface VersionInsert {
  id: string;
  level: Level;
  version: number;
  sourceChecksum: string;
  status: 'draft' | 'expert_reviewed' | 'audio_reviewed' | 'published';
  active: boolean;
}

export interface UnitInsert {
  id: string;
  curriculumVersionId: string;
  level: Level;
  orderIndex: number;
  slug: string;
  title: string;
  summary: string;
  status: string;
}

export interface LessonInsert {
  id: string;
  unitId: string;
  kind: string;
  orderIndex: number;
  title: string;
  bodyMd: string;
}

export interface VocabularyInsert {
  id: string;
  lessonId: string;
  term: string;
  translation: string;
  gender: string | null;
  article: string | null;
  usageNotes: string | null;
  exampleSentenceId: string | null;
}

export interface SentenceInsert {
  id: string;
  unitId: string;
  curriculumVersionId: string;
  textPt: string;
  textEn: string;
  tags: readonly string[];
  vocabRefs: readonly string[];
  grammarRefs: readonly string[];
  pronunciationRefs: readonly string[];
  islandRefs: readonly string[];
  orderIndex: number;
  status: string;
}

export interface IslandInsert {
  id: string;
  unitId: string;
  kind: string;
  title: string;
  setting: string;
  bodyMd: string;
}

export interface IslandSentenceLink {
  islandId: string;
  sentenceId: string;
  orderIndex: number;
}

export interface ScenarioInsert {
  id: string;
  unitId: string;
  slug: string;
  title: string;
  objective: string;
  setting: string;
  roles: string;
  allowedDifficulty: string;
  expectedVocab: readonly string[];
  expectedGrammar: readonly string[];
  openingMessage: string;
  completionConditions: string;
  correctionPolicy: string;
  feedbackRubric: string;
  status: string;
}

export interface CurriculumTransaction {
  deactivateLevel(level: Level): Promise<void>;
  insertVersion(input: VersionInsert): Promise<void>;
  insertUnit(input: UnitInsert): Promise<void>;
  insertLesson(input: LessonInsert): Promise<void>;
  insertVocabularyItem(input: VocabularyInsert): Promise<void>;
  insertSentence(input: SentenceInsert): Promise<void>;
  insertIsland(input: IslandInsert): Promise<void>;
  linkIslandSentence(input: IslandSentenceLink): Promise<void>;
  insertScenario(input: ScenarioInsert): Promise<void>;
}

export interface CurriculumRepository {
  withTransaction<T>(fn: (tx: CurriculumTransaction) => Promise<T>): Promise<T>;
}
```

`packages/content/src/compile.ts`:

```ts
import { createHash } from 'node:crypto';
import type { SourceManifest } from './schemas/source.js';
import type { CurriculumRepository } from './repository.js';

export function deriveVersionId(level: string, version: number, sourceChecksum: string): string {
  const hash = createHash('sha256').update(`${level}|${version}|${sourceChecksum}`).digest('hex').slice(0, 16);
  return `cv_${hash}`;
}

export interface CompileInput {
  repository: CurriculumRepository;
  manifest: SourceManifest;
  sourceChecksum: string;
}

export interface CompileResult {
  versionId: string;
}

export async function compile(input: CompileInput): Promise<CompileResult> {
  if (input.manifest.status !== 'published') {
    throw new ContentNotPublishableError('(in-memory)', input.manifest.status);
  }
  const versionId = deriveVersionId(input.manifest.level, input.manifest.version, input.sourceChecksum);
  return input.repository.withTransaction(async (tx) => {
    await tx.deactivateLevel(input.manifest.level);
    await tx.insertVersion({
      id: versionId,
      level: input.manifest.level,
      version: input.manifest.version,
      sourceChecksum: input.sourceChecksum,
      status: input.manifest.status,
      active: true,
    });
    for (const unit of input.manifest.units) {
      await tx.insertUnit({
        id: unit.id,
        curriculumVersionId: versionId,
        level: unit.level,
        orderIndex: unit.orderIndex,
        slug: unit.slug,
        title: unit.title,
        summary: unit.summary,
        status: unit.status,
      });
      for (const lesson of unit.lessons) {
        await tx.insertLesson({
          id: lesson.id,
          unitId: unit.id,
          kind: lesson.kind,
          orderIndex: lesson.orderIndex,
          title: lesson.title,
          bodyMd: lesson.bodyMd,
        });
        for (const vocab of lesson.vocabulary) {
          await tx.insertVocabularyItem({
            id: vocab.id,
            lessonId: lesson.id,
            term: vocab.term,
            translation: vocab.translation,
            gender: vocab.gender ?? null,
            article: vocab.article ?? null,
            usageNotes: vocab.usageNotes ?? null,
            exampleSentenceId: vocab.exampleSentenceId ?? null,
          });
        }
      }
      for (const sentence of unit.sentences) {
        await tx.insertSentence({
          id: sentence.id,
          unitId: unit.id,
          curriculumVersionId: versionId,
          textPt: sentence.textPt,
          textEn: sentence.textEn,
          tags: sentence.tags,
          vocabRefs: sentence.vocabRefs,
          grammarRefs: sentence.grammarRefs,
          pronunciationRefs: sentence.pronunciationRefs,
          islandRefs: sentence.islandRefs,
          orderIndex: sentence.orderIndex,
          status: unit.status,
        });
      }
      for (const island of unit.islands) {
        await tx.insertIsland({
          id: island.id,
          unitId: unit.id,
          kind: island.kind,
          title: island.title,
          setting: island.setting,
          bodyMd: island.bodyMd,
        });
        for (let i = 0; i < island.sentenceIds.length; i++) {
          const sentenceId = island.sentenceIds[i];
          if (!sentenceId) continue;
          await tx.linkIslandSentence({ islandId: island.id, sentenceId, orderIndex: i });
        }
      }
      for (const scenario of unit.scenarios) {
        await tx.insertScenario({
          id: scenario.id,
          unitId: unit.id,
          slug: scenario.slug,
          title: scenario.title,
          objective: scenario.objective,
          setting: scenario.setting,
          roles: scenario.roles,
          allowedDifficulty: scenario.allowedDifficulty,
          expectedVocab: scenario.expectedVocab,
          expectedGrammar: scenario.expectedGrammar,
          openingMessage: scenario.openingMessage,
          completionConditions: scenario.completionConditions,
          correctionPolicy: scenario.correctionPolicy,
          feedbackRubric: scenario.feedbackRubric,
          status: unit.status === 'published' ? 'published' : 'draft',
        });
      }
    }
    return { versionId };
  });
}
```

`packages/content/src/__tests__/repository.inMemory.ts` (test double used by content tests):

```ts
import type {
  CurriculumRepository,
  CurriculumTransaction,
  IslandSentenceLink,
  IslandInsert,
  LessonInsert,
  ScenarioInsert,
  SentenceInsert,
  UnitInsert,
  VersionInsert,
  VocabularyInsert,
  Level,
} from '../repository.js';

export interface InsertedRow {
  table: 'curriculum_versions' | 'units' | 'lessons' | 'vocabulary_items' | 'sentences' | 'islands' | 'island_sentences' | 'conversation_scenarios';
  row: Record<string, unknown>;
}

export function createInMemoryRepository(): CurriculumRepository & { rows: InsertedRow[] } {
  const rows: InsertedRow[] = [];
  const capture = (table: InsertedRow['table']) => (row: Record<string, unknown>) => {
    rows.push({ table, row });
  };
  const tx: CurriculumTransaction = {
    async deactivateLevel(_level: Level) { rows.push({ table: 'curriculum_versions', row: { op: 'deactivate' } }); },
    async insertVersion(input: VersionInsert) { capture('curriculum_versions')(input); },
    async insertUnit(input: UnitInsert) { capture('units')(input); },
    async insertLesson(input: LessonInsert) { capture('lessons')(input); },
    async insertVocabularyItem(input: VocabularyInsert) { capture('vocabulary_items')(input); },
    async insertSentence(input: SentenceInsert) { capture('sentences')(input); },
    async insertIsland(input: IslandInsert) { capture('islands')(input); },
    async linkIslandSentence(input: IslandSentenceLink) { capture('island_sentences')(input); },
    async insertScenario(input: ScenarioInsert) { capture('conversation_scenarios')(input); },
  };
  return {
    rows,
    async withTransaction<T>(fn: (txArg: CurriculumTransaction) => Promise<T>): Promise<T> { return fn(tx); },
  };
}
```

`packages/content/src/index.ts`:

```ts
export * from './schemas/source.js';
export * from './validate.js';
export * from './compile.js';
export * from './errors.js';
export * from './repository.js';
```

`packages/content/src/index.ts`:

```ts
export * from './schemas/source.js';
export * from './validate.js';
export * from './compile.js';
```

- [ ] **Step 4: Author the synthetic published fixture and the real draft `a1-introductions`**

`packages/content/src/fixtures/a1-introductions-published/manifest.json`:

```json
{
  "id": "a1-introductions",
  "level": "A1",
  "version": 1,
  "status": "published",
  "units": [
    {
      "id": "unit_a1_introductions",
      "level": "A1",
      "orderIndex": 1,
      "slug": "introductions",
      "title": "Apresentações",
      "summary": "Greet people, introduce yourself, and respond to basic introductions.",
      "status": "published",
      "lessons": [
        {
          "id": "les_vocab_greetings",
          "kind": "vocabulary",
          "orderIndex": 0,
          "title": "Saudações",
          "bodyMd": "Saudações cordiais em português europeu.",
          "vocabulary": [
            { "id": "voc_ola", "term": "olá", "translation": "hello", "usageNotes": "informal greeting" },
            { "id": "voc_bom_dia", "term": "bom dia", "translation": "good morning", "gender": "n/a" },
            { "id": "voc_boa_tarde", "term": "boa tarde", "translation": "good afternoon", "gender": "n/a" },
            { "id": "voc_boa_noite", "term": "boa noite", "translation": "good evening / good night", "gender": "n/a" },
            { "id": "voc_chamar_se", "term": "chamar-se", "translation": "to be called", "gender": "n/a" }
          ]
        },
        {
          "id": "les_grammar_presentative",
          "kind": "grammar",
          "orderIndex": 1,
          "title": "Eu chamo-me…",
          "bodyMd": "Use 'chamar-se' to introduce yourself.",
          "vocabulary": []
        },
        {
          "id": "les_pronunciation_vowels",
          "kind": "pronunciation",
          "orderIndex": 2,
          "title": "Open and closed vowels",
          "bodyMd": "Contrast between /e/ and /ɛ/, /o/ and /ɔ/.",
          "vocabulary": []
        }
      ],
      "sentences": [
        { "id": "sen_a1_1", "textPt": "Olá, tudo bem?", "textEn": "Hello, how are you?", "tags": ["greeting"], "vocabRefs": ["voc_ola"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": ["isl_a1_cafe"], "orderIndex": 0 },
        { "id": "sen_a1_2", "textPt": "Bom dia.", "textEn": "Good morning.", "tags": ["greeting"], "vocabRefs": ["voc_bom_dia"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": ["isl_a1_cafe"], "orderIndex": 1 },
        { "id": "sen_a1_3", "textPt": "Boa tarde.", "textEn": "Good afternoon.", "tags": ["greeting"], "vocabRefs": ["voc_boa_tarde"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": [], "orderIndex": 2 },
        { "id": "sen_a1_4", "textPt": "Boa noite.", "textEn": "Good night.", "tags": ["greeting"], "vocabRefs": ["voc_boa_noite"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": [], "orderIndex": 3 },
        { "id": "sen_a1_5", "textPt": "Eu chamo-me Ana.", "textEn": "My name is Ana.", "tags": ["introductions"], "vocabRefs": ["voc_chamar_se"], "grammarRefs": ["les_grammar_presentative"], "pronunciationRefs": ["les_pronunciation_vowels"], "islandRefs": ["isl_a1_cafe"], "orderIndex": 4 },
        { "id": "sen_a1_6", "textPt": "Muito prazer.", "textEn": "Pleased to meet you.", "tags": ["introductions"], "vocabRefs": [], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": ["isl_a1_cafe"], "orderIndex": 5 }
      ],
      "islands": [
        {
          "id": "isl_a1_cafe",
          "kind": "dialogue",
          "title": "No café",
          "setting": "A small café in Lisbon",
          "bodyMd": "**Empregado:** Bom dia! O que vai beber?\n\n**Cliente:** Um café, por favor.\n\n**Empregado:** Com ou sem açúcar?\n\n**Cliente:** Sem açúcar, obrigado.\n\n**Empregado:** Mais alguma coisa?\n\n**Cliente:** Não, obrigado. Quanto é?\n\n**Empregado:** São dois euros.",
          "sentenceIds": ["sen_a1_1", "sen_a1_2", "sen_a1_5", "sen_a1_6"]
        }
      ],
      "scenarios": [
        {
          "id": "scn_a1_cafe",
          "slug": "cafe",
          "title": "Pedir um café",
          "objective": "Order a coffee in a Portuguese café using the unit vocabulary.",
          "setting": "Café em Lisboa",
          "roles": "Cliente e empregado",
          "allowedDifficulty": "A1",
          "expectedVocab": ["café", "açúcar", "obrigado", "por favor", "preço"],
          "expectedGrammar": ["gostar de", "querer", "preferir"],
          "openingMessage": "Olá! Bem-vindo. O que vai beber hoje?",
          "completionConditions": "The learner orders a drink and pays.",
          "correctionPolicy": "Offer at most three gentle corrections per turn; explain in English.",
          "feedbackRubric": "Politeness, accuracy of vocabulary, willingness to continue."
        }
      ]
    }
  ]
}
```

`packages/content/src/sources/a1-introductions/manifest.json` (real, `status: "draft"`, identical content to the published fixture, awaiting human review):

```json
{
  "id": "a1-introductions",
  "level": "A1",
  "version": 1,
  "status": "draft",
  "units": [
    {
      "id": "unit_a1_introductions",
      "level": "A1",
      "orderIndex": 1,
      "slug": "introductions",
      "title": "Apresentações",
      "summary": "Greet people, introduce yourself, and respond to basic introductions.",
      "status": "draft",
      "lessons": [
        {
          "id": "les_vocab_greetings",
          "kind": "vocabulary",
          "orderIndex": 0,
          "title": "Saudações",
          "bodyMd": "Saudações cordiais em português europeu.",
          "vocabulary": [
            { "id": "voc_ola", "term": "olá", "translation": "hello", "usageNotes": "informal greeting" },
            { "id": "voc_bom_dia", "term": "bom dia", "translation": "good morning", "gender": "n/a" },
            { "id": "voc_boa_tarde", "term": "boa tarde", "translation": "good afternoon", "gender": "n/a" },
            { "id": "voc_boa_noite", "term": "boa noite", "translation": "good evening / good night", "gender": "n/a" },
            { "id": "voc_chamar_se", "term": "chamar-se", "translation": "to be called", "gender": "n/a" }
          ]
        },
        {
          "id": "les_grammar_presentative",
          "kind": "grammar",
          "orderIndex": 1,
          "title": "Eu chamo-me…",
          "bodyMd": "Use 'chamar-se' to introduce yourself.",
          "vocabulary": []
        },
        {
          "id": "les_pronunciation_vowels",
          "kind": "pronunciation",
          "orderIndex": 2,
          "title": "Open and closed vowels",
          "bodyMd": "Contrast between /e/ and /ɛ/, /o/ and /ɔ/.",
          "vocabulary": []
        }
      ],
      "sentences": [
        { "id": "sen_a1_1", "textPt": "Olá, tudo bem?", "textEn": "Hello, how are you?", "tags": ["greeting"], "vocabRefs": ["voc_ola"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": ["isl_a1_cafe"], "orderIndex": 0 },
        { "id": "sen_a1_2", "textPt": "Bom dia.", "textEn": "Good morning.", "tags": ["greeting"], "vocabRefs": ["voc_bom_dia"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": ["isl_a1_cafe"], "orderIndex": 1 },
        { "id": "sen_a1_3", "textPt": "Boa tarde.", "textEn": "Good afternoon.", "tags": ["greeting"], "vocabRefs": ["voc_boa_tarde"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": [], "orderIndex": 2 },
        { "id": "sen_a1_4", "textPt": "Boa noite.", "textEn": "Good night.", "tags": ["greeting"], "vocabRefs": ["voc_boa_noite"], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": [], "orderIndex": 3 },
        { "id": "sen_a1_5", "textPt": "Eu chamo-me Ana.", "textEn": "My name is Ana.", "tags": ["introductions"], "vocabRefs": ["voc_chamar_se"], "grammarRefs": ["les_grammar_presentative"], "pronunciationRefs": ["les_pronunciation_vowels"], "islandRefs": ["isl_a1_cafe"], "orderIndex": 4 },
        { "id": "sen_a1_6", "textPt": "Muito prazer.", "textEn": "Pleased to meet you.", "tags": ["introductions"], "vocabRefs": [], "grammarRefs": [], "pronunciationRefs": [], "islandRefs": ["isl_a1_cafe"], "orderIndex": 5 }
      ],
      "islands": [
        {
          "id": "isl_a1_cafe",
          "kind": "dialogue",
          "title": "No café",
          "setting": "A small café in Lisbon",
          "bodyMd": "**Empregado:** Bom dia! O que vai beber?\n\n**Cliente:** Um café, por favor.\n\n**Empregado:** Com ou sem açúcar?\n\n**Cliente:** Sem açúcar, obrigado.\n\n**Empregado:** Mais alguma coisa?\n\n**Cliente:** Não, obrigado. Quanto é?\n\n**Empregado:** São dois euros.",
          "sentenceIds": ["sen_a1_1", "sen_a1_2", "sen_a1_5", "sen_a1_6"]
        }
      ],
      "scenarios": [
        {
          "id": "scn_a1_cafe",
          "slug": "cafe",
          "title": "Pedir um café",
          "objective": "Order a coffee in a Portuguese café using the unit vocabulary.",
          "setting": "Café em Lisboa",
          "roles": "Cliente e empregado",
          "allowedDifficulty": "A1",
          "expectedVocab": ["café", "açúcar", "obrigado", "por favor", "preço"],
          "expectedGrammar": ["gostar de", "querer", "preferir"],
          "openingMessage": "Olá! Bem-vindo. O que vai beber hoje?",
          "completionConditions": "The learner orders a drink and pays.",
          "correctionPolicy": "Offer at most three gentle corrections per turn; explain in English.",
          "feedbackRubric": "Politeness, accuracy of vocabulary, willingness to continue."
        }
      ]
    }
  ]
}
```

(No audio-manifest file in Phase A. Audio manifests are derived in Phase C from approved text + voice + SSML.)

- [ ] **Step 5: Run validate tests and verify they pass**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run packages/content/src/__tests__/validate.test.ts
```

Expected: 2 tests pass. Do not commit without authorization.

---

### Task 6: Argon2id auth with truly opaque access/refresh tokens, rate limits, error envelope

**Files:** Create `apps/api/src/middleware/`, `apps/api/src/modules/auth/`, the `createApp()` factory, the `compile-content` CLI, and tests.

**Interfaces:**
- `hashPassword(plain) -> Promise<string>` with Argon2id `memoryCost: 19456, timeCost: 2, parallelism: 1`.
- `verifyPassword(hash, plain) -> Promise<boolean>`.
- `issueSession(executor, { userId, ip, userAgent }) -> Promise<{ sessionId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }>`. `executor` is either a `Db` or a Drizzle transaction handle.
- `rotateSession(executor, refreshTokenPlain) -> Promise<{ session, user }>`. Runs in one transaction: find by refresh hash, validate, mint replacement, revoke old with `rotatedTo`, commit; rollback on any failure.
- `revokeSession(executor, sessionId) -> Promise<void>`.
- `authenticateRequest(req) -> Promise<{ userId, sessionId }>` reads **only** the unexpired `ptp_access` cookie. The refresh cookie is never accepted for authorization.
- Cookies: name `ptp_access`, `ptp_refresh`, HttpOnly, SameSite=Lax, Secure in production, path `/`.
- `requireAuth()` reads the session, returns 401 on miss.
- `rateLimit({ key, limit, windowMs })` token bucket; login = 10 / minute / IP, refresh = 30 / minute / IP, mutations including `POST /api/auth/logout` = 30 / minute / user.
- `errorEnvelope()` returns `{ error: { code, message, correlationId, details? } }` for Zod and unhandled errors.
- `correlationId()` reads or mints `x-request-id`.
- `POST /api/auth/login` returns `Set-Cookie: ptp_access, ptp_refresh` (HttpOnly, path `/`) and a JSON body `{ accessExpiresAt, refreshExpiresAt, user }`. The raw tokens never appear in the JSON body.
- `POST /api/auth/refresh` reads only the refresh cookie, rotates inside one transaction, returns the new Set-Cookie pair and the same JSON body shape.
- `POST /api/auth/logout` revokes by access cookie or refresh cookie, clears both cookies, returns `204`. Rate-limited as a mutation.
- `GET /api/auth/session` is wrapped in `requireAuth()` and returns `{ user, accessExpiresAt }` where `accessExpiresAt` is the stored `auth_sessions.access_expires_at` value, not `Date.now() + TTL`.

- [ ] **Step 1: Write the failing auth and rate-limit tests**

`apps/api/src/test/session.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { authSessions, userSettings, users } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { seed } from '../db/seed.js';

const app = createApp();

beforeAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "auth_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "user_settings" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "users" RESTART IDENTITY CASCADE`);
  await seed();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE "auth_sessions" RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "auth_sessions" RESTART IDENTITY CASCADE`);
});

describe('auth', () => {
  it('rejects bad password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('logs in, refreshes, and logs out with both cookies set on path /; raw tokens are never in the body', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'correct-horse-battery-staple' });
    expect(login.status).toBe(200);
    expect((login.body as Record<string, unknown>).accessToken).toBeUndefined();
    expect((login.body as Record<string, unknown>).refreshToken).toBeUndefined();
    expect(login.body.user).toMatchObject({ email: 'owner@local.test' });
    const setCookie = (login.headers['set-cookie'] as string[] | undefined) ?? [];
    expect(setCookie.some((c) => /^ptp_access=[^;]+; Path=\//.test(c))).toBe(true);
    expect(setCookie.some((c) => /^ptp_refresh=[^;]+; Path=\//.test(c))).toBe(true);
    const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader);
    expect(refresh.status).toBe(200);
    expect((refresh.body as Record<string, unknown>).accessToken).toBeUndefined();
    const refreshedCookies = (refresh.headers['set-cookie'] as string[] | undefined) ?? [];
    const refreshedHeader = refreshedCookies.map((c) => c.split(';')[0]).join('; ');
    const session = await request(app).get('/api/auth/session').set('Cookie', refreshedHeader);
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe('owner@local.test');
    const logout = await request(app).post('/api/auth/logout').set('Cookie', refreshedHeader);
    expect(logout.status).toBe(204);
    const sessions = await db.select().from(authSessions);
    expect(sessions.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('persists only token hashes, never raw tokens', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'correct-horse-battery-staple' });
    const rows = await db.select().from(authSessions);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.accessTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.accessTokenHash).not.toEqual(row.refreshTokenHash);
  });

  it('authenticateRequest rejects a request that only has a refresh cookie', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'correct-horse-battery-staple' });
    const setCookie = (login.headers['set-cookie'] as string[] | undefined) ?? [];
    const refreshOnly = setCookie.filter((c) => c.startsWith('ptp_refresh=')).map((c) => c.split(';')[0]).join('; ');
    const res = await request(app).get('/api/curriculum/levels/A1').set('Cookie', refreshOnly);
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/session returns the stored access expiry, not Date.now()+TTL', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'correct-horse-battery-staple' });
    const setCookie = (login.headers['set-cookie'] as string[] | undefined) ?? [];
    const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
    const session = await request(app).get('/api/auth/session').set('Cookie', cookieHeader);
    expect(session.status).toBe(200);
    const [row] = await db.select().from(authSessions);
    expect(session.body.accessExpiresAt).toBe(row!.accessExpiresAt.toISOString());
  });
});
```

`apps/api/src/test/rateLimit.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { seed } from '../db/seed.js';

const app = createApp();

beforeAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "auth_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "user_settings" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "users" RESTART IDENTITY CASCADE`);
  await seed();
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "auth_sessions" RESTART IDENTITY CASCADE`);
});

describe('rate limits', () => {
  it('rejects more than 10 login attempts per minute from one IP', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'wrong' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/session.test.ts apps/api/src/test/rateLimit.test.ts
```

Expected: failures because the app, middleware, and auth service do not exist.

- [ ] **Step 3: Implement the middleware, the auth service, the auth routes, and the app factory**

`apps/api/src/middleware/correlationId.ts`:

```ts
import type { RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';

export function correlationId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header('x-request-id');
    const id = incoming && incoming.length > 0 ? incoming : `req_${randomBytes(6).toString('hex')}`;
    res.setHeader('x-request-id', id);
    (req as { correlationId?: string }).correlationId = id;
    next();
  };
}
```

`apps/api/src/middleware/errorEnvelope.ts`:

```ts
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

export function notFound(): RequestHandler {
  return (req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Resource not found', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
  };
}

export function errorEnvelope(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const correlationId = (req as { correlationId?: string }).correlationId ?? '';
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'validation_error', message: 'Invalid request payload', correlationId, details: err.issues } });
      return;
    }
    if (err && typeof err === 'object' && 'status' in err && 'code' in err) {
      const e = err as { status: number; code: string; message: string };
      res.status(e.status).json({ error: { code: e.code, message: e.message, correlationId } });
      return;
    }
    logger.error({ err, correlationId }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error', correlationId } });
  };
}
```

`apps/api/src/middleware/rateLimit.ts`:

```ts
import type { Request, RequestHandler } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const STORE = new Map<string, Bucket>();

export interface RateLimitOptions {
  key: (req: Request) => string;
  limit: number;
  windowMs: number;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const k = opts.key(req);
    const now = Date.now();
    const bucket = STORE.get(k);
    if (!bucket || bucket.resetAt <= now) {
      STORE.set(k, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.limit) {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
      return;
    }
    next();
  };
}
```

`apps/api/src/middleware/requireAuth.ts`:

```ts
import type { RequestHandler } from 'express';
import { authenticateRequest } from '../modules/auth/service.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export function requireAuth(): RequestHandler {
  return async (req, res, next) => {
    try {
      const ctx = await authenticateRequest(req);
      req.auth = ctx;
      next();
    } catch {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
    }
  };
}
```

`apps/api/src/middleware/validate.ts`:

```ts
import type { RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (e) {
      next(e instanceof ZodError ? e : new ZodError([]));
    }
  };
}
```

`apps/api/src/modules/auth/service.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { authSessions, users } from '../../db/schema.js';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ACCESS_COOKIE = 'ptp_access';
const REFRESH_COOKIE = 'ptp_refresh';

export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'transaction'>;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('hex');
}

function newSessionId(): string {
  return `sess_${randomBytes(12).toString('hex')}`;
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export async function issueSession(executor: DbExecutor, opts: { userId: string; ip?: string; userAgent?: string }): Promise<IssuedSession> {
  const sessionId = newSessionId();
  const accessToken = newToken();
  const refreshToken = newToken();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await executor.insert(authSessions).values({
    id: sessionId,
    userId: opts.userId,
    accessTokenHash: sha256(accessToken),
    refreshTokenHash: sha256(refreshToken),
    accessExpiresAt,
    refreshExpiresAt,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
  });
  return {
    sessionId,
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export async function rotateSession(executor: DbExecutor, refreshTokenPlain: string): Promise<{ session: IssuedSession; user: { id: string; email: string; displayName: string } }> {
  return executor.transaction(async (tx) => {
    const hash = sha256(refreshTokenPlain);
    const rows = await tx.select().from(authSessions).where(eq(authSessions.refreshTokenHash, hash));
    const current = rows[0];
    if (!current || current.revokedAt || current.refreshExpiresAt <= new Date()) {
      throw Object.assign(new Error('invalid_refresh'), { status: 401, code: 'unauthorized' });
    }
    const next = await issueSession(tx, { userId: current.userId });
    await tx.update(authSessions).set({ revokedAt: new Date(), rotatedTo: next.sessionId }).where(eq(authSessions.id, current.id));
    const [user] = await tx.select().from(users).where(eq(users.id, current.userId));
    if (!user) throw Object.assign(new Error('user_missing'), { status: 401, code: 'unauthorized' });
    return { session: next, user: { id: user.id, email: user.email, displayName: user.displayName } };
  });
}

export async function revokeSession(executor: DbExecutor, sessionId: string): Promise<void> {
  await executor.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, sessionId));
}

export async function authenticateRequest(req: { cookies?: Record<string, string>; headers: { cookie?: string } }): Promise<{ userId: string; sessionId: string }> {
  const access = req.cookies?.[ACCESS_COOKIE];
  if (!access) throw Object.assign(new Error('no_access'), { status: 401, code: 'unauthorized' });
  const hash = sha256(access);
  const rows = await db.select().from(authSessions).where(eq(authSessions.accessTokenHash, hash));
  const row = rows[0];
  if (!row || row.revokedAt || row.accessExpiresAt <= new Date()) {
    throw Object.assign(new Error('invalid_access'), { status: 401, code: 'unauthorized' });
  }
  return { userId: row.userId, sessionId: row.id };
}

export async function currentUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user ?? null;
}

export async function accessExpiryOf(sessionId: string): Promise<string | null> {
  const [row] = await db.select().from(authSessions).where(eq(authSessions.id, sessionId));
  return row ? row.accessExpiresAt.toISOString() : null;
}
```

`apps/api/src/modules/auth/routes.ts`:

```ts
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { authSessions, users } from '../../db/schema.js';
import { currentUser, issueSession, revokeSession, rotateSession, verifyPassword, accessExpiryOf } from './service.js';
import { loginRequestSchema } from '@eup/contracts';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validateBody } from '../../middleware/validate.js';

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeMs,
    domain: config.COOKIE_DOMAIN || undefined,
  };
}

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const authRouter = Router();

authRouter.post(
  '/login',
  rateLimit({ key: (req) => `login:${req.ip ?? 'unknown'}`, limit: 10, windowMs: 60_000 }),
  validateBody(loginRequestSchema),
  async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid email or password', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
      return;
    }
    const session = await issueSession(db, { userId: user.id, ip: req.ip, userAgent: req.header('user-agent') ?? undefined });
    res.cookie('ptp_access', session.accessToken, cookieOptions(ACCESS_TTL_MS));
    res.cookie('ptp_refresh', session.refreshToken, cookieOptions(REFRESH_TTL_MS));
    res.json({
      accessExpiresAt: session.accessExpiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  },
);

authRouter.post(
  '/refresh',
  rateLimit({ key: (req) => `refresh:${req.ip ?? 'unknown'}`, limit: 30, windowMs: 60_000 }),
  async (req, res) => {
    const refresh = req.cookies?.ptp_refresh;
    if (!refresh) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Missing refresh cookie', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
      return;
    }
    try {
      const { session, user } = await rotateSession(db, refresh);
      res.cookie('ptp_access', session.accessToken, cookieOptions(ACCESS_TTL_MS));
      res.cookie('ptp_refresh', session.refreshToken, cookieOptions(REFRESH_TTL_MS));
      res.json({
        accessExpiresAt: session.accessExpiresAt,
        refreshExpiresAt: session.refreshExpiresAt,
        user: { id: user.id, email: user.email, displayName: user.displayName },
      });
    } catch {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid refresh token', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
    }
  },
);

authRouter.post(
  '/logout',
  rateLimit({ key: (req) => `logout:${req.ip ?? 'unknown'}`, limit: 30, windowMs: 60_000 }),
  async (req, res) => {
    const access = req.cookies?.ptp_access;
    if (access) {
      const hash = createHash('sha256').update(access).digest('hex');
      const rows = await db.select().from(authSessions).where(eq(authSessions.accessTokenHash, hash));
      const row = rows[0];
      if (row) await revokeSession(db, row.id);
    }
    const refresh = req.cookies?.ptp_refresh;
    if (refresh) {
      const hash = createHash('sha256').update(refresh).digest('hex');
      const rows = await db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, hash));
      const row = rows[0];
      if (row) await revokeSession(db, row.id);
    }
    res.clearCookie('ptp_access', cookieOptions(ACCESS_TTL_MS));
    res.clearCookie('ptp_refresh', cookieOptions(REFRESH_TTL_MS));
    res.status(204).end();
  },
);

authRouter.get('/session', requireAuth(), async (req, res) => {
  const user = await currentUser(req.auth!.userId);
  if (!user) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Unknown user', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
    return;
  }
  const accessExpiresAt = await accessExpiryOf(req.auth!.sessionId);
  res.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    accessExpiresAt,
  });
});
```

`apps/api/src/modules/curriculum/service.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  conversationScenarios,
  curriculumVersions,
  islands,
  lessons,
  sentences,
  unitProgress,
  units,
} from '../../db/schema.js';

export interface CurriculumView {
  active: { level: 'A1' | 'A2'; versionId: string };
  levels: Array<{ id: 'A1' | 'A2'; units: Array<{ id: string; title: string; slug: string; orderIndex: number }> }>;
}

export async function getActiveCurriculum(): Promise<CurriculumView> {
  const active = await db.select().from(curriculumVersions).where(eq(curriculumVersions.active, true));
  const a1 = active.find((v) => v.level === 'A1');
  const a2 = active.find((v) => v.level === 'A2');
  const pick = a1 ?? a2 ?? active[0];
  const levels = await Promise.all(
    (['A1', 'A2'] as const).map(async (level) => {
      const version = active.find((v) => v.level === level) ?? pick;
      if (!version) return { id: level, units: [] as CurriculumView['levels'][number]['units'] };
      const rows = await db.select().from(units).where(and(eq(units.curriculumVersionId, version.id), eq(units.level, level)));
      return { id: level, units: rows.map((r) => ({ id: r.id, title: r.title, slug: r.slug, orderIndex: r.orderIndex })) };
    }),
  );
  return {
    active: { level: a1 ? 'A1' : a2 ? 'A2' : 'A1', versionId: a1?.id ?? a2?.id ?? pick?.id ?? '' },
    levels,
  };
}

export async function getLevel(levelId: 'A1' | 'A2') {
  const view = await getActiveCurriculum();
  const level = view.levels.find((l) => l.id === levelId);
  return level ?? null;
}

export async function getUnit(unitId: string) {
  const [unit] = await db.select().from(units).where(eq(units.id, unitId));
  if (!unit) return null;
  const [unitLessons, unitSentences, unitIslands, unitScenarios, progress] = await Promise.all([
    db.select().from(lessons).where(eq(lessons.unitId, unitId)),
    db.select().from(sentences).where(eq(sentences.unitId, unitId)),
    db.select().from(islands).where(eq(islands.unitId, unitId)),
    db.select().from(conversationScenarios).where(eq(conversationScenarios.unitId, unitId)),
    db.select().from(unitProgress).where(eq(unitProgress.unitId, unitId)),
  ]);
  return { id: unit.id, lessons: unitLessons, sentences: unitSentences, islands: unitIslands, scenarios: unitScenarios, progress };
}
```

`apps/api/src/modules/curriculum/routes.ts`:

```ts
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { units } from '../../db/schema.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { getActiveCurriculum, getLevel, getUnit } from './service.js';

export const curriculumRouter = Router();
curriculumRouter.use(requireAuth());

curriculumRouter.get('/', async (_req, res) => {
  res.json(await getActiveCurriculum());
});

curriculumRouter.get('/levels/:levelId', async (req, res) => {
  const levelId = req.params.levelId as 'A1' | 'A2';
  const level = await getLevel(levelId);
  if (!level) {
    res.status(404).json({ error: { code: 'not_found', message: 'Level not found', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
    return;
  }
  res.json({ id: level.id, units: level.units });
});

curriculumRouter.get('/units/:unitId', async (req, res) => {
  const data = await getUnit(req.params.unitId);
  if (!data) {
    res.status(404).json({ error: { code: 'not_found', message: 'Unit not found', correlationId: (req as { correlationId?: string }).correlationId ?? '' } });
    return;
  }
  const [unit] = await db.select().from(units).where(eq(units.id, req.params.unitId));
  res.json({ ...data, level: unit?.level });
});
```

`apps/api/src/app.ts`:

```ts
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { correlationId } from './middleware/correlationId.js';
import { errorEnvelope, notFound } from './middleware/errorEnvelope.js';
import { authRouter } from './modules/auth/routes.js';
import { curriculumRouter } from './modules/curriculum/routes.js';
import { db } from './db/client.js';
import { sql } from 'drizzle-orm';

export function createApp(): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(correlationId());
  app.use(pinoHttp({ logger, redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] }));
  app.get('/api/health', async (_req, res) => {
    let dbOk = true;
    try { await db.execute(sql`select 1`); } catch { dbOk = false; }
    res.json({ status: 'ok', version: '0.1.0', dbOk });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/curriculum', curriculumRouter);
  app.use(notFound());
  app.use(errorEnvelope());
  return app;
}
```

`apps/api/src/server.ts`:

```ts
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = createApp();
app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'));
```

`apps/api/src/db/curriculumRepository.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from './client.js';
import {
  conversationScenarios,
  curriculumVersions,
  islandSentences,
  islands,
  lessons,
  sentences,
  units,
  vocabularyItems,
} from './schema.js';
import type {
  CurriculumRepository,
  CurriculumTransaction,
  IslandInsert,
  IslandSentenceLink,
  LessonInsert,
  Level,
  ScenarioInsert,
  SentenceInsert,
  UnitInsert,
  VersionInsert,
  VocabularyInsert,
} from '@eup/content';

class DrizzleTransaction implements CurriculumTransaction {
  constructor(private readonly tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {}

  async deactivateLevel(level: Level): Promise<void> {
    await this.tx.update(curriculumVersions).set({ active: false }).where(eq(curriculumVersions.level, level));
  }

  async insertVersion(input: VersionInsert): Promise<void> {
    await this.tx.insert(curriculumVersions).values({
      id: input.id,
      level: input.level,
      version: input.version,
      sourceChecksum: input.sourceChecksum,
      status: input.status,
      publishedAt: new Date(),
      active: input.active,
    });
  }

  async insertUnit(input: UnitInsert): Promise<void> {
    await this.tx.insert(units).values({
      id: input.id,
      curriculumVersionId: input.curriculumVersionId,
      level: input.level,
      orderIndex: input.orderIndex,
      slug: input.slug,
      title: input.title,
      summary: input.summary,
      status: input.status,
    });
  }

  async insertLesson(input: LessonInsert): Promise<void> {
    await this.tx.insert(lessons).values({
      id: input.id,
      unitId: input.unitId,
      kind: input.kind,
      orderIndex: input.orderIndex,
      title: input.title,
      bodyMd: input.bodyMd,
    });
  }

  async insertVocabularyItem(input: VocabularyInsert): Promise<void> {
    await this.tx.insert(vocabularyItems).values({
      id: input.id,
      lessonId: input.lessonId,
      term: input.term,
      translation: input.translation,
      gender: input.gender,
      article: input.article,
      usageNotes: input.usageNotes,
      exampleSentenceId: input.exampleSentenceId,
    });
  }

  async insertSentence(input: SentenceInsert): Promise<void> {
    await this.tx.insert(sentences).values({
      id: input.id,
      unitId: input.unitId,
      curriculumVersionId: input.curriculumVersionId,
      textPt: input.textPt,
      textEn: input.textEn,
      tags: [...input.tags],
      vocabRefs: [...input.vocabRefs],
      grammarRefs: [...input.grammarRefs],
      pronunciationRefs: [...input.pronunciationRefs],
      islandRefs: [...input.islandRefs],
      orderIndex: input.orderIndex,
      status: input.status,
    });
  }

  async insertIsland(input: IslandInsert): Promise<void> {
    await this.tx.insert(islands).values({
      id: input.id,
      unitId: input.unitId,
      kind: input.kind,
      title: input.title,
      setting: input.setting,
      bodyMd: input.bodyMd,
    });
  }

  async linkIslandSentence(input: IslandSentenceLink): Promise<void> {
    await this.tx.insert(islandSentences).values({
      islandId: input.islandId,
      sentenceId: input.sentenceId,
      orderIndex: input.orderIndex,
    });
  }

  async insertScenario(input: ScenarioInsert): Promise<void> {
    await this.tx.insert(conversationScenarios).values({
      id: input.id,
      unitId: input.unitId,
      slug: input.slug,
      title: input.title,
      objective: input.objective,
      setting: input.setting,
      roles: input.roles,
      allowedDifficulty: input.allowedDifficulty,
      expectedVocab: [...input.expectedVocab],
      expectedGrammar: [...input.expectedGrammar],
      openingMessage: input.openingMessage,
      completionConditions: input.completionConditions,
      correctionPolicy: input.correctionPolicy,
      feedbackRubric: input.feedbackRubric,
      status: input.status,
    });
  }
}

export class DrizzleCurriculumRepository implements CurriculumRepository {
  withTransaction<T>(fn: (tx: CurriculumTransaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => fn(new DrizzleTransaction(tx)));
  }
}
```

`apps/api/src/cli/compile-content.ts`:

```ts
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DrizzleCurriculumRepository } from '../db/curriculumRepository.js';
import { validateSource, compile, ContentNotPublishableError } from '@eup/content';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fixtureFlag = args.find((a) => a.startsWith('--fixture='));
const sourceFlag = args.find((a) => !a.startsWith('--fixture='));
const useFixture = Boolean(fixtureFlag);
const name = (fixtureFlag ?? sourceFlag ?? 'a1-introductions').replace(/^--fixture=/, '');
const folderName = useFixture ? 'fixtures' : 'sources';
const folder = resolve(join(here, '..', '..', '..', 'packages', 'content', 'src', folderName, name));
const { manifest, sourceChecksum } = validateSource(folder);

if (!useFixture && manifest.status !== 'published') {
  console.error(`content_not_publishable: ${name} is status "${manifest.status}". Use --fixture=<name> to load a published fixture.`);
  process.exit(2);
}

const repository = new DrizzleCurriculumRepository();
repository.withTransaction((tx) => compile({ repository: { withTransaction: (fn) => fn(tx) }, manifest, sourceChecksum }))
  .then((result) => {
    console.log(`compiled ${manifest.id} (${sourceChecksum.slice(0, 12)}) -> ${result.versionId}`);
    process.exit(0);
  })
  .catch((e) => {
    if (e instanceof ContentNotPublishableError) {
      console.error(e.message);
      process.exit(2);
    }
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 4: Run auth and rate-limit tests**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/session.test.ts apps/api/src/test/rateLimit.test.ts
```

Expected: 4 tests pass. Do not commit without authorization.

---

### Task 7: Content compile integration, curriculum endpoint integration, and the `compile-content` CLI

**Files:** Create `apps/api/src/test/compileContent.test.ts`, `apps/api/src/test/curriculum.test.ts`, `apps/api/src/test/factories.ts`.

**Interfaces:**
- `compileContent({ db, sourceName })` is a thin wrapper around `validateSource + compile` that uses the synthetic published fixture.
- The curriculum API test seeds the published fixture, logs in, and asserts the A1 unit list is returned. Draft content is never returned.

- [ ] **Step 1: Write the failing integration tests**

`apps/api/src/test/factories.ts`:

```ts
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { validateSource } from '@eup/content';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(join(here, '..', '..', '..'));

export interface CompiledFixture {
  manifest: ReturnType<typeof validateSource>['manifest'];
  sourceChecksum: string;
  folder: string;
}

export function loadPublishedFixture(): CompiledFixture {
  const folder = join(root, 'packages', 'content', 'src', 'fixtures', 'a1-introductions-published');
  const { manifest, sourceChecksum } = validateSource(folder);
  return { manifest, sourceChecksum, folder };
}

export function readManifestStatus(name: 'a1-introductions'): 'draft' | 'expert_reviewed' | 'audio_reviewed' | 'published' {
  const path = join(root, 'packages', 'content', 'src', 'sources', name, 'manifest.json');
  return JSON.parse(readFileSync(path, 'utf8')).status as 'draft' | 'expert_reviewed' | 'audio_reviewed' | 'published';
}
```

`apps/api/src/test/compileContent.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { compile } from '@eup/content';
import { DrizzleCurriculumRepository } from '../db/curriculumRepository.js';
import {
  conversationScenarios,
  curriculumVersions,
  islandSentences,
  islands,
  lessons,
  sentences,
  units,
  vocabularyItems,
} from '../db/schema.js';
import { loadPublishedFixture } from './factories.js';

beforeAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "compiled_assets" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "conversation_messages" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "conversation_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "practice_events" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "practice_ratings" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "practice_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "collection_items" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "collections" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "unit_progress" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "audio_assets" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "island_sentences" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "conversation_scenarios" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "sentences" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "vocabulary_items" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "lessons" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "islands" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "units" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "curriculum_versions" RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "curriculum_versions" RESTART IDENTITY CASCADE`);
});

describe('content compile', () => {
  it('compiles the published fixture into a deterministic version id and writes every referenced row', async () => {
    const fixture = loadPublishedFixture();
    const repository = new DrizzleCurriculumRepository();
    const result = await repository.withTransaction((tx) => compile({ repository: { withTransaction: (fn) => fn(tx) }, manifest: fixture.manifest, sourceChecksum: fixture.sourceChecksum }));
    expect(result.versionId).toMatch(/^cv_[a-f0-9]{16}$/);
    const versions = await db.select().from(curriculumVersions).where(eq(curriculumVersions.id, result.versionId));
    expect(versions.length).toBe(1);
    expect(versions[0]!.active).toBe(true);
    const versionUnits = await db.select().from(units).where(eq(units.curriculumVersionId, result.versionId));
    expect(versionUnits.length).toBe(1);
    const versionLessons = await db.select().from(lessons).where(eq(lessons.unitId, 'unit_a1_introductions'));
    expect(versionLessons.length).toBe(3);
    const vocabulary = await db.select().from(vocabularyItems).where(eq(vocabularyItems.lessonId, 'les_vocab_greetings'));
    expect(vocabulary.length).toBe(5);
    const versionSentences = await db.select().from(sentences).where(eq(sentences.unitId, 'unit_a1_introductions'));
    expect(versionSentences.length).toBe(6);
    const versionIslands = await db.select().from(islands).where(eq(islands.unitId, 'unit_a1_introductions'));
    expect(versionIslands.length).toBe(1);
    const islandSentenceRefs = await db.select().from(islandSentences).where(eq(islandSentences.islandId, 'isl_a1_cafe'));
    expect(islandSentenceRefs.length).toBe(4);
    const versionScenarios = await db.select().from(conversationScenarios).where(eq(conversationScenarios.unitId, 'unit_a1_introductions'));
    expect(versionScenarios.length).toBe(1);
  });

  it('rolls back when a referenced row is missing', async () => {
    const fixture = loadPublishedFixture();
    const broken = JSON.parse(JSON.stringify(fixture.manifest));
    broken.units[0]!.sentences[0]!.vocabRefs = ['voc_does_not_exist'];
    const repository = new DrizzleCurriculumRepository();
    await expect(
      repository.withTransaction((tx) => compile({ repository: { withTransaction: (fn) => fn(tx) }, manifest: broken, sourceChecksum: fixture.sourceChecksum })),
    ).rejects.toBeTruthy();
    const versions = await db.select().from(curriculumVersions).where(eq(curriculumVersions.active, true));
    expect(versions.length).toBeLessThanOrEqual(1);
  });
});
```

`apps/api/src/test/curriculum.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { seed } from '../db/seed.js';
import { compile } from '@eup/content';
import { curriculumVersions } from '../db/schema.js';
import { loadPublishedFixture, readManifestStatus } from './factories.js';

const app = createApp();

beforeAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "auth_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "user_settings" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "users" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "compiled_assets" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "conversation_messages" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "conversation_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "practice_events" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "practice_ratings" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "practice_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "collection_items" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "collections" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "unit_progress" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "audio_assets" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "island_sentences" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "conversation_scenarios" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "sentences" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "vocabulary_items" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "lessons" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "islands" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "units" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "curriculum_versions" RESTART IDENTITY CASCADE`);
  await seed();
  const fixture = loadPublishedFixture();
  await compile({ db, manifest: fixture.manifest, sourceChecksum: fixture.sourceChecksum });
});

afterAll(async () => {
  await db.execute(sql`TRUNCATE TABLE "auth_sessions" RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "curriculum_versions" RESTART IDENTITY CASCADE`);
});

describe('curriculum API', () => {
  it('returns the A1 unit list and never draft content', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@local.test', password: 'correct-horse-battery-staple' });
    const setCookie = (login.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
    const res = await request(app).get('/api/curriculum/levels/A1').set('Cookie', setCookie);
    expect(res.status).toBe(200);
    expect(res.body.units.map((u: { id: string }) => u.id)).toEqual(['unit_a1_introductions']);
  });

  it('exposes the published version id as the active pointer', async () => {
    const [active] = await db.select().from(curriculumVersions).where(eq(curriculumVersions.active, true));
    expect(active?.level).toBe('A1');
    expect(readManifestStatus('a1-introductions')).toBe('draft');
  });
});
```

- [ ] **Step 2: Run the integration tests and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/compileContent.test.ts apps/api/src/test/curriculum.test.ts
```

Expected: failures because the integration harness and CLI are not wired.

- [ ] **Step 3: Adjust the content compiler to roll back on bad references**

Update the validator in `packages/content/src/compile.ts`. Wrap the loop that inserts sentences, islands, and scenarios in a pre-validation that asserts every `vocabRefs`, `grammarRefs`, `pronunciationRefs`, and `islandRefs` entry resolves to a known lesson, vocabulary item, or island. Throw a typed `CompileValidationError` when any reference is missing so the surrounding Drizzle transaction rolls back.

Add the error type and reference check immediately above the `for (const unit ...)` loop:

```ts
export class CompileValidationError extends Error {
  constructor(public readonly issues: Array<{ unitId: string; sentenceId: string; missing: string }>) {
    super(`curriculum compile failed validation: ${issues.length} missing reference(s)`);
  }
}

function validateReferences(manifest: SourceManifest): void {
  const issues: Array<{ unitId: string; sentenceId: string; missing: string }> = [];
  for (const unit of manifest.units) {
    const lessonIds = new Set(unit.lessons.map((l) => l.id));
    const vocabIds = new Set(unit.lessons.flatMap((l) => l.vocabulary.map((v) => v.id)));
    const islandIds = new Set(unit.islands.map((i) => i.id));
    for (const sentence of unit.sentences) {
      for (const ref of sentence.vocabRefs) if (!vocabIds.has(ref)) issues.push({ unitId: unit.id, sentenceId: sentence.id, missing: ref });
      for (const ref of sentence.grammarRefs) if (!lessonIds.has(ref)) issues.push({ unitId: unit.id, sentenceId: sentence.id, missing: ref });
      for (const ref of sentence.pronunciationRefs) if (!lessonIds.has(ref)) issues.push({ unitId: unit.id, sentenceId: sentence.id, missing: ref });
      for (const ref of sentence.islandRefs) if (!islandIds.has(ref)) issues.push({ unitId: unit.id, sentenceId: sentence.id, missing: ref });
    }
  }
  if (issues.length > 0) throw new CompileValidationError(issues);
}
```

Call `validateReferences(input.manifest)` as the first line of `compile(input)` so any bad reference aborts the transaction before the first insert.

- [ ] **Step 4: Run the integration tests and verify they pass**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/compileContent.test.ts apps/api/src/test/curriculum.test.ts
npm run content:compile
echo "exit=$?"
psql "$DATABASE_URL" -c 'SELECT id, level, version, active FROM curriculum_versions;'
psql "$DATABASE_URL" -c 'SELECT count(*) FROM sentences WHERE unit_id = '"'"'unit_a1_introductions'"'"';'
npm run content:compile:fixture
psql "$DATABASE_URL" -c 'SELECT id, level, version, active FROM curriculum_versions;'
psql "$DATABASE_URL" -c 'SELECT count(*) FROM sentences WHERE unit_id = '"'"'unit_a1_introductions'"'"';'
```

Expected: 3 tests pass; `content:compile` exits non-zero and prints `content_not_publishable: a1-introductions is status "draft"`; the SQL queries before the fixture compile show no active A1 version and zero sentences; `content:compile:fixture` prints `compiled a1-introductions-published (… ) -> cv_<hex>`; the SQL queries after the fixture compile show one active A1 version and six sentences. The seed-loaded `usr_owner` user still exists. Do not commit without authorization.

---

### Task 8: Minimal React 19 + Vite 8 SPA — login form and authenticated home page

**Files:** Create the `apps/web` workspace, the dev proxy, the login page, the home page, and tests.

**Interfaces:**
- Vite dev server: port 5173, proxies `/api` → `http://localhost:8787`, sets `changeOrigin: true`.
- `api.login(email, password)` parses the JSON body with the `loginResponseSchema` contract. It does **not** persist tokens to `localStorage`; the HttpOnly cookies carry them.
- `api.session()` parses the response with `sessionResponseSchema`.
- `api.level(levelId)` parses `GET /api/curriculum/levels/:id` with `curriculumLevelResponseSchema` from `@eup/contracts`.
- `useAuth()` returns `{ status, user, login, logout }`. `<RequireAuth>` calls `useAuth()` and never calls `api.session()` directly.
- `<LoginPage>` posts to `/api/auth/login` and navigates to `/` on success.
- `<HomePage>` calls `GET /api/curriculum/levels/A1` and renders the unit list. Phase A renders unit titles in `<span>` elements, not `<a href="/learn/...">`, because the learn route is added in a later phase.
- The root component (`apps/web/src/main.tsx`) wraps `<RouterProvider>` with `<AuthProvider>` so every page (including `<LoginPage>`) sits inside one auth context.

- [ ] **Step 1: Write the failing web tests**

`apps/web/src/test/login.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { AuthProvider } from '../app/AuthProvider';

function withFetch(impl: typeof fetch) {
  const previous = global.fetch;
  global.fetch = impl;
  return () => { global.fetch = previous; };
}

const loginResponse = {
  accessExpiresAt: '2030-01-01T00:00:00Z',
  refreshExpiresAt: '2030-02-01T00:00:00Z',
  user: { id: 'usr_owner', email: 'owner@local.test', displayName: 'Owner' },
};

const sessionResponse = {
  user: { id: 'usr_owner', email: 'owner@local.test', displayName: 'Owner' },
  accessExpiresAt: '2030-01-01T00:00:00Z',
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderLogin() {
  const router = createMemoryRouter(
    [{ path: '/login', element: <LoginPage /> }, { path: '/', element: <div>home stub</div> }],
    { initialEntries: ['/login'] },
  );
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('submits credentials, sets cookies via the server response, and never stores the token in localStorage', async () => {
    const restore = withFetch(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) {
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'no session', correlationId: 'cid' } }), { status: 401, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/login')) {
        return new Response(JSON.stringify(loginResponse), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'ptp_access=abc; Path=/; HttpOnly' },
        });
      }
      return new Response('{}', { status: 200 });
    });
    try {
      renderLogin();
      await userEvent.type(screen.getByLabelText('Email'), 'owner@local.test');
      await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple');
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await waitFor(() => expect(window.localStorage.length).toBe(0));
    } finally {
      restore();
    }
  });
});

describe('HomePage', () => {
  it('renders the unit list from the API and never hard-codes content', async () => {
    const restore = withFetch(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) {
        return new Response(JSON.stringify(sessionResponse), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/api/curriculum/levels/A1')) {
        return new Response(JSON.stringify({ id: 'A1', units: [{ id: 'unit_a1_introductions', title: 'Apresentações', slug: 'introductions', orderIndex: 1 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    });
    try {
      const { HomePage } = await import('../features/home/HomePage');
      const router = createMemoryRouter([{ path: '/', element: <HomePage /> }], { initialEntries: ['/'] });
      const qc = new QueryClient();
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByText('Apresentações')).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
```

- [ ] **Step 2: Run the web tests and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/web/src/test
```

Expected: failures because the workspace does not exist.

- [ ] **Step 3: Scaffold the web workspace and implement the pages**

`apps/web/package.json`:

```json
{
  "name": "@eup/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0", "npm": ">=11.0.0" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@eup/contracts": "*",
    "@tanstack/react-query": "5.101.4",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "react-router": "7.18.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.6.3",
    "@testing-library/react": "16.1.0",
    "@testing-library/user-event": "14.5.2",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.17",
    "@vitejs/plugin-react": "6.0.4",
    "jsdom": "25.0.1",
    "typescript": "6.0.3",
    "vite": "8.1.5",
    "vitest": "4.1.10"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`apps/web/vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/test/setup.ts'] },
});
```

`apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>European Portuguese</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { LoginPage } from './features/auth/LoginPage.js';
import { HomePage } from './features/home/HomePage.js';
import { RequireAuth } from './features/layout/RequireAuth.js';
import { AuthProvider } from './app/AuthProvider.js';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth><HomePage /></RequireAuth>,
  },
]);

const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('missing root element');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

`apps/web/src/app/api.ts`:

```ts
import { loginResponseSchema, sessionResponseSchema, curriculumLevelResponseSchema, type CurriculumLevelResponse } from '@eup/contracts';

export type { CurriculumLevelResponse };

export const api = {
  async login(email: string, password: string) {
    const res = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error('login_failed');
    return loginResponseSchema.parse(await res.json());
  },
  async session() {
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) throw new Error('session_missing');
    return sessionResponseSchema.parse(await res.json());
  },
  async level(levelId: 'A1' | 'A2'): Promise<CurriculumLevelResponse> {
    const res = await fetch(`/api/curriculum/levels/${levelId}`, { credentials: 'include' });
    if (!res.ok) throw new Error('level_missing');
    return curriculumLevelResponseSchema.parse(await res.json());
  },
};
```

`apps/web/src/app/AuthProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.js';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: { id: string; email: string; displayName: string } | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthState['user']>(null);

  useEffect(() => {
    api.session()
      .then((s) => { setUser(s.user); setStatus('authenticated'); })
      .catch(() => setStatus('anonymous'));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setStatus('anonymous');
  }, []);

  return <AuthContext.Provider value={{ status, user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

`apps/web/src/features/auth/LoginPage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/AuthProvider.js';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
        </label>
        <button type="submit">Sign in</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
```

`apps/web/src/features/layout/RequireAuth.tsx`:

```tsx
import { Navigate } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from '../../app/AuthProvider.js';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <p>Loading…</p>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

`apps/web/src/features/home/HomePage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api, type CurriculumLevelResponse } from '../../app/api.js';

export function HomePage() {
  const [level, setLevel] = useState<CurriculumLevelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.level('A1')
      .then(setLevel)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main>
      <h1>European Portuguese — A1</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {(level?.units ?? []).map((unit) => (
          <li key={unit.id}><span>{unit.title}</span></li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Run web tests, build, and typecheck**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/web/src/test
npm --workspace apps/web run build
npm run typecheck
```

Expected: 2 tests pass; `vite build` produces `apps/web/dist`; `typecheck` exits 0. Do not commit without authorization.

---

### Task 9: Governance — session-init V11, AGENTS, CONTEXT, ADRs accepted, end-to-end verification

**Files:** Modify `scripts/session-init.js` (append only), `docs/agents/session-init.md`, `docs/agents/success-criteria.md`, `AGENTS.md`, `CONTEXT.md`. Update both ADRs to `Accepted`.

**Interfaces:**
- V11 scanner: `scanEuropeanPortugueseWorkspace()` returns `{ available: true, status: 'ok' }` when every required workspace file exists, or `{ available: true, status: 'incomplete', missing: [...] }` otherwise.
- V11 is a single check added to `runValidationChecks` and reported in `unified.issues`. V1–V10 are untouched.
- `CONTEXT.md` and `AGENTS.md` identify the new product while preserving the existing issue tracker, triage, and domain references.

- [ ] **Step 1: Write the failing governance tests**

`apps/api/src/test/governance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

describe('governance', () => {
  it('session-init reports V11 and V1-V10 still pass', () => {
    const out = execFileSync('node', ['scripts/session-init.js'], { cwd: root, encoding: 'utf8' });
    const snapshot = JSON.parse(out);
    const ids = snapshot.validation.checks.map((c: { id: string }) => c.id);
    for (const id of ['V1-agent-docs-complete', 'V7-no-leftover-uploads', 'V11-eup-foundation-scaffold']) {
      expect(ids).toContain(id);
    }
  });

  it('CONTEXT.md identifies the European Portuguese product while preserving legacy sections', () => {
    const text = readFileSync(join(root, 'CONTEXT.md'), 'utf8');
    expect(text).toContain('European Portuguese');
    expect(text).toContain('Pipeline stages');
    expect(text).toContain('Known gaps');
  });

  it('AGENTS.md references the foundation governance doc', () => {
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(text).toContain('docs/agents/european-portuguese-foundation.md');
  });
});
```

- [ ] **Step 2: Run the governance tests and verify failure**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npx vitest run apps/api/src/test/governance.test.ts
```

Expected: failure because V11 is missing and `CONTEXT.md` does not yet mention European Portuguese.

- [ ] **Step 3: Update `scripts/session-init.js` (append only, then a single in-place edit)**

Append this block to the bottom of `scripts/session-init.js` (do not modify any existing function or object body):

```js
function scanEuropeanPortugueseWorkspace() {
  const required = [
    'apps/api/src/server.ts',
    'apps/api/src/app.ts',
    'apps/api/src/db/schema.ts',
    'apps/api/migrations/0000_init.sql',
    'apps/web/src/main.tsx',
    'packages/contracts/src/index.ts',
    'packages/domain/src/index.ts',
    'packages/content/src/index.ts',
    'packages/content/src/sources/a1-introductions/manifest.json',
    'packages/content/src/fixtures/a1-introductions-published/manifest.json',
    'tools/check-android-prereqs.ts',
    'docs/adr/0021-foundation-vertical-slice.md',
    'docs/adr/0022-shared-credentials-and-android-secure-storage.md',
    'docs/agents/european-portuguese-foundation.md',
  ];
  const missing = required.filter((p) => !fileExists(join(PROJECT_ROOT, p)));
  if (missing.length === 0) return { available: true, status: 'ok' };
  return { available: true, status: 'incomplete', missing };
}
```

In `main()`, add `european_portuguese_workspace: normalizeStatus(scanEuropeanPortugueseWorkspace())` to the existing `scanners` object literal (one new line in the existing object body). Do not rewrite `main()`. After the snapshot is built, push a single `medium`-severity entry to `unified.issues` when the new scanner reports `incomplete`:

```js
const eupScan = scanEuropeanPortugueseWorkspace();
if (eupScan.status === 'incomplete') {
  unified.issues.push({
    severity: 'medium',
    area: 'european_portuguese_workspace',
    message: `European Portuguese workspace missing: ${eupScan.missing.join(', ')}`,
    action: 'Run the foundation phase A plan',
  });
}
```

Add the V11 check inside `runValidationChecks` (one new line at the end of the `checks.push(...)` block, right before the existing `return`):

```js
  const eupStatus = scanEuropeanPortugueseWorkspace();
  checks.push({
    id: 'V11-eup-foundation-scaffold',
    pass: eupStatus.status === 'ok',
    detail: eupStatus.status === 'ok' ? 'European Portuguese workspace scaffolded' : `Missing: ${eupStatus.missing?.join(', ')}`,
  });
```

- [ ] **Step 4: Update `docs/agents/session-init.md` and `docs/agents/success-criteria.md`**

In `docs/agents/session-init.md`, add a row to the scanners table for `european_portuguese_workspace` and a bullet for V11 in the validation list.

In `docs/agents/success-criteria.md`, add a row to the sub-criteria table:

```markdown
| V11 | `eup-foundation-scaffold` | Every workspace file listed in `tools/check-android-prereqs.ts`-equivalent table exists; the synthetic published fixture and the real draft source are both present. |
```

- [ ] **Step 5: Update `CONTEXT.md` and `AGENTS.md`**

Insert a new section at the top of `CONTEXT.md` (do not delete the existing pipeline or entity sections):

```markdown
# European Portuguese Learning Platform

The image-to-prompt application is reference only. The new product
is the European Portuguese learning platform. It lives under
`apps/api/`, `apps/web/`, and `packages/{contracts,domain,content,tooling}`.
The PostgreSQL database is the source of truth for users, ratings,
collections, and conversation state. Authentication uses Argon2id with
opaque access and refresh tokens held in HttpOnly cookies.
```

In `AGENTS.md`, add one bullet to the existing list (do not remove the
session-init or issue-tracker bullets):

```markdown
- **European Portuguese foundation governance:** see `docs/agents/european-portuguese-foundation.md` for the read-only operator guide.
```

- [ ] **Step 6: Update ADR status to Accepted**

In both `docs/adr/0021-foundation-vertical-slice.md` and
`docs/adr/0022-shared-credentials-and-android-secure-storage.md`, change
the `## Status` line to:

```markdown
Accepted. Implemented 2026-07-22.
```

Add this `## Verification` block at the end of each file:

```markdown
## Verification

- `node scripts/session-init.js` reports `validation.summary.pass_rate` 1.0 with V1–V11 accounted for.
- `npx vitest run packages/contracts` passes.
- `npx vitest run packages/domain` passes.
- `npx vitest run packages/content` passes.
- `npx vitest run apps/api` passes.
- `npx vitest run apps/web` passes.
- `npm run typecheck` exits 0.
- `npm run build` produces `apps/web/dist`.
- `node tests/run-all.js` still reports its existing pass count (no legacy regression).
```

- [ ] **Step 7: Run the full verification suite**

Run:

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
npm install
npx vitest run apps/api/src/test/governance.test.ts
npm run lint
npm run typecheck
node tests/run-all.js | tail -n 5
npm test
node scripts/session-init.js | tail -n 30
```

Expected:
- Governance tests pass.
- `lint` and `typecheck` exit 0.
- Legacy `tests/run-all.js` still passes; no regression to `data/presets.json`, `server.js`, `src/`, or `tests/run-all.js`.
- `npm test` reports every workspace suite green.
- `session-init.js` prints the V11 line and the existing V1–V10 lines; `validation.summary.pass_rate` is 1.0; the snapshot includes the new `european_portuguese_workspace` scanner.

Do not commit without explicit user authorization.

---
