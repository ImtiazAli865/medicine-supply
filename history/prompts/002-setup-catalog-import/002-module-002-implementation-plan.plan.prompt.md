---
id: 002
title: Module 002 implementation plan
stage: plan
date: 2026-11-06
surface: agent
model: claude-sonnet-5-5
feature: 002-setup-catalog-import
branch: 002-setup-catalog-import
user: ImtiazAli865
command: /sp.plan
labels: ["plan","architecture","csv-import","settings","sql-classification","module-002"]
links:
  spec: specs/002-setup-catalog-import/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/002-setup-catalog-import/plan.md
 - specs/002-setup-catalog-import/research.md
 - specs/002-setup-catalog-import/data-model.md
 - specs/002-setup-catalog-import/contracts/api.openapi.yaml
 - specs/002-setup-catalog-import/quickstart.md
 - history/prompts/002-setup-catalog-import/002-module-002-implementation-plan.plan.prompt.md
tests:
 - none
---

## Prompt

Go to /sp.plan

(No additional arguments were supplied to the command.)

## Response snapshot

Ran setup-plan, read the Module 002 spec and constitution, checked candidate libraries on the npm registry, and wrote the plan artifacts. Key decisions: read CSV/Excel in the browser (Papa Parse, read-excel-file, fflate zip inspection) and send only text rows; re-validate on the server; classify against the catalog in ONE SQL function used by both preview and import (so they cannot disagree); the confirmed import is a single transactional function with a client-generated import id (idempotent), a per-business advisory lock, and a preview fingerprint to refuse the import if the catalog changed; settings in a `business_settings` table with RLS and one narrow SECURITY DEFINER save function; checklist state derived from real data. The SheetJS `xlsx` npm package and `exceljs` were rejected. All constitution gates PASS before and after design. The agent-context script only changed CLAUDE.md line endings, which were restored.

## Outcome

- ✅ Impact: Module 002 plan and design artifacts complete; ADR-worthy decisions identified.
- 🧪 Tests: none run (planning only); test strategy defined (unit, PGlite database suite, Supabase integration incl. 5,000-row timing, Playwright at 360 px).
- 📁 Files: plan.md, research.md, data-model.md, contracts/api.openapi.yaml, quickstart.md
- 🔁 Next prompts: /sp.tasks for Module 002 (optionally /sp.adr first)
- 🧠 Reflection: the 4 MB JSON cap for import requests is a deliberate limit below common serverless body limits; a very wide 10,000-row file may need splitting. Library APIs (read-excel-file v9, write-excel-file v4) must be verified at install.

## Evaluation notes (flywheel)

- Failure modes observed: update-agent-context.ps1 again rewrote CLAUDE.md line endings only.
- Graders run and results (PASS/FAIL): constitution check PASS (pre and post design); OpenAPI YAML parses.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): n/a
