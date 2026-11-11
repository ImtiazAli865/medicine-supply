---
id: 008
title: Fix touch target findings
stage: refactor
date: 2026-11-06
surface: agent
model: claude-sonnet-5-5
feature: 002-setup-catalog-import
branch: 003-manual-orders
user: ImtiazAli865
command: fix the touch-target findings from the Module 001 walk-through
labels: ["touch-targets","accessibility","e2e","module-002"]
links:
  spec: specs/002-setup-catalog-import/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - src/components/setup/SetupChecklist.tsx
 - src/components/settings/SettingsForm.tsx
 - src/components/import/PreviewList.tsx
 - tests/e2e/fixtures.ts
 - tests/e2e/touch-targets.spec.ts
 - specs/001-auth-products-stores/checklists/requirements.md
tests:
 - tests/e2e/touch-targets.spec.ts (new test fails before the fix, passes after)
 - tests/e2e/shell.spec.ts, setup-checklist.spec.ts, settings.spec.ts, import.spec.ts (42 passed, mobile project)
---

## Prompt

Haan, theek karo

(Answer to: "Touch-target ki 2 chhoti kharabiyan abhi theek karun?")

## Response snapshot

Tests first: `smallTargets` now measures a checkbox or radio by its label row (tapping the label toggles it) and the touch-target spec waits for network idle and for the settings form before measuring; a new test creates a store and a medicine in a fresh business so the home checklist shows its "Open" links. Before the fix the new test failed with two "Open" links at 40 x 44 px. Fix: `min-w-11` on the checklist link, `shrink-0` on the Settings Account Summary checkbox and on the import preview "Create as a separate product" checkbox (it had shrunk to 16 px wide). After the fix: 42 e2e tests passed (mobile project: touch targets, shell, setup checklist, settings, import including the two 5,000-row timings), lint and typecheck pass, and the app was rebuilt with the dev project environment. The full e2e suite was not re-run in one go.

## Outcome

- ✅ Impact: The two findings from the walk-through are fixed and the test that missed them can no longer pass before content loads.
- 🧪 Tests: 42 passed (subset, mobile project), lint, typecheck; full suite not re-run.
- 📁 Files: see the list above; nothing committed.
- 🔁 Next prompts: commit these changes, then start `/sp.implement` for Module 003.
- 🧠 Reflection: measuring a checkbox by its label row is the standard reading of a tap target, but it is a rule change in the test, so it is stated in the helper's comment and in the checklist.

## Evaluation notes (flywheel)

- Failure modes observed: none.
- Graders run and results (PASS/FAIL): new test red before, green after.
- Prompt variant (if applicable): null
- Next experiment (smallest change to try): none.
