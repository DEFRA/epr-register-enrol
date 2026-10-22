## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

High

## What to build

Step 1 for approvals. When a regulator submits "Make determination" with **Approved**, the work item moves into a new non-terminal state, **`approved-pending-contact`** (tag **"Approved"**, light blue), instead of going straight to Granted. The accreditation number is minted and shown to the regulator. Nothing changes for the operator.

Repos: management-be, management-fe, mgmt-tests.

**management-be**
- Add the `approved-pending-contact` state (display name "Approved", non-terminal) and the transition into it from the decision path (CallerInvocable false). Bump the re-accreditation `templateVersion` v16 → v17 with a new snapshot migration, following the existing re-accreditation snapshot-migration pattern and registration.
- The decision endpoint keeps its contract. For Approved it mints the number via the OJ accreditation-number adapter, stamps `accreditationId` / `accreditationStartDate` / `accreditationYear` on the payload, moves to `approved-pending-contact`, and records a "Determination made: Approved" audit entry.
- For Approved, step 1 does **not** push to OJ, stop the SLA clock, enqueue publishing or send the Decision email. Those move to step 2 (task 004).
- The generic status-push hook excludes the new transition, so a pending state is never pushed.
- Idempotent replay: Approved again on an item already in `approved-pending-contact` succeeds with no new side effects. Refused on it gives 409.
- From `approved-pending-contact`, the only available actions are reassign and unassign (confirm-contact arrives in 004). Query, withdraw, due-date change/override and re-determination are not available.
- Relax the approval-service guard that refuses an item already carrying a real-format `accreditationId` while not `approved`, so that it allows `approved-pending-contact`. Step 2 must reuse that number and never re-mint.
- Refused keeps its current single-step behaviour in this task (task 005 changes it).

**management-fe**
- Mirror the new state and v17 in the module, and register v17 in the detail-template version map.
- State badge: `approved-pending-contact` → light blue. The colour is provisional and may change later, so keep it as the single badge-map entry.
- Detail page in `approved-pending-contact`:
  - status tag "Approved";
  - a persistent green banner on every visit: title "Application approved", body "The application was approved. You now need to contact the applicant about the decision.", then "Accreditation ID: <number>";
  - Accreditation ID / start date / year summary rows (the decision metadata is built for this state as well as `approved`);
  - "Assigned to you" box with only Reassign / Unassign;
  - a separate box with a primary **"Confirm applicant contact"** button (`data-testid`, `disabled` for read-only users), linking to the confirm-contact URL that task 004 implements;
  - "Make determination", Query and due-date links hidden.
- The step 1 success flash for Approved is replaced by the persistent banner.

**mgmt-tests**
- Add a `driveToApprovedPendingContact` helper and page-object accessors for the pending banner, tag and "Confirm applicant contact" button.
- Specs that expect an approval to reach Granted will fail until task 004 completes. Note which ones in the task notes. Do not paper over them.

## Acceptance criteria

- [x] management-be endpoint tests (stubbed push / number / Notify adapters): Approved → `approved-pending-contact`, number minted and stamped, audit "Determination made: Approved", **no** OJ push, SLA clock still running, no publishing job, no Decision email.
- [x] Idempotent replay and the 409 for the opposite outcome are covered.
- [x] The status-push hook does not push the new transition (test).
- [x] Available actions from `approved-pending-contact` are reassign/unassign only (test).
- [x] v17 snapshot migration tests (unit + Mongo integration, matching existing prior art).
- [x] Existing log-decision, approval-service, type, lifecycle and hook-order tests are updated where they asserted single-step approval.
- [x] management-fe tests: detail page in `approved-pending-contact` shows the tag, banner, accreditation rows, the restricted sidebar and the Confirm button (disabled for read-only), and hides Make determination, Query and due-date links. The module v17 guard and the template map are updated.
- [x] mgmt-tests: the new helper and page-object accessors exist and lint passes. Specs expected to fail until 004 are listed in the task notes.
- [x] Quality gates pass in management-be and management-fe, and lint/format in mgmt-tests.
- [x] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/001-AFK-Low-remove-bespoke-approve-endpoint.md`

## Notes

- Done. management-be: new transition `make-determination-approved` (awaiting-decision → approved-pending-contact, CallerInvocable false) and the v17 `ReAccreditationPendingContactSnapshotMigration`, registered last. The step 1 write is `IReAccreditationApprovalService.RecordApprovedDeterminationAsync`. It stamps the number, start date and year, and moves the state, in one write with `action-applied` + `determination-made` ("Determination made: Approved") audit entries. The log-decision service mints the number, then takes the hop, then makes the step 1 write. There is no decision push for Approved. An item on pre-v17 rules is refused before any side effect.
- Behaviour change to flag: Approved on an already-**Granted** item is now 409, not an idempotent replay. The spec says "any terminal state gives 409". Approved on `approved-pending-contact` is still a replay, and Refused on it is 409.
- `ApproveAsync` accepts `approved-pending-contact` and reuses the step 1 number (never re-mints), ready for task 004. It has no production caller until 004 wires confirm-contact. Its hooks still fire with action id `approve`, which drives the Decision email and is excluded from the status-push hook.
- Gap (pre-existing, also true for terminal states): the SLA extend/override endpoints have no state gate in management-be. Only management-fe hides the due-date link (forced off in the pending state). Worth a follow-up.
- management-fe: the frontend-only `approve` transition is replaced by `make-determination-approved`. `DECISION_OUTCOMES.approved` maps to it, and `terminalStateForOutcome` is renamed `targetStateForOutcome`. The state id lives in `re-accreditation/states.js` to avoid an import cycle. New `typeBanners` block in `work-items/detail.njk`. The Confirm button (`confirm-applicant-contact-cta`) links to `/work-items/re-accreditation/{id}/confirm-contact`, which 404s until task 004. Route test: `routes/work-items/detail.pending-contact.route.test.js`.
- mgmt-tests: added `driveToApprovedPendingContact` and the detail page-object accessors (`stateTagText`, `pendingContactBanner*`, `confirmApplicantContact*`). Added `ra-527-approve-step1-pending-contact.e2e.js`; task 007 may fold it into its own spec. `logDecision('approved')` now asserts `approved-pending-contact`. `driveToApproved` asserts `approved` after step 1, so it fails loudly until 004.
- **Specs expected to fail until task 004** (an approval must reach Granted):
  - `re-accreditation-approval`
  - `ra-346-approve-gating` (approved block)
  - `ra-249-application-ref-after-approval`
  - `ra-203-decision-notification` (Decision email now at step 2)
  - `ra-313-withdrawn-in-worklist` (approved item)
  - `ra-358-terminal-assignment-gating` (approved item, via `approveWorkItem`)
  - `ra-595-determination-from-duly-made` (approve case)
  - `ra-410-cta-lifecycle` ("step 3: Approved reaches Granted" and the `→ approved` audit check)
- Quality gates passed:
  - management-be: `dotnet format style --verify-no-changes`, and the full `dotnet test` (2313 tests, about 2 minutes).
  - management-fe: lint, format:check and test (2184).
  - mgmt-tests: lint and format:check. Browser specs were not run (they need the full stack, task 008).
