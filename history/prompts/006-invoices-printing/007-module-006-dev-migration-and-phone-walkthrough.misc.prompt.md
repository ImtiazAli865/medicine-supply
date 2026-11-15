---
id: 007
title: Module 006 DEV migration and owner phone walkthrough
stage: misc
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 006-invoices-printing
branch: 006-invoices-printing
user: ImtiazAli865
command: chat
labels: ["dev-migration","phone-walkthrough","module-006","owner-verification"]
links:
  spec: specs/006-invoices-printing/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/006-invoices-printing/quickstart.md
 - specs/006-invoices-printing/tasks.md
tests:
 - no automated tests were run in this stretch; the owner phone walkthrough is recorded as reported, not seen (one screenshot at step 3)
---

## Prompt

Owner messages in this stretch (translated from Roman Urdu where marked):

1. "Apply migration 0007 to DEV" (the owner's answer to a question, translated from Roman Urdu).
2. "Yes, run server now" (answer to the offer to serve the production build to a phone on the local network).
3. A phone screenshot (order for a store: ordered 1, delivered 2, "More than ordered", grand total PKR 280.00) with: "1. I finished up to step three; for step 4 I do not understand whether I have to go back or what to do. 2. Press Create invoice again and refresh the page: still only one draft." (translated from Roman Urdu)
4. "In step 5, should I type a new medicine and confirm the order?" (translated from Roman Urdu)
5. "All steps went fine, but in step 5, when we tapped the Register the medicines link, registered the medicine on the Pending screen and gave a selling price, only name and unit were shown as required and the rest optional; shouldn't the selling price also have been shown as compulsory for the invoice?" (translated from Roman Urdu)
6. "all steps have been done and confirmed now continue for next step"

## Response snapshot

- Migration 0007 was applied to the DEV project through the owner's signed-in Supabase tab; counts and the delivered-quantity checksum were identical before and after (quickstart section 8). The production build was served to the phone (port 3000).
- The assistant explained steps 4 and 5 of quickstart section 3 in simple Roman Urdu.
- On the selling-price question: by design (Module 004) the registration form requires only name and unit, so taking an order is never blocked; the invoice refuses to issue while a billed line has no verified selling price, and the price is given on the form or on the Pending Prices screen. A small hint on the form when it is reached from an invoice draft was offered as an optional improvement; it was not implemented.
- After the owner confirmed all steps, the phone server was stopped (port 3000 free) and the walkthrough was recorded in quickstart section 6 as "reported, not seen". T064 was ticked.

## Outcome and evaluation

- 64 of 66 tasks ticked. Not reported by the owner and therefore not recorded as met: the taps from the order screen to a printed A4 invoice (SC-001), the time to cancel and replace an invoice (SC-013), and any real A4 or 80 mm thermal printer result ("not tested").
- Remaining: the pull request (T066) only when the owner says; the ADR is recorded in PHR 008.
