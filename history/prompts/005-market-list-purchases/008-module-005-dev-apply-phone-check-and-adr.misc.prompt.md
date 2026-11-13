---
id: 008
title: Module 005 DEV apply, phone check and ADR
stage: misc
date: 2026-11-14
surface: agent
model: claude-sonnet-5-5
feature: 005-market-list-purchases
branch: 005-market-list-purchases
user: ImtiazAli865
command: /sp.adr
labels: ["dev-apply","owner-verification","adr","module-005"]
links:
  spec: specs/005-market-list-purchases/spec.md
  ticket: null
  adr: history/adr/0005-purchase-recording-write-model.md
  pr: null
files:
 - history/adr/0005-purchase-recording-write-model.md
 - specs/005-market-list-purchases/quickstart.md
 - specs/005-market-list-purchases/tasks.md
tests:
 - read-only catalog and count checks on the DEV project before and after migration 0006 (counts identical: 158 medicines, 2 stores, 8 orders, 24 order lines, 20 order events)
 - read-only queries on the DEV project to compare the purchase entries and the product prices after the owner's price-offer tests
---

## Prompt

keep continue T056 now

(then:)

yes tell me now

(then, the owner sent a phone screenshot of the "Update the purchase price?" dialog for Nimer, with this text, translated from Roman Urdu:)

Cost and price: record a purchase with a cost. The question about updating the medicine's purchase price will come. Press No first and check that the price did not change. Do it again and press Yes, the price should change.
Everything else passed and it took 30-40 seconds, but I did not understand the cost and price part, so I took a screenshot; please look and tell me whether this happened correctly. (translated from Roman Urdu)

(then:)

No, in the product the same old rate 55 is showing, it did not update. (translated from Roman Urdu)

(then:)

I also tested the Acold tab just now. The product has price 33, I wrote 40 and clicked update, but when I went to the product again and searched, it still shows 33. (translated from Roman Urdu)

(then:)

Yes, exactly like that: the purchase price shows 40 and the selling price shows the same 33. (translated from Roman Urdu)

(then:)

It was the time of finding and saving, and the ADR must be written in English only, not Roman Urdu; Roman Urdu is only for our conversation. (translated from Roman Urdu)

## Response snapshot

- T056: migration `0006` applied to the DEV project (`medicine-supply-dev`) through the owner's already signed-in Supabase tab, after read-only counts; the generic "destructive operations" warning was confirmed for this migration only. After the apply the counts were identical, both tables exist with Row Level Security on, 2 append-only triggers, 2 indexes, 2 policies, 7 functions executable by signed-in users and not by `anon`, no direct write privilege for signed-in users. Recorded in quickstart section 8.
- A fresh production build was made against the DEV project (an earlier e2e rerun had rebuilt `.next` against the TEST project) and the server was started on port 3000 for the owner's phone.
- T057: the owner reported the walkthrough. The price-offer worry was investigated with read-only queries: the update had worked (Nimer purchase price 65.00 and ACOLD TAB 40.00 right after the Yes answers, selling prices unchanged at 60.00 and 33.00). The owner was looking at the Products list, which shows only the selling price; the Edit page shows the purchase price, and the owner confirmed that. Recorded in quickstart section 9, with "reported, not seen" for the steps without screenshots. SC-012 (30-40 seconds for finding and saving) is recorded as not met on that one reported timing.
- T058: the owner asked for the ADR in English only; ADR-0005 was written in English (`purchase-recording-write-model`). Roman Urdu stays in chat only.
- Not done yet: commit of these records, the pull request (T059).

## Outcome and evaluation

- The apparent bug was a misunderstanding about which price the list shows; no code change was made. A possible later change (show the purchase price in the Products list) was offered and not started.
- The selling price is below the purchase price for both tested medicines; the product form only warns about that, and it was left to the owner.
