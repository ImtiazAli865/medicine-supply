# Implementation Plan: Offline Order Taking, Automatic Sync and Backup

**Branch**: `009-offline-sync-backup` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/009-offline-sync-backup/spec.md`

## Summary

The supplier keeps taking orders when the signal is slow or gone. The phone keeps a copy of the active medicines and stores, writes every change to its own storage first ("Saved on this device"), and sends the orders to the server by itself when the connection returns, exactly once, in the order they were made. A change that the server cannot take is held, never dropped; a change that clashes with a newer server copy shows both versions and waits for the supplier's choice. Stores and typed medicines made offline sync in order without being matched or merged. A backup file can be exported and imported with a preview and duplicate protection. A Settings section shows the state.

Technical approach (details in [research.md](research.md)): **no migration and no new package.** The existing idempotent `order_save` and store create are the server side. On the device, raw IndexedDB (one database per business) holds the copy and a draft journal. The existing autosave state machine gains a journal and an `on_device` status, and a client-side `SyncCenter` keeps unsynced drafts retrying after the screen is closed. A hand-written service worker keeps the app files and a client-only shell page so the app opens offline; the shell reuses the order screens, whose `GET` requests are answered from the device copy when the network fails. Two small read-only routes are added: `/api/ping` and `/api/backup/export`.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19.3, Next.js 16.4.5 App Router, Node 24 for tests.
**Primary Dependencies**: existing only: `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `lucide-react`, Tailwind 4. Browser APIs used directly: IndexedDB, Service Worker and Cache Storage, Web Locks (`navigator.locks`), BroadcastChannel, `Blob` download. **No new npm package** (the plan found none needed; a test double for IndexedDB is a small in-memory class in `tests/helpers`).
**Storage**: Supabase PostgreSQL stays the authority (unchanged, no migration). On the device: IndexedDB `medsupply-registry` and `medsupply-<businessId>` ([data-model.md](data-model.md)); Cache Storage for the app files. LocalStorage is not used for data.
**Testing**: Vitest (unit; integration against the TEST project and PGlite), Playwright on the production build against the TEST project (mobile project 360 px for the offline specs). Offline is switched on with `context.setOffline` or, if the spike shows the worker ignores it, by stopping a second server ([quickstart.md](quickstart.md) section 3).
**Target Platform**: Chrome on Android (the owner's phone) and desktop Chrome; mobile-first, 360 px.
**Project Type**: web application (single Next.js project).
**Performance Goals**: journal write median under 50 ms and never on the typing path; offline search of 5,000 medicines under 300 ms (the Module 008 local filter, about 1 ms); 20 queued orders sent within 60 s of the connection returning (one request each, about 0.3 s at 250 ms round trip); cache refresh of 5,000 medicines under 5 s on a normal connection; app files 1.7 MB cached once per build.
**Constraints**: online only for confirm, edit/cancel of confirmed orders, invoices, payments, purchases, prices, reports; foreground sync only; no background push; nothing of one business reachable by another; no price of any kind in the backup; no purchase price, MRP or cost on the device.
**Scale/Scope**: one supplier per business; hundreds of orders, up to a few thousand medicines, dozens of stores, dozens of waiting orders, up to 200 lines per order.

## Constitution Check

*GATE: passes before research; re-checked after design (below).*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Real functionality, no fakes | Every offline claim has a test that runs the real browser offline; the UI says "Saved on this device" only after a real IndexedDB write and "Saved"/"Synced" only after the server confirmed; the spike decides how the network is really cut. Nothing is stubbed. | Pass |
| II. Billing integrity | Confirming (where prices are snapshotted) stays online; drafts carry no snapshot; the cached selling price is labelled "last known price" and never becomes a line price; invoices untouched. | Pass |
| III. Ledger append-only | No ledger, payment or invoice work offline (see Complexity Tracking for the constitution's payment wording). No balance on the device or in the backup. | Pass (deviation acknowledged by the owner) |
| IV. Medicine identification and order safety | Typed lines sync exactly as typed, never matched or merged; a line whose medicine is gone is held, not dropped or replaced; a store typed offline is never merged with a similar one without asking; one store's lines never move to another store; unsynced orders are never deleted without confirmation; works with an empty catalog and no stores. | Pass |
| V. Security, RLS and secrets | No server change widens access: every request runs with the user's session and row level security; the new export route reads as the user with explicit columns; `/api/ping` returns nothing; no secret reaches the browser or the backup; the device database is per business; a different user never opens it. A migration is not needed (none to approve). | Pass |
| VI. Server-side AI | No AI in this module. | Not applicable |
| VII. Offline-first with honest sync | IndexedDB holds the cache, drafts and the queue; client-made ids and request ids; conflict detection by server versions; no overwrite of newer server data; no deletion of unsynced orders without confirmation; "Saved on this device" and "Synced" are different states. Payment recording offline is deferred by the owner (Complexity Tracking). | Pass (deviation acknowledged by the owner) |
| VIII. Mobile-first, verifiable delivery | 360 px checks, loading, error, empty and offline states on every new screen; lint, typecheck and build clean; nothing claimed that was not run. | Pass |

**Post-design re-check (after Phase 1)**: the design adds no migration, no package and no secret; the two new routes are read-only; the device boundary is the database name. No new violation.

## Project Structure

### Documentation (this feature)

```text
specs/009-offline-sync-backup/
├── plan.md              # This file
├── research.md          # Phase 0 decisions D1-D13
├── data-model.md        # Device databases, draft journal, backup file
├── quickstart.md        # Verification steps, spike rule, owner trial
├── contracts/
│   ├── api.openapi.yaml         # /api/ping, /api/backup/export
│   └── backup-file.schema.json  # backup file v1
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/sp.tasks, not created here)
```

### Source Code (repository root)

```text
public/
└── sw.js                          # the service worker (plain JavaScript); sw-assets.json is generated, git-ignored
scripts/
└── make-sw-assets.mjs             # run after `next build`: lists .next/static and the shell route
src/
├── app/
│   ├── offline/page.tsx           # client-only offline shell (outside the (app) group; public in the proxy)
│   ├── (app)/layout.tsx           # + passes userId and businessId to the provider
│   └── api/
│       ├── ping/route.ts          # GET, no sign-in, no database
│       └── backup/export/route.ts # GET, paged, explicit safe columns
├── lib/
│   ├── api/client.ts              # + timeouts, + local-answer hook for a fixed list of GETs, + connectivity reports
│   ├── supabase/proxy.ts          # + /offline public; matcher skips /sw.js and /sw-assets.json
│   ├── orders/autosave.ts         # + journal, + canSend, + on_device status (backward compatible)
│   ├── hooks/useOrderEditor.ts    # opens the draft through the SyncCenter; wording and confirm gating
│   ├── backup/                    # export route repository, file build, parse/validate, import preview
│   └── device/                    # db.ts, schema.ts, identity.ts, cache.ts, local-api.ts, journal.ts,
│                                  # sync-center.ts, backoff.ts, connectivity.ts, locks.ts, backup glue
├── components/
│   ├── offline/                   # OfflineProvider, OfflineShell, SyncIndicator, ConflictPanel,
│   │                              # SyncStatusSection, BackupSection, ImportPreview, DeviceNotes
│   ├── orders/                    # OrderEditor, SaveStatus, OrderScreen, NewOrderStart, StoreSelector,
│   │                              # OrderHistory (offline wording, store-made-offline, confirm gating)
│   ├── settings/SettingsForm.tsx  # hosts the "Sync and backup" section
│   └── shell/AppShell.tsx         # header SyncIndicator, provider, worker registration
tests/
├── helpers/                       # memory-storage.ts (in-memory DeviceStorage), offline.ts (goOffline / second server)
├── unit/                          # journal, autosave-journal, sync-center, backoff, local-api, identity, backup
├── integration/                   # backup-export.test.ts (two tenants), offline-replay.test.ts
└── e2e/                           # offline-*.spec.ts (list in quickstart section 4)
```

**Structure Decision**: one Next.js project as in Modules 001 to 008. All new logic is framework-free TypeScript in `src/lib/device` and `src/lib/backup` (unit-testable with an in-memory storage); components stay thin. The worker is plain JavaScript only because the app has no bundler step for it, and it holds no business logic.

## Design Notes

### Interfaces and contracts

- New routes: see [contracts/api.openapi.yaml](contracts/api.openapi.yaml). Error taxonomy reuses `unauthenticated` (401), `no_business` (403), `validation_error` (400).
- Unchanged routes used by the queue and their refusals (all mapped to a plain reason, none retried blindly): `PUT /api/orders/{id}` (`version_conflict`, `order_not_editable`, `store_locked`, `store_not_found`, `store_inactive`, `invalid_lines`), `POST /api/stores` (`similar_store`, `unusable_id`).
- Idempotency and retries: the request id of an unresolved request is stored in the journal before the send and reused until the server answers; timeouts become network failures (GET 15 s, other 20 s); retries use growing delays (2 s, 5 s, 15 s, 45 s, then 2 minutes) with a Retry button always available; a 401 pauses all sending and asks the same user to sign in again without leaving the screen (sync sends use `onUnauthorized: "event"`).
- Versioning: the device schema is versioned (`schemaVersion` 1) with an upgrade function per version; the backup file has `version: 1` and an unknown version is refused.

### Key decisions and ADR

Decided in [research.md](research.md): D1 no migration or package, D2 per-business IndexedDB, D3 hand-written worker and client-only shell, D4 offline identity, D5 journal in the autosave machine plus a sync centre (foreground only, one sender per business by Web Lock), D6 journal record and device-side conflicts, D7 local answers behind `fetchJson`, D8 device copy and refresh, D9 connectivity by real answers, D10 money actions stay online, D11 backup built on the queue, D12 offline testing, D13 honest wording.

📋 Architectural decision detected: offline architecture (per-business device database, service-worker shell, journalled autosave plus sync centre, local answers for reads). Document reasoning and tradeoffs? Run `/sp.adr offline-first-device-sync`.

### Non-functional requirements and budgets

- Performance: see Technical Context. The typing path never waits for IndexedDB (writes are queued and coalesced; the status shows "Saving…" until the write completes).
- Reliability: a crash or closed tab leaves the draft either as before or as after the change (one transaction per write with a `rev` check); an unresolved request survives a restart; a refresh of the device copy never leaves half a list.
- Security: nothing new is trusted from the browser; the cookie's user id only chooses which device database to open; every server call is checked by the real session and row level security; the backup holds no secret or price; "Clear device data" is available.
- Degradation: if IndexedDB is unavailable (private window, storage full) the app says so and works online exactly as today; if the service worker cannot register, only the offline reload is lost.

### Operational readiness

- Observability: the Settings section is the status screen (state counts, last sync, last error text per item); failures keep their plain reason; no secrets in any message.
- Rollback: the module changes no server data. Turning it off means removing the journal option from the editor and the worker registration; the device data is harmless and can be cleared from Settings. A worker version change deletes older caches.
- Build: `npm run build` becomes `next build && node scripts/make-sw-assets.mjs`; `public/sw-assets.json` is git-ignored.

## Risks

1. **Offline testing in Playwright** (worker network not cut by `setOffline`). Blast radius: tests only. Guardrail: the spike (T001) decides between `setOffline` and the stop-the-server helper before any offline spec is written.
2. **Existing online behaviour changing by accident** (the journal touches the autosave machine, `fetchJson` and the editor). Guardrail: the journal is optional, the manual (confirmed-order) mode is untouched, the existing Module 003 to 008 specs run unchanged except for the listed wording changes ("Not saved" after a lost connection becomes "Saved on this device, not yet sent"); the Module 008 specs that simulate a failed read by aborting a request call `blockDeviceStorage(page)` so they keep testing the online failure, with one new test per kind for the device-labelled answer; the whole suite runs before the PR.
3. **A silent overwrite or duplicate through a sync bug.** Guardrail: the server's request id and version checks stay the final authority; "keep the phone version" re-bases on the server version and shows a preview first; every conflict kind has a test; the kill switch is that sending can be paused from Settings (items stay on the device).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Constitution Principle VII says payment recording MUST work offline; this module keeps payments online only (the owner's brief for Module 009 lists payments as out of scope). | The ledger needs its own design (pending-sync balance, payment allocation order, conflicts with later invoices) and the owner asked for orders first. Nothing in the data model blocks a later module from adding it (payments already carry client idempotency keys). | Adding offline payments here would double the scope and risk the ledger rules; leaving the constitution text unchanged and recording the deferral is the smallest honest step. **Owner acknowledged on 2026-11-19** ("yes, later"): offline payments are deferred to a later module that completes Principle VII; the constitution text is not amended now. |
