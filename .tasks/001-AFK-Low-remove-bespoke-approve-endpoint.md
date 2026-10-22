## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Low

## What to build

Prefactor: remove the obsolete RA-132 bespoke re-accreditation approve endpoint (`POST …/re-accreditation/{id}/approve`) and everything that only exists to support it. Since RA-410 the live flow goes through the decision endpoint, which calls the shared approval service directly. Nothing in the running system calls `/approve`, but it is a route that bypasses the determination flow. Removing it first means tasks 003/004 only have one caller of the approval service to keep working, and no bypass exists while the two-step flow is being built.

Repos: management-be, management-fe, mgmt-tests (all on `feature/ra-527`).

Keep the shared approval service itself. Only the endpoint, its handler and wiring, and its dedicated client and tests go.

## Acceptance criteria

- [ ] management-be: the bespoke approve endpoint, its handler and its endpoint registration are deleted. A request to it now returns 404 (covered by a test).
- [ ] management-be: tests that existed only for the `/approve` endpoint are removed. Tests for the shared approval service as used by the decision flow still pass.
- [ ] management-be: any approve-only config (e.g. an approve-specific timeout) and OpenAPI examples that reference the endpoint are removed if nothing else uses them.
- [ ] management-fe: the unused backend-client wrapper for the approve endpoint and its tests are deleted, along with any config used only by it (e.g. `approveTimeoutMs`) and its config tests. Comments referring to the endpoint as current are updated.
- [ ] mgmt-tests: the unused approve page-object helpers (`approvePath` / `openApprovePathDirectly`) and the comment reference to them are removed.
- [ ] Quality gates pass in each touched repo: management-be `dotnet format style --verify-no-changes` + `dotnet test`; management-fe `npm run lint`, `npm run format:check`, `npm test`; mgmt-tests `npm run lint`, `npm run format:check`.
- [ ] Commits on `feature/ra-527` in each touched repo, and the parent repo's submodule pointers updated and committed on its `feature/ra-527`.

## Blocked by

- None — can start immediately.
