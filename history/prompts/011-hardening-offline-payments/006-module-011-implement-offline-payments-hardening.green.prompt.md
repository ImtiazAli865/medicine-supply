---
id: 006
title: Module 011 implement offline payments and hardening
stage: green
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 011-hardening-offline-payments
branch: 011-hardening-offline-payments
user: ImtiazAli865
command: /sp.implement
labels: ["offline-payments","sync","backup","password-reset","security-review","test-infrastructure","module-011"]
links:
  spec: specs/011-hardening-offline-payments/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - src/lib/accounts/payment-input.ts
 - src/lib/device/schema.ts
 - src/lib/device/payments.ts
 - src/lib/device/payment-transport.ts
 - src/lib/device/sync-center.ts
 - src/lib/device/runtime.ts
 - src/lib/device/shell-route.ts
 - src/lib/device/worker-status.ts
 - src/lib/backup/file.ts
 - src/lib/backup/client.ts
 - src/lib/backup/preview.ts
 - src/lib/backup/apply.ts
 - src/lib/auth/reset.ts
 - src/lib/supabase/proxy.ts
 - src/components/offline/OfflinePaymentScreen.tsx
 - src/components/offline/DevicePaymentCard.tsx
 - src/components/offline/OfflineProvider.tsx
 - src/components/accounts/PendingSyncNote.tsx
 - src/components/accounts/RecordPaymentDialog.tsx
 - src/components/shell/InsecureAddressNotice.tsx
 - src/app/auth/confirm/route.ts
 - src/app/(auth)/forgot-password/page.tsx
 - src/app/(auth)/reset-password/page.tsx
 - tests/helpers/offline-guard.ts
 - tests/helpers/tenant-cleanup.ts
 - tests/helpers/supabase-test.ts
 - scripts/sweep-test-project.mjs
 - guides/supabase-setup.md
 - guides/offline-and-sync.md
 - guides/backup-and-restore.md
 - guides/deployment.md
 - specs/011-hardening-offline-payments/traceability.md
 - specs/011-hardening-offline-payments/security-review.md
tests:
 - unit: payment-input, device-payments, payment-transport, sync-center-payments (send, conflicts), backup payments (file, restore, forbidden keys), offline-guard, shell-route, insecure-address, reset-password-form, api-auth-routes, bundle-secrets, traceability, guides, delete-tenant-helper, sweep-script
 - integration: payments-queue-api, db-rls-all-tables (PGlite), rls-audit-test-project
 - browser (mobile): offline-payments, offline-payments-states, offline-payments-send, offline-payments-conflicts, offline-payments-protect, offline-payments-backup, offline-payments-touch-targets, pending-sync-notes, api-requires-session, insecure-address, password-reset, account-payment, offline-backup
---

## Prompt

Owner message (translated from Roman Urdu): "Yes, implement it" (Module 011: offline payments and hardening), after the analysis edits were applied.

## Response snapshot

Implemented Module 011 task by task. Part A: a cash payment can be recorded with no internet (shell route, device store `paymentOps`, schema version 2), kept as waiting until the server confirms it, sent once in order per store by the existing sync centre with the same key on every retry, refused payments kept as conflicts the supplier decides, pending-sync notes on every balance shown online (never on an invoice print or the statement), the online dialog's "Keep it on this phone" bridge, and backup file version 2 with waiting payments only. Part B: a 47-row traceability table (the master prompt has 16 acceptance criteria, not 15, so the spec was corrected), a recorded security review (RLS on all tables, every route needs a session, no secret in the bundle, npm audit), the insecure-address notice, a password reset by emailed link, an honest tenant clean-up helper and a sweep script, and four guides.

## Outcome

- Impact: the constitution's offline payment requirement is met; hardening is recorded with real outputs.
- Tests: see the list above. Real results (quickstart section 6): lint, typecheck and build pass; `npm test` 193 files, 1,921 tests passed; browser suite 560 passed, 7 failed in the long run and all passed when re-run alone (one was a real race in a test that the new honest clean-up found).
- Files: see the list above.
- Next prompts: owner steps (password reset email setup, leftover sweep yes, phone trial, pull request).
- Reflection: the guard narrowing (payment word allowed only in named files) is the one change to a rule the owner approved in Module 009; its diff is to be shown before any commit.

## Evaluation notes (flywheel)

- Failure modes observed: tests that read the first phone database when two businesses share a phone; numbers from the service API arrive as numbers, not text; vitest runs a function returned from `beforeEach` as a cleanup.
- Next experiment: run the whole suites once more from a clean state before the pull request.
