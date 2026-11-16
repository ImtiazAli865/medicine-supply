# Research: Voice Order Entry with Gemini (Module 008)

Decisions that shape the plan. Each has the decision, why, and what else was considered. Nothing here was run yet; items marked **verify** are checked against the current documentation during implementation (a task in `tasks.md`), because the Gemini API and the browser speech API change.

## Facts found in the existing code (they shape the decisions)

- `orders.source` already allows `'manual'` and `'voice'` (migration 0003) and is immutable after creation (`orders_guard`, last redefined in 0007). `order_save` (0003, the only writer of orders) creates every order with the literal `'manual'`, so it must be extended to create a voice order.
- `order_save(p_id, p_request_id, p_expected_version, p_store_id, p_notes, p_lines)` is idempotent on the order id and the request id, creates the order and its lines in one transaction, assigns the number from a counter, writes the `created` event, and refuses invalid lines. Typed lines (`product_id` null, `name` kept) already work. `order_to_json` was last redefined in 0004.
- Medicines have a generated `search_text` (name, brand, generic name, strength, manufacturer, SKU) with a trigram index; stores have one too. `norm_text()` is the shared normalisation. `pg_trgm` is installed in the `extensions` schema.
- The client already has a medicine search dialog (`MedicineSearch`) with a "None of these, it is a new medicine" typed form, and `cleanTypedName`, `parseQuantity` and `LIMITS` in `editor-state.ts`; the store selector and inline "Add new store" exist.
- The API layer has `handle()`, `ApiError` with a code-to-status table, `requireBusinessUser()`, and `readJson()`. Money and unrelated modules are untouched by this module.
- `.env.example` has no Gemini entries; the constitution forbids committing a key and requires placeholders. No Gemini key exists in any env file of the repository.
- The test setup has PGlite (`createTestDb`), Supabase TEST-project helpers (`createTenant`) and Playwright with a production build that talks to the TEST project; the Playwright config passes only two env values to the app today.
- Settings is a page of its own (`/settings`); there is no sixth navigation item and there must not be one.

## D1. Where voice lives: a panel on the New order screen, then the normal order screen

**Decision**: The New order screen (`/orders/new`) gets a "Speak the order" panel above the store selector (microphone, language, transcript box, Parse). Parsing shows the preview on the same page. "Create draft order" makes the draft through the existing order save and then replaces the address with the normal order screen (`/orders/{id}`), so everything after creation is the Module 003 screen unchanged.

**Why**: The spec puts the microphone on the New order screen (FR-001) and says the first step stays "choose a store" with voice as an alternative (Assumptions). No new route, no navigation item (FR-039), and no second order editor to keep in step with the first.

**Considered**: A separate `/orders/voice` page (an extra screen to reach, the microphone would not be "on the New order screen"); creating the draft before the supplier confirms the preview (violates "AI output is never saved without the supplier's confirmation", FR-026).

## D2. The speech side: a provider interface, browser recognition first

**Decision**: A small client interface `SpeechToTextProvider` (`isSupported()`, `start({ lang, onResult, onError, onEnd })`, `stop()`), with `BrowserSpeechProvider` as the only implementation (`window.SpeechRecognition ?? window.webkitSpeechRecognition`). Language codes: English `en-PK`, Urdu `ur-PK`; the choice is stored in `localStorage` under one key (a lightweight preference, allowed by the constitution; never a data backend), read inside `try/catch`. Recognition is continuous with interim results shown, ended by a Stop button; final results are appended to the transcript box. Browser error names are mapped to the plain messages of FR-005 (`not-allowed`, `service-not-allowed`, `no-speech`, `audio-capture`, `network`, `language-not-supported`, `aborted`). Where the API is missing, the panel shows the unsupported message and the transcript box stays fully usable. Audio is never touched by the app, and the screen says in one sentence that the browser's speech service may process it.

**Why**: Meets FR-001 to FR-007 and the constitution (provider interface; honest support; no offline claim). **Verify**: current Chrome Android behaviour for `ur-PK`/`en-PK` and the error names, from the MDN and Chrome documentation, before the messages are final.

**Considered**: A cloud speech provider now (out of scope; the interface makes it a later swap); recording audio and uploading it (violates FR-006).

## D3. The AI side: `TextToOrderParser` with a Gemini implementation using plain `fetch`

**Decision**: `src/lib/voice/` holds `TextToOrderParser` (`parse(transcript, { signal }) -> RawParse`), `GeminiParser` and `RuleParser`. `GeminiParser` calls the Gemini REST API with the built-in `fetch` (no new package): the key in the request header, model from `GEMINI_MODEL`, temperature 0, JSON output with a response schema, and a fixed system instruction. The base address defaults to the Google host and may be overridden by the optional variable `GEMINI_API_BASE_URL`, which the tests use to point the app at a local fake server (D17). A parse has a 15-second time limit (`AbortController`). Upstream results map to the app's codes: HTTP 429 to `ai_busy`; the time limit to `ai_timeout`; HTTP 401 or 403, or a missing key or model, to `ai_not_configured` (the message never names a secret); any other upstream error or network failure to `ai_unavailable`; an answer that fails the schema to `ai_invalid`. **Verify** at implementation: the exact request and response shape (`generateContent`, `systemInstruction`, `generationConfig.responseMimeType`, `responseSchema`, key header name, safety-block responses) against the current Google documentation.

**Why**: Constitution VI (interface, `GEMINI_MODEL`, server only). No package keeps the "no new packages" rule and keeps the surface small. The configurable base address is how the real client code is exercised in tests without ever calling the real service.

**Considered**: The official SDK package (a new dependency, harder to point at a fake); calling Gemini from the browser (never: the key would be exposed).

## D4. What is sent to the AI

**Decision**: The request body holds exactly two things: the fixed instruction text (a constant in code, no data) and the transcript. A function `buildGeminiRequest(transcript)` is the only place that makes the body, and a test captures the real body sent to the fake server and asserts its keys and that it contains no catalog name, store name, price or balance. The instruction asks for digits for quantities, the store name as spoken or null, and the product name as spoken, and tells the model to ignore everything that is not an order.

**Why**: FR-011, SC-004 (the exact request body is asserted).

## D5. Validating the answer: strict structure, doubtful values flagged

**Decision**: A Zod schema accepts `{ store: string | null (at most 200), items: [{ name: string (1 to 200), quantity: number | null, unit: string | null (at most 50) }] (at most 200) }`; unknown fields (such as a price) are dropped (`strip`). Any other shape (not JSON, `items` not an array, a name that is not text, a quantity that is neither a number nor null, more than 200 items) refuses the whole answer as `ai_invalid`; nothing is partly used. A quantity that is a number but is not a whole number from 1 to 100,000 (zero, negative, 2.5, 10^9) passes the schema and is **flagged** at matching time (quantity left empty, "check the quantity"), never rounded. Words for numbers are expected as digits from the model because the instruction says so; a number written as text is a schema violation.

**Why**: Separates "the answer is unusable" (refuse) from "one value is doubtful" (flag), which is how spec FR-012 and FR-020, SC-006 and SC-007 read together.

## D6. Matching: candidates from the database, the decision in application code

**Decision**: Two read functions (SECURITY INVOKER, so Row Level Security applies) return candidates only: `voice_match_products(p_names jsonb)` (up to five active medicines per spoken name, exact forms first, then trigram similarity of the normalised spoken name against `search_text`, with a similarity floor of 0.3) and `voice_match_stores(p_name text)` (the same for active stores). Each candidate row carries `is_exact`, which is true when the normalised spoken text equals the normalised name, the name with strength, the name with strength and form, or the brand. The decision is plain TypeScript, `classifyMatch(candidates)`: exactly one `is_exact` candidate means **matched**; any other non-empty candidate set means **choose one** (nothing preselected); no candidate means **unknown**. A spoken name that fits two strengths or forms is therefore never matched, and a spelling variant is never matched.

**Why**: "Matching is done by application code, never by Gemini" (FR-015) and "never auto-merge different strengths" (FR-018); keeping the retrieval in SQL uses the existing trigram indexes (5,000 medicines within the 2-second goal, SC-009) while the rule that matters stays in one tested TypeScript function that is easy to read and review.

**Considered**: Loading the whole catalog into the server and matching in memory (1 MB or more per parse); letting SQL decide `matched` (the safety rule would be buried in a query).

## D7. Quantity and unit rules in one place

**Decision**: `normaliseQuantity(raw)` returns a whole number from 1 to 100,000 or a flag (`missing`, `not_whole`, `too_small`, `too_large`); no rounding. `normaliseUnit(raw, product)` keeps the spoken unit (cleaned of repeated spaces, at most 50 characters); when none was spoken it uses the chosen medicine's own unit with the flag `unit_not_heard`, or an empty unit for an unknown medicine. These reuse `cleanTypedName` and `LIMITS` so the voice lines obey exactly the manual-order limits.

## D8. The rule-based parser (the degraded fallback)

**Decision**: A pure function `parseWithRules(transcript)` for the clear form `store name [:|,|-] item, item and item` where an item is `name quantity unit` (quantity as digits, unit as one or two words from the text). It splits on commas, semicolons, the words `and`, `aur` and line breaks, reads a trailing integer and the following word as quantity and unit, and returns everything it cannot read as `unreadable` parts. It never reads number words, never guesses a medicine, never invents a quantity or unit. Its output has the same shape as the AI's, so the same matching and preview follow.

**Why**: FR-033 and SC-011. It is a safety net for clear sentences, not a second AI.

## D9. The preview model and the "Create draft order" rule

**Decision**: A client reducer owns the preview: `{ transcript, storeResolution, lines[] }`, where a line is `{ key, spoken, state: matched | choose_one | unknown | typed | catalog, candidates[], productId?, typedName?, quantity, unit, flags[], touched }`. "Create draft order" is enabled only when a store is chosen and every line is `matched`-or-chosen (`catalog`), `typed` (the supplier accepted "None of these", or the unknown line is accepted as typed), has a valid whole quantity and a non-empty unit-or-flagged-unit, and there is at least one line. Unknown lines become `typed` without a separate step (they are pending lines by design), but a typed line from a **choose-one** line needs the supplier's explicit "None of these" choice. "Parse again" asks keep-or-start-over: keep means touched lines stay as they are and untouched lines are replaced by the new parse, dropping a new line whose normalised spoken name equals a kept line's.

**Why**: FR-023 to FR-025; keeps all the safety logic in a pure, unit-testable module.

## D10. Keeping the work safe in the browser tab

**Decision**: The transcript and the preview state are written to `sessionStorage` (one key, versioned, inside `try/catch`, cleared on creation, start over or discard) so a refresh in the same tab restores them. This is a per-tab convenience, not storage of an order: the screen never says "saved" and the text on screen says the order does not exist until the draft is created.

**Why**: FR-030 and "never lose what was said". `sessionStorage` (unlike a synced store) cannot be mistaken for an offline queue; offline order taking stays Module 009.

## D11. Creating the draft: the existing save, extended

**Decision**: The client makes the order id, the request id and every line id when the preview opens (once), and on "Create draft order" calls the existing orders API with `source: "voice"` and `spoken_text`. The database function creates the order, lines, number and `created` event in one transaction, exactly as for a manual order, and replays on the same ids, so ten simultaneous taps create one order (SC-005). Catalog lines send `product_id`; typed lines send the exact spoken name. After success the client navigates to the normal order screen and clears the session copy.

## D12. Migration `0009_voice_orders.sql`: the only database change to earlier objects

**Decision**: (1) `orders.spoken_text text null` with a check (null, or 1 to 2,000 characters and `source = 'voice'`), included in `order_to_json` and made immutable in `orders_guard`; (2) `order_save` gets two trailing parameters, `p_source text default 'manual'` and `p_spoken_text text default null`, used only when the order is created (ignored on later saves); the old six-argument function is dropped in the same migration so the call stays unambiguous, and the body is the 0003 body with exactly three changes (the validation of the two new values, the `source` in the insert, the `spoken_text` in the insert). Grants are re-issued for the new signature. (3) The new tables and functions of D13 to D15.

**Why**: One writer of orders, one set of validations, nothing duplicated. Tests prove that every Module 003 and 004 suite still passes against the changed function and that the old call form still works through the defaults.

**Considered**: A separate `order_create_voice` function (a second order writer with its own copy of the validations); relaxing the `source` immutability (weakens a guard for no gain).

## D13. The diagnostic log

**Decision**: Table `voice_diagnostics` (id, business, created_at, kind, parser, item_count, doubtful_count, unreadable_count, transcript_length, message), append-only (update and delete refused by a trigger, like the order events), select-only Row Level Security, written only by the function `voice_diag_add(...)` (SECURITY DEFINER) that the server route calls with the user's session, read by `voice_diag_list(p_limit, p_offset)`. Kinds: `ai_busy`, `ai_timeout`, `ai_invalid`, `ai_not_configured`, `ai_unavailable`, `rate_limited`, `rules_unreadable`, `low_confidence`. A record is written for each failed parse and for each successful parse that has at least one doubtful item or unreadable part (one record per parse). It never holds the key, the transcript, a price or a balance; only its length. A refusal caused by the app's own limit (`rate_limited`) is recorded at most once per minute per business, so a loop cannot flood the log. The write functions can also be called by the signed-in owner directly (it is their own data): at worst they fill their own log or use their own quota. Records older than 90 days are removed by the function that writes (service role is not needed: the function deletes only the caller's own business rows older than 90 days).

**Why**: FR-035, FR-036. Append-only matches the project's history tables; the 90-day prune keeps a solo business's log small.

## D14. The parse rate limit

**Decision**: Table `voice_parse_attempts` (business_id, at) with RLS on and no user policy, and `voice_parse_allow()` (SECURITY DEFINER) that takes a per-business advisory lock, counts attempts in the last 60 seconds, refuses at 20 (returning the seconds to wait), otherwise records one attempt, and deletes attempts older than one hour. The server route calls it first **only for the AI parser** and returns `rate_limited` (HTTP 429) before any AI call; the rule-based parser makes no AI call, is never counted and is never refused by this limit, so "Use the simple reader" is always there as the fallback.

**Why**: FR-014 and SC-012. The count must survive several server instances, so it lives in the database, not in memory.

## D15. Errors and messages

**Decision**: New error codes in the existing taxonomy: `rate_limited` (429), `ai_busy` (503), `ai_timeout` (504), `ai_invalid` (502), `ai_unavailable` (502), `ai_not_configured` (503), with the fixed plain-English messages of the contract. Validation problems (empty transcript, over 2,000 characters) use the existing `validation_error`. No message includes the key, the model name, the upstream body or a stack.

## D16. Settings: Voice diagnostics

**Decision**: A read-only page `/settings/voice-diagnostics` (a link on the Settings screen) lists the owner's recent records, newest first, with paging, loading, error with Retry and an empty state. No export, no edit, no delete.

## D17. Test strategy and the "never call the real API" guarantee

**Decision**: Unit tests (Vitest): schema, `classifyMatch`, quantity and unit rules, the rule parser (at least 30 sentences), the preview reducer, the request builder (asserts the body), error mapping, the language preference. PGlite tests: the new migration (voice order creation, `spoken_text` rules and immutability, the unchanged manual path, `voice_match_*`, diagnostics append-only and isolation, the rate limit). Supabase TEST tests: the voice API with a fake parser behind the route (ten simultaneous creates of one id give one order, isolation of two businesses, the key never in a response). Playwright (mobile): a fake `SpeechRecognition` installed with `addInitScript`, and a small fake Gemini HTTP server started beside the app by the Playwright config (the app gets `GEMINI_API_BASE_URL` pointing to it, a placeholder key and a placeholder model), serving scripted answers: success, doubtful items, 429, timeout, invalid, no key. A guard in `GeminiParser` refuses to run in the test environment (`NODE_ENV=test` or the test variable) when the base address is the real Google host, so no test can reach the real service by mistake. The key sentinel (a recognisable fake) is searched for in every browser response and the built bundle. The real call is checked once manually by the owner (quickstart section 3).

## D18. Where the secrets are read

**Decision**: `GEMINI_API_KEY` and `GEMINI_MODEL` are read only in `src/lib/voice/gemini.ts`, which is imported only by the parse route; no `NEXT_PUBLIC_` name is used; `.env.example` gets placeholders and one comment line. The bundle test (D17) is the proof. Nothing logs the request, the response or the headers. **Lint guard**: `scripts/check-secrets.mjs` currently fails the build if any file under `src/` mentions `GEMINI_API_KEY`; it is changed to allow exactly one file, `src/lib/voice/gemini.ts`, and a unit test proves that the guard passes for that file and fails for any other file that mentions the name.

## D19. Things deliberately not built

Offline voice or offline drafts (Module 009); a cloud speech provider; audio storage; voice commands other than taking an order; automatic splitting into several orders; any change to invoices, prices or the ledger; a second AI provider; reading number words in the rule parser; a settings screen for the key (the owner puts it in the environment).

## Risks to revisit

1. Browser speech recognition differs by phone and may send audio to a remote service; the app says so and keeps the typed box. Urdu-script text may match few catalog names; those lines become typed lines the supplier can fix.
2. The model can invent an item or merge two; the preview shows the transcript beside the lines and a created order is only a draft, but a supplier who confirms without reading is the residual risk. The "parts of the transcript not used" highlight is the mitigation.
3. Copying the `order_save` body into 0009 risks drift; the three-change rule and the unchanged Module 003 suites are the guard, and the diff is reviewed in T-tasks.
4. The Gemini API shape and the model name change over time; the model is configuration and the request builder is isolated in one file with a documentation check task.
5. Cost: the per-minute limit protects the paid key from loops but not from heavy legitimate use; a daily cap can be added later from the diagnostic and attempts tables.
