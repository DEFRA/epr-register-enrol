## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Medium

## What to build

The same two-step process for refusals, reusing the pattern built in tasks 003 and 004.

- **Step 1:** submitting "Make determination" with **Refused** moves the item to a new non-terminal state, **`rejected-pending-contact`** (tag **"Refusing"**, orange). No accreditation number is minted. Record the audit entry "Determination made: Refused". No OJ push, SLA stop or email.
- **Step 2:** "Confirm applicant contact" moves it to the existing `rejected` ("Refused"), with the same run order as approvals: pre-commit OJ push to `rejected` (failure → nothing written), then one write (state, SLA stopped, audit "Applicant contacted"), and **no** email (RA-211: regulators send refusal notices themselves).

Repos: management-be, management-fe, mgmt-tests.

**management-be**
- Add the `rejected-pending-contact` state (display "Refusing", non-terminal), the transition into it from the decision path, and a confirm-contact transition to `rejected` (all CallerInvocable false). These are part of v17; extend the v17 snapshot migration if it is already committed.
- The status-push hook excludes the new step 1 transition.
- Only reassign/unassign and confirm-contact are available from `rejected-pending-contact`.
- Idempotent replay of Refused on `rejected-pending-contact` succeeds. Approved on it gives 409. Confirm-contact on an item already `rejected` is a replay success.

**management-fe**
- Mirror the state in the module. State badge `rejected-pending-contact` → orange.
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

- [ ] management-be endpoint tests:
  - step 1 Refused → `rejected-pending-contact`, no number minted, no push, SLA running, audit entry;
  - step 2 → `rejected`, push to-state `rejected`, SLA stopped, **no** Decision email, audit "Applicant contacted";
  - push failure → nothing written;
  - replay and 409 cases;
  - push hook exclusion;
  - available actions.
- [ ] Existing reject tests are updated where they asserted the single-step refusal.
- [ ] management-fe tests: the refusal detail page (tag, banner, no accreditation rows, restricted sidebar), the confirm flow for refusals, and the one-time "accreditation is refused" banner.
- [ ] mgmt-tests: the existing suite that reaches Refused passes using the re-composed helper. The refusal decision-moment assertions move to step 2.
- [ ] Quality gates pass in all three repos.
- [ ] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/004-AFK-High-approve-step2-confirm-applicant-contact.md`
