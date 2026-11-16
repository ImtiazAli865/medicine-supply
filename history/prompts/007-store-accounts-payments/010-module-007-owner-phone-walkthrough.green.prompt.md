---
id: 010
title: Module 007 owner phone walkthrough
stage: green
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 007-store-accounts-payments
branch: 007-store-accounts-payments
user: ImtiazAli865
command: chat
labels: ["phone-walkthrough","owner-verification","module-007"]
links:
  spec: specs/007-store-accounts-payments/spec.md
  ticket: null
  adr: history/adr/0007-store-ledger-and-account-summary.md
  pr: https://github.com/ImtiazAli865/medicine-supply/pull/6
files:
 - specs/007-store-accounts-payments/quickstart.md
 - specs/007-store-accounts-payments/tasks.md
 - history/adr/0007-store-ledger-and-account-summary.md
tests:
 - none run in this stretch; the owner's phone walkthrough is reported, not seen
---

## Prompt

1. "Phone check first" (translated from Roman Urdu: the owner's answer when asked whether to merge the pull request or do the phone check first)
2. "On Home, 'No store owes you anything' has to be clicked in the first step" (translated from Roman Urdu)
3. "Stores are visible in Store accounts; I clicked a store and saw Record payment, Add opening balance, Adjust balance and Statement; now should I click Add opening balance" (translated from Roman Urdu)
4. "In the third step, generate a new order, confirm it and then issue the invoice, right?" (translated from Roman Urdu)
5. "During issue invoice the option Payment received now (optional) also came; does that mean I have to write what is being paid from the balance?" (translated from Roman Urdu)
6. "all test passed" (the owner's report after the walkthrough)

## Response snapshot

- Served the production build, which points at the DEV project, on the local network (a laptop address on the owner's Wi-Fi) for the phone check, and verified that it answered locally and over the network and that the build used the DEV project.
- Guided the owner through steps 1 to 5 of quickstart section 3 (the Home card, the account screen, the opening balance with its warning and the double-save check, the order and invoice flow, and what "Payment received now" means: cash received at delivery, applied to the store account oldest balance first, opening balance before invoices).
- The owner reported that all of it passed. Recorded it as "reported, not seen" (no screenshots or notes were sent; the real printer result and the tap count were not reported), ticked T073, and updated the ADR status line.
- Stopped the phone-check server. Nothing was merged; the owner has not yet asked for the merge.
