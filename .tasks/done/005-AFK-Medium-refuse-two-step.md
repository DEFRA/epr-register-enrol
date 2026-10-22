## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Medium

## What to build

The same two-step process for refusals, reusing the pattern built in tasks 003 and 004.

- **Step 1:** submitting "Make determination" with **Refused** moves the item to a new non-terminal state, **`rejected-pending-contact`** (tag **"Refusing"**, orange). No accreditation number is minted. Record the audit entry "Determination made: Refused". No OJ push, SLA stop or email.
- **Step 2:** "Confirm applicant contact" moves it to the existing `rejected` ("Refused"), with the same run order as approvals: pre-commit OJ push to `rejected` (failure → no state or outcome changes; `status-push-failed` written), then one write (state, SLA stopped, audit "Applicant contacted"), and **no** email (RA-211: regulators send refusal notices themselves).

Repos: management-be, management-fe, mgmt-tests.

**management-be**
- Add the `rejected-pending-contact` state (display "Refusing", non-terminal), the transition into it from the decision path, and a confirm-contact transition to `rejected` (all CallerInvocable false). These are part of v17; extend the v17 snapshot migration if it is already committed.
- The status-push hook excludes the new step 1 transition.
- Only reassign/unassign and confirm-contact are available from `rejected-pending-contact`.
- Idempotent replay of Refused on `rejected-pending-contact` succeeds. Approved on it gives 409. Confirm-contact on an item already `rejected` is a replay success.

**management-fe**
- Mirror the state in the module. State badge `rejected-pending-contact` → orange. Both the "Refusing" label and the orange colour are provisional and may change later, so keep each as a single mapping entry (backend display name, frontend module mirror, badge map, filter label).
- Detail page in `rejected-pending-contact`:
  - tag "Refusing";
  - a persistent banner, title "Application refused", body "The application was refused. You now need to contact the applicant about the decision.";
  - **no** accreditation rows and no Accreditation ID line;
  - the same restricted sidebar and "Confirm applicant contact" button as approvals.
- The confirm page works identically for refusals.
- Success flash (one time): title "Applicant contacted", body "The applicant has been contacted and accreditation is refused."

**mgmt-tests**
- Add a `driveToRefusingPendingContact` helper. Re-compose `driveToRefused` as `driveToRefusingPendingContact` + `confirmApplicantContact`.
- Update the refusal parts of the decision-moment specs (e.g. the RA-368 status push and the reject terminal flow), so that OJ shows REFUSED only after step 2.

## Acceptance criteria

- [x] management-be endpoint tests:
  - step 1 Refused → `rejected-pending-contact`, no number minted, no push, SLA running, audit entry;
  - step 2 → `rejected`, push to-state `rejected`, SLA stopped, **no** Decision email, audit "Applicant contacted";
  - push failure → no state or outcome changes; `status-push-failed` written;
  - replay and 409 cases;
  - push hook exclusion;
  - available actions.
- [x] Existing reject tests are updated where they asserted the single-step refusal.
- [x] management-fe tests: the refusal detail page (tag, banner, no accreditation rows, restricted sidebar), the confirm flow for refusals, and the one-time "accreditation is refused" banner.
- [x] mgmt-tests: the existing suite that reaches Refused passes using the re-composed helper. The refusal decision-moment assertions move to step 2.
- [x] Quality gates pass in all three repos.
- [x] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/004-AFK-High-approve-step2-confirm-applicant-contact.md`

## Notes

- Done. management-be: new non-terminal `rejected-pending-contact` ("Refusing") and transitions `make-determination-rejected` (awaiting-decision → rejected-pending-contact) and `confirm-contact-rejected` (rejected-pending-contact → rejected), both CallerInvocable false. The single-step `reject` transition is **removed** from v17 (like `approve` before it), so nothing refuses without both steps.
- **v17, not v18** (user-confirmed: one bump for the ticket). The v17 snapshot migration now also adds the refusal state and transitions and strips `reject`. It only adds what is missing, so items stamped v17 by tasks 003/004 gain just the refusal rules (Mongo test covers both earlier builds).
- Step 1 (`/decision` with `rejected`): the submit-for-decision hop if needed, then one write by the new `ReAccreditationRefusalService.RecordRefusedDeterminationAsync`: action-applied + `determination-made` ("Determination made: Refused"). No number, no push, SLA running, no email. The log-decision service no longer pushes at all.
- Step 2 (`/confirm-contact`): the confirm-contact service reads the outcome off the pending state. It makes the pre-commit decision push (to `rejected`, from `rejected-pending-contact`, one `OccurredAt`), then `RefuseAsync` makes one write: state rejected, payload `slaClock.stoppedAt`, action-applied (`confirm-contact-rejected`), `applicant-contacted`, `sla-clock-stopped`, then `status-push-sent`. No email (RA-211), nothing published. A push failure gives 500, and the only entry written is the support-only `status-push-failed`, as for approvals.
- Replays and 409s:
  - Refused on `rejected-pending-contact` → replay.
  - Approved on it → 409.
  - Refused on an already-Refused item → **409**. It was a replay before. The change follows the user's rule that re-entering an earlier step from a terminal state is 409.
  - Confirm-contact on `rejected` → replay. This includes legacy items that were refused in one step.
- `ReAccreditationConfirmContactGuard` now covers both outcomes (`Step` record: Approval / Refusal).
- Shared write helpers were moved out of the approval service into `ReAccreditationDecisionWrites`: audit append, payload update / SLA stop, hook fan-out and actor check.
- The status-push hook excludes `confirm-contact-rejected`, and both pending states through its to-state rule.
- Audit entries: every state change writes `action-applied` plus its own entry, the same as the approval path. **Please confirm:** step 1 of a refusal writes `determination-made` with details `{ outcome: "rejected" }` only (no number). Step 2 writes `applicant-contacted` `{ outcome: "rejected" }` and `sla-clock-stopped`. There is no `accreditation-issued` and no `publishing-enqueued`.
- management-fe:
  - The module mirror has the new state and both transitions, and `reject` is removed. `DECISION_OUTCOMES.rejected` now maps to `make-determination-rejected`.
  - Badge: `rejected-pending-contact` → `govuk-tag--orange`.
  - Detail page: the "Application refused" persistent banner. There is no Accreditation ID line and no accreditation rows. The sidebar and the Confirm button are the same as for approvals.
  - The one-time "Decision logged: Refused" flash is gone.
  - Confirm success flash: "…accreditation is refused."
  - Provisional copy and colour each live in one entry: module STATES (the label), the state-badge map, the detail controller's `PENDING_CONTACT_BANNERS` and the confirm controller's `SUCCESS_BANNERS`. The Status filter label is task 006.
  - The state-badge test's RA-291 "no orange" guard now pins orange to `rejected-pending-contact` only.
- mgmt-tests:
  - `driveToRefusingPendingContact` is new. `driveToRefused` is now `driveToRefusingPendingContact` + `confirmApplicantContact`.
  - `confirmApplicantContact` handles both outcomes. `logDecision('refused')` now asserts `rejected-pending-contact`, and `rejectWorkItem` confirms contact.
  - Updated: reject-terminal-flow, ra-410-cta-lifecycle, ra-595, and ra-313 (ra-358 is covered via `rejectWorkItem`).
  - ra-368 has a new refusal describe: step 1 adds no push and the operator stays "Updated"; step 2 adds the third push and the operator is Rejected (REFUSED). Task 007 may fold this into its spec.
- Known gap, not fixed (now applies to refusals too): if the CM write fails after a delivered push, a retry sends a new `OccurredAt` and the operator journey answers 409.
- Left as is: `detail.njk` still styles a generic `reject` action as a warning button. It is dead code for re-accreditation now.
- Review smells deferred: the approval service still has its own two retry loops rather than the refusal service's `WriteAsync`. Step 1 guards are near-duplicates across the approval and refusal services.
- Quality gates:
  - management-be: `dotnet format style --verify-no-changes` and the full `dotnet test` (2369 passed, 9 skipped).
  - management-fe: lint, format:check and test (2240).
  - mgmt-tests: lint and format:check. Browser specs were not run (they need the full stack, task 008).

## Note (2026-10-22, task 007)

- The push-failure acceptance-criteria wording above was amended from "nothing written" to "no state or outcome changes; `status-push-failed` written", which is what the code does and what `main` did. See `.tasks/007-AFK-Medium-step2-parity-with-single-step.md`.
- Reverted at the user's request by task 007: "Refused on an already-Refused item is 409" goes back to `main`'s behaviour, a 200 idempotent replay (replay header, item unchanged and still Refused, nothing pushed or written). Approved on a Refused item is still 409.
- Also changed by task 007: refusal step 2 no longer stops the SLA clock (no payload `slaClock.stoppedAt` and no `sla-clock-stopped` entry), matching `main`'s single-step refuse.
