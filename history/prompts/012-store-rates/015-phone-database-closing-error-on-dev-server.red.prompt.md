---
id: 015
title: Phone database closing error on dev server
stage: red
date: 2026-11-28
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: none
labels: ["bug","offline","dev-server","module-012"]
links:
  spec: specs/012-store-rates/spec.md
  ticket: null
  adr: null
  pr: https://github.com/ImtiazAli865/medicine-supply/pull/12
files:
 - src/components/offline/OfflineProvider.tsx
 - src/lib/device/cache.ts
 - src/lib/device/runtime.ts
 - tests/unit/device-cache.test.ts
tests:
 - tests/unit/device-cache.test.ts (the new case failed before the change)
 - npm run lint, npx tsc --noEmit, tests/unit (83 files, 928 tests passed)
 - temporary reproduction on the development server with a test account (7 page errors before the change, 0 after)
 - offline and store-price browser tests on a production build (still running when this was written)
---

## Prompt

Two screenshots without text: the development overlay showing "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing", and the store page with its remembered price.

## Response snapshot

React's development double run of effects started the phone storage twice; the discarded run closed its database while its first refresh was still reading it. The start now waits one tick so a discarded run never starts, and the freshness check and cache age question no longer reject when the database is closing.

## Outcome

- Impact: the error no longer appears; the failing step was only a read.
- Tests: see above; the full browser suite was not run again.
- Files: see the list above, not committed.
- Next prompts: results of the browser tests, then commit when the owner says.
- Reflection: browser tests run a production build, which does not run effects twice.

## Evaluation notes (flywheel)

- Failure modes observed: the third fault found only on the development server.
- Next experiment: add a development-server smoke check to the module checklist.
