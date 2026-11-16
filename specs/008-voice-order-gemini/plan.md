# Implementation Plan: Voice Order Entry with Gemini (Module 008)

**Branch**: `008-voice-order-gemini` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-voice-order-gemini/spec.md`

## Summary

Module 008 lets the supplier take an order by voice. The browser's built-in speech recognition turns speech into an editable transcript; a server route asks Gemini to turn only that text into a draft list (store as spoken, items with name, quantity and unit); application code, not the AI, matches the store and the medicines; the supplier reviews and corrects an order preview and only then creates a normal draft order whose source is voice. Every failure keeps what was said and leaves manual entry open.

Approach (details and rationale in [research.md](research.md)):

- **A panel on the New order screen** (microphone, language, transcript, Parse, then the preview) and the normal Module 003 order screen after creation; no new navigation item (D1).
- **Two replaceable interfaces**: a client `SpeechToTextProvider` (browser recognition first, `en-PK` and `ur-PK`, honest support detection) and a server `TextToOrderParser` (Gemini through the built-in `fetch`, plus a pure rule-based fallback). The model comes from `GEMINI_MODEL`, the key from `GEMINI_API_KEY`; both are read only in one server file (D2, D3, D8, D18).
- **Only the transcript is sent**: one function builds the request (fixed instruction plus transcript); a test asserts the exact body (D4).
- **Strict validation, doubtful values flagged**: a Zod schema refuses a wrong structure as a whole and drops extra fields; a numeric but doubtful quantity is flagged and never rounded (D5, D7).
- **Matching = facts from SQL, decision in TypeScript**: two read functions return up to five active candidates each (using the existing trigram indexes); `classifyMatch` says matched only for exactly one exact candidate, otherwise choose one or unknown (D6).
- **A pure preview reducer** decides what is doubtful and when "Create draft order" is enabled; the preview lives in the tab's `sessionStorage` and is never called saved (D9, D10).
- **Creation uses the existing, idempotent `order_save`**, extended with `p_source` and `p_spoken_text` (used only when creating), so there is still one writer of orders (D11, D12).
- **Database (migration `0009_voice_orders.sql`)**: `orders.spoken_text`, the extended `order_save`, `order_to_json` and `orders_guard`, an append-only `voice_diagnostics` log with a read function, a per-minute rate limit table and function, and the two match functions (D12 to D14).
- **Honest tests**: fakes for speech and for a local Gemini server; a guard that no test can reach the real service; the key sentinel searched in responses and the bundle (D17).
- **The lint secrets guard** (`scripts/check-secrets.mjs`) forbids the name `GEMINI_API_KEY` anywhere under `src/`; it gets a one-file allow-list (`src/lib/voice/gemini.ts`) and a test, so the key stays in exactly one place and lint still catches every other use (D18).
- **The per-minute limit counts AI parses only**; the simple reader is never limited, so the fallback is always there (D14).
- **No new packages and no sixth navigation item**; Settings gets a read-only "Voice diagnostics" page (D16).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24 (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2, Zod 4, lucide-react). **No new packages**: Gemini is called with the built-in `fetch`; speech uses the browser API; matching uses PostgreSQL's existing `pg_trgm`.
**Storage**: Supabase PostgreSQL. New migration `supabase/migrations/0009_voice_orders.sql`: one new nullable column on `orders`, replaced `order_to_json`, `orders_guard` and `order_save`, tables `voice_diagnostics` and `voice_parse_attempts`, and the functions `voice_parse_allow`, `voice_diag_add`, `voice_diag_list`, `voice_match_products`, `voice_match_stores`. Browser: `localStorage` for the language preference only; `sessionStorage` for the unsent transcript and preview (a per-tab convenience, never an order store).
**Testing**: Vitest (unit: schema, request builder, matching decision, quantity and unit rules, rule parser with 30+ sentences, preview reducer, error mapping, language preference), PGlite (real PostgreSQL: the extended order creation and its guards, the unchanged manual path and every Module 003 and 004 order suite, match functions, diagnostics, rate limit, isolation), Supabase TEST project (voice API with a fake parser behind the route, 10 simultaneous creates, two-user isolation, key never in a response, scale), Playwright mobile at 360 px (fake `SpeechRecognition`, a local fake Gemini server, every failure mode, touch targets, states, shell). Real Gemini and a real microphone are checked once by the owner (quickstart section 3).
**Target Platform**: Android mobile browsers first (Chrome); responsive to tablet and desktop. Speech recognition needs a browser that has it; the app says so when it does not.
**Project Type**: Web application (same single Next.js project)
**Performance Goals**: A 200-item transcript matched against 5,000 medicines gives the preview within 2 seconds of the AI answer arriving; creating the draft within 2 seconds (SC-009). The AI's own time is bounded by a 15-second limit and shown honestly as "working".
**Constraints**: Transcript at most 2,000 characters; at most 200 lines (the order limit); quantity a whole number from 1 to 100,000; unit at most 50 characters; at most 20 AI parses per business per minute; spoken text at most 2,000 characters and read-only; the diagnostic log keeps counts, never the text, the key, a price or a balance; no audio is recorded or stored; no price, MRP, cost, balance or invoice data is sent to the AI or returned by any voice route.
**Scale/Scope**: 1 business / 1 owner; tens of voice orders per week. New screens: the voice panel and preview on New order (with dialogs for choosing a medicine, adding a store and the keep-or-start-over choice) and Voice diagnostics. Changed screens: New order (panel), the order screen (read-only spoken text), Settings (link).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes: real speech capture, a real parse call, a real draft order | PASS: every control does real work; success is shown only after the server confirms; the fakes exist only in tests; no feature is claimed that is not built (no offline voice, no audio storage); the real call is checked once by the owner and recorded as "reported, not seen" unless evidenced |
| II. Billing integrity and price snapshots | Touches orders only | PASS: the draft is created without prices, snapshots or invoices; confirming stays the normal Module 003 step; no price, MRP or cost reaches the AI or any voice response; invoices, prices and the ledger are untouched (SC-014) |
| III. Append-only ledger | No | PASS (n/a); no balance is read or sent anywhere |
| IV. Medicine identification and order safety (core) | Yes | PASS: matched only for exactly one exact candidate; different strengths, forms, manufacturers and pack sizes are always choose one; unknown names become typed pending lines with the exact spoken text; nothing is auto-selected or substituted; the same medicine twice stays two lines; an order is never lost on any failure; typed lines never block confirming |
| V. Security, RLS and secrets | Yes: two new tables, six functions, one key | PASS: Row Level Security on both tables, select-only policy on the log, no write grants; every function filters on the business; the match functions run as the caller; `GEMINI_API_KEY` exists only in one server file and a placeholder in `.env.example`; a bundle and response search proves it; crafted-id tests on PGlite and with two real users |
| VI. Server-side AI with human confirmation (core) | Yes: this module is the principle | PASS: Gemini only from a server route behind `TextToOrderParser`; model from `GEMINI_MODEL`; only the transcript is sent (the body is asserted); the answer is schema-validated and a wrong shape is refused whole; application code matches; the supplier confirms the transcript and the preview before any order exists; failures, 429s and timeouts never block order taking; failures and low-confidence results go to a diagnostic log without secrets; tests use a fake and a guard stops any test from reaching the real host; no offline recognition is claimed |
| VII. Offline-first with honest sync | Partly: the constitution wants order taking to work offline | PASS with the same tracked deferral as Modules 003 to 007: voice and creating a draft need a connection here; the screen says so; the tab copy of the transcript is not called saved or synchronised; offline order taking and sync are Module 009 |
| VIII. Mobile-first, verifiable delivery | Yes: a new panel, a preview and a page | PASS: Playwright at 360 px with the touch-target check on the panel, the preview and every dialog; loading, error with Retry and empty states; no sixth navigation item; real results recorded in the quickstart, nothing claimed unrun |

**Post-design re-check (after Phase 1)**: All gates still PASS. Risks recorded to revisit: (1) copying the `order_save` body into migration 0009 could drift from the 0003 behaviour, so the diff is limited to three changes and every earlier order suite runs against it; (2) browser speech recognition and the Gemini API differ by phone and over time, so the first implementation tasks check the current documentation and the messages are written from what is verified; (3) a supplier who confirms an order without reading it is not prevented by software, only made unlikely by the transcript beside the lines and the highlighted unused parts; (4) the per-minute limit guards the paid key from loops, not from heavy legitimate use.

## Project Structure

### Documentation (this feature)

```text
specs/008-voice-order-gemini/
├── plan.md              # This file
├── research.md          # Phase 0: decisions D1 to D19 and risks
├── data-model.md        # Phase 1: orders.spoken_text, order_save, the two tables, the functions
├── quickstart.md        # Phase 1: how to run and verify, the owner's phone walkthrough
├── contracts/
│   └── api.openapi.yaml # Phase 1: parse, diagnostics, the extended order save
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items pass)
└── tasks.md             # Phase 2 (/sp.tasks, not created here)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0009_voice_orders.sql              # orders.spoken_text; order_to_json, orders_guard, order_save replaced;
                                       # voice_diagnostics, voice_parse_attempts; voice_* functions; grants; rollback notes

src/lib/voice/
├── types.ts                           # RawParse, Preview, PreviewLine, Candidate, flags, DiagnosticRecord
├── speech.ts                          # SpeechToTextProvider interface, BrowserSpeechProvider, support detection, error mapping
├── language.ts                        # English/Urdu choice and its localStorage preference (try/catch)
├── parser.ts                          # TextToOrderParser interface, RawParse schema (Zod), parser selection
├── gemini.ts                          # GeminiParser, buildGeminiRequest, time limit, status mapping, real-host test guard
├── rules.ts                           # parseWithRules (pure)
├── quantity.ts                        # normaliseQuantity, normaliseUnit (pure)
├── match.ts                           # classifyMatch, buildPreview (pure; takes candidates from the database)
├── repository.ts                      # calls voice_parse_allow, voice_match_*, voice_diag_add, voice_diag_list
├── service.ts                         # parseTranscript(): limit, parse, validate, match, diagnostics (the route's logic)
├── preview-state.ts                   # reducer, "can create" rule, keep-or-start-over merge (pure)
├── session.ts                         # sessionStorage copy of the transcript and preview (try/catch)
└── client.ts                          # postParse(), createVoiceDraft() (uses the order save), diagnostics fetch

src/lib/validation/voice.ts            # ParseBody, DiagnosticsQuery
src/lib/validation/order.ts            # OrderSaveSchema gains source and spoken_text (create only)
src/lib/orders/repository.ts           # saveOrder passes p_source and p_spoken_text
src/lib/orders/types.ts                # Order gets spoken_text
src/lib/api/errors.ts                  # codes rate_limited, ai_busy, ai_timeout, ai_invalid, ai_unavailable, ai_not_configured

src/app/api/voice/
├── parse/route.ts                     # POST
└── diagnostics/route.ts               # GET
src/app/(app)/settings/voice-diagnostics/page.tsx

src/components/voice/
├── VoiceOrderPanel.tsx                # microphone, language, transcript box, Parse, simple reader, take by hand
├── ListeningBar.tsx                   # listening state, Stop, interim words
├── VoicePreview.tsx                   # transcript beside the order, store, lines, unused parts, Create draft order
├── VoiceStoreBlock.tsx                # store resolution: matched, choose one, unknown, add a store
├── VoiceLineRow.tsx                   # one line: state, candidates, quantity, unit, flags, remove
├── VoiceFailure.tsx                   # the message of each failure with Retry and the fallbacks
├── KeepCorrectionsDialog.tsx          # keep my corrections or start over
├── VoiceDiagnosticsScreen.tsx         # read-only list with paging and states
src/components/orders/NewOrderStart.tsx    # gains the panel above the store selector
src/components/orders/OrderView.tsx / OrderEditor.tsx   # read-only "Spoken text" for a voice order
src/components/settings/SettingsForm.tsx   # link to Voice diagnostics (or the Settings page)

.env.example                           # GEMINI_API_KEY=, GEMINI_MODEL=, GEMINI_API_BASE_URL= (placeholders and comments only)
scripts/check-secrets.mjs              # allow-list: GEMINI_API_KEY may appear only in src/lib/voice/gemini.ts
tests/unit/check-secrets.test.ts       # the guard allows that one file and fails on any other use

tests/
├── unit/voice-*.test.ts               # schema, request, match, quantity/unit, rules (30+ sentences), preview state, errors, language
├── helpers/voice.ts, voice-db.ts      # builders, a fake parser, a fake Gemini server, a fake SpeechRecognition
├── integration/db-voice-*.pglite.test.ts   # order, match, diagnostics, rate limit, rls
├── integration/voice-api.test.ts, voice-concurrency.test.ts, rls-voice.test.ts, voice-scale.test.ts   # Supabase TEST project
└── e2e/voice-*.spec.ts, support/fake-gemini.mjs   # speak, preview, create, failures, unsupported, secrets, diagnostics, empty catalog
playwright.config.ts                   # starts the fake Gemini server; passes GEMINI_* test values to the app
```

**Structure Decision**: The same single Next.js project and the same layout as earlier modules: pure logic and the two interfaces in `src/lib/voice`, thin route handlers, components in `src/components/voice`, one migration, tests beside the earlier ones. The matching decision, the preview rules, the rule parser and the quantity rules are pure TypeScript so they can be unit-tested without a browser or a database; the database only supplies candidates and enforces what must hold whatever code runs.

## Complexity Tracking

No constitution violations. Deliberate limits recorded instead: (1) voice needs a connection (offline is Module 009); (2) the simple reader reads only clear digit-and-comma sentences; (3) Urdu-script names will often become typed lines; (4) one parse limit for everyone, no daily cap; (5) the diagnostic log has no export. The one structural cost is a copy of the `order_save` body in the new migration (three small changes), accepted so that orders keep a single writer and a single set of validations.
