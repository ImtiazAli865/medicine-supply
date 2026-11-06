---
id: 001
title: Read docs and add project rules
stage: general
date: 2026-11-05
surface: agent
model: claude-sonnet-5-5
feature: none
branch: master
user: ImtiazAli865
command: (free-form request)
labels: ["setup","claude-md","project-rules","module-plan","open-questions"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - CLAUDE.md
 - history/prompts/general/001-read-docs-add-project-rules.general.prompt.md
tests:
 - none
---

## Prompt

This project is a Medicine Supply & Order Management app (mobile-first, Next.js + Supabase). We use the Spec Kit (SDD) workflow that is already set up in this folder.

Do these steps in order. Do NOT write any application code yet, and do NOT run "specify init" or create-next-app.

1. Read docs/master-prompt.txt and docs/negative-prompt.txt fully.

2. Open CLAUDE.md (created by Spec Kit). Add a short "Project rules" section that carries the key rules from the negative prompt (what must never be done). Do not delete or rewrite anything that is already in CLAUDE.md. Also add one line pointing to the two docs files as the source of truth.

3. Give me a short summary (max 25 lines) of what you understood: the main users, the core flows (orders, market list, invoice, store ledger/khata, payments, voice order), and the main rules about prices, the ledger, and the Gemini API being server-side only.

4. Propose the build modules in order. Module 001 must be only: login, products (catalog can start empty), and stores. For each module give one line on what it contains.

5. List any open questions or contradictions you found between the two docs. If there are none, say so. My current defaults: solo use, one selling price per product, no batch/expiry, English UI.

Then stop and wait for my approval before running /sp.constitution.

## Response snapshot

Read both docs fully. Appended a "Project rules" section (with source-of-truth pointer to docs/master-prompt.txt and docs/negative-prompt.txt) to the end of CLAUDE.md without altering existing content. Delivered a summary of users/flows/rules, a proposed module order (001 = login, products, stores), and open questions/contradictions. Stopped before /sp.constitution.

## Outcome

- ✅ Impact: CLAUDE.md now carries the negative-prompt rules; understanding, module plan and open questions delivered for approval.
- 🧪 Tests: none (no code written)
- 📁 Files: CLAUDE.md (appended section), this PHR
- 🔁 Next prompts: user approval / answers to open questions, then /sp.constitution
- 🧠 Reflection: Several spec ambiguities (offline invoice issue, delivered vs ordered qty, costing method, price snapshot timing) should be settled before the constitution and Module 001 spec.

## Evaluation notes (flywheel)

- Failure modes observed: none
- Graders run and results (PASS/FAIL): not run
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): resolve open questions before /sp.constitution
