---
description: "Task list for Module 008: Voice Order Entry with Gemini"
---

# Tasks: Voice Order Entry with Gemini

**Input**: Design documents from `/specs/008-voice-order-gemini/`
**Prerequisites**: plan.md, spec.md, research.md (decisions D1-D19), data-model.md, contracts/api.openapi.yaml, quickstart.md, ADR-0008
**Tests**: INCLUDED. Constitution Principles IV, V, VI and VIII and spec success criteria SC-001 to SC-014 require them. Within each story, write its tests first and confirm they fail (or, for tests that need the migration, that they fail before it exists).
**Organization**: Grouped by user story. Priority order: US1 speak an order, review, create a draft (P1, the MVP), US2 doubtful items shown and never guessed (P1), US3 failures never block or lose an order (P1), US4 language and honest browser support (P2), US5 nothing sensitive leaves the supplier's control, diagnostics (P2), US6 correct anything and parse again (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 speak and create · US2 doubts · US3 failures and fallback · US4 language and support · US5 privacy and diagnostics · US6 correct and parse again
- Paths are relative to the repository root `D:\my project\medicine-supply`. Do not touch `docs/`, `.specify/`, `.claude/`, `CLAUDE.md`, or the specs of Modules 001 to 007 while implementing (checking boxes in this file and writing results in this module's quickstart are allowed).
- Never put a real key in a file, a test, a log, a screen or a chat message. The owner puts `GEMINI_API_KEY` and `GEMINI_MODEL` into `.env.local` by themselves. Tests use the placeholder key `test-key-sentinel-do-not-use` and a local fake server, and use the separate TEST Supabase project (`.env.test.local`), never the owner's dev project. Migration `0009` goes to the TEST project and later to the dev project only when the owner says so.
- No test may call the real Gemini service. The Gemini client refuses to run in the test environment when its base address is the real Google host (T023).
- No price, MRP, cost, margin, balance or invoice field may appear in any voice request to the AI, any voice route response, any voice screen or the diagnostic log. Never invent a medicine, quantity, unit, store or price. Never auto-select a candidate.
- All repository text (code, comments, tests, docs, commit messages) is English only (CLAUDE.md "Language"). Chat replies to the owner stay in Roman Urdu.
- Task IDs are stable references. After `/sp.analyze` one task moved phase (T044 is now in US1) and one was added with the next free ID (T070, listed in US3), so the IDs inside a phase are not strictly in order.
- This branch starts from `master` (Module 007 merged, merge commit `2a98dfa`). Do not commit, push, apply a migration to dev or test, or open a pull request unless the owner says so. Do not add npm packages.

## Path Conventions

Same single Next.js project: `src/app`, `src/components`, `src/lib`, `supabase/migrations`, `tests/{unit,integration,e2e,helpers}`. Reuse existing helpers: `src/lib/ids.ts` (`newId`, `isUuid`), `src/lib/normalize.ts`, `src/lib/orders/editor-state.ts` (`cleanTypedName`, `parseQuantity`, `LIMITS`), `src/components/orders/MedicineSearch.tsx` and `StoreSelector.tsx`, `src/lib/api/{auth,errors,client}.ts`, `src/lib/hooks/*`, `src/components/ui/*`, `tests/helpers/{pglite,supabase-test,orders,orders-db,pending}.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: A known baseline, verified facts about the two external APIs, and test fakes

- [x] T001 Baseline: on this branch run `npm run lint`, `npm run typecheck`, `npx vitest run tests/unit` and `npx vitest run pglite` before any change and record the real counts in `specs/008-voice-order-gemini/quickstart.md` section 6 (the whole `npm test` is slow and runs at the end, T065; say so; never write a count that was not run).
- [x] T002 [P] Verify the current external facts the plan relies on and record them with the date and the source addresses in a new section "Verified facts" at the end of `specs/008-voice-order-gemini/research.md`: (a) the Gemini REST `generateContent` request and response shape, how the key is sent (header), `systemInstruction`, `generationConfig.responseMimeType` and `responseSchema`, how a safety block, a 429 and a bad key are reported; (b) the browser `SpeechRecognition` API in Chrome on Android: `continuous`, `interimResults`, the `lang` values `en-PK` and `ur-PK`, and the error names (`not-allowed`, `service-not-allowed`, `no-speech`, `audio-capture`, `network`, `language-not-supported`, `aborted`). Use the web fetch tool, not memory. If a fact differs from `plan.md`, `research.md` D2/D3 or the contract, fix those files in the same task and tell the owner; if it changes the design (for example the key can no longer be sent as assumed), stop and ask.
- [x] T003 [P] `.env.example` and the secrets guard: add `GEMINI_API_KEY=`, `GEMINI_MODEL=` and `GEMINI_API_BASE_URL=` with one comment line each (server only; never commit a real value; the base address is for tests and is normally empty). `scripts/check-secrets.mjs` (part of `npm run lint`) currently fails when ANY file under `src/` mentions `GEMINI_API_KEY`, which would fail lint at T023: change it to allow that name in exactly one file, `src/lib/voice/gemini.ts`, and keep `SERVICE_ROLE` forbidden everywhere and every other file forbidden to mention the key name. Add `tests/unit/check-secrets.test.ts` that runs the script (with `node`, in a temporary directory that has its own `src/`) and proves: the allowed file passes, any other file under `src/` that mentions the name fails, a file with a JWT-like value fails, and a clean tree passes. Run `npm run lint` and confirm it passes.
- [x] T004 [P] Test helpers: `tests/helpers/voice.ts` (builders for `RawParse`, preview lines and candidates; a `FakeParser` that returns a scripted result or throws a scripted failure; the text of a fake `SpeechRecognition` class for Playwright `addInitScript` that lets a test push interim and final words, errors and an end event) and `tests/helpers/voice-db.ts` (PGlite and Supabase wrappers for `voice_*`, plus a builder that seeds medicines with strengths, forms, manufacturers and pack sizes for matching tests).
- [x] T005 [P] Fake Gemini for browser tests: `tests/e2e/support/fake-gemini.mjs` (a small `node:http` server that answers `generateContent` calls; the transcript text selects the scripted behaviour by a marker: normal, doubtful items, an invented extra item, a price field in the answer, HTTP 429, a slow answer, invalid JSON, a wrong shape, 401; it records every request body so a test can assert it; it checks the key header equals the placeholder) and `playwright.config.ts` (start it as a second `webServer` on a spare port and pass `GEMINI_API_KEY=test-key-sentinel-do-not-use`, `GEMINI_MODEL=test-model` and `GEMINI_API_BASE_URL` to the app server; change nothing else of the config).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration `0009_voice_orders.sql`, the shared TypeScript layer, and the TEST project

**CRITICAL**: No user story starts before T011 is green. T014 is an owner step.

- [x] T006 Write the failing database tests first, `tests/integration/db-voice-schema.pglite.test.ts`: `orders.spoken_text` exists with the 1 to 2,000 character check and the check that it needs `source = 'voice'`; `orders_guard` refuses a change of `spoken_text` and of `source`; `voice_diagnostics` and `voice_parse_attempts` exist with Row Level Security enabled and no write grant for `authenticated`; `voice_diagnostics` refuses update and delete for a signed-in user; the six new functions exist with the right grants (`authenticated` can execute `voice_parse_allow`, `voice_diag_add`, `voice_diag_list`, `voice_match_*`, not `anon`); the old six-argument `order_save` is gone and the eight-argument one exists; `rls_audit()` still passes.
- [x] T007 Migration `supabase/migrations/0009_voice_orders.sql`, part 1 (data-model sections 1 and 2 first half): header comment (what it adds, the objects of earlier modules it replaces, the rollback block from data-model section 7), `alter table public.orders add column spoken_text` with its checks, `order_to_json` re-created from its **latest** definition (0004) with only `'spoken_text'` added, and `orders_guard` re-created from its **latest** definition (0007) with only the `spoken_text` immutability added. Copy, do not retype; list the diff in the task notes.
- [x] T008 Same migration, part 2 (data-model section 2): drop the six-argument `order_save`; create `order_save(..., p_source text default 'manual', p_spoken_text text default null)` as the 0003 body with exactly three changes: the validation of the two new values (before anything is written, with the existing `invalid_lines` refusal shape), `source` taken from `p_source` in the create insert, and `spoken_text` in the create insert (both ignored on an update of an existing order); re-issue the revoke and grant for the new signature. Do not change any other line of the body; record `diff` of the old and new bodies in the task notes and confirm it shows only those changes.
- [x] T009 Same migration, part 3 (data-model sections 3 to 5, tables and writers): `voice_diagnostics` (checks, append-only trigger that lets the service role delete for cleanup, index, Row Level Security with one select policy, revoke and grant), `voice_parse_attempts` (Row Level Security on, no policy), `voice_parse_allow()` (advisory lock per business, 20 per 60 seconds, deletes rows older than one hour), `voice_diag_add(...)` (validates kind, counts, length and message; skips a `rate_limited` record when one exists from the last 60 seconds; deletes the business's records older than 90 days), `voice_diag_list(p_limit, p_offset)`. Every function filters on `current_business_id()` and raises `no_business` without one.
- [x] T010 Same migration, part 4 (data-model section 5, the match functions): `voice_match_products(p_names jsonb)` and `voice_match_stores(p_name text)` as SECURITY INVOKER, active records only, up to five candidates each, `is_exact` as defined in the data model, similarity floor 0.3 on the trigram-indexed `search_text`, ordered exact first, then score, then name; no price, MRP or cost column in any result; revoke from `public, anon`, grant to `authenticated`.
- [x] T011 Run `tests/integration/db-voice-schema.pglite.test.ts` (T006) until green, then the whole PGlite suite (`npx vitest run pglite`), which includes every Module 003 to 007 order, pending, market, invoice and ledger suite against the changed `order_save`; also call the function in the old six-argument form once to prove the defaults; run `npm run typecheck`. Record the counts in quickstart section 6.
- [x] T012 [P] Shared TypeScript layer: `src/lib/api/errors.ts` (codes `rate_limited` 429, `ai_busy` 503, `ai_timeout` 504, `ai_invalid` 502, `ai_unavailable` 502, `ai_not_configured` 503 with the contract messages), `src/lib/voice/types.ts` (data-model section 6 shapes), `src/lib/validation/voice.ts` (`ParseBodySchema` with the transcript trimmed, 1 to 2,000 characters, and `parser` `ai` or `rules`; `DiagnosticsQuerySchema`), `src/lib/validation/order.ts` (`OrderSaveSchema` gains `source` and `spoken_text`: `voice` requires 1 to 2,000 characters of spoken text, `manual` refuses it; default `manual`), `src/lib/orders/types.ts` (`Order.spoken_text`) and `src/lib/orders/repository.ts` (`saveOrder` passes `p_source` and `p_spoken_text`). Unit tests in `tests/unit/voice-validation.test.ts`.
- [x] T013 [P] `src/lib/voice/repository.ts`: thin wrappers (user session) for `voice_parse_allow`, `voice_diag_add`, `voice_diag_list`, `voice_match_products` and `voice_match_stores`, mapping a refusal or `no_business` to the documented `ApiError`; no function returns or accepts a price.
- [x] T014 Owner step, only after the owner says so: apply `supabase/migrations/0009_voice_orders.sql` to the **TEST project** through the owner's signed-in Supabase tab (the SQL Editor; the owner signs in; never ask for a password or key). Before and after, read counts only (`orders`, `order_lines`, `order_events`, `stores`, `products`) and confirm they are unchanged and that `orders.spoken_text` exists; record both in quickstart section 7. **STOP here and ask the owner before any task that needs the TEST project (T020, T040, T050, T059, T060 and every Playwright run).**

**Checkpoint**: The database layer and the shared TypeScript layer exist; the TEST project has the migration.

---

## Phase 3: User Story 1 - Speak an order, review it, and get a draft order (Priority: P1) MVP

**Goal**: Microphone to transcript to Parse to a preview of matched and typed lines to a created draft order whose source is voice.

**Independent Test**: With a fake speech engine and a fake Gemini, say the example sentence, check the preview, create the draft, and see a Draft order with the right store and lines and its read-only spoken text; tapping Create twice creates one order.

### Tests for User Story 1 (write first)

- [x] T015 [P] [US1] `tests/unit/voice-gemini-request.test.ts`: `buildGeminiRequest` returns only the fixed instruction and the transcript (assert the exact keys and that no catalog, store, price, balance or business text can appear); the key goes in a header and never in the body or a URL; the model comes from `GEMINI_MODEL` and the string of a model is not hardcoded in `src/` (a grep test); a round trip against the fake server of T005 returns the scripted answer; the guard refuses the real Google host in the test environment.
- [x] T016 [P] [US1] `tests/unit/voice-schema.test.ts`: the answer schema accepts the contract shape, drops unknown fields such as a price or an MRP, refuses the whole answer for invalid JSON, a missing or non-array `items`, a non-text name, a quantity that is neither a number nor null, a unit over 50 characters, a store over 200 characters and 201 items, and lets a numeric but doubtful quantity (0, -3, 2.5, 1e9) through for the later flag.
- [x] T017 [P] [US1] `tests/unit/voice-match.test.ts` and `tests/unit/voice-quantity.test.ts` (core cases; the long test set is T030): `classifyMatch` gives matched only for exactly one exact candidate, choose one for several exact or any near candidate, unknown for none; `normaliseQuantity` accepts whole numbers 1 to 100,000 and flags the rest with the right flag without rounding; `normaliseUnit` keeps the spoken unit and falls back to the medicine's unit with `unit_not_heard`.
- [x] T018 [P] [US1] `tests/unit/voice-preview-state.test.ts` (core): the reducer builds a preview from a parse result; "can create" is false without a store, with any choose-one line not yet chosen, with a doubtful quantity, or with no line, and true for matched, chosen and typed lines with valid quantities; ids for the order, the request and every line are made once when the preview opens.
- [x] T019 [P] [US1] `tests/integration/db-voice-order.pglite.test.ts`: creating through `order_save` with `p_source = 'voice'` and spoken text makes one Draft order with the lines, the number, the `created` event, `source = 'voice'` and the spoken text; repeating with the same ids replays (one order, one set of lines); a later save of the same order with another source or text ignores both; `voice` without text and `manual` with text are refused before anything is written; typed lines keep the exact name; the old call form still creates a manual order with no spoken text; 200 lines pass and 201 are refused; a medicine of another business or an inactive one is refused with nothing created partly; a voice draft is then an ordinary order in every later step: it can be edited while a draft, confirmed through `order_confirm` (the price snapshots are taken exactly as for a manual order), cancelled, and a confirmed voice order accepts an invoice draft through the existing invoice helpers (the invoice functions and screens are unchanged).
- [x] T020 [P] [US1] `tests/integration/voice-api.test.ts` (Supabase TEST project, two real users; needs T014), part 1: the match functions return only the caller's active medicines and stores; creating a voice order through `saveOrder` as a real user works and replays; the answer carries `source` and `spoken_text`; the order does not exist before the call.
- [x] T021 [P] [US1] `tests/e2e/voice-speak.spec.ts` (mobile project, 360 px, fake speech and fake Gemini; needs T014): New order shows the panel; the fake speech engine pushes the example sentence and the words appear in the box; Parse shows the preview with the store and three lines; Create draft order opens the order screen (status Draft, source voice, the Spoken text shown read-only, the lines as checked) and nothing is confirmed or priced; the whole path from the transcript to the created draft takes at most 5 taps when nothing is doubtful (SC-001; count the actions); tapping Create twice quickly and reloading leave exactly one order in Order History; blocking the create request once and retrying with the same ids still leaves exactly one order; refreshing the page on the preview restores the transcript and the preview in the same tab and creates nothing (User Story 1 acceptance 4); the voice draft is confirmed through the normal Confirm and shows the same totals and snapshots as a manual order.

### Implementation for User Story 1

- [x] T022 [US1] Pure logic: `src/lib/voice/quantity.ts` (`normaliseQuantity`, `normaliseUnit`, reusing `LIMITS` and `cleanTypedName`), `src/lib/voice/match.ts` (`classifyMatch`, `buildPreview` that turns a `RawParse` and the candidate rows into the contract `Preview`, with the flags and `more_than_one_store`), `src/lib/voice/preview-state.ts` (the reducer, the "can create" rule with its reason text, the ids made once). No I/O in these files.
- [x] T023 [US1] `src/lib/voice/parser.ts` (the `TextToOrderParser` interface, the answer schema of T016, `getParser(kind)`) and `src/lib/voice/gemini.ts` (`buildGeminiRequest`, `GeminiParser` with the built-in `fetch`, the 15-second `AbortController` limit, the key read from `GEMINI_API_KEY` and the model from `GEMINI_MODEL` only here (the allow-list of T003 makes lint pass for this one file), the optional `GEMINI_API_BASE_URL`, the real-host guard for the test environment, the mapping of upstream results to `ai_busy`, `ai_timeout`, `ai_not_configured`, `ai_unavailable` and `ai_invalid`; no logging of the request, the headers or the answer). Follow the facts verified in T002. Run `npm run lint` after this task.
- [x] T024 [US1] `src/lib/voice/service.ts`: `parseTranscript(supabase, body)` runs the parser, validates, calls the match functions through the repository, and returns the contract `Preview`; the rate limit and the diagnostics are added in T042. It never sends or returns a price.
- [x] T025 [US1] `src/app/api/voice/parse/route.ts` (`POST`, `requireBusinessUser`, `ParseBodySchema` first, `handle()`, `Cache-Control: no-store`; the raw AI answer and any secret are never returned).
- [ ] T026 [US1] `src/lib/voice/speech.ts` (the `SpeechToTextProvider` interface and a `BrowserSpeechProvider` for start, stop, interim and final results; the full error mapping and honest support text are T048) and `src/lib/voice/client.ts` (`postParse`, `createVoiceDraft` that calls the existing order save with `source: "voice"` and the spoken text, using the ids made when the preview opened).
- [x] T027 [US1] Components in `src/components/voice/`: `VoiceOrderPanel.tsx` (the microphone, the transcript box, Parse, a plain sentence that the browser's speech service may process audio), `ListeningBar.tsx` (listening state, a large Stop button, interim words), `VoicePreview.tsx` (the transcript beside the order, the store block, the lines, the Create draft order button with its disabled reason), simple `VoiceLineRow.tsx` and `VoiceStoreBlock.tsx` (matched and typed lines, a chosen store); wire the panel above the store selector in `src/components/orders/NewOrderStart.tsx`. Touch targets at least 44 px; loading, error and empty states; words, not only colours, for every state.
- [x] T028 [US1] Show the read-only "Spoken text" (and the source "Voice") on the order screen for a voice order: `src/components/orders/OrderView.tsx` and `OrderEditor.tsx` (and `OrderListItem.tsx` if the source is shown in History); the text is not editable and never appears on invoices or prints.
- [x] T044 [US1] `src/lib/voice/session.ts`: the transcript and the preview state are copied to `sessionStorage` (one versioned key, inside `try/catch`, cleared on creation, start over or discard) and restored after a refresh in the same tab; the screen never calls this "saved" and says the order does not exist until the draft is created.
- [x] T029 [US1] Run the US1 tests (T015 to T021, and the refresh check of T044) and fix until green; run `npm run lint` and `npm run typecheck`; record the counts in quickstart section 6.

**Checkpoint**: A spoken (or typed) order becomes a created draft with the happy path; MVP.

---

## Phase 4: User Story 2 - Doubtful items are shown, never guessed (Priority: P1)

**Goal**: Matched, choose one (nothing preselected) and unknown for stores and medicines; flagged quantities and units; the draft cannot be created until every doubt is resolved.

**Independent Test**: With a fake parser that returns an exact name, a two-strength name, a misspelling, an unknown name and a bad quantity, each shows the right state and the draft stays blocked until the supplier resolves them.

### Tests for User Story 2 (write first)

- [x] T030 [P] [US2] Extend `tests/unit/voice-match.test.ts` and `tests/unit/voice-quantity.test.ts` to the full test set of at least 30 sentences and names (exact names, two strengths of one brand, different forms, different manufacturers and pack sizes, near spellings, Urdu-script names, an empty catalog, the same medicine twice, store names that are exact, near, several and none, quantities 0, -1, 2.5, 100001 and missing, a spoken unit and a missing unit): no case ever yields a catalog line without the supplier's choice, and matched appears only for exactly one exact candidate.
- [x] T031 [P] [US2] `tests/integration/db-voice-match.pglite.test.ts`: `voice_match_products` returns only active medicines of the caller's business, at most five, exact forms first, `is_exact` true for name, name with strength, name with strength and form, and brand; near spellings come back with a lower score and `is_exact` false; the result has no price, MRP or cost key (scan the JSON keys); another business's medicines never appear with a crafted name; `voice_match_stores` behaves the same for stores.
- [x] T032 [P] [US2] `tests/e2e/voice-preview.spec.ts` (mobile; needs T014): a two-strength name shows Choose one with nothing selected and Create draft order disabled with its reason; choosing one enables it; "None of these, it is a new medicine" makes a typed line (the exact spoken text, "Not registered", "No selling price") and the created order keeps it; a doubtful quantity and a missing unit are flagged and block creation until fixed; the same medicine twice shows a warning and keeps two lines; an unknown store offers Choose a store and Add a store inline (with the duplicate check); a sentence naming two stores shows the warning.
- [x] T033 [P] [US2] `tests/e2e/voice-empty-catalog.spec.ts` (mobile; needs T014): with no medicines every spoken product becomes a typed line and the order can still be created and later registered through the existing Quick Register.

### Implementation for User Story 2

- [x] T034 [US2] Complete `VoiceLineRow.tsx` (the candidate list showing name, strength, dosage form, manufacturer and pack size, none preselected, the "None of these" choice, change the medicine through the existing `MedicineSearch`, edit quantity and unit with the flag text, remove the line) and `VoiceStoreBlock.tsx` (matched, choose one, unknown, choose any store, Add a store inline reusing the store selector and its duplicate check, the more-than-one-store warning), the duplicate-medicine warning, and the exact disabled reason on Create draft order. Keep every rule in `preview-state.ts`, not in the components.
- [x] T035 [US2] Run the US2 tests (T030 to T033) and fix until green; also rerun the US1 tests; `npm run lint`, `npm run typecheck`; record the counts in quickstart section 6.

**Checkpoint**: No doubtful item can become a confirmed catalog line without the supplier's choice.

---

## Phase 5: User Story 3 - A failed voice or AI step never blocks or loses an order (Priority: P1)

**Goal**: Every failure has its own message, keeps the transcript, offers Retry and a fallback (the simple reader, or by hand); the rate limit and the diagnostic log work.

**Independent Test**: With the fake Gemini failing in every way and a missing key, each case shows its own message, keeps the text, and the same order can be completed by the simple reader or by hand.

### Tests for User Story 3 (write first)

- [x] T036 [P] [US3] `tests/unit/voice-rules.test.ts`: at least 30 sentences (clear comma, "and" and "aur" separated sentences with and without a store; sentences with number words, a missing quantity, a missing unit, two numbers in one item, an empty text, only a store, and text that is not an order): at least 90% of the clear sentences read correctly, 100% of unclear parts come back as `unreadable`, and nothing is ever guessed (no medicine, no quantity, no number word).
- [x] T037 [P] [US3] `tests/unit/voice-errors.test.ts`: upstream HTTP 429 gives `ai_busy`, the time limit `ai_timeout`, 401 and 403 and a missing key or model `ai_not_configured`, other upstream errors and a network failure `ai_unavailable`, a schema failure `ai_invalid`; every message is the contract text and none contains the key, the model, the upstream body or a stack.
- [x] T038 [P] [US3] `tests/integration/db-voice-diagnostics.pglite.test.ts`: `voice_diag_add` appends one record and validates the kind, the counts, the length and the message; a second `rate_limited` record within 60 seconds is skipped while other kinds are always written; update and delete are refused for a user; records older than 90 days of the caller's business are removed by the next write and no other business's; `voice_parse_allow` allows 20 and refuses the 21st within a minute with a wait time, allows again after the minute, and keeps businesses apart; two simultaneous calls at the limit never allow more than 20.
- [x] T039 [P] [US3] `tests/e2e/voice-failures.spec.ts` (mobile; needs T014): with the fake Gemini set to 429, slow, invalid JSON, a wrong shape and 401, and with the app's own limit reached, and with the connection cut, each shows its own message with Retry, keeps the transcript, offers "Use the simple reader" and "Take this order by hand", and the same order is completed by the simple reader (also when the app's own AI limit is reached: the simple reader is not counted); "Take this order by hand" opens the manual order for the same store with a dismissible read-only "What you said" box showing the spoken text (T070), which survives a reload in the same tab and is not shown in another tab; a fake answer with an invented item and a price field shows the item (visible against the transcript) and never the price; a double tap on Parse sends one request to the fake Gemini and shows one preview with no doubled lines; the bottom navigation and manual entry keep working in every case.
- [x] T040 [P] [US3] `tests/integration/voice-api.test.ts`, part 2 (Supabase TEST project; needs T014): the 21st AI parse in a minute is refused before any AI call (the fake parser is not called) while the rules parser still answers; each failure writes the right diagnostic kind with counts and no transcript text, key, price or balance; repeated refusals in a minute write one `rate_limited` record; a doubtful but successful parse writes one `low_confidence` record.

### Implementation for User Story 3

- [x] T041 [US3] `src/lib/voice/rules.ts`: `parseWithRules` as in research D8 (pure; the same `RawParse` shape plus `unreadable`), registered as the `rules` parser.
- [x] T042 [US3] Finish `service.ts`: for the AI parser only, call `voice_parse_allow` first (return `rate_limited` before any AI call; the rules parser is never counted or refused by it), parse, record the diagnostic for each failure and for each low-confidence result through `voice_diag_add` (counts and length only; the `rate_limited` throttle is inside the function), and make sure no failure path writes or returns the transcript, the key or an upstream body; `rules` parses also write `rules_unreadable` when parts are unreadable.
- [x] T043 [US3] `src/components/voice/VoiceFailure.tsx` and the panel: the message of each failure code, Retry, "Use the simple reader" (calls the parse route with `parser: "rules"`), "Take this order by hand" (navigates to the manual order for the same store when known and keeps the spoken text readable there, by passing it through the session copy of T044), and the connection-needed message when the request cannot be made.
- [x] T070 [US3] The spoken text on the manual order screen after "Take this order by hand": `src/components/orders/OrderEditor.tsx` (manual orders only) shows a dismissible read-only "What you said" box when the tab's session copy of T044 holds spoken text for it, with a `readSpokenText()` helper in `src/lib/voice/session.ts`; it is not a field of the order, is never saved, is cleared when dismissed or when the tab is closed, and is never shown on another order or in another tab. Tested in T039.
- [x] T045 [US3] Run the US3 tests (T036 to T040) and fix until green; rerun earlier stories' tests; `npm run lint`, `npm run typecheck`; record the counts in quickstart section 6.

**Checkpoint**: No failure blocks or loses an order; the paid key is protected by the limit.

---

## Phase 6: User Story 4 - Choose the spoken language and learn honestly what works (Priority: P2)

**Goal**: English or Urdu, remembered; an honest message and a working typed box where the browser cannot listen; named reasons for every listening failure.

**Independent Test**: Change the language, reload, see it remembered; open the screen in a browser without speech recognition and see the message and the typed box; use the typed box to create a draft.

### Tests for User Story 4 (write first)

- [x] T046 [P] [US4] `tests/unit/voice-language.test.ts` and `tests/unit/voice-speech.test.ts`: the language preference reads and writes `localStorage` inside `try/catch` and falls back to English when storage throws or holds junk; support detection finds `SpeechRecognition` and the prefixed one and reports unsupported otherwise; every browser error name maps to its plain message (permission refused, service not allowed, nothing heard, no microphone, no connection, language not supported, stopped).
- [x] T047 [P] [US4] `tests/e2e/voice-language.spec.ts` and `tests/e2e/voice-unsupported.spec.ts` (mobile; needs T014): the language choice survives a reload and the fake engine receives `en-PK` or `ur-PK`; without the speech API the panel says this browser cannot listen, suggests the keyboard microphone or typing, and the typed transcript box creates a draft; the fake engine's permission refusal, nothing-heard and network errors each show their own message with Retry and typing; the listening state shows a large Stop button and the interim words; no audio is kept (the fake engine asserts it was never asked for a recording).

### Implementation for User Story 4

- [x] T048 [US4] `src/lib/voice/language.ts` and the completed `src/lib/voice/speech.ts` (support detection, the full error mapping from T046, interim and final handling, and the English retry with `en-US` when the browser answers `language-not-supported`, with a note on screen), and the panel: the language choice next to the microphone, the one-sentence honesty note (the browser's speech service may process audio and needs a connection; mixed languages are not promised), the unsupported message with the typed box, and the listening and error states. All strings are English.
- [x] T049 [US4] Run the US4 tests (T046 and T047) and fix until green; `npm run lint`, `npm run typecheck`; record the counts in quickstart section 6.

**Checkpoint**: Voice is honest about what the phone can do and always has a way forward.

---

## Phase 7: User Story 5 - Nothing sensitive leaves the supplier's control (Priority: P2)

**Goal**: Only the transcript goes to the AI; the key never reaches the browser; the owner can read a diagnostic log without secrets; businesses are isolated.

**Independent Test**: Assert the captured request body, search every response and the built bundle for the key sentinel, read the diagnostic log after failures, and try another business's data with crafted ids.

### Tests for User Story 5 (write first)

- [x] T050 [P] [US5] `tests/integration/db-voice-rls.pglite.test.ts` and `tests/integration/rls-voice.test.ts` (PGlite and the Supabase TEST project with two real users; needs T014): for every voice function and for the changed `order_save`, business B can never read, add or list business A's diagnostics, attempts, medicines, stores or orders with crafted ids; a request for A's id gets exactly the answer of a missing id and changes nothing; direct reads of `voice_diagnostics` return only the caller's rows and direct writes (insert, update, delete) are refused; `voice_parse_attempts` cannot be read or written directly; the same order id used by two businesses stays separate.
- [x] T051 [P] [US5] `tests/e2e/voice-secrets.spec.ts` (mobile; needs T014): the fake Gemini records the body of every request and the test asserts it holds only the instruction and the transcript (no catalog name, store name, price or balance seeded in the test business appears); the key sentinel is absent from every browser response and page text of a parse, a failure and a create, and from the built `.next/static` files (read from disk); a wrong key (the fake answers 401) shows the safe message without the key.
- [x] T052 [P] [US5] `tests/e2e/voice-diagnostics.spec.ts` (mobile; needs T014): Settings has a Voice diagnostics link; the list shows the records newest first with kind, time and counts and no text of what was said; an empty business shows the empty state; a failing request shows an error with Retry and never the empty state; a second business sees none of the first's records.

### Implementation for User Story 5

- [x] T053 [US5] `src/app/api/voice/diagnostics/route.ts` (`GET`, validated query, `no-store`), `src/app/(app)/settings/voice-diagnostics/page.tsx`, `src/components/voice/VoiceDiagnosticsScreen.tsx` (read only, paging, loading, error with Retry, empty state naming the next step) and the link on the Settings screen (`src/components/settings/`); no export, edit or delete control.
- [x] T054 [US5] Run the US5 tests (T050 to T052) and fix until green; `npm run lint`, `npm run typecheck`; record the counts in quickstart section 6.

**Checkpoint**: The AI boundary is proven, not just promised.

---

## Phase 8: User Story 6 - Correct anything, then parse again (Priority: P2)

**Goal**: A working preview: change, add, remove, edit the transcript and parse again with the supplier's corrections kept or discarded by their choice.

**Independent Test**: Change a line's medicine, quantity and unit, remove a line, add one by search, edit the transcript and parse again, and see the corrections kept or an explicit choice offered.

### Tests for User Story 6 (write first)

- [x] T055 [P] [US6] Extend `tests/unit/voice-preview-state.test.ts`: editing a quantity, unit or medicine choice, removing a line and adding a catalog or typed line update the preview with no AI call and respect the 200-line limit; "Parse again" with keep corrections keeps every touched line and replaces untouched lines, dropping a new line whose normalised spoken name equals a kept line's; start over clears the transcript, the preview and the session copy and creates nothing.
- [x] T056 [P] [US6] `tests/e2e/voice-correct.spec.ts` (mobile; needs T014): the corrections above through the screen; the keep-or-start-over dialog; a 200-line preview refuses a further line and says the limit; Start over and Discard ask for confirmation and leave no order.

### Implementation for User Story 6

- [x] T057 [US6] `src/components/voice/KeepCorrectionsDialog.tsx`, add a catalog line by the existing medicine search and add a typed line from the preview, remove a line, edit the transcript and Parse again, Start over and Discard with confirmation; all rules stay in `preview-state.ts`.
- [x] T058 [US6] Run the US6 tests (T055 and T056) and fix until green; `npm run lint`, `npm run typecheck`; record the counts in quickstart section 6.

**Checkpoint**: All six stories work; voice is faster than typing and never guesses.

---

## Phase 9: Polish and Cross-Cutting Concerns

**Purpose**: Concurrency, scale, layout, honesty sweep and verification. T059 to T062 can run in parallel.

- [x] T059 [P] `tests/integration/voice-concurrency.test.ts` (Supabase TEST project, separate connections; needs T014): 10 simultaneous creates of one voice order (same ids) give one order, one set of lines and one number; 10 different orders created at once get 10 distinct numbers with no gap; a create repeated after a dropped connection (same ids) gives the stored order and no second one; a medicine deactivated between the preview and the create is refused with the line named and no order is created partly; 25 simultaneous AI parse-limit checks allow at most 20 (the fake parser is called at most 20 times) while simultaneous simple-reader parses all answer.
- [x] T060 [P] `tests/integration/voice-scale.test.ts` (Supabase TEST project; needs T014): seed (with the secret key from `.env.test.local` in the test only, never in `src/`) 5,000 medicines and 100 stores, then measure matching a 200-item parse result through the real match functions and the creation of a 200-line voice draft, five runs each, and print the maximum in `afterAll`. Goals: the preview within 2 seconds of the answer and the creation within 2 seconds (SC-009). If a query is slow, find the cause with `explain` and fix it in a new migration `0010_voice_perf.sql`; do not loosen a goal.
- [x] T061 [P] Update `tests/e2e/touch-targets.spec.ts`, `tests/e2e/states.spec.ts` and `tests/e2e/shell.spec.ts` so every new screen and dialog (New order with the microphone and the transcript box, the preview with a choose-one line, an unknown line and each dialog, the failure messages, Voice diagnostics) is checked at 360 px: reachable through visible navigation, every interactive control at least 44 x 44 px, no sideways scroll, and a loading, error with Retry and empty state where a list exists; the bottom navigation still has five items.
- [x] T062 [P] Update `README.md` with the Voice module: what works (microphone and language, transcript, Gemini on the server, the preview and corrections, matching rules, the simple reader and manual fallback, the diagnostic log, the rate limit) and what does not (offline voice, a cloud speech provider, audio storage, voice commands, any change to prices or invoices), how the owner sets `GEMINI_API_KEY` and `GEMINI_MODEL` (never in chat or a committed file), and that automated tests never call the real service.
- [x] T063 Security and honesty sweep: search `src/` for `GEMINI_API_KEY`, `GEMINI_MODEL` and `GEMINI_API_BASE_URL` (only in `src/lib/voice/gemini.ts`; confirm the allow-list in `scripts/check-secrets.mjs` names only that file), `NEXT_PUBLIC_` names containing GEMINI (none), `purchase_price`, `mrp`, `cost`, `margin`, `profit`, `price` and `balance` in voice code (none read, sent, returned or rendered), `localStorage` and `sessionStorage` use (only the language preference and the unsent preview copy, always in `try/catch`), audio recording or upload (none), "saved", "synced", "offline" and "pending sync" wording near voice (none that is untrue), `any` types, ignored errors, any control that auto-selects a candidate or auto-confirms an order, any invented medicine, quantity, unit, store or price, and any claim of offline or universal speech support; fix what is found and list what was checked in quickstart section 6.
- [x] T064 [P] AI boundary and order-writer review (Principles IV and VI): confirm in code and tests that `buildGeminiRequest` is the only place a request body is made and holds only the instruction and the transcript; that matching is decided only by `classifyMatch`; that the draft is created only by the supplier's tap and never confirmed, priced or invoiced; that `order_save`'s new body differs from 0003 only in the three listed changes (show the diff) and that every Module 003 to 007 suite still passes; that the real-host guard is covered by a test; and that Module 003 to 007 behaviour (numbers, snapshots, pending lines, invoices, the ledger) is unchanged. Record the finding in quickstart section 6.
- [x] T065 Full verification, actually run: `npm run lint`, `npm run typecheck`, `npm test` (including every Module 001 to 007 suite, which now runs against the changed `order_save`), `npm run build`, `npm run test:e2e`. Record the real counts and any skips (with reasons) in quickstart section 6; if a test fails once and passes on rerun, say so and investigate, never write "passed" for something that was not run or was flaky. Record the mapping of master prompt Sections 6 and 17 to the tests, and what is not covered (the real Gemini service, a real microphone, offline voice, items of later modules). Run `npm run build` again after the e2e run so `.next` matches the DEV env for the owner.
- [x] T066 Owner step, only after the owner says so: apply `supabase/migrations/0009_voice_orders.sql` (and `0010_voice_perf.sql` if T060 created it) to the **dev project** through the owner's signed-in Supabase tab; read the counts of `orders`, `order_lines`, `order_events`, `stores` and `products` before and after and confirm nothing existing changed (existing orders keep `spoken_text` null and source manual); record in quickstart section 8. The owner puts their paid Gemini key and the model name into `.env.local` themselves.
- [ ] T067 Owner verification on a real phone against the dev project (after T066): the walkthrough in quickstart section 3 (English and Urdu, the preview and corrections, a doubtful medicine, a created draft with its spoken text, airplane mode, a wrong key, the simple reader, Voice diagnostics, the real Gemini answer). Record exactly what the owner reported, as "reported, not seen" unless evidence (a screenshot) was sent, and what was not tried (the phone and browser, anything skipped). **Partly done, still open (2026-11-17, see quickstart section 9):** the owner reported (not seen) that the phone microphone worked but the browser often misheard words; one real server-side Gemini call with a dummy sentence was made by the assistant and succeeded; the preview, draft creation, Urdu, airplane mode, wrong key, simple reader and Voice diagnostics steps were not reported, and the phone model and browser version were not stated.
- [x] T068 Documentation records: update the status line of `history/adr/0008-voice-ai-boundary-and-voice-order-creation.md` to say what was implemented and measured (only with facts; the ADR already exists with the owner's consent, so no new ADR is created unless the owner asks), and create the PHRs for the tasks, analysis and implementation work under `history/prompts/008-voice-order-gemini/` (English only; translate the owner's Roman Urdu messages and mark them "(translated from Roman Urdu)").
- [x] T069 Pull request: update this branch from `master`, rerun lint, typecheck, test and build, push when the owner says, and open the pull request for `008-voice-order-gemini` into `master` with a summary, the real verification results, and the known gaps (the real Gemini and microphone checks are the owner's), only when the owner says. Never merge without the owner's word.

---

## Dependencies and Execution Order

- **Phase 1** first (T001 first; T002 to T005 in parallel). **Phase 2** needs Phase 1: T006 (failing tests) then T007 to T010 in order (same file), then T011; T012 and T013 can run beside the migration; T014 is an owner step and blocks every task marked "needs T014".
- **US1 (T015 to T029)** needs Phase 2 and T014 for its Supabase and browser tests; its unit and PGlite tests (T015 to T019) need only T011 to T013. **US2 (T030 to T035)** needs US1. **US3 (T036 to T043, T045, T070)** needs US1 (the route, the panel and the session copy T044); its unit and PGlite tests need only Phase 2. **US4 (T046 to T049)** needs US1's panel. **US5 (T050 to T054)** needs US1 and the failure paths of US3 for the diagnostic content. **US6 (T055 to T058)** needs US1 and US2.
- **Phase 9** needs the stories it covers; T059 to T062 and T064 are parallel with each other; T063 after the code is complete; T065 after everything; T066 to T069 are owner-gated and last.
- Files shared by several tasks (one at a time): `supabase/migrations/0009_voice_orders.sql` (T007 to T010), `src/lib/voice/service.ts` (T024 then T042), `src/lib/voice/session.ts` (T044 then T070), `src/lib/voice/speech.ts` (T026 then T048), `src/lib/voice/preview-state.ts` (T022 then T034 and T057), `src/components/voice/VoiceLineRow.tsx` and `VoiceStoreBlock.tsx` (T027 then T034), `src/components/voice/VoiceOrderPanel.tsx` (T027, T043, T048), `src/components/orders/OrderEditor.tsx` (T028 then T070), `tests/integration/voice-api.test.ts` (T020 then T040), `tests/unit/voice-match.test.ts` (T017 then T030), `tests/unit/voice-preview-state.test.ts` (T018 then T055).

## Parallel Opportunities

- Setup: T002, T003, T004, T005 together.
- Each story's test tasks can be written in parallel (T015 to T021; T030 to T033; T036 to T040; T046 and T047; T050 to T052; T055 and T056).
- US3 and US4 can proceed at the same time after US1; US5's database tests and the diagnostics screen are independent of US4.
- Polish: T059, T060, T061, T062 and T064 together.

## Implementation Strategy

1. **MVP first**: Phases 1 and 2 and US1 give a working voice draft (matched and typed lines) that can be shown on the TEST project. Stop at T014 and ask the owner to apply the migration to the TEST project.
2. **Safety stories before polish**: US2 and US3 are P1 for a reason (a wrong medicine and a lost order are the two worst outcomes); do them before US4 to US6.
3. **Do not claim anything unrun.** Record real counts only; investigate any intermittent failure; the real Gemini call and the real microphone (T067) are the owner's check and are not skipped; the real service is never called by a test.
4. **Keep the boundary small**: the AI sees only the transcript; one file reads the key; one function builds the request; one function decides matches; one function writes orders.
5. **Use the earlier lessons**: write the read queries so the trigram index is used, measure at 5,000 medicines and 200 lines (T060), copy migration bodies instead of retyping them, run the earlier order suites after touching `order_save`, and fix test expectations only when the test, not the app, is wrong.
