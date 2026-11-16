# Feature Specification: Voice Order Entry with Gemini (Module 008)

**Feature Branch**: `008-voice-order-gemini`
**Created**: 2026-11-16
**Status**: Draft
**Input**: User description: "Module 008 voice order entry with Gemini, building on Modules 001 to 007 (all merged into master; manual orders are Module 003, pending medicines and Quick Register are Module 004, invoices Module 006, store accounts Module 007). A microphone button on the New order screen captures speech with the browser's built-in speech recognition behind a speech-to-text provider interface; the supplier chooses English or Urdu (ur-PK) and the choice is remembered. The editable transcript goes to a server-side route only, which asks Google Gemini for a strict structured draft (store name as spoken; items with product name as spoken, quantity and unit) behind a text-to-order parser interface; the model name comes from GEMINI_MODEL and the key from GEMINI_API_KEY (server only, placeholders in .env.example). Only the transcript text is sent. Matching of the store and the medicines is done by application code, never by Gemini; results are matched, choose one, or unknown (a typed pending line). An order preview shows the transcript beside the parsed order, highlights doubtful items, allows every correction, and creates a normal draft order only after the supplier confirms. Failures (rate limit, timeout, invalid output, missing key, no internet, unsupported browser) never block or lose an order; a simple rule-based parser is the degraded fallback. AI failures and low-confidence results go to a diagnostic log without secrets. Automated tests use mocked speech recognition and a mocked Gemini and never call the real API; the owner checks the real call once with their paid key. Out of scope: offline voice and sync (Module 009), reports (Module 010), a cloud speech provider (interface only), storing audio, multi-user roles, and anything that changes invoices, prices or the ledger."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Speak an order, review it, and get a draft order (Priority: P1)

The supplier is on the phone with a pharmacy or standing in the market. On the New order screen they tap the microphone and say something like "Al Madina Medical: Panadol 20 strips, Brufen 10 strips, and cough syrup 5 bottles." The app shows exactly what it heard, then an order preview: the store and each line with the quantity and unit. The supplier checks it, fixes anything, and taps "Create draft order". A normal draft order opens, exactly like one taken by hand, except that its source is recorded as voice. The order is still only a draft: confirming it is a separate, normal step.

**Why this priority**: Voice order taking is the headline feature of the product (master prompt Section 6). Every other story in this module only makes this one safe and honest.

**Independent Test**: With a mocked speech recognition and a mocked parser, say the example sentence, check the transcript, the preview and the lines, tap "Create draft order", and see a draft order with the right store and lines, source voice, status Draft, that the supplier can then edit and confirm as usual.

**Acceptance Scenarios**:

1. **Given** the New order screen on a browser that supports speech recognition, **When** the supplier taps the microphone, speaks, and stops, **Then** the transcript appears in an editable box, the order is parsed, and a preview shows the store and every spoken item with its quantity and unit.
2. **Given** a preview in which every store and medicine is matched, **When** the supplier taps "Create draft order", **Then** one draft order is created for that store with those lines, its source is "voice", it opens on the normal order screen, and nothing has been confirmed, priced or invoiced automatically.
3. **Given** the supplier taps "Create draft order" twice quickly, loses the connection and retries, or refreshes and taps again, **When** the server answers, **Then** exactly one order exists, with one set of lines and one order number.
4. **Given** the supplier has not tapped "Create draft order", **When** they leave the screen or refresh, **Then** no order was created, and the transcript and the preview they were working on are still there when they come back in the same browser tab.
5. **Given** a created voice draft, **When** the supplier opens it, **Then** it can be edited, confirmed, cancelled and invoiced exactly like a manual order, and it shows the original spoken text as read-only text for later checking.

---

### User Story 2 - Doubtful items are shown, never guessed (Priority: P1)

Gemini only turns the sentence into a draft list of names and numbers. The application, not Gemini, decides what each name means. Each spoken store and medicine becomes one of three things: matched (one clear catalog record), choose one (several candidates, nothing preselected), or unknown (kept as the supplier said it, as a typed "not registered" line). Different strengths, dosage forms, manufacturers and pack sizes are never merged or substituted. Doubtful quantities and units are flagged. The supplier resolves every doubt before the draft can be created.

**Why this priority**: A wrong medicine on an order flows into purchases, invoices and the khata. Principle "never silently substitute a similar medicine" is non-negotiable (master prompt Sections 6, 7A, 8).

**Independent Test**: With a mocked parser that returns an exact name, a name that fits two strengths, a misspelt name, an unknown name and a doubtful quantity, check that each shows the right state, that nothing is preselected when it is doubtful, and that the draft cannot be created until the doubts are resolved.

**Acceptance Scenarios**:

1. **Given** a spoken product name that equals exactly one active medicine, **When** the preview opens, **Then** that line is shown as matched with that medicine's name, strength and form visible, and the supplier can still change it.
2. **Given** a spoken name that fits more than one active medicine (for example two strengths of the same brand) or only resembles one (a spelling or sound difference), **When** the preview opens, **Then** the line is shown as "choose one" with up to five candidates, each showing name, strength, dosage form, manufacturer and pack size, none preselected, and the draft cannot be created until the supplier chooses one or chooses "None of these, it is a new medicine".
3. **Given** a spoken name with no candidate, or the supplier chooses "None of these", **When** the draft is created, **Then** the line is a typed line that keeps the exact spoken text, shown as "Not registered" and "No selling price", and the existing Quick Register and linking flows work on it later; it never blocks creating or confirming the order.
4. **Given** the catalog is empty or small, **When** the supplier speaks an order, **Then** every medicine becomes an unknown typed line and the order can still be created.
5. **Given** a spoken quantity that is missing, zero, negative, fractional, above 100,000 or not understood, **When** the preview opens, **Then** the line is flagged "check the quantity", no quantity is invented, and the draft cannot be created until the supplier enters a valid whole number.
6. **Given** a spoken unit that is missing, **When** the preview opens, **Then** the line shows the chosen medicine's own unit (or an empty unit for an unknown medicine) with the note "unit not heard", and the supplier can change it.
7. **Given** the spoken store name equals one active store, fits several, resembles one, or fits none, **When** the preview opens, **Then** the store is shown as matched, choose one (nothing preselected), choose one, or unknown, with the options to pick any store or add a new store inline (with the same duplicate check as adding a store), and the draft cannot be created until a store is chosen.
8. **Given** the same medicine is spoken twice, **When** the preview opens, **Then** both lines are kept and a warning is shown; lines are never merged silently.

---

### User Story 3 - A failed voice or AI step never blocks or loses an order (Priority: P1)

The supplier must always be able to take an order. When the microphone, the connection, the Gemini service, the key or the answer fails, the app says what happened in plain words, keeps everything that was said, offers Retry, and offers a way forward that needs no AI: edit the transcript by hand and use the simple rule-based parser, or go to the manual order screen.

**Why this priority**: The master prompt and the negative prompt require that a failed or rate-limited AI call never blocks order taking and never loses an order.

**Independent Test**: With a mocked parser that fails in each way (rate limit, timeout, invalid output, missing key, no connection) and a browser without speech recognition, check each shows its own message, keeps the transcript, offers Retry and a fallback, and that taking the same order by the fallback creates a correct draft.

**Acceptance Scenarios**:

1. **Given** Gemini answers with a rate limit (HTTP 429), **When** the supplier taps parse, **Then** a message says the service is busy and to try again shortly, the transcript is kept, Retry is offered, and the fallback below is offered.
2. **Given** Gemini does not answer within the time limit, **When** it expires, **Then** a message says it took too long, the transcript is kept, and Retry and the fallback are offered.
3. **Given** Gemini answers with something that is not valid structured output (not JSON, wrong shape, quantities that are not numbers, more than 200 lines, text where a list belongs), **When** the server validates it, **Then** the answer is refused as a whole, never partly used, and a message says the answer could not be understood.
4. **Given** the server has no Gemini key or model configured, **When** the supplier taps parse, **Then** a message says voice understanding is not set up on the server (without naming any secret), the transcript is kept, and the fallback is offered.
5. **Given** the device has no connection, **When** the supplier taps parse, **Then** a message says a connection is needed, the transcript is kept, and manual entry remains one tap away.
6. **Given** the AI is unavailable for any reason, **When** the supplier chooses the simple reader (the rule-based parser), **Then** clear sentences of the form "store: name quantity unit, name quantity unit" are turned into a preview, everything the parser is unsure about is flagged exactly as in Story 2, and it never guesses a medicine or a quantity; a sentence it cannot read is returned as "could not read this part" for the supplier to fix by hand.
7. **Given** any failure, **When** the supplier chooses "Take this order by hand", **Then** the manual order screen opens with the same store (if known), and the spoken text is available to read, so nothing said is lost.

---

### User Story 4 - Choose the spoken language and learn honestly what works (Priority: P2)

Next to the microphone the supplier chooses the language they will speak: English or Urdu (ur-PK). The choice is remembered on that device. If the browser cannot do speech recognition, the app says so plainly and offers the typed transcript box, where the phone keyboard's own voice typing can be used. The app does not promise that every phone, browser or accent works, or that speech recognition works without a connection.

**Why this priority**: Browser speech recognition varies; being honest and giving a working fallback keeps the feature useful for every supplier. It is P2 because Story 1 works with typed text alone.

**Independent Test**: Change the language, reload, and see it remembered; open the screen in a browser without speech recognition and see the message and the typed box; use the typed box to create a draft.

**Acceptance Scenarios**:

1. **Given** the language choice English or Urdu, **When** the supplier selects one, **Then** the next recording uses it and the choice is still selected after a reload on that device.
2. **Given** a browser without speech recognition, **When** the New order screen opens, **Then** the microphone is not offered as working; a message explains that this browser cannot listen and suggests the keyboard microphone or typing; the transcript box works; no error appears for other features.
3. **Given** speech recognition that needs a connection, **When** the device is offline or the browser reports a network or permission problem, **Then** the app names the problem (no microphone permission, no connection, nothing heard, service not allowed) and offers Retry and typing.
4. **Given** the app listens, **When** it is listening, **Then** the screen clearly shows the listening state with a large Stop button, shows the words as they arrive where the browser supplies them, and never records or keeps audio.
5. **Given** Urdu speech returns Urdu-script text, **When** it is parsed, **Then** the transcript is shown as heard, matching still works on the names it can find, and anything it cannot match is an unknown typed line the supplier can correct.

---

### User Story 5 - Nothing sensitive leaves the supplier's control (Priority: P2)

Only the words of the order go to the AI. No prices, no MRP, no balances, no invoices, no product list, no store list and no other financial or catalog data are ever sent. The Gemini key lives only on the server and never reaches the browser, a response, a bundle or a log. AI failures and low-confidence results are recorded in a diagnostic log that holds no secret, so the supplier can see what went wrong.

**Why this priority**: Constitution and master prompt make this non-negotiable, but it is invisible to the supplier until something is wrong, so it ranks below the visible flows. It is verified by tests, not by the supplier.

**Independent Test**: Capture the exact request the server would send to Gemini (with the mocked provider) and assert it contains only the instruction and the transcript; search every browser response and the built bundle for the key; read the diagnostic log after each failure kind.

**Acceptance Scenarios**:

1. **Given** any parse request, **When** the server builds the request to the AI, **Then** its body contains only the fixed instruction and the transcript text, and no catalog, store, price or balance data.
2. **Given** the key is set on the server, **When** any page, API response, error message or log line is produced, **Then** the key never appears in it; a missing or wrong key produces a safe message that names no secret.
3. **Given** a parse that failed or returned low-confidence results (doubtful items, a refusal of the structure), **When** it ends, **Then** one record is written to the diagnostic log with the time, the kind of failure or doubt, which parser was used and counts, and never the key, never the full transcript text and never any price or balance.
4. **Given** the owner opens Settings, **When** they open "Voice diagnostics", **Then** they see the recent records of their own business, newest first, with a clear empty state; another business's records are never visible.
5. **Given** a business uses the AI parser repeatedly, **When** it exceeds the allowed number of AI parses per minute, **Then** the request is refused with a clear "too many requests, wait a moment" message before anything is sent to the AI, and the simple reader and manual entry are unaffected.

---

### User Story 6 - Correct anything, then parse again (Priority: P2)

The preview is a working screen, not a verdict. The supplier can edit the transcript and parse again, choose a different store or medicine, change a quantity or unit, remove a line, add a line from the catalog by search, or add a typed line, all before creating the draft. Nothing the supplier corrected by hand is overwritten when they parse again unless they say so.

**Why this priority**: Speech and AI make mistakes; cheap correction is what makes voice faster than typing. It builds on Stories 1 and 2.

**Independent Test**: Change a line's medicine, quantity and unit, remove one line, add one by search, edit the transcript and parse again, and see that earlier hand corrections are kept or an explicit choice is offered.

**Acceptance Scenarios**:

1. **Given** a preview, **When** the supplier edits any quantity, unit or medicine choice, removes a line, or adds a line by the same medicine search as the manual order screen, **Then** the preview updates at once, no AI call is made, and the draft cannot be created while a doubt remains.
2. **Given** a preview with hand corrections, **When** the supplier edits the transcript and taps "Parse again", **Then** the app asks whether to keep the hand corrections or start over, and does exactly what was chosen.
3. **Given** a preview with 200 lines, **When** a further line would be added, **Then** the screen refuses it and says the limit, as on the manual order screen.
4. **Given** the supplier taps "Start over" or "Discard", **When** they confirm, **Then** the transcript and preview are cleared, and no order was created.

---

### Edge Cases

- The transcript is empty, only spaces, or too long (over 2,000 characters): parsing is refused before anything is sent, with a message.
- The transcript holds only a store name, or only products and no store: the preview shows what exists; the missing store must be chosen by the supplier.
- The transcript holds several stores in one sentence: the first store is used, the rest is flagged "more than one store was named; this order is for one store" and the supplier decides; items are never split into several orders automatically.
- The AI answers with a quantity that is not a plain number (words, Urdu digits or a range returned as text): the whole answer is refused as unusable, because the instruction asks for digits (FR-012). A number that is not a whole number from 1 to 100,000 (a decimal, zero, a negative or a huge value) passes the answer check but is flagged for the supplier, never rounded or guessed (FR-020).
- The AI answers with items that were not spoken (an invented medicine): the preview shows the spoken name as the AI gave it; the supplier sees the transcript beside it and can remove it; nothing is created without the supplier's confirmation, and the transcript comparison makes an invented line visible.
- The AI answers with a price, MRP or balance in its text: those fields are ignored and never shown or stored; only store, name, quantity and unit are read.
- The same voice order is parsed twice (double tap on parse): one request is made or the second replaces the first; the preview never shows doubled lines.
- Speech recognition hears nothing, stops early, or is blocked by a permission prompt: a specific message, Retry, and the typed box.
- The supplier changes the store in the preview after products were matched: matching does not depend on the store, so lines stay; the store is only the order's store.
- A medicine matched at parse time is deactivated or the catalog changes before the draft is created: the server re-checks on creation; a line that is no longer valid is refused with the line named, and the supplier fixes it; nothing is created partially.
- The connection drops while creating the draft: the save is retried with the same identifiers and creates one order; the preview is kept until the server confirms.
- Two businesses speak at the same time: each sees only its own stores, medicines, previews, orders and diagnostic records.
- The browser tab is closed on the preview: nothing was created; the preview may be restored in the same tab if it is reopened.
- A medicine name contains digits and units ("Panadol 500 20 strips"): the app never guesses which number is the strength and which is the quantity; if it cannot tell, both candidates are shown and the quantity is flagged.
- The AI service changes its model: the model comes from the configuration, so a change needs no code change; a model that is not found produces the "not set up" message.

## Requirements *(mandatory)*

### Functional Requirements

**Capturing speech**

- **FR-001**: The New order screen MUST offer a microphone button that starts listening with the browser's built-in speech recognition, and a Stop button while listening, both at least 44 × 44 px at a 360 px width.
- **FR-002**: Speech capture MUST sit behind a speech-to-text provider interface, with the browser's speech recognition as the first implementation, so another provider (for example a cloud speech service) can be added later without changing the order screens. No other provider is built in this module.
- **FR-003**: The supplier MUST be able to choose the spoken language, English or Urdu (ur-PK), next to the microphone; the choice MUST be remembered on that device and used for the next recording. Mixed-language recognition MUST NOT be promised.
- **FR-004**: The app MUST detect whether the browser supports speech recognition and, if not, MUST say so plainly and MUST keep the typed transcript box fully working. It MUST NOT claim that speech recognition works offline or on every device.
- **FR-005**: The app MUST name the reason when listening fails or returns nothing (no microphone permission, no microphone, no connection, nothing heard, service not allowed, stopped early) and MUST offer Retry and typing.
- **FR-006**: The app MUST NOT record, store or upload audio itself. It MUST tell the supplier, in one plain sentence near the microphone, that the browser's speech service may process the audio.
- **FR-007**: The transcript MUST be shown in an editable text box (up to 2,000 characters), whether it came from speech, typing or the phone keyboard's voice typing, and the supplier MUST be able to edit it before and after parsing.

**Parsing the words into a draft list**

- **FR-008**: Parsing MUST run on the server only. The browser MUST never call the AI service and MUST never receive the AI key or the raw AI answer; it receives only the validated preview data.
- **FR-009**: Parsing MUST sit behind a text-to-order parser interface, with Google Gemini as the first implementation and a simple rule-based parser as the degraded fallback; another provider MUST be replaceable without changing the screens.
- **FR-010**: The Gemini model name MUST come from the environment variable `GEMINI_MODEL` and the key from `GEMINI_API_KEY`; neither MUST be hardcoded or committed, `.env.example` MUST show placeholders only, and the key MUST exist only on the server.
- **FR-011**: The request sent to the AI MUST contain only a fixed instruction and the transcript text. It MUST NOT contain prices, MRP, selling prices, balances, invoices, product names from the catalog, store names from the supplier's list, business details or any other financial or catalog data.
- **FR-012**: The AI MUST be asked for a strict structured answer: the store name as spoken (or empty) and a list of items, each with the product name as spoken, the quantity and the unit. The server MUST validate the answer against a schema, MUST refuse an answer that does not fit as a whole (never partly), MUST ignore any extra field (such as a price), MUST cap the list at 200 items, and MUST treat the answer only as a draft.
- **FR-013**: A parse MUST have a time limit; when it ends without an answer the supplier MUST see the "took too long" message and keep the transcript.
- **FR-014**: The server MUST limit the number of AI parses per business per minute (20) and refuse more with a clear message before calling the AI, so a fault or a loop cannot run up the paid key. The simple reader (FR-033) makes no AI call, is not counted, and stays available when the limit is reached.

**Matching by application code**

- **FR-015**: The AI MUST NEVER decide which store, which catalog medicine or which price applies. Matching MUST be done by application code against the supplier's own active stores and active medicines, normalised (case, spacing, punctuation, common spelling variants) with a similarity search for near matches.
- **FR-016**: A spoken product MUST be shown as **matched** only when its normalised name equals exactly one active medicine (its name or brand, including the strength and form when those were spoken). Everything else with a candidate MUST be **choose one**, with up to five candidates showing name, strength, dosage form, manufacturer and pack size, none preselected. A near match, a spelling or sound difference, or several strengths, forms, manufacturers or pack sizes MUST always be **choose one**, never matched.
- **FR-017**: A spoken product with no candidate, or one the supplier declines, MUST become an **unknown** typed line keeping the exact spoken text, shown as "Not registered" and "No selling price", exactly as in Modules 003 and 004. The "None of these, it is a new medicine" choice MUST always be offered.
- **FR-018**: The system MUST NOT merge, substitute or auto-select different strengths, dosage forms, manufacturers or pack sizes, and MUST NOT treat a similar name as the same medicine.
- **FR-019**: The spoken store MUST be matched the same way against the active stores: matched, choose one (nothing preselected when doubtful), or unknown, with the options to choose any store or add a new store inline with the same duplicate check as on the Stores screen. A store MUST be chosen before the draft can be created.
- **FR-020**: A quantity MUST be accepted only as a whole number from 1 to 100,000. A missing, zero, negative, fractional, huge, range or unreadable quantity MUST be flagged and left for the supplier to enter; the system MUST NOT round, assume or invent a quantity.
- **FR-021**: A unit MUST be kept as spoken (cleaned of extra spaces, up to 50 characters). When no unit was spoken, the chosen medicine's own unit MUST be shown with the note "unit not heard"; an unknown medicine with no unit MUST show an empty unit the supplier fills in.
- **FR-022**: The same medicine spoken twice MUST stay two lines with a warning, never merged silently.

**The order preview and the draft**

- **FR-023**: After parsing, the screen MUST show an order preview with the transcript beside the parsed store and lines, and MUST highlight, with words and not only colour, every matched line, every choose-one line, every unknown line, every doubtful quantity or unit, and every part of the transcript the parse did not use.
- **FR-024**: The supplier MUST be able to change the store, change or choose each medicine (by the same medicine search as the manual order screen), change a quantity or unit, remove a line, add a catalog line or a typed line, edit the transcript and parse again, and start over, all before creating the draft. Hand corrections MUST be kept on "Parse again" unless the supplier chooses to start over.
- **FR-025**: "Create draft order" MUST be disabled, with the reason stated, while any store, medicine choice or quantity is still doubtful. Choose-one lines MUST NOT be saved with a guessed medicine.
- **FR-026**: Creating the draft MUST make exactly one normal draft order through the existing order save for the chosen store and lines, with the order's source recorded as "voice". It MUST NOT confirm the order, take a price snapshot, fill a price or create an invoice. AI output MUST NEVER be saved or confirmed as a final order without the supplier's tap on "Create draft order", and the order stays a draft until the supplier confirms it by the normal step.
- **FR-027**: Creating the draft MUST be safe to repeat: the order and line identifiers are made on the device before the first attempt, so a double tap, a refresh, a lost connection or a retry creates one order, one set of lines and one order number.
- **FR-028**: The server MUST re-validate everything on creation (store and medicines belong to the business and are active, quantities and units are valid, at most 200 lines). A line that is no longer valid MUST be refused with the line named and nothing created partially.
- **FR-029**: The created order MUST keep the spoken text as read-only "Spoken text" shown on the order screen for later checking. It holds no price or balance and cannot be edited.
- **FR-030**: The transcript and the preview MUST NOT be lost by a refresh, a dropped connection or a failed call: they are kept in the browser tab until the supplier creates the draft, starts over, or closes the tab. They MUST NOT be described as saved or synchronised, and they are not an order until the draft is created.

**Failures and fallback**

- **FR-031**: Each of these MUST show its own plain message, keep the transcript, offer Retry and offer a fallback: rate limit (429), timeout, invalid or unusable answer, missing key or model, no connection, unsupported browser, microphone permission refused, nothing heard.
- **FR-032**: A failed or slow AI call MUST NEVER block order taking: "Take this order by hand" MUST always be available and MUST open the manual order screen with the same store when known, and the spoken text MUST remain readable there.
- **FR-033**: A simple rule-based parser, shown to the supplier as "Use the simple reader", MUST be offered when the AI is unavailable or the AI limit is reached. It MUST read only clear sentences of the form "store name, then items separated by commas or the word 'and', each as a name, a quantity and a unit", MUST flag everything it is unsure about exactly as FR-023, MUST NEVER guess a medicine or a quantity, and MUST return the parts it cannot read as "could not read this part".
- **FR-034**: When the AI answers but some items are doubtful, the preview MUST open normally with the doubts flagged; a doubtful result is not a failure.

**Diagnostics and privacy**

- **FR-035**: Every failed parse and every low-confidence result (a refused structure, doubtful items, an unreadable part) MUST write one record to a diagnostic log holding the time, the business, the kind of failure or doubt, which parser was used, counts (items, doubtful items) and a short safe message. It MUST NEVER hold the key, any secret, the full transcript text, a price or a balance. A refusal caused by the app's own limit MUST be recorded at most once per minute per business, so a loop cannot flood the log.
- **FR-036**: The owner MUST be able to read their own business's recent diagnostic records, newest first, in a read-only "Voice diagnostics" list under Settings, with loading, error (with Retry) and empty states. No business can read another's records, and the log cannot be edited or deleted from the app.
- **FR-037**: The key, the full AI request and the raw AI answer MUST NEVER appear in any browser response, page, bundle, error message, console output or log.

**General**

- **FR-038**: All new screens MUST be English, mobile-first, with touch targets of at least 44 × 44 px at 360 px, no sideways scroll, and loading, error (with Retry) and empty states that name the next action.
- **FR-039**: The bottom navigation MUST keep its five items; the microphone lives on the New order screen (and its "Speak the order" entry), not in the navigation.
- **FR-040**: Each business MUST see and change only its own previews' results, orders, stores, medicines and diagnostic records; this MUST be enforced by the database for anything new, not only by the screens.
- **FR-041**: The system MUST NOT report a draft as created unless the server confirmed it, and MUST keep the typed and corrected values on screen when an operation fails.
- **FR-042**: Voice, parsing and the diagnostic log MUST NOT change, read or reveal invoices, prices, price snapshots, the ledger or balances.
- **FR-043**: Automated tests MUST use a mocked speech recognition and a mocked AI provider and MUST NEVER call the real AI service. The real service MUST be checked once, manually, by the owner with their own paid key, and the result recorded as "reported, not seen" unless evidenced.

### Key Entities *(include if feature involves data)*

- **Transcript**: The words of the order as text, typed, heard by the browser, or from the phone keyboard. Up to 2,000 characters. It lives in the browser tab until the draft is created; after that it is kept with the order as read-only "Spoken text".
- **Parsed draft**: The answer of the parser (AI or rule-based): the store as spoken and a list of items (name as spoken, quantity, unit). Never saved by itself; validated by the server; contains no price or balance.
- **Preview line**: One item of the preview, with its state (matched, choose one, unknown), its doubts (quantity, unit, store), and the supplier's choice. Becomes an order line (catalog or typed) only when the supplier creates the draft.
- **Voice order**: A normal draft order (Module 003) whose source is "voice" and that carries the read-only spoken text.
- **Voice diagnostic record**: One failure or low-confidence event: time, business, kind, parser used, counts, short safe message. Owner-readable, append-only, no secret and no full transcript.
- **Speech provider / text-to-order parser**: The two replaceable parts (speech to text, text to draft list). The browser speech recognition, Gemini and the rule-based parser are the implementations in this module.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the mocked services, the example sentence "Al Madina Medical: Panadol 20 strips, Brufen 10 strips, and cough syrup 5 bottles" becomes a correct draft order (right store, right three lines, source voice, status Draft) in at most 5 taps after the transcript appears, and the draft is never confirmed, priced or invoiced by this module.
- **SC-002**: For every spoken product that has more than one plausible catalog record or only a near match, the preview shows "choose one" with nothing preselected in 100% of cases in the test set (at least 30 sentences including strengths, forms, spelling variants, Urdu-script names and empty-catalog cases); no test ever produces a catalog line without the supplier's choice.
- **SC-003**: Across every failure mode (429, timeout, invalid output, missing key, no connection, unsupported browser, permission refused, nothing heard, and a failed draft creation), 0 transcripts and 0 orders are lost, each shows its own message, and the order can be completed by the fallback or by hand in each case.
- **SC-004**: The exact request body sent to the AI contains only the fixed instruction and the transcript in 100% of tested parses (asserted on the captured request); a search of every browser response, the built bundle and every log finds the key 0 times.
- **SC-005**: Repeating "Create draft order" 10 times at once, or after a refresh or lost connection, creates exactly 1 order, 1 set of lines and 1 order number.
- **SC-006**: An invalid or unusable AI answer (wrong shape, non-numeric quantity, 201 items, extra price fields) is refused as a whole or has its extra fields ignored in 100% of test cases, and no price or balance from an AI answer is ever shown or stored.
- **SC-007**: A quantity that is not a whole number from 1 to 100,000 is flagged and blocks creation in 100% of cases; no quantity is ever rounded or invented.
- **SC-008**: Two businesses are isolated for everything new (orders with source voice, spoken text, diagnostic records): a second business's user can read or change 0 of the first business's records, using crafted ids, verified with two real users.
- **SC-009**: Parsing a 200-item transcript with the mocked provider and matching it against a catalog of 5,000 medicines produces the preview within 2 seconds of the answer arriving (the AI's own time is not counted); creating the draft takes at most 2 seconds.
- **SC-010**: The New order screen with the microphone, the preview (including a choose-one line, an unknown line and all dialogs) and Voice diagnostics pass the 360 px check: no control smaller than 44 × 44 px and no sideways scroll.
- **SC-011**: The rule-based parser reads at least 90% of the clear sentences in the test set correctly and flags 100% of the parts it cannot read, and never produces a catalog line or a guessed quantity.
- **SC-012**: Exceeding 20 AI parses per minute is refused before any AI call in 100% of cases, and the simple reader and manual order entry are unaffected.
- **SC-013**: The owner checks the real Gemini call once with their paid key on the DEV project (a spoken or typed sentence becomes a correct preview, and a deliberately wrong key shows the "not set up" or failure message without exposing the key) and the result is recorded as reported, not seen, unless evidenced.
- **SC-014**: The module changes no invoice, price snapshot, ledger entry or balance, and every Module 001 to 007 test still passes.

## Assumptions

- Speech recognition is the browser's built-in one (the mobile browser's speech service, which may process audio on a remote service and needs a connection). English and Urdu (ur-PK) are offered; whether a given phone supports them is the browser's business and is stated honestly. Roman Urdu is not a recognition language; speaking mixed English and Urdu may return English or Urdu-script text depending on the browser.
- Medicine names are mostly English or brand names; Urdu-script text may need correction by the supplier. Transliteration of Urdu script to catalog names is not attempted beyond normal matching.
- The owner has a paid Gemini key and puts it and the model name in the server environment themselves (`GEMINI_API_KEY`, `GEMINI_MODEL`); the free tier is for test data only. The app never asks for the key in chat or in a screen.
- The New order screen keeps its first step (choose a store). The "Speak the order" entry is offered on that first step too, because the supplier may say the store name first; saying no store is allowed and the supplier chooses it in the preview. Nothing is created until "Create draft order".
- The preview is not an order and has no order number; the draft order is created only on "Create draft order". The existing draft automatic saving, order numbering, idempotent save, price snapshot at confirmation and delivered quantity rules of Module 003 apply to the created draft unchanged. The orders table already allows the source "voice".
- The spoken text is kept with the created order as read-only text (up to 2,000 characters). It is the supplier's own words about an order, not a price or a balance. The diagnostic log does not keep the transcript, only its length and the kind of event.
- The AI parse limit is 20 per business per minute (the simple reader is not counted) and the parse time limit is 15 seconds; both are configuration values chosen to protect the paid key and the supplier's time, and can be tuned later.
- The simple rule-based parser handles clear comma-separated or "and"-separated sentences only; it is a safety net, not a second AI.
- Only the owner of a business can use voice entry and read its diagnostics (no multi-user roles).
- Without a connection, parsing and creating a draft do not work and the app says so; keeping a transcript in the browser tab is not offline order taking and is never called saved or synchronised (offline order taking and sync are Module 009).
- Automated tests never call the real services; the real Gemini call and the real phone microphone are checked once by the owner and recorded as reported, not seen, unless evidenced.

## Out of Scope

Offline voice, offline order drafts and synchronisation (Module 009); reports, dashboards and profit (Module 010); a cloud speech-to-text provider (only the interface is built); storing or uploading audio; multi-user roles and permissions; sending any financial or catalog data to the AI; letting the AI choose a store, a medicine or a price; automatic confirmation of orders; automatic splitting of one sentence into several orders; changing invoices, prices, price snapshots, the ledger or balances; translating Urdu script into catalog names beyond ordinary matching; voice commands other than taking an order (such as "confirm this order" or "show my balance"); a second AI provider; Quick Register and Pending Prices changes (Module 004 works on voice typed lines unchanged); thermal or PDF changes.
