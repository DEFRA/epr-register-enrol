## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Low

## What to build

Finalise the step 1 (pending-contact) state labels and badge colours, following user decisions made on 2026-10-22. These replace the provisional "Refusing" wording and the provisional light-blue/orange colours (commit e7d402d marked them provisional).

1. **Rename "Refusing" to "Refused".** The display name of `rejected-pending-contact` becomes **"Refused"**, the same text as the final `rejected` state. Both refusal states then show "Refused" everywhere in the CM UI.
   - management-be: the state's display name in `ReAccreditationType` (v17). The v17 snapshot migration (`ReAccreditationPendingContactSnapshotMigration`) must also correct the display name on items already stamped v17 by an earlier build: change "Refusing" to "Refused" only when needed, keeping it idempotent, in the same way it already adds only what's missing. Do **NOT** bump to v18: v17 is the single version bump for the whole ticket and is unreleased.
   - management-fe: `src/server/work-items/re-accreditation/module.js` (the state entry), and any other place the label text appears.
   - Any backend-supplied display name (e.g. `toStateDisplayName` in audit details) follows automatically. Check that nothing still says "Refusing".
2. **Badge colours** (`src/server/work-items/core/state-badge.js` in management-fe):
   - `approved-pending-contact` ("Approved") uses the **same colour as Granted** (`approved`, currently `govuk-tag--green`).
   - `rejected-pending-contact` ("Refused") uses the **same colour as the final Refused** (`rejected`, currently `govuk-tag--red`).
   - Check other places that colour state or outcome tags (e.g. `src/server/routes/work-items/application-summary.js` around lines 200–210) and keep them consistent.
   - Side effect worth noting in the task notes: "Approved" no longer shares light blue with "Awaiting decision".
3. **Worklist Status filter** (`src/server/routes/work-items/controller.js`, around line 200): replace the separate "Refusing" option with **one "Refused" option** whose `stateIds` cover both `rejected` and `rejected-pending-contact`. Merge it into the existing "Refused" option; don't add a second one. "Approved" (`approved-pending-contact`) and "Granted" (`approved`) stay as separate options. Check how filter values reach the backend list query, so the combined option returns items in both states. Look at how other multi-state options, if any, are handled.
4. **Start date and year: confirm only, no change expected.** Task 007 already made step 1 stamp only `accreditationId`, with step 2 stamping the start date and year. The CM UI shows neither until after step 2. Verify that this still holds and that tests cover it.
5. **Tests and docs:**
   - management-fe and management-be unit tests for the label, colours, filter and migration.
   - mgmt-tests: update page objects and specs, including `ra-527-two-step-determination.e2e.js` and any task 005/006/009 assertions, that expect "Refusing", the old colours, or a separate Refusing filter option.
   - Spec `.tasks/spec-ra-527-two-step-determination.md`: replace "Refusing" and the provisional colours with the final decisions, and describe the single Refused filter option.
   - Remove "PROVISIONAL" comments about the wording and colours in code.
   - Update `.tasks/011-HITL-Low-full-stack-verification-and-sign-off.md`: the user has now decided the tag wording and colours, so drop them from the "design or product confirm" item. Keep asking design to confirm the refusal banner copy ("Application refused…", "…accreditation is refused").

Repos: management-be, management-fe, mgmt-tests, and the parent (spec, task file, submodule pointers).

## Acceptance criteria

- [ ] `rejected-pending-contact` displays as "Refused" in the CM UI (badge, summary and history), and no "Refusing" text remains in code, tests or spec.
- [ ] management-be v17 type and snapshot migration use "Refused". The migration fixes items already stamped v17 with "Refusing", is idempotent, and is tested. No v18.
- [ ] Badges: Approved (step 1) matches Granted's colour; Refused (step 1) matches the final Refused colour.
- [ ] Status filter: one "Refused" option that returns both `rejected` and `rejected-pending-contact` items, with no "Refusing" option. "Approved" and "Granted" stay separate.
- [ ] Start date and year are still set only at step 2 and not shown before then (verified, with tests).
- [ ] mgmt-tests specs and page objects are updated. Lint and format check pass. Browser specs need the full stack (task 011).
- [ ] Quality gates: management-be format check and full test suite; management-fe lint, format check and tests.
- [ ] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed. Nothing pushed.

## Blocked by

- `.tasks/009-AFK-Medium-e2e-two-step-determination-spec.md`
