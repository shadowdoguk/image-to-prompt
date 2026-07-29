# European Portuguese Learning Platform — Design

**Date:** 2026-07-22  
**Status:** Approved in brainstorming  
**Release target:** Curated A1 and A2 European Portuguese for web and Android

## 1. Purpose

Replace the current image-to-prompt application with a fresh, focused product for English-speaking learners of European Portuguese. The product guides a learner from no prior knowledge through A1 and A2 while preserving the freedom to browse vocabulary, lessons, Language Islands, and practice material in any order.

The application prioritizes a small number of effective activities:

- Structured A1–A2 progression.
- Curated vocabulary, grammar, pronunciation, sentences, dialogues, and stories.
- Shadowing through Listen & Repeat.
- Active Recall from English into European Portuguese.
- Separate self-ratings for comprehension/shadowing and production/recall.
- Smart review based on weak material.
- Focused practice through filters and collections.
- Guided AI role-play linked to learned Language Islands.

The current product domain, user workflow, and accumulated feature set are not retained. Existing code may be consulted for operational patterns, but the learning application is a clean modular rebuild.

## 2. Product principles

1. **A clear next step:** Home always identifies the learner's next lesson or review activity.
2. **Freedom without confusion:** Learners can browse all published A1–A2 material without abandoning the guided path.
3. **European Portuguese only:** Content, terminology, examples, audio, and AI behavior use `pt-PT`; Brazilian Portuguese must never be silently substituted.
4. **Curated before generated:** Core teaching content is written and reviewed, not generated dynamically for learners.
5. **Practice over feature count:** Shadowing, recall, review, and contextual communication take priority over peripheral tools.
6. **One learning record:** Web and Android use the same account and central progress store.
7. **Predictable modules:** Each subsystem has a defined interface and can be understood and tested independently.
8. **Connected first, offline-ready:** The first release requires a connection. Domain and storage interfaces must permit later downloadable lessons and synchronized offline progress without redesign.

## 3. Release scope

### 3.1 Included in the first release

- A complete, expert-reviewed A1 and A2 curriculum.
- Responsive web application.
- Android application built from the shared web interface with Capacitor.
- Guided Home screen and browsable Learn library.
- Vocabulary Builder organized by CEFR level, unit, and category.
- First-class vocabulary, grammar, and pronunciation lessons.
- Language Islands containing dialogues, short stories, and standalone sentences.
- Listen & Repeat practice.
- Active Recall practice.
- Separate 1–5-star ratings per sentence and practice mode.
- Smart Review queue.
- Search and multi-keyword sentence filtering.
- Personal collections.
- Practice settings for speed, repetitions, pause duration, text size, sort order, and looping.
- On-device microphone recording and immediate playback for shadowing attempts.
- Text-based guided AI role-play linked to a unit or island.
- Shared progress between web and Android.
- Private deployment support through Coolify after local acceptance.

### 3.2 Explicitly deferred

- General-purpose unrestricted AI chat.
- Live voice conversation with AI.
- Automated pronunciation scoring.
- Permanent storage or upload of learner voice recordings.
- Android offline lesson downloads and background synchronization.
- Native iOS application.
- Learner-imported custom content.
- Gesture-based range selection.
- In-app content issue reporting.
- In-app curriculum authoring or administration.
- Public registration, subscriptions, payments, or multi-tenant administration.
- CEFR promotion based on unique-word thresholds.
- B1, B2, C1, or C2 content.

## 4. Information architecture

### 4.1 Primary destinations

- **Home:** Continue learning, Review next, current A1/A2 progress, and shortcuts to Vocabulary, Islands, and Conversation.
- **Learn:** A1 and A2 unit map with one clearly marked Next unit and progress on every unit.
- **Practice:** Listen & Repeat, Active Recall, Smart Review, collections, and filtered sessions.
- **Islands:** Browse real-life topics, dialogues, stories, and standalone sentences.
- **Conversation:** Start or resume guided AI role-plays tied to learned material.
- **Progress:** Separate Shadow and Recall progress, recent activity, and unit completion.
- **Settings:** Practice controls, account settings, audio behavior, and later offline storage.

Desktop uses a persistent top-level navigation. Android uses touch-sized controls and a compact bottom navigation, with less-frequent destinations under More. Both clients expose the same underlying content and progress.

### 4.2 Home behavior

Home presents, in order:

1. The next incomplete guided lesson.
2. A Smart Review action when review candidates exist.
3. The active A1 or A2 path.
4. Shortcuts to Vocabulary, Language Islands, and AI Conversation.
5. Recent units and collections.

A learner may ignore the recommendation and open any published item. Browsing does not alter the recommended sequence; completing material updates the recommendation.

## 5. Curriculum model

### 5.1 Hierarchy

```text
Curriculum
└── CEFR Level: A1 or A2
    └── Unit
        ├── Vocabulary lessons
        ├── Grammar lessons
        ├── Pronunciation lessons
        ├── Example sentences
        ├── Language Islands
        │   ├── Dialogues
        │   ├── Short stories
        │   └── Standalone sentences
        └── AI conversation scenarios
```

Units have an explicit sequence within a level. Lessons have an explicit sequence within a unit. Every sentence may reference vocabulary items, grammar points, pronunciation targets, islands, and one or more searchable tags.

### 5.2 Six-stage unit loop

Each unit follows the same learning loop:

1. **Learn — Core vocabulary:** Meaning, gender and article where applicable, usage notes, and example sentences.
2. **Notice — Grammar and sound:** One focused grammar pattern and one pronunciation target taught in context.
3. **Shadow — Listen & Repeat:** Hear complete sentences, repeat aloud, optionally record and replay, then self-rate.
4. **Recall — Active Recall:** See English, produce European Portuguese aloud, reveal the answer, compare, and self-rate.
5. **Apply — Language Island:** Follow a dialogue or story that combines the unit language naturally.
6. **Communicate — AI role-play:** Practise a constrained scenario using the unit's language and receive gentle corrections and a short summary.

The stages define the recommendation order, not a hard lock. Learners can open any published stage.

### 5.3 Content lifecycle

Curriculum is stored in version-controlled content files and passes through:

```text
draft → expert_reviewed → audio_reviewed → published
```

Only `published` content is available in learner mode.

- **Expert review** verifies European Portuguese usage, grammar, spelling, register, translation accuracy, and CEFR suitability.
- **Audio review** verifies accent authenticity, pronunciation, intelligibility, natural rhythm, and slowed-playback quality.
- Changes to published Portuguese text or SSML invalidate the prior audio review and require regenerated audio.

An in-app authoring interface is not part of the first release. Content contributors edit validated files through the repository workflow.

## 6. Practice model

### 6.1 Listen & Repeat

For each sentence, the learner can:

- Play or pause reviewed `pt-PT` audio.
- Choose playback speed.
- Configure automatic repetitions and pauses.
- Loop the session.
- View or hide the English translation.
- Record a shadowing attempt with the device microphone.
- Play the attempt back immediately.
- Assign a 1–5 Shadow rating.

Recordings are temporary, remain on the current device, and are discarded when the learner replaces the recording, leaves the active item, or ends the session. They are not uploaded in the first release.

### 6.2 Active Recall

For each sentence, the learner:

1. Sees the English prompt.
2. Produces the European Portuguese sentence aloud.
3. Reveals the curated answer.
4. Plays the reviewed audio when needed.
5. Compares the attempt honestly.
6. Assigns a separate 1–5 Recall rating.

The app does not claim to judge pronunciation or correctness automatically in the first release.

### 6.3 Rating semantics

Ratings are mode-specific:

- **1:** Barely recognized or produced.
- **2:** Significant help required.
- **3:** Partly secure but hesitant or inaccurate.
- **4:** Correct with minor hesitation.
- **5:** Confident and fluent for the current mode.

A sentence is mastered for a mode only when its rating for that mode is 5. Lowering a rating immediately removes mastered status for that mode.

Mode progress uses all published sentences in the selected scope as its denominator:

```text
sentences rated 5 in the mode / all published sentences in the selected unit or level
```

For a personal collection, the denominator is the number of sentence references currently in that collection. A sentence that has not yet been rated therefore counts as not mastered.

Unit-level progress also records completion of its six stages so that path progression is not reduced to star ratings alone.

### 6.4 Smart Review

Smart Review includes previously rated sentences with a current rating from 1 through 4 in the selected mode. Candidates are ordered by:

1. Lowest current rating.
2. Oldest `lastPractisedAt` timestamp.
3. Curriculum order as a stable tie-breaker.

Unrated sentences enter through guided lessons or manually selected practice, not Smart Review. Five-star sentences are excluded by default but can be included through a filter. The first release does not implement rating decay or a hidden spaced-repetition formula.

### 6.5 Filters and collections

Learners can search sentence text, translation, vocabulary references, and tags. Comma-separated terms use OR matching by default so `maçã, dar, João` finds sentences containing any term; an explicit Match all control switches to AND matching.

A collection is a named ordered set of sentence references. Adding an existing sentence does not duplicate its ratings or progress. Collections can be practised in either mode and can use the same sorting and playback settings as unit sessions.

### 6.6 Practice settings

Settings include:

- Repetitions per sentence: 1–5.
- Pause duration: 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, or 7 seconds.
- Playback speed: 0.5×–2×.
- Text size: small, default, large, or extra large.
- Sort: curriculum order, easy to hard, or hard to easy.
- Loop playback: on or off.

Learning-relevant settings synchronize through the account. Device permission state and temporary recordings remain device-local.

## 7. AI conversation practice

AI conversation is a separate tool, not a source of canonical teaching content.

Each scenario defines:

- Unit and island references.
- Setting and roles.
- Learner objective.
- Expected vocabulary and grammar.
- Allowed difficulty and register.
- Opening message.
- Completion conditions.
- Correction policy.
- Feedback rubric.

The model should remain near learned A1/A2 language, keep turns concise, avoid overwhelming correction, and distinguish European Portuguese from Brazilian Portuguese. It may introduce a small amount of comprehensible new language when needed, with an English explanation.

A session ends with a structured summary containing:

- What the learner communicated successfully.
- Up to three corrections.
- Useful vocabulary from the exchange.
- One suggested next practice action.

The conversation provider is accessed through a server-side adapter. Existing MiniMax integration knowledge may be reused, but MiniMax is selected only if a dedicated European Portuguese evaluation passes. Provider keys never enter client bundles. Provider failure must not block ordinary learning or practice.

The first release is text-only for AI conversation. Microphone use is limited to local shadowing record-and-playback.

## 8. Audio strategy

### 8.1 Provider choice

Use Microsoft Azure Speech as the initial TTS provider, behind an adapter, with Amazon Polly `Inês` Neural as the fallback. Both choices require explicit `pt-PT` configuration. The supporting research is in `docs/reports/european-portuguese-tts-options-july-2026.md`.

Provider selection is conditional on a native-speaker listening test. Catalog labels such as Neural or HD do not prove pedagogical suitability.

### 8.2 Generation pipeline

Audio is pre-generated during content publication rather than generated on every learner request:

1. Validate published Portuguese text and SSML.
2. Generate normal-speed and pedagogically slowed variants when slowed runtime playback degrades quality.
3. Save immutable, content-addressed audio files.
4. Record provider, locale, voice ID, engine, SSML version, checksum, and generation date.
5. Run native-speaker audio review.
6. Publish the content manifest only after approval.

The application reuses stored files for playback. TTS credentials stay server-side. A changed text, voice, or SSML checksum creates a new asset rather than silently replacing an approved file.

### 8.3 Listening-test gate

Before selecting the production voice, generate the same 30–50-item corpus with Azure candidates and Polly Inês. At least two native European Portuguese reviewers blindly score:

- Accent authenticity.
- Vowel reduction and open/closed vowels.
- Sibilants and `lh`/`nh`.
- Clitics, questions, numbers, and dates.
- Naturalness and rhythm.
- Word accuracy.
- Quality at normal and slowed rates.

Any voice with Brazilian lexical or prosodic leakage is rejected.

## 9. Technical architecture

### 9.1 Repository structure

The intended structure is:

```text
apps/
  web/          React + Vite responsive client
  android/      Capacitor Android project wrapping the web build
  api/          Modular TypeScript Node API
packages/
  contracts/    Shared schemas and API types
  domain/       Pure learning and review rules
  content/      Curriculum source files, schemas, compiler, and validators
  ui/           Shared presentation components where separation adds value
  tooling/      Audio generation and content-quality commands
```

No new application logic is placed into the current monolithic `server.js`, `src/app.js`, or `tests/run-all.js`. The implementation plan will define how the failed application is preserved for reference and then removed or archived without overwriting the existing uncommitted `data/presets.json` change.

### 9.2 Clients

- **Web:** React and Vite provide a responsive application for desktop and mobile browsers.
- **Android:** Capacitor copies the same built web application into an Android project and exposes native capabilities through plugins.
- **Shared behavior:** Navigation, curriculum display, practice logic, ratings, collections, and conversation UI share one implementation.
- **Native boundaries:** Microphone permissions, local temporary files, secure token storage, and future offline downloads sit behind client capability interfaces.

Touch targets, gestures, focus behavior, and layouts are tested explicitly on Android rather than assumed from desktop responsiveness.

### 9.3 API

The TypeScript Node API is split into modules with explicit public interfaces:

- Identity and sessions.
- Curriculum delivery.
- Practice sessions and ratings.
- Review queue.
- Collections and filters.
- Progress reporting.
- User settings.
- Conversation scenarios and sessions.
- Audio manifests.

Routes perform transport concerns and delegate to domain services. Domain services do not depend on HTTP. Persistence adapters do not contain learning rules.

### 9.4 Persistence

PostgreSQL is the central source of truth locally and on the VPS. Local development uses a container so production does not require a database-engine migration.

Core persisted entities are:

- `User`
- `CurriculumVersion`
- `Level`
- `Unit`
- `Lesson`
- `VocabularyItem`
- `Sentence`
- `Island`
- `ConversationScenario`
- `PracticeRating`
- `PracticeEvent`
- `Collection`
- `CollectionItem`
- `UserSettings`
- `ConversationSession`
- `ConversationMessage`
- `AudioAsset`

Published curriculum is compiled from validated files into versioned PostgreSQL records. Publication imports a complete curriculum version in one transaction and advances a single active-version pointer only after all records and audio references succeed. Runtime code reads the active compiled version and never reads unvalidated draft files.

`PracticeRating` has a unique key of `(userId, sentenceId, mode)` and supports idempotent upsert. `mode` is `shadow` or `recall`. Progress views are derived from ratings, events, and completed stages instead of storing competing totals.

### 9.5 Authentication

The local development environment uses one seeded owner account. The private VPS deployment has no public registration.

- Passwords are hashed with Argon2id using parameters selected for the deployment environment.
- Web sessions use secure, HTTP-only, same-site cookies.
- Android uses short-lived access credentials with securely stored refresh credentials.
- Production requires HTTPS.
- Provider and database secrets come from environment or Coolify secrets.
- Authentication, conversation, and mutation endpoints are rate-limited.

The schema may support additional users later, but multi-user administration is not a first-release feature.

### 9.6 Local and hosted environments

During development:

- Linux runs the API, PostgreSQL, and web development server.
- Desktop browsers connect locally.
- Android test devices connect to the development API over the trusted local network.
- Debug-only Android networking configuration permits the local endpoint.

After acceptance:

- Web, API, and PostgreSQL deploy privately through Coolify.
- Android and web use the same HTTPS API.
- The VPS database becomes the shared learning source of truth.
- Backups cover the database, reviewed content manifests, and generated audio metadata/assets.

## 10. Runtime data flows

### 10.1 Practice session

```text
Choose unit, collection, or filter
→ API resolves authorized content
→ client builds or receives ordered queue
→ learner practises locally with stored audio
→ rating is optimistically displayed
→ idempotent rating/event write reaches API
→ progress and review views update
```

If a rating write fails, the client marks it pending and retries while the session remains open. It does not display the rating as synchronized until acknowledged.

### 10.2 AI role-play

```text
Choose scenario
→ API loads published scenario and learner context
→ server constructs bounded pt-PT instructions
→ provider adapter sends and validates turn
→ response and structured corrections return
→ accepted messages persist to conversation history
→ completion produces feedback summary
```

Conversation context is bounded by scenario-relevant vocabulary, recent turns, and concise progress data. Full curriculum or unrelated personal data is not sent to the provider.

### 10.3 Content publication

```text
Edit version-controlled draft
→ schema and reference validation
→ expert review approval
→ TTS generation
→ native-speaker audio review
→ compile immutable curriculum version
→ publish manifest and assets
```

Publication fails atomically: learners continue seeing the previous complete curriculum version if any validation, generation, or deployment step fails.

## 11. Error handling and resilience

- **Connection loss:** Keep loaded practice material visible. Mark unsynchronized writes and offer retry. Do not claim full offline support.
- **Audio failure:** Identify the affected sentence and provide retry. Never substitute an unreviewed voice or locale.
- **Microphone denial:** Explain how to grant permission; keep playback and self-rating usable.
- **AI provider failure:** Preserve accepted transcript state, offer retry, and leave all non-AI learning available.
- **Invalid AI response:** Retry once through the adapter's validation path, then return a clear temporary-unavailability state.
- **Content validation failure:** Block publication and report file, field, and reference errors.
- **Authentication expiry:** Preserve local screen state while re-authenticating; do not discard an in-progress rating or conversation draft.
- **Unexpected server errors:** Return a stable error envelope and correlation ID without exposing secrets or provider payloads.

## 12. Offline evolution

Offline Android practice is deferred, but the first release preserves these seams:

- Versioned content manifests.
- Immutable downloadable audio assets.
- A client content-store interface.
- Idempotent rating and event mutations.
- Server timestamps plus client mutation IDs.
- Capability-aware audio and filesystem services.

A later phase can add saved-island bundles, storage quotas, download progress, offline-ready state, queued mutations, and conflict-safe synchronization. The first release does not display offline controls that do not work.

## 13. Testing and quality strategy

### 13.1 Automated tests

- **Domain unit tests:** rating semantics, mastery, review ordering, progress derivation, filters, collections, and curriculum sequencing.
- **Content validation tests:** schema validity, unique IDs, valid references, CEFR constraints, status transitions, translation presence, and audio-manifest consistency.
- **API integration tests:** authentication, curriculum reads, idempotent rating writes, collections, settings, conversation boundaries, and error envelopes.
- **React component tests:** practice controls, reveal behavior, star controls, pending synchronization, accessibility states, and responsive navigation.
- **Playwright flows:** guided path, Shadow, Recall, Smart Review, filtering, collections, AI role-play fallback, and web/mobile viewports.
- **Android device tests:** touch targets, back behavior, microphone permission, record/playback, audio focus, secure authentication, and web/Android progress synchronization.
- **Deployment smoke tests:** health, database migrations, content version, audio availability, login, and one complete practice mutation.

### 13.2 Human quality gates

- European Portuguese expert review for every published content item.
- Native-speaker listening review for every changed audio item.
- Blind provider comparison before the TTS voice is pinned.
- Guided AI scenario evaluation for locale, level, correction quality, concision, and refusal to drift into Brazilian Portuguese.
- Accessibility and touch usability review on representative desktop and Android devices.

### 13.3 First vertical-slice acceptance gate

Before curriculum expansion, one complete A1 unit must demonstrate:

- All six learning stages.
- Reviewed vocabulary, grammar, pronunciation, sentences, and one Language Island.
- Approved European Portuguese audio.
- Listen & Repeat with settings and temporary microphone record/playback.
- Active Recall with reveal and independent rating.
- Smart Review behavior.
- Search/filter and a personal collection.
- One constrained text AI role-play.
- Shared progress between desktop web and a physical Android phone.
- Automated tests and deployment smoke checks passing.

Only after this template is approved should content production scale across the complete A1 and A2 release target.

## 14. Delivery strategy

The work is deliberately decomposed. This document defines the full A1–A2 release, but the next implementation plan covers only stages 1–4 through one accepted A1 vertical slice. Curriculum scale and private release receive separate plans after that gate passes:

1. **Foundation:** New workspace, contracts, database, authentication, content schema, and deployment skeleton.
2. **Vertical slice:** One complete A1 unit across web and Android.
3. **Practice depth:** Smart Review, filters, collections, settings, and polished session behavior.
4. **Conversation:** One evaluated guided text scenario and provider adapter.
5. **Content scale:** Produce, review, generate audio for, and publish the remaining A1 and A2 units.
6. **Private release:** Coolify deployment, backups, monitoring, Android release build, and cross-client acceptance.
7. **Post-release:** Offline saved content, synchronization, imported content, reporting, and voice AI considered as separate designs.

## 15. Success criteria

The first release succeeds when:

- An English-speaking beginner can follow a clear path through complete, reviewed A1 and A2 material.
- The learner can always identify the next recommended lesson and can freely browse alternatives.
- Shadow and Recall practice are fast, understandable, and independently tracked.
- Smart Review reliably surfaces the learner's weakest rated sentences.
- European Portuguese text and audio pass expert/native-speaker review with no silent Brazilian Portuguese fallback.
- Web and Android show the same account progress after synchronization.
- Android touch, playback, microphone record/playback, and permissions work on physical devices.
- AI role-play remains constrained to the selected scenario and gives useful, level-appropriate feedback.
- A failure in TTS, AI, or connectivity does not corrupt progress or block unrelated learning.
- The implementation is composed of bounded modules rather than new monolithic files.
