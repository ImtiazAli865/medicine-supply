# Quickstart and Verification Guide: Voice Order Entry with Gemini (Module 008)

**Feature**: 008-voice-order-gemini | **Status**: planned, nothing implemented or verified yet

This file says how the module will be run and checked. The "Results" section stays empty until real runs exist; nothing here may be read as a claim that something passed.

## 1. Prerequisites

- Modules 001 to 007 are merged into master (Module 007 merge commit `2a98dfa`).
- `.env.local` has the DEV project values; `.env.test.local` has the TEST project values (no secret is committed).
- Migration `supabase/migrations/0009_voice_orders.sql` is applied to the TEST project (through the owner's signed-in Supabase tab, with the owner's say-so) before the Supabase integration tests and the browser tests; it is applied to the DEV project only after the TEST results are recorded and the owner says so.
- Port 3000 is free for the e2e run; the e2e also starts a tiny fake Gemini server on a spare local port (set by the Playwright config), so no test needs a real key or a connection to Google.
- **The owner's own paid Gemini key** is needed only for the one manual check in section 3. The owner puts `GEMINI_API_KEY` and `GEMINI_MODEL` into `.env.local` (DEV) by themselves; the key is never typed into the chat, a screen, a test or a committed file. Before the module is built, `.env.example` gets placeholders only.

## 2. Commands (same as earlier modules)

```bash
npm run lint
npm run typecheck
npm test                  # unit + PGlite + Supabase integration
npm run test:e2e          # Playwright, mobile and desktop projects
npm run build             # run again after e2e so .next matches the DEV env
```

Automated tests never call the real Gemini service: the parser is replaced by a fake in unit and integration tests, and the e2e app is pointed at the local fake server with a placeholder key and model. A guard in the Gemini client refuses to run in the test environment when its base address is the real Google host.

## 3. Manual walkthrough on a phone (owner, DEV project, after the module is built, migration 0009 is applied to DEV and the owner's key is in `.env.local`)

Use a test store (for example "Nimer") and a couple of test medicines so nothing real is touched. Use Chrome on Android.

1. Open **New order**. At the top is **Speak the order** with a microphone, a language choice (English or Urdu) and a text box. Read the one sentence that says the browser's speech service may process the audio.
2. Choose **English**, tap the microphone, allow the microphone, and say: "Nimer: Panadol 20 strips, Brufen 10 strips and cough syrup 5 bottles." Tap **Stop**. The words appear in the text box.
3. Tap **Parse**. A preview opens: the transcript on top, the store and each line below, with words (not only colours) saying matched, choose one or unknown. Any medicine that fits more than one strength shows **Choose one** with nothing preselected.
4. Fix everything that is doubtful (choose a medicine or "None of these", enter a doubtful quantity). Try to tap **Create draft order** while a doubt remains: it is disabled and says why.
5. Tap **Create draft order**. A normal draft order opens, its lines are the ones you checked, a read-only **Spoken text** shows what you said, and nothing is confirmed. Tap the button twice quickly on a second try (or refresh): only one order exists.
6. Change the language to **Urdu**, reload the page: the choice is still Urdu. Say one short order in Urdu and see what the browser returns; correct it by hand.
7. Failure checks (the owner can do these with the real setup): (a) switch the phone to airplane mode and tap Parse: a "connection needed" message, the text is kept, "Take this order by hand" is offered; (b) temporarily put a wrong key in `.env.local` and restart: the "not set up" message appears and no key is shown anywhere; (c) tap **Use the simple reader** with the sentence "Nimer, Panadol 20 strips, Brufen 10 strips": a preview appears, and an unclear sentence is returned as "could not read this part".
8. Open **Settings**, then **Voice diagnostics**: the failures of step 7 are listed (kind, time, counts), with no key and no text of what you said.
9. Time yourself: from tapping the microphone to a created draft for a three-line order (goal: under one minute when nothing is doubtful), and report which phone and browser you used and whether the real Gemini answer matched what you said ("not tested" if you skipped it).

## 4. Master prompt Section 6 and 17 mapping

| Requirement | Where it is proven |
|-------------|--------------------|
| Microphone, speech to text, transcript shown and editable (Section 6 steps 1 and 2, browser keyboard fallback) | e2e `voice-speak` (fake speech recognition), `voice-unsupported`; unit language and error mapping |
| Store and products recognised, quantities and units extracted (steps 3 and 4) | unit `voice-schema`, `voice-rules`; e2e `voice-speak` |
| Matching by application code, never by the AI; ambiguous, unknown, uncertain highlighted (steps 5 and 7, Sections 7A and 8) | unit `voice-match` (30+ cases); PGlite `db-voice-match`; e2e `voice-preview` |
| Preview, corrections, confirmation before saving (steps 6, 8 and 9, "AI output is never saved as a final order") | unit `voice-preview-state`; e2e `voice-speak`, `voice-preview`; Supabase `voice-api` |
| Voice with an empty or small catalog works (Section 7A) | e2e `voice-empty-catalog` |
| Only the transcript is sent; key never exposed; schema validation on the server | unit `voice-gemini-request` (the exact body), `voice-schema`; Supabase `voice-api`; e2e `voice-secrets` (key sentinel searched in responses and the bundle) |
| 429, timeout, invalid output, no key, no connection never block or lose an order; fallback to manual and to a rule parser | unit `voice-errors`, `voice-rules`; e2e `voice-failures` |
| Diagnostic log without secrets; owner-only read | PGlite `db-voice-diagnostics`, `db-voice-rls`; Supabase `rls-voice`; e2e `voice-diagnostics` |
| Order source voice and the read-only spoken text; idempotent creation | PGlite `db-voice-order`; Supabase `voice-concurrency` (10 simultaneous creates give one order) |
| Responsive layouts | e2e `touch-targets`, `states`, `shell` updates |
| Module 001 to 007 behaviour unchanged | every earlier suite is run again against the changed `order_save` |
| Real Gemini call and real phone microphone | owner walkthrough, section 3 (reported, not seen unless evidenced) |

## 5. What the automated checks must prove

- **Request**: the body sent to the AI has only the fixed instruction and the transcript; no catalog or store name, price, balance or invoice; the key is in a header only on the server and never in any response, page, bundle or log.
- **Answer validation**: a wrong shape, a non-number quantity, more than 200 items or invalid JSON refuses the whole answer; extra fields (a price) are dropped; a numeric but doubtful quantity (0, 2.5, 10^9, negative) is flagged, never rounded.
- **Matching**: matched only for exactly one exact candidate; two strengths, forms, manufacturers or pack sizes, near spellings and Urdu-script names are choose one or unknown, never matched; the same medicine twice stays two lines with a warning.
- **Preview**: Create draft order is disabled while a store, a choice or a quantity is doubtful; hand corrections survive Parse again when asked; start over clears everything and creates nothing.
- **Creation**: one order, one set of lines, one number for 10 simultaneous or repeated creates; source voice; spoken text kept read-only; status Draft; no snapshot, price or invoice; a medicine deactivated in between is refused with the line named and nothing is created.
- **Failures**: each of rate limit, upstream 429, timeout, invalid answer, no key, no connection, unsupported browser, refused microphone, nothing heard has its own message, keeps the transcript, offers Retry and a fallback, and writes the right diagnostic record.
- **Rate limit**: the 21st AI parse in a minute is refused before any AI call; the simple reader and manual entry are unaffected; the refusals are logged at most once a minute.
- **Isolation**: two real users; crafted ids on every function; the diagnostic log and the orders of one business are invisible to the other.
- **Scale**: a 200-item transcript against 5,000 medicines gives a preview within 2 seconds of the answer; creating the draft within 2 seconds (times recorded, not assumed).
- **Screens** (Playwright, 360 px): New order with the microphone, the preview with a choose-one line, an unknown line and every dialog, and Voice diagnostics: touch targets at least 44 px, no sideways scroll, loading, error with Retry and empty states; the bottom navigation keeps five items.

## 6. Results

(Empty until real runs exist.)

## 7. Migration 0009 on the TEST project

(Empty until the owner says to apply it.)

## 8. Migration 0009 on the DEV project

(Empty until the owner says to apply it.)
