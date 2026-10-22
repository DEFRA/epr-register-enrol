## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Low

## What to build

Regulators can find work items that are waiting for applicant contact from the work-items list.

- The Status filter gains two options, inserted between "Queried" and "Granted":
  - **"Approved"** → `approved-pending-contact`
  - **"Refusing"** → `rejected-pending-contact`
- Pending-contact work items are active, not archived. They always appear in the default list. Only terminal `approved` items stay behind "Show archived", as today.
- The list shows the tags in their agreed colours (light blue / orange), using the badge map entries added in 003 and 005.

Repos: management-fe (and management-be only if the list query needs a change to include the new states). mgmt-tests is covered in task 007.

## Acceptance criteria

- [x] management-fe tests: filter options render in the right order with the right labels; selecting each sends the right state id to the backend; the URL/`status=` token round-trips.
- [x] Pending-contact items appear in the default (non-archived) list (management-be query test if the backend is touched, otherwise a management-fe test with a stubbed backend).
- [x] Quality gates pass in each touched repo.
- [x] Commits on `feature/ra-527`, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/005-AFK-Medium-refuse-two-step.md`

## Notes

- Done. management-fe only (commit 78ece23). `STATUS_FILTER_OPTIONS` gains "Approved" → `approved-pending-contact` and "Refusing" → `rejected-pending-contact`, between "Queried" and "Granted". The `status=` token is the state id itself.
- management-be is unchanged. The list query has had no state-based exclusion since RA-313, and the archive job only stamps terminal states. So pending-contact items are always in the default list, and `includeArchived` doesn't affect them.
- The tag colours come from the state-badge entries added in tasks 003 and 005. No change was needed here.
- The "Refusing" label is provisional. It now lives in two places: the module STATES entry (tag and detail page) and the filter option. The filter writes its labels by hand because "Updated" groups two states.
- Tests (management-fe `controller.test.js`, describe "RA-527 pending-contact Status filter options"): option order and labels; each option sends its own state id and renders checked with a chip; the tokens round-trip through the chip-removal links; pending items show in the default list (`includeArchived: false`) with the light-blue and orange tags.
- No mgmt-tests change. Task 007's new spec covers the Status filter end to end.
- Quality gates (management-fe): lint, format:check and test (2245 passed).
