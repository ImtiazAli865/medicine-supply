---
id: 003
title: Module 004 task breakdown
stage: tasks
date: 2026-11-10
surface: agent
model: claude-sonnet-5-5
feature: 004-pending-products
branch: 004-pending-products
user: ImtiazAli865
command: /sp.tasks
labels: ["tasks","pending-products","quick-register","pending-prices","module-004"]
links:
  spec: specs/004-pending-products/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/004-pending-products/tasks.md
tests:
 - none (planning only)
---

## Prompt

Haan, tasks banao

## Response snapshot

- Wrote `specs/004-pending-products/tasks.md`: 64 tasks in 8 phases. Setup 3 (T001 to T003), Foundational 13 (T004 to T016: the whole `0004` migration in one file plus types, validation, repository and the test-project apply), US1 8, US2 7, US3 6, US4 8, US5 8, Polish and owner steps 11 (T054 to T064).
- Tests are included for every story (PGlite for the functions, Supabase for the API, concurrency, isolation and scale, Playwright at 360 px), written before the screens.
- Format check run on the file: all 64 lines have a checkbox, a sequential id, story labels only inside story phases, and a file path or command; five "run the tests" tasks were fixed to name their test files.
- Owner steps are explicit and not skipped: apply `0004` to the dev project only after the owner says so (T061), the phone walkthrough (T062), the ADR consent (T063), and the pull request only after PR #2 is merged (T064).
- Suggested MVP: Phases 1 and 2 plus US1; then US2, US4, US3, US5.
- Nothing committed yet; next step is `/sp.analyze`.
