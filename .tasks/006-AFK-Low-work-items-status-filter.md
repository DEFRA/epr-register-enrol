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

- [ ] management-fe tests: filter options render in the right order with the right labels; selecting each sends the right state id to the backend; the URL/`status=` token round-trips.
- [ ] Pending-contact items appear in the default (non-archived) list (management-be query test if the backend is touched, otherwise a management-fe test with a stubbed backend).
- [ ] Quality gates pass in each touched repo.
- [ ] Commits on `feature/ra-527`, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/005-AFK-Medium-refuse-two-step.md`
