---
id: 006
title: Module 010 implement reports and profit
stage: green
date: 2026-11-24
surface: agent
model: claude-sonnet-5-5
feature: 010-reports-profit
branch: 010-reports-profit
user: ImtiazAli865
command: /sp.implement
labels: ["reports","profit","implementation","module-010","green"]
links:
  spec: specs/010-reports-profit/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - supabase/migrations/0011_reports.sql
 - src/lib/reports/ (types, period, validation, labels, format, csv, repository, client)
 - src/app/api/reports/ (sales, purchases, stores, medicines, cost-missing, balances-note, export)
 - src/app/(app)/reports/ (hub, sales, purchases, stores, medicines, cost-missing, balances)
 - src/components/reports/ (shell, period chooser, group switch, badges, bar list, figure card, list controls, pager, six screens, hub)
 - src/app/(app)/page.tsx, src/app/(app)/settings/page.tsx, src/lib/device/shell-route.ts
 - tests/helpers/reports-db.ts and 21 new test files (unit, PGlite, TEST project, end-to-end)
 - specs/010-reports-profit/ (tasks ticked, contract and data model aligned, quickstart results)
tests:
 - npm run lint passed; npx tsc --noEmit passed; npm run build passed
 - 21 files, 149 tests passed (unit and PGlite, including the 5,000-invoice data set)
 - after the owner applied 0011 to TEST: reports-api 9/9; reports e2e 37/37; speed test passed (medians 1.3 to 2.0 s, cold first call 3.1 to 4.8 s); full npm test 1,659/1,660 (the one failure was the speed test cold-call rule, fixed); full Playwright 520 passed, 11 failed, then 10 passed alone and 1 real defect (Home card wording) fixed, 42/42 on the Home-related specs
---

## Prompt

Owner message (translated from Roman Urdu): "Yes, implement" (the answer to "Shall I start the implementation from T001?").

## Response snapshot

Implemented Module 010 up to the point that needs the TEST project. Baseline recorded first (lint and typecheck passed; npm test 1,509 of 1,511, the two failures being load-sensitive 2-second budgets in pending-scale that pass when run alone). Then: migration `0011_reports.sql` (read-only SECURITY INVOKER functions and one index: the shared sales-line base with both cost figures, sales, cost missing, purchases, sales by store and by medicine, the not-in-account note, and five small helpers); the pure TypeScript layer (periods in Pakistan time, validation, wording, CSV for six reports, the repository); seven routes; seven screens with loading, error, empty and offline states; the Home card, the Settings link and the offline shell's blocked-area line; and the tests. The owner's cost rule works on PGlite: 23 Nov bought 50 sold 55 gives 5 per unit, 24 Nov bought 58 sold 65 gives 7, and a later purchase never changes an earlier day. One slip was fixed on the way: a JavaScript replace turned `$$` into `$` in the migration, caught immediately by the schema test.

## Outcome

- ✅ Impact: all report functions, routes, screens, CSV and guards exist and pass every check that does not need the TEST project.
- 🧪 Tests: see the front matter. The full suites were not rerun after the last two small fixes (the speed-test rule and the Home card wording); the affected specs were.
- 📁 Files: see the front matter.
- 🔁 Next prompts: the owner applies `0011_reports.sql` to the TEST project (SQL editor); then run reports-api, the scale test, the e2e specs and the full npm test; owner decides about DEV, the commit and the pull request.
- 🧠 Reflection: reading the real triggers first (an issued invoice cannot be changed, lines can only be written while a draft) shaped the test helpers; a loose rule would have made every date test impossible.

## Evaluation notes (flywheel)

- Failure modes observed: my speed test left 250,000 order lines on the shared TEST project (the tenant helper ignores a delete that times out), which made other tests fail with statement timeouts until the leftovers were removed in small batches; the Home card wording broke an existing no-profit-word rule (found only by the full browser suite); `String.replace` with `$$` in the replacement text corrupted dollar quotes (fixed, caught by the schema test); shell heredocs with quotes failed twice (files written with the editor tool instead).
- Graders run and results (PASS/FAIL): lint PASS, typecheck PASS, build PASS, 149 unit and PGlite tests PASS; TEST-project tests not run.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): run the report e2e specs first against the TEST project before the long full test, to catch screen problems early.
