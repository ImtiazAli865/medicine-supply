---
id: 009
title: Phone storage not starting on shared localhost
stage: red
date: 2026-11-27
surface: agent
model: claude-sonnet-5-5
feature: 012-store-rates
branch: 012-store-rates
user: ImtiazAli865
command: none
labels: ["bug","offline","identity","cookies","module-012"]
links:
  spec: specs/012-store-rates/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - src/lib/device/identity.ts
 - tests/unit/device-identity.test.ts
 - tests/e2e/offline-other-project-cookie.spec.ts
 - specs/012-store-rates/quickstart.md
tests:
 - tests/unit/device-identity.test.ts (the new case failed before the change; 11 passed after)
 - npm run lint, npx tsc --noEmit, tests/unit (83 files, 927 tests passed)
 - 8 browser tests on a production build, mobile, including the new one (passed)
---

## Prompt

Screenshot of Settings (translated from Roman Urdu: "the screenshot of settings"), then a screenshot of its lower part: there is no "Sync and backup" section (translated from Roman Urdu).

## Response snapshot

The section disappears only when the app thinks the sign-in cookie is another user's. It took the first Supabase cookie of any project on the same host name. It now reads only its own project's cookie. The owner was asked to reload and look for the section.

## Outcome

- Impact: the phone storage can start next to other projects' cookies; the owner then reported (translated from Roman Urdu: "it has appeared") that the section shows after a reload.
- Tests: see above; the full browser suite was not run again.
- Files: see the list above.
- Next prompts: the owner's reload; commit when the owner says.
- Reflection: the earlier browser tests always used a clean browser, so a shared host name was never exercised.

## Evaluation notes (flywheel)

- Failure modes observed: none new.
- Next experiment: test with leftovers of other apps in the browser, not only a clean profile.
