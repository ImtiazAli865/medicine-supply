# ADR-0008: Voice AI Boundary and Voice Order Creation (server-only AI that only reads words, matching by application code, human confirmation, one order writer, a diagnostic log without secrets)

> **Scope**: One decision cluster made in Module 008 (voice order entry with Gemini). The parts were chosen together and would change together: what the AI may see and decide, where it runs, how its answer is validated and matched to the catalog, how a voice order is created, and what is logged. It does not cover offline voice or a cloud speech provider (later modules).

- **Status:** Accepted at the plan stage (the owner asked for this ADR on 2026-11-16). Nothing is implemented yet; the decision is revisited if the implementation or its measurements disagree.
- **Date:** 2026-11-16
- **Feature:** 008-voice-order-gemini
- **Related:** ADR-0003 (the order write model: one idempotent writer, typed lines, snapshots at confirmation; this ADR extends `order_save` and keeps that model), ADR-0004 (pending lines and Quick Register: unknown spoken names become the same typed lines), ADR-0002 (REST handlers over Row Level Security with client-generated ids: the preview and the draft use device-made ids), constitution Principles IV, V and VI.
- **Context:** The master prompt makes voice order taking a core feature, and the constitution (Principle VI) sets the rules around it: Gemini only from the server behind a `TextToOrderParser` interface, the model name from `GEMINI_MODEL`, only the transcript sent, schema-validated output, the AI never chooses the product, store or price, a failed or rate-limited AI call never blocks order taking, failures logged without secrets, and the supplier confirms every transcript and preview before saving. Principle IV adds that different strengths, forms, manufacturers and pack sizes are never merged and that a wrong medicine on an order is the costliest mistake in the system (it flows into purchases, invoices and the khata). The owner has a paid Gemini key, wants English and Urdu speech, and wants a simple fallback when the AI is unavailable. The decisions below meet all of this together.

<!-- Significance checklist: 1) Impact: yes, every later module that reads orders (market list, invoices, reports) inherits whatever a voice order may contain, and the AI boundary cannot be tightened afterwards without breaking the promises already made to the supplier. 2) Alternatives: yes, listed below. 3) Scope: yes, browser, server route, database functions, tests and the environment. -->

## Decision

1. **The AI only reads words.** The server sends Gemini exactly two things: a fixed instruction (a constant in code) and the transcript text. No catalog name, store name, price, MRP, balance, invoice or business detail is ever included, so the AI cannot leak financial data and cannot "know" the catalog. One function builds the request and a test asserts the exact body.
2. **The AI never decides what a word means.** Gemini returns a draft list (store as spoken; items with product name as spoken, quantity, unit). Application code matches. The database only supplies candidate facts (`voice_match_products`, `voice_match_stores`: up to five active records each, with an `is_exact` flag, no price column); one pure TypeScript function, `classifyMatch`, decides: **matched** only when exactly one candidate is an exact name match, otherwise **choose one** (nothing preselected) or **unknown**. A near spelling, two strengths, two forms or two pack sizes are never matched.
3. **The answer is validated, and a wrong shape is refused whole.** A strict schema (extra fields such as a price are dropped; a wrong structure, a non-number quantity, invalid JSON or more than 200 items refuse the whole answer). A numeric but doubtful quantity (zero, negative, fractional, huge) passes and is flagged, never rounded or invented.
4. **Nothing exists until the supplier confirms.** The transcript and the preview live only in the page and in the tab's `sessionStorage` (a per-tab convenience, never called saved). "Create draft order" is disabled while a store, a choice or a quantity is doubtful. It creates a normal **draft** order; confirming, pricing and invoicing remain the existing Module 003 and later steps.
5. **One order writer.** `order_save` gets two trailing parameters, `p_source` (default `manual`) and `p_spoken_text` (default null), used only when the order is created, so a voice order reuses the same idempotency (order id and request id), number counter, line validation, typed lines and `created` event. The old six-argument function is dropped in the same migration. `orders.spoken_text` (at most 2,000 characters, only for source voice, immutable like `source`) keeps what was said, read-only, with the order.
6. **A failed AI never blocks an order.** Each failure (the app's own rate limit, upstream 429, timeout, invalid answer, missing or refused key, no connection, unsupported browser) has its own plain message, keeps the transcript, offers Retry, and offers a fallback: a pure rule-based parser for clear digit-and-comma sentences (it never guesses a medicine, a quantity or a number word) and "take this order by hand".
7. **Diagnostics without secrets, and a spend guard in the database.** `voice_diagnostics` is append-only with select-only Row Level Security and holds the kind, the parser, counts and the transcript length, never the text, the key, a price or a balance; the owner reads it under Settings. A per-business limit of 20 AI parses per minute is counted in `voice_parse_attempts` (so it holds across server instances) and refuses before any AI call; the simple reader is never counted, so the fallback always works, and refusals are logged at most once a minute.
8. **Secrets and tests.** `GEMINI_API_KEY` and `GEMINI_MODEL` are read in one server file used only by the parse route; `.env.example` holds placeholders; no `NEXT_PUBLIC_` name is used. The optional `GEMINI_API_BASE_URL` points the app at a local fake server in tests, and a guard refuses to run in the test environment against the real host. Automated tests use a fake speech engine and a fake Gemini; the real call and the real microphone are checked once by the owner and recorded as "reported, not seen" unless evidenced.

## Consequences

### Positive

- The two worst failure modes are closed by structure: the AI cannot reveal money or catalog data because it never receives them, and it cannot choose a medicine because it never sees the catalog and the matching rule is one small tested function.
- A voice order is an ordinary draft in every way that matters later (typed lines work with Quick Register and Pending Prices, price snapshots happen at confirmation, invoices are untouched), and its source and words stay visible for checking.
- The order is never lost: every failure keeps the transcript, a fallback exists that needs no AI, and creation is exactly-once for a double tap, a refresh or ten simultaneous requests.
- The paid key is protected from loops and the owner can see what went wrong without any secret in the log.
- Offline voice (Module 009), a cloud speech provider and a second AI provider can be added behind the two interfaces without changing the screens or the database rules.

### Negative

- Matching quality is deliberately conservative: a supplier who says a short brand name when several strengths exist always gets "choose one", and Urdu-script names will often become typed lines. This is slower than a smart guess and safer.
- The `order_save` body is copied into migration `0009` with three small changes, so it could drift from the Module 003 behaviour. Mitigation: the diff is limited to three changes and every Module 003 and 004 order suite runs against the new function.
- The Gemini API shape, the browser speech API and the model name change over time. Mitigation: the model is configuration, the request builder is isolated in one file, and the first implementation tasks check the current documentation.
- A supplier who creates and confirms an order without reading the preview can still send a wrong line; software only makes this unlikely (the transcript beside the lines, unused parts highlighted, a draft that must be confirmed separately).
- The per-minute limit protects against loops, not heavy legitimate use or cost over a day; a daily cap can be added later from the same tables.
- Browser speech recognition may send audio to the browser vendor's service and needs a connection; the app says so and does not promise offline or universal support.

## Alternatives Considered

- **Send the catalog or store names to Gemini so it can match.** Rejected: breaks "only the transcript text", leaks the supplier's catalog, costs tokens, and lets the AI choose the product (forbidden).
- **Let the database decide matched vs choose one.** Rejected: the safety rule would be buried in SQL; one TypeScript function is easier to read, review and test with 30+ sentences.
- **A separate `order_create_voice` function.** Rejected: a second order writer with its own copy of the validations; one writer is safer.
- **Allow the `source` to change after creation.** Rejected: weakens an existing guard for no benefit.
- **Auto-select a candidate above a similarity score.** Rejected: "never silently substitute a similar medicine"; a wrong strength is a wrong medicine.
- **Save the preview as a draft order immediately and let the supplier fix it.** Rejected: AI output would exist as an order before the supplier confirmed it.
- **Use the official Gemini SDK package.** Rejected: a new dependency and harder to point at a fake; the plain request is small.
- **Call Gemini from the browser.** Rejected: the key would be exposed.
- **Count the rate limit in server memory.** Rejected: it would not hold across instances; the database count does.
- **Store the transcript in the diagnostic log.** Rejected: business text with no need to keep; only its length is kept. The transcript that matters is the one kept read-only with the created order.
- **Record and upload audio for a cloud speech service now.** Rejected: out of scope and a privacy cost; the interface leaves the door open.

## References

- Feature Spec: specs/008-voice-order-gemini/spec.md
- Implementation Plan: specs/008-voice-order-gemini/plan.md; research D1 to D19 and the risks: specs/008-voice-order-gemini/research.md; data model: specs/008-voice-order-gemini/data-model.md; API contract: specs/008-voice-order-gemini/contracts/api.openapi.yaml; checks and the owner's walkthrough: specs/008-voice-order-gemini/quickstart.md
- Constitution Principles IV, V and VI; master prompt Sections 6, 7A and 8; negative prompt (voice and AI rules)
- Related ADRs: ADR-0002, ADR-0003, ADR-0004
