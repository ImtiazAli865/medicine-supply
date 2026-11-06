---
id: 001
title: Module 001 spec login products stores
stage: spec
date: 2026-11-05
surface: agent
model: claude-sonnet-5-5
feature: 001-auth-products-stores
branch: 001-auth-products-stores
user: ImtiazAli865
command: /sp.specify
labels: ["spec","auth","products","stores","rls","module-001"]
links:
  spec: specs/001-auth-products-stores/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/001-auth-products-stores/spec.md
 - specs/001-auth-products-stores/checklists/requirements.md
 - history/prompts/001-auth-products-stores/001-module-001-spec-login-products-stores.spec.prompt.md
tests:
 - none
---

## Prompt

Module 001 Foundation: login, products, and stores for the Medicine Supply & Order Management app. Scope ONLY: (1) Supabase email+password login/logout with session handling and protected routes; each user belongs to one business (solo use), every table carries business_id with RLS from the first migration; (2) Products: add, edit, view, search (debounced partial match on name, brand, generic name, strength, manufacturer, SKU), deactivate/reactivate (no hard delete); catalog may start empty; required fields are only product name and unit; optional strength, dosage form, manufacturer, pack size, SKU, purchase price, selling price, MRP; one selling price per product; unit gross profit shown internally; duplicate check before creating; NUMERIC money in PKR; (3) Stores: add, edit, view, search, deactivate/reactivate; only store name required; contact person, phone, address, notes optional; (4) mobile-first app shell with bottom navigation, loading/error/empty states with next-action prompts ("Add your first store", "Add your first medicine"), English UI; client-generated UUIDs for records. OUT OF SCOPE for this module: setup checklist, CSV import, orders, Quick Register from orders, market list, purchases, invoices, ledger/payments, voice/Gemini, offline sync, reports. Follow docs/master-prompt.txt, docs/negative-prompt.txt and .specify/memory/constitution.md (principles I-VIII). Success criteria must be testable, including RLS isolation between two businesses.

## Response snapshot

Created branch `001-auth-products-stores` and wrote the technology-agnostic spec: 5 user stories (sign-in P1, stores P1, products P1, mobile shell P2, business isolation P1), edge cases, 29 functional requirements, 10 measurable success criteria, assumptions and out-of-scope list. No clarification markers were needed. Quality checklist passed in one iteration.

## Outcome

- ✅ Impact: Module 001 spec ready for /sp.clarify or /sp.plan.
- 🧪 Tests: none (spec only); success criteria SC-003 and SC-005 define RLS and duplicate-prevention tests.
- 📁 Files: spec.md, checklists/requirements.md
- 🔁 Next prompts: /sp.plan for Module 001 (technology choices and schema go there)
- 🧠 Reflection: The create-new-feature script created the branch and spec.md but then printed a parameter-binding error and no JSON; paths were derived from the branch name instead.

## Evaluation notes (flywheel)

- Failure modes observed: create-new-feature.ps1 ended with "A positional parameter cannot be found that accepts argument 'prompts'" after creating the branch and spec file.
- Graders run and results (PASS/FAIL): spec quality checklist PASS
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): inspect the script's JSON-output step if it fails again
