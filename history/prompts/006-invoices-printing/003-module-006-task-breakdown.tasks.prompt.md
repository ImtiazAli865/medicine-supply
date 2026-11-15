---
id: 003
title: Module 006 task breakdown
stage: tasks
date: 2026-11-14
surface: agent
model: claude-sonnet-5-5
feature: 006-invoices-printing
branch: 006-invoices-printing
user: ImtiazAli865
command: /sp.tasks
labels: ["tasks","invoices","printing","module-006"]
links:
  spec: specs/006-invoices-printing/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/006-invoices-printing/tasks.md
tests:
 - none (task list only; the format was checked by a script: 66 tasks, all in the checklist format, ids T001 to T066 in order)
---

## Prompt

create the task

## Response snapshot

- `tasks.md` has 66 tasks: Setup 3 (T001 to T003), Foundational 12 (T004 to T015: failing schema tests, the whole migration `0007_invoices.sql` in six ordered parts, the run of all older suites because three Module 003 objects change, the shared TypeScript layer, and the owner step to apply the migration to the TEST project), US1 draft 11 (T016 to T026, MVP), US2 issue 9 (T027 to T035), US3 print A4 and thermal 5 (T036 to T040), US4 cancel and replace 6 (T041 to T046), US5 list, to-invoice and Home card 5 (T047 to T051), US6 order sheets A and B 4 (T052 to T055), Polish and owner steps 11 (T056 to T066: isolation, scale at 1,000 invoices and a 60-line invoice, touch targets and states, honesty sweep, quantities review, README, full verification, DEV apply, owner phone check, ADR consent and PHRs, pull request).
- 32 tasks are marked parallel. Shared files that must be edited one task at a time are listed in the dependency section.
- Tests are included for every story (PGlite for the rules, Supabase with two real users for isolation, concurrency and scale, Playwright at 360 px with print emulation and PDF text for the prints).
- Owner steps are explicit and need the owner's say-so: applying `0007` to TEST (T015) and DEV (T063), the phone walkthrough (T064), the ADR consent (T065) and the pull request (T066). Printing is verified in emulation, a real thermal printer is not claimed.

## Outcome and evaluation

- Not done yet: `/sp.analyze` (suggested before implementation, as for Module 005), the implementation and any commit (nothing is committed on this branch).
