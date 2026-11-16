---
id: 008
title: Module 007 TEST apply and verification
stage: green
date: 2026-11-16
surface: agent
model: claude-sonnet-5-5
feature: 007-store-accounts-payments
branch: 007-store-accounts-payments
user: ImtiazAli865
command: sp.implement
labels: ["migration","supabase-test","concurrency","rls","scale","e2e","verification","module-007"]
links:
  spec: specs/007-store-accounts-payments/spec.md
  ticket: null
  adr: history/adr/0007-store-ledger-and-account-summary.md
  pr: null
files:
 - supabase/migrations/0008_store_accounts.sql
 - src/components/accounts/EntryRow.tsx
 - tests/helpers/accounts.ts
 - tests/integration/accounts-api.test.ts
 - tests/integration/accounts-concurrency.test.ts
 - tests/integration/rls-accounts.test.ts
 - tests/integration/accounts-scale.test.ts
 - tests/unit/invoice-validation.test.ts
 - tests/e2e/account-invoice-entry.spec.ts
 - tests/e2e/account-issue-payment.spec.ts
 - tests/e2e/invoices-paid-status.spec.ts
 - tests/e2e/account-summary-print.spec.ts
 - tests/e2e/account-payment.spec.ts
 - tests/e2e/account-opening.spec.ts
 - tests/e2e/account-adjust-reverse.spec.ts
 - tests/e2e/account-statement.spec.ts
 - tests/e2e/touch-targets.spec.ts
 - tests/e2e/states.spec.ts
 - tests/e2e/shell.spec.ts
 - specs/007-store-accounts-payments/quickstart.md
 - specs/007-store-accounts-payments/tasks.md
 - history/adr/0007-store-ledger-and-account-summary.md
tests:
 - npx vitest run pglite (56 files, 651 tests passed)
 - npm test (1,204 of 1,207 passed; 2 unit tests updated for the new payment_status filter and fixed, 1 timing miss in product-search passed on rerun)
 - accounts-api 7, accounts-concurrency 9, rls-accounts 6, accounts-scale 7 (Supabase TEST project, all passed)
 - Playwright whole suite 405 passed, 195 skipped, 2 failed (Module 004 and 005 specs, passed on rerun alone); Module 007 specs all passed
 - npm run lint, npm run typecheck, npm run build passed
---

## Prompt

1. "i have signed in supabase now what i have to do" (the owner signed in to Supabase after being asked to apply migration 0008 to the TEST project)
2. "Run it now" (the owner's answer after the first Run click was refused by the permission system)
3. "Yes, do it" (translated from Roman Urdu; the owner answer to whether to write the remaining Supabase tests and the regression runs)

## Response snapshot

- Confirmed the open Supabase project was the TEST project, read the counts before (invoices 0, order lines 13, order events 7, stores 12), pasted the migration into the SQL Editor, and ran it after the owner's "Run it now"; read the counts after (unchanged, `in_account` column present, `ledger_entries` empty, 17 ledger functions).
- Ran `accounts-api` against the TEST project and fixed a wrong test expectation (`replayed` is `false` for a new entry).
- Ran the browser specs; fixed four wrong test expectations and one real finding (the invoice number link in an entry row was 19 px high; now 44 px).
- Wrote and ran the concurrency, isolation and scale tests on the TEST project; recorded measured times (all within the goals, one network outlier of 2.4 s).
- Ran the whole e2e suite and the whole `npm test`; fixed two Module 006 unit tests that the new `payment_status` filter changed; the remaining failures were timing misses that passed on rerun.
- Recorded the real results, including what was not run, in quickstart sections 6 and 7; ticked the verified tasks; updated the ADR-0007 status line.
- Stopped before the DEV project (T072), the owner's phone walkthrough (T073) and the pull request (T075); nothing is committed or pushed.
