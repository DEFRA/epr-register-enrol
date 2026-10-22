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

- [x] `rejected-pending-contact` displays as "Refused" in the CM UI (badge, summary and history), and no "Refusing" text remains in code, tests or spec.
- [x] management-be v17 type and snapshot migration use "Refused". The migration fixes items already stamped v17 with "Refusing", is idempotent, and is tested. No v18.
- [x] Badges: Approved (step 1) matches Granted's colour; Refused (step 1) matches the final Refused colour.
- [x] Status filter: one "Refused" option that returns both `rejected` and `rejected-pending-contact` items, with no "Refusing" option. "Approved" and "Granted" stay separate.
- [x] Start date and year are still set only at step 2 and not shown before then (verified, with tests).
- [x] mgmt-tests specs and page objects are updated. Lint and format check pass. Browser specs need the full stack (task 011).
- [x] Quality gates: management-be format check and full test suite; management-fe lint, format check and tests.
- [x] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed. Nothing pushed.

## Blocked by

- `.tasks/009-AFK-Medium-e2e-two-step-determination-spec.md`

## Notes

Done. Commits on `feature/ra-527`: management-fe `ab25da1`, management-be `28eebcd`, mgmt-tests `6040184`. The parent commit bumps all three pointers.

- **Label.** `rejected-pending-contact` reads "Refused" in management-be `ReAccreditationType` (still v17) and in management-fe `module.js`. Audit `toStateDisplayName` follows from the backend. The step 1 refusal and the final refusal now look identical in the tag. The state id, the persistent "Application refused" banner and the "Confirm applicant contact" button tell them apart. The mgmt-tests helpers rely on `logDecision`, which asserts the state id.
- **Migration.** The frozen v17 literal is now "Refused". `ReAccreditationPendingContactSnapshotMigration` replaces in place any pending-contact state that is declared differently from the frozen v17 one, and only when needed, so it stays idempotent. Decision: it compares the whole frozen record (id matched case-insensitively), not the string "Refusing". So no production code carries the old label, and it would also correct a stale "Approved" or `IsTerminal` (neither exists). There is no v18. A new Mongo theory covers it: an item stamped v17 with "Refusing" gets only that label fixed, stays v17, nothing else changes, and a second run writes nothing. The only "Refusing" left in code is that test's seed of the old label, plus English verb uses.
- **Colours.** `approved-pending-contact` is green and `rejected-pending-contact` is red. Tests pin each pending state to its final state's colour. Side effect: "Approved" no longer shares light blue with "Awaiting decision", which is now the only light-blue state, and no state uses orange. `application-summary.js` lines 200–210 colour only the file scan status, so they did not change.
- **Filter: how the combined Refused option reaches the backend.** `STATUS_FILTER_OPTIONS` `{ value: 'rejected', text: 'Refused', stateIds: ['rejected', 'rejected-pending-contact'] }`. `readFilters` flattens the selected groups' `stateIds`, the same mechanism "Updated" uses for two ids. `getWorkItems` sends them as repeated `stateId=` params, and management-be's `WorkItemPersistence` matches them with `In`. Approved and Granted stay separate. A stale `status=rejected-pending-contact` URL or session token is dropped like any unknown value (tested). That is acceptable because the feature is unreleased. Archiving is not affected: terminal items archive after 7 days, and the filter is independent of `includeArchived`.
- **Start date and year:** verified unchanged. They are stamped only at step 2 and hidden before it. Coverage: management-be `RecordApprovedDeterminationAsync_stamps_only_the_accreditation_id` and the `ApproveAsync` step 2 stamping tests; management-fe `detail.pending-contact.route.test.js` "no start date or year rows"; the e2e row-key assertions.
- **mgmt-tests.** `driveToRefusingPendingContact` is renamed to `driveToRefusedPendingContact`. The ra-527 spec covers:
  - the green and red tags;
  - Refused (`status=rejected`) finding the pending refusal, then the final one;
  - Granted finding nothing while pending and the approval once final;
  - Approved finding nothing once final;
  - the exact list of options (new page-object method `statusOptionValues()`).

  ra-410, ra-595 and reject-terminal-flow expect "Refused" at step 1. Browser specs were not run (no Docker here); task 011 runs them.
- **Spec and task 011.** The spec records the final wording, colours and single Refused option. Task 011 now asks design to confirm only the refusal banner copy. The "provisional" comments about banner copy stay in the code (`detail.controller.js`, `confirm-contact/controller.js`).
- **Quality gates:**
  - management-be: `dotnet format style --verify-no-changes` and the full `dotnet test` (2391 passed, 9 skipped, about 2 minutes). After the review tidy-ups (rename, `Name` text, comment wrap), the ReAccreditation migration, type and endpoint classes were re-run (544 passed).
  - management-fe: lint, format:check and the full vitest run (2251).
  - mgmt-tests: lint and format:check.
- **Code review.** A standards and spec review was run. Fixes applied:
  - `IsOutdated` renamed to `DiffersFromFrozenPendingState`;
  - the migration `Name` mentions the label correction;
  - redundant `assertStateId` calls removed from three specs, because `logDecision` already asserts the state id;
  - the fixture renamed to `aRefusalItem`, since it also builds final Refused items;
  - the light-blue test named after the rule it enforces;
  - a two-scenario `it` split in two.

  Left as is:
  - the v17 frozen literal is edited in place rather than in a new migration, as the task directs (v17 is unreleased);
  - the label is still mirrored by hand across the backend, the frontend module and the filter text, which the spec accepts.
