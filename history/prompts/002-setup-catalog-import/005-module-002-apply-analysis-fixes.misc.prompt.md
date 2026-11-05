---
id: 005
title: Module 002 apply analysis fixes
stage: misc
date: 2026-11-06
surface: agent
model: claude-sonnet-5-5
feature: 002-setup-catalog-import
branch: 002-setup-catalog-import
user: ImtiazAli865
command: (reply to /sp.analyze remediation offer)
labels: ["analyze","remediation","spec","plan","tasks","module-002"]
links:
  spec: specs/002-setup-catalog-import/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/002-setup-catalog-import/spec.md
 - specs/002-setup-catalog-import/plan.md
 - specs/002-setup-catalog-import/research.md
 - specs/002-setup-catalog-import/data-model.md
 - specs/002-setup-catalog-import/tasks.md
 - history/prompts/002-setup-catalog-import/005-module-002-apply-analysis-fixes.misc.prompt.md
tests:
 - none (documentation edits only)
---

## Prompt

Yes, apply fixes

## Response snapshot

Applied all 15 findings from the analysis. Spec: template headings stay exact and "required" is stated on the Import screen and in an xlsx Instructions sheet (FR-013, AC1); summary has its own address and refresh-safe confirm (AC12); 4 MB request limit stated (FR-015, edge case); SC-002 defines the connection and measures browser plus server time. Research D7/D11 updated (sessionStorage pending id, `?import=<id>`, ASCII `EXAMPLE` marker). Data model: settings table has its own trigger that does not bump `version` on dismiss; `save_business_settings` upserts a missing row; `imports` UNIQUE (business_id, id) and composite FK from products. Plan: file structure lists body.ts, setup repository, import-files helper and all tests. Tasks: T002 test-file helper (damaged, protected, macro, too large/many/wide, 5,000-row), T004–T006 migration details, T017/T027/T031 template, T019 concurrent different ids, T020/T021 5,000-row browser timing and bad-file and refresh cases, T032 refresh safety and 4 MB check, T033 verify-only, T045/T046/T049 isolation and signed-out checks moved to where routes exist, T060 SC-001/SC-012 human timings. Task count stays 62 and all lines keep the required format.

## Outcome

- ✅ Impact: 2 HIGH, 7 MEDIUM and 6 LOW findings resolved in the artifacts; no code written.
- 🧪 Tests: none run; test tasks strengthened.
- 📁 Files: spec.md, plan.md, research.md, data-model.md, tasks.md
- 🔁 Next prompts: /sp.implement
- 🧠 Reflection: quickstart.md and the OpenAPI contract needed no change.

## Evaluation notes (flywheel)

- Failure modes observed: one edit failed on first try because the task text differed from memory; fixed after re-reading.
- Graders run and results (PASS/FAIL): task format validation (see response)
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): n/a
