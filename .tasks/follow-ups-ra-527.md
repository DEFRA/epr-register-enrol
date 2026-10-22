# RA-527 follow-ups

Captured on 2026-10-22, at the end of the AFK run. Tasks 001–010 are done and committed on `feature/ra-527`; nothing is pushed. The only task left is `011-HITL-Low-full-stack-verification-and-sign-off.md`.

This file is not a task, and the AFK runner ignores it. Raise any item below as a task or ticket when it's picked up.

## Status at hand-off

| Repo | Branch | Head |
|---|---|---|
| parent (`epr-register-enrol`) | `feature/ra-527` | `0e925c5` |
| `lib/epr-register-enrol-management-be` | `feature/ra-527` | `28eebcd` |
| `lib/epr-register-enrol-management-fe` | `feature/ra-527` | `ab25da1` |
| `lib/epr-register-enrol-mgmt-tests` | `feature/ra-527` | `6040184` |
| `lib/epr-register-enrol-backend` (operator backend) | `feature/ra-527` | `bd824d4` |

Working trees are clean. Every task ran unit tests, lint and format checks. **No browser (e2e) spec has run yet**, because the dev container has no Docker access, by design. The first full run is part of task 011. A human runs it on the host, and Claude reads the log from `.e2e-logs/`. The commands are in task 011, under "Running the browser suite".

## For the sign-off (task 011)

- **Raise all five repos' PRs together, including `epr-register-enrol-backend`.** That repo is new to this ticket (task 008). If CM goes live without it, a retried "Confirm applicant contact" after a partial failure gets a 409 from the operator backend and the application needs manual repair.
- **Step 2 retry is not covered end to end.** The browser suite can't make CM's write fail after a successful push. The operator backend's endpoint tests cover the 200 for a repeated final status (task 008). The CM side relies on its push adapter treating 200 as delivered, which was checked by reading the code.
- **Design to confirm the refusal banner copy:** "Application refused…" and "…accreditation is refused". The tag wording and colours are settled (task 010).

## Follow-ups

### 1. SLA extend and override endpoints have no state check (pre-existing)

`POST /work-items/{id}/sla/extend` and `POST /work-items/{id}/sla/override` (`EprRegisterEnrolManagementBe/WorkItems/Core/SlaEndpoints.cs:32,38`, implemented in `SlaService.ExtendAsync` / `OverrideAsync`, `SlaService.cs:144,368`) don't check the work item's state. A direct API call can change the deadline of a Granted, Refused or Withdrawn application, or of one waiting at step 1. Only management-fe hides the link. Found in task 003; it also happens on `main`.

**Suggested fix:** refuse both on terminal states (409, matching the engine's `TerminalState`). Decide whether the step 1 pending-contact states should allow deadline changes; the SLA clock is still running there.

### 2. Near-duplicate code in the approval and refusal services (tidy-up)

Deferred from task 005's review:

- `ReAccreditationApprovalService` still has its own two concurrency-retry loops (`ReAccreditationApprovalService.cs:110,289`), while `ReAccreditationRefusalService` uses a shared `WriteAsync` loop (`ReAccreditationRefusalService.cs:136`).
- The step 1 guards `ValidateStepOneTarget` are near-copies (`ReAccreditationApprovalService.cs:402`, `ReAccreditationRefusalService.cs:223`).

**Suggested fix:** move both onto shared helpers (e.g. alongside `ReAccreditationDecisionWrites`), with no change in behaviour. The existing tests should pass unchanged.

### 3. Accreditation year can differ between number and record (accepted edge case)

The number is created at step 1 using the configured accreditation year. The year and start date are stamped at step 2, using the configured year at that time. If the configuration rolls over between the steps, the stored year doesn't match the number's year. Task 007 logs a warning when they differ and otherwise lets the approval through. Revisit only if this happens in practice.

### Decided not to do

- **Generic-route query hole (pre-existing on `main`):** the `query-during-*` transitions are caller-invocable through `POST /work-items/{id}/actions/{actionId}`. That route skips the bespoke query service and its `application-queried` audit entry, so a later resume/continue-review can return an item to an older origin state. It isn't reachable through normal UI use. **The user decided to ignore it.**

## Decisions made during the run (for PR reviewers)

The detail is in the task notes under `.tasks/done/` and in the spec.

- **Response codes match `main`.** The same outcome repeated on a final application is a 200 no-op; the other outcome is 409. The new step 1 states and the confirm-contact endpoint follow the same pattern. Removing `/approve` (now 404) is the only deliberate exception, as the spec requires (story 49).
- **The only new 200:** the operator backend accepts a status push that repeats the application's current final status (task 008).
- **Step 2 matches the old single step,** with these differences:
  - the number is created at step 1 and never overwritten, with `main`'s "Manual investigation required" check restored;
  - start date and year are set at step 2 and hidden until then;
  - refusal doesn't stop the SLA clock, as on `main`;
  - a failed push still writes the regulator-visible `status-push-failed` entry, as on `main`.
- **One template version bump (v16 → v17) for the whole ticket.** v17 is unreleased, and its snapshot migration only adds or corrects what's missing.
- **Labels and colours:**
  - step 1 shows "Approved" (green, like Granted) and "Refused" (red, like Refused);
  - one "Refused" worklist filter option covers both refusal states.
