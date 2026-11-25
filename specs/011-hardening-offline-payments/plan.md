# Implementation Plan: Hardening and Offline Payments

**Branch**: `011-hardening-offline-payments` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/011-hardening-offline-payments/spec.md`

## Summary

Module 011 closes the one gap the constitution names (recording a payment without the internet) and then checks, tightens and documents everything built in Modules 001 to 010. It adds no server table, function or route for payments and no new package.

Approach (details and rationale in [research.md](research.md)):

- **Offline payments are one more queue in the existing sync centre** (D1): a persisted `PaymentOp` record in a new device store, sent one at a time in recorded order after the store operations, with the existing backoff, leader election, status screen and sign-out protection. The key is the ledger entry id; the attempt is written before the send (D2); the server's idempotent `ledger_payment_add` makes a repeat harmless.
- **Honest wording and no balance on the phone** (D5): offline shows only what the supplier typed; online screens that show a balance add "pending sync" and "N payments waiting, PKR X, not counted yet"; customer printouts never mention it.
- **The guards are narrowed, not removed** (D4): "payment" is allowed only in the named payment-queue files and only at `$.waiting.payments` in the backup; balance, invoice, ledger, price and cost stay forbidden everywhere on the device.
- **Storage and backup versions** (D7): device schema 2 and backup file version 2, with version 1 still readable.
- **Hardening that can be proved by a test is a test** (D9, D10): a traceability table checked by a unit test, a route-auth scan, an RLS audit on PGlite and on the TEST project, a build-bundle secret scan and a recorded `npm audit`.
- **Known honesty gaps** (D11, D12): a visible notice when the offline worker cannot start, and a password reset path with a cross-device emailed link.
- **Test infrastructure** (D13): `deleteTenant` discovers every table with a business id (so it also cleans `business_settings` and the TEST-only voice tables), stops hiding errors and uses batches; scale tests clean up; a dry-run sweep script lists the leftover test businesses.
- **Evidence before change** (D14): Reports speed is measured three times; a covering index (migration 0012) is added only if the rule in D14 says so.
- **Documentation** (D15, D16): a `guides/` folder, a README status section, and a restore drill tried once.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24, PostgreSQL 17 on Supabase (unchanged)
**Primary Dependencies**: Existing stack only (Next.js 16.4, React 19, Tailwind 4, Supabase JS 2 and SSR, Zod 4, lucide-react). **No new packages.**
**Storage**: Browser IndexedDB (device schema 1 to 2: one new object store `paymentOps`) and the backup file (version 1 to 2). Supabase PostgreSQL unchanged; migration `0012` only if D10 or D14 finds a need (none planned).
**Testing**: Vitest unit tests (payment input rules, queue ordering and remap, sync centre with in-memory storage: once, lost answer, two tabs, restart, conflicts, pause; backup v2; the narrowed guards with planted words; route-auth scan; traceability; insecure-address logic; test-helper clean-up), PGlite (RLS audit of every table), integration on the TEST project (the real payment route through the device transport: replay, not found, key reused, refused), Playwright at 360 px (record offline and send once, conflicts, backup and restore with payments, pending-sync notes, the offline shell, password reset with a mocked verification, touch targets, five navigation items).
**Target Platform**: Android mobile browsers first; responsive to tablet and desktop
**Project Type**: Web application (the same single Next.js project)
**Performance Goals**: recording a payment offline is saved on the phone within 1 s; 30 waiting payments are sent in order in under 60 s on a normal connection; Reports speed rule of D14.
**Constraints**: no balance, invoice, ledger entry, price or cost on the device or in the backup; online-only actions say "Needs the internet"; controls at least 44 by 44 px at 360 px; five bottom-navigation items; no secret in browser code; everything committed in English.
**Scale/Scope**: 1 business / 1 owner; tens of waiting payments at most. New: one device store and its sync code, one shell screen, two small account-screen notes, a password-reset flow (3 routes, 2 forms), a notice component, a traceability table and a security record, guides. Changed: sync centre, device schema, backup file code, `RecordPaymentDialog`, `OfflineShell`, `shell-route`, proxy public list, sign-in form (one link), two static guards, `deleteTenant`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies to this module? | Gate result |
|-----------|-------------------------|-------------|
| I. Real functionality, no fakes | Yes | PASS: a waiting payment is real device data sent through the real route; nothing says recorded or synced before the server confirms; the password reset uses the real authentication service; every audit result is a real run; the traceability table cannot name a file that does not exist |
| II. Billing integrity and price snapshots | Touches nothing | PASS (n/a): no invoice, price or cost logic changes; invoice issuing stays online only |
| III. Append-only ledger | Yes (payments) | PASS: the only write is the existing idempotent payment function with the client key; no edit, no delete, no allocation on the phone; the balance is never computed or stored on the phone and is shown as pending sync while payments wait; a payment never goes to another store |
| IV. Medicine identification and order safety | Touches nothing | PASS (n/a) |
| V. Security, RLS and secrets | Yes (review) | PASS: the module adds the audit that proves RLS on every table and 401 on every route; the reset flow adds no secret to the browser and no open redirect; any table found without RLS is fixed by a migration in this module |
| VI. Server-side AI | No AI | PASS (n/a) |
| VII. Offline-first with honest sync | Yes (the point of Part A) | PASS: closes the tracked deviation of Modules 003 to 009 for payments; payments are queued with client keys and idempotency; "Saved on this phone" is never "Synced"; a stale payment cannot overwrite newer server data (append-only); unsynced items are never deleted without confirmation; invoice issuing stays online as the principle says |
| VIII. Mobile-first, verifiable delivery | Yes | PASS: 360 px and 44 px checks on every new screen; loading, error and empty states; lint, typecheck, test and build must run and only real results are claimed; the full browser suite is run and any failure is explained |

**Post-design re-check (after Phase 1)**: All gates still PASS. Risks recorded to revisit: (1) the narrowed guard must still catch "balance", "invoice" and "ledger" in the payment files (a test plants each word); (2) two writers of one payment (two tabs, or the online dialog and the queue) rely on the single id; (3) the password-reset email depends on the owner's email settings, so it is tested with a mocked verification and then tried once by the owner.

## Project Structure

### Documentation (this feature)

```text
specs/011-hardening-offline-payments/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── offline-payments.md          # device contract: answers to states, ordering, removal
│   ├── backup-file.v2.delta.json    # backup file version 2
│   └── auth-reset.openapi.yaml      # password reset routes
├── checklists/requirements.md
├── traceability.md      # filled during implementation (47 rows)
├── security-review.md   # filled during implementation (real outputs)
└── tasks.md             # Phase 2 output (/sp.tasks, not created here)
```

### Source Code (repository root)

```text
src/lib/accounts/payment-input.ts            # NEW: the amount, date and reference rules, shared by the online dialog and the offline form
src/lib/device/schema.ts                     # CHANGED: schema version 2, PaymentOpRecord, paymentOps store
src/lib/device/db.ts                         # CHANGED: upgrade step 2 for the real and in-memory databases
src/lib/device/payments.ts                   # NEW: build and validate a record, ordering, remap, removal rules, waiting totals (pure)
src/lib/device/payment-transport.ts          # NEW: POST the payment and map the answer (D3)
src/lib/device/sync-center.ts                # CHANGED: payment operations (record, send, resolve, remove, status counts)
src/lib/device/runtime.ts                    # CHANGED: wire the transport
src/lib/device/shell-route.ts                # CHANGED: a `payment` shell route
src/lib/backup/{file,client,preview,apply}.ts# CHANGED: version 2, waiting.payments, restore rules
src/components/offline/OfflinePaymentScreen.tsx   # NEW: store picker, form, waiting list with Remove
src/components/offline/DevicePaymentCard.tsx      # NEW: one waiting payment and its conflict choices
src/components/offline/{OfflineShell,OfflineProvider,SyncStatusSection,BackupSection,ImportPreview,SyncIndicator}.tsx  # CHANGED
src/components/accounts/PendingSyncNote.tsx  # NEW: the "pending sync" note for balances shown online
src/components/accounts/{RecordPaymentDialog,AccountScreen,AccountListItem,AccountsSummaryCard}.tsx  # CHANGED
src/components/shell/{AppShell,InsecureAddressNotice}.tsx   # NEW notice, CHANGED shell
src/app/(auth)/forgot-password/page.tsx  src/app/(auth)/reset-password/page.tsx   # NEW
src/app/auth/confirm/route.ts                # NEW: verifies the recovery link
src/components/auth/{ForgotPasswordForm,ResetPasswordForm}.tsx  # NEW; SignInForm CHANGED (one link)
src/lib/supabase/proxy.ts                    # CHANGED: two public paths
tests/helpers/supabase-test.ts               # CHANGED: deleteTenant fails loudly, batches
scripts/sweep-test-project.mjs               # NEW: dry-run list and --delete of leftover test businesses
guides/{supabase-setup,offline-and-sync,backup-and-restore,deployment}.md   # NEW
README.md                                    # CHANGED: final status section
tests/unit/            payment-input, device-payments, sync-center-payments, backup-payments, offline-guard (extended),
                       api-auth-routes, traceability, insecure-address, delete-tenant-helper, reset-password-form
tests/integration/     payments-queue-api (TEST project), db-rls-all-tables (PGlite), rls-audit-test-project
tests/e2e/             offline-payments, offline-payments-conflicts, offline-payments-backup, pending-sync-notes,
                       password-reset, hardening-touch-targets
```

**Structure Decision**: the same single Next.js project and layering. Payments reuse the sync centre's queue pattern; the shared amount and date rules are extracted once; the device code that may contain the word "payment" is limited to named files so the static guard stays meaningful.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|-----------|-----------|--------------------------------------|
| The Module 009 guard that forbade the word "payment" on the device is narrowed to named files (the owner is shown the exact diff of the guard before it is committed) | Waiting payments are device data now | Removing the word from the guard entirely would let a balance or ledger concept creep in unnoticed; a path-limited allow-list keeps every other forbidden word forbidden |
| The backup forbidden-key check allows the key `payments` at one path | The backup must carry waiting payments (a lost phone must not lose money) | A new unchecked section would escape the check; allowing one exact path keeps the check on everything else |

## Suggested ADR

📋 Architectural decision detected: offline payments as a queue in the sync centre with a client key, no balance on the phone and a "pending sync" note online, plus the narrowed device guards. Document reasoning and tradeoffs? Run `/sp.adr offline-payments-queue-and-pending-sync`
