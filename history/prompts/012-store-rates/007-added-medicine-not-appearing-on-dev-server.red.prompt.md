---
id: 007
title: Added medicine not appearing on dev server
stage: red
date: 2026-11-27
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: none
labels: ["bug","order-editor","strict-mode","offline-storage","module-012"]
links:
  spec: specs/012-store-rates/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - src/lib/orders/dispose-when-gone.ts
 - src/lib/hooks/useOrderEditor.ts
 - tests/unit/dispose-when-gone.test.ts
 - specs/012-store-rates/quickstart.md
tests:
 - tests/unit/dispose-when-gone.test.ts (failed before the code existed, 2 passed after)
 - temporary development-server reproduction with a test account (failed before the fix, passed after; then deleted)
 - npm run lint, npx tsc --noEmit, tests/unit (83 files, 926 tests passed)
 - 35 related browser tests on a production build (passed; the full suite was not run again)
---

## Prompt

Adding an order is not working (translated from Roman Urdu). Then, with three screenshots of a new order showing "Added ALPRAZOLAM (ALPOFOZ) FOZA." and still "No medicines yet": I went into the order, searched a medicine and added it, but the order does not get added; "Confirm" should appear below and that does not come either (translated from Roman Urdu).

## Response snapshot

Reproduced exactly on the development server by making the phone storage unavailable: the screen's save machine was disposed by React's development double run of effects, so every edit was ignored while the screen still said "Added". Fixed by disposing only when the screen is really gone. The upgrade of the phone database from version 2 was checked and works. The owner was asked to reload, try again and send what Settings says about the phone storage.

## Outcome

- Impact: orders can be taken in the owner's browser again; the same screen was affected when editing a confirmed order on the development server.
- Tests: see above; the related browser tests on a production build passed afterwards.
- Files: see the list above.
- Next prompts: the owner's retry and the Settings screenshot.
- Reflection: the browser tests only run the production build, so a development-only fault could not show there.

## Evaluation notes (flywheel)

- Failure modes observed: a first reproduction with a fresh browser passed because its phone storage worked; the missing "Online" indicator in the screenshot was the clue.
- Next experiment: look at the connection indicator first when a screen behaves differently from the tests.
