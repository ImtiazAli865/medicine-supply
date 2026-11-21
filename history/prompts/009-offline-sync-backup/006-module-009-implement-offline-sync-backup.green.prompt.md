---
id: 006
title: Module 009 implement offline sync backup
stage: green
date: 2026-11-21
surface: agent
model: claude-sonnet-5-5
feature: 009-offline-sync-backup
branch: 009-offline-sync-backup
user: ImtiazAli865
command: /sp.implement
labels: ["implement","offline","sync","backup","indexeddb","service-worker","module-009"]
links:
  spec: specs/009-offline-sync-backup/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - src/lib/device/ (schema, db, identity, connectivity, cache, local-api, journal, sync-center, locks, shell-route, conflict, runtime, store-transport, backoff)
 - src/lib/backup/ (file, preview, apply, client, export-repository)
 - src/lib/orders/autosave.ts, save-transport.ts, src/lib/api/client.ts, src/lib/hooks/useOrderEditor.ts
 - src/components/offline/ (OfflineProvider, SyncIndicator, DeviceNotes, OfflineShell, ConflictPanel, DeviceOrderCard, DeviceStoreCard, SyncStatusSection, BackupSection, ImportPreview, ExportOffer, useBackupExport)
 - src/app/offline/page.tsx, src/app/api/ping/route.ts, src/app/api/backup/export/route.ts, public/sw.js, scripts/make-sw-assets.mjs
 - tests (unit, integration, e2e) listed in specs/009-offline-sync-backup/quickstart.md section 6
tests:
 - npm test 151 files, 1,511 tests (2 hosted-database latency tests failed once, passed alone); full Playwright 772 tests, 473 passed, 19 failed (sleep/timeouts and 2 test fixes), 17 passed on rerun alone and the other 2 after test edits; details in quickstart section 6
---

## Prompt

Owner message that led to this stage (translated from Roman Urdu where marked): "Yes, continue" (translated from Roman Urdu), the answer to the offer to start /sp.implement after the analysis fixes were committed (810d994).

## Response snapshot

Implemented Module 009 following tasks.md: baseline, the gating spike (Playwright `setOffline` also cuts the service worker's requests, so the offline specs use it), the pure device layers with unit tests (storage contract on an in-memory implementation, identity, connectivity, cache, local answers, journal, sync centre, conflicts, backup), the service worker and the client-only offline page, the autosave journal extension, then the six user stories with browser tests run against the production build. Real defects found and fixed while testing (the full end-to-end run later added three more: the offline provider's context caused a brief duplicate of the page content, a second tab could not send its own changes, and Retry did nothing while the connection flag said offline):  a test helper that returned before the device copy was complete, "keep the phone version" re-sending line ids the server had removed (phone lines not active on the server now get new ids), the shell reporting "sign in" instead of "unavailable" when the browser could not read its storage, missing device notes on the new-order screen, export and import trusting a connection flag instead of trying the server, and the unauthorised 401 handling during background sending. No migration and no new npm package were needed; `package.json` differs only in the `build` script.

## Outcome

- ✅ Impact: Module 009 implemented; verification counts are in quickstart section 6.
- 🧪 Tests: see quickstart section 6 (final verification table).
- 📁 Files: see the list above.
- 🔁 Next prompts: the owner's airplane-mode trial (quickstart section 5), commit when told, then the pull request when told.
- 🧠 Reflection: A playwright `waitForFunction` with an async function returns at once; polling with `expect.poll` is the right pattern for the device state.

## Evaluation notes (flywheel)

- Failure modes observed: see the response snapshot.
- Graders run and results (PASS/FAIL): see quickstart section 6.
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): none.
