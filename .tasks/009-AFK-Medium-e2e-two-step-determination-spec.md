## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

Medium

## What to build

A dedicated end-to-end spec in mgmt-tests, `ra-527-two-step-determination`, that tests each step separately for **both** outcomes against the full stack (CM frontend, CM backend and OJ backend).

Repos: mgmt-tests (plus any `data-testid` additions in management-fe if a selector is missing).

## Acceptance criteria

- [ ] **Approve, step 1:** the tag is "Approved", the banner "Application approved…" shows the Accreditation ID, and the Accreditation ID row is present, but there are **no** Accreditation start date or Accreditation year rows (user decision, task 007: both are set only at step 2). The **operator status is unchanged** (checked against the OJ backend with the existing operator-status wait helper or an equivalent negative assertion). No Decision email has been sent.
- [ ] **Refuse, step 1:** the tag is "Refusing", the banner reads "Application refused…", there are no accreditation rows, and the operator status is unchanged.
- [ ] **While pending:** only Reassign, Unassign and Confirm applicant contact are available. Make determination, Query and Withdraw are absent.
- [ ] **Confirm page:** submitting unticked shows the error summary and the inline error. Cancel returns to the application summary with nothing changed.
- [ ] **Approve, step 2:** the tag is "Granted", the one-time banner reads "…accreditation is granted", the Accreditation ID (unchanged from step 1), start date and year rows are present, the operator shows GRANTED, and the Decision email is sent at this point. On a revisit, the banner is gone.
- [ ] **Refuse, step 2:** the tag is "Refused", the one-time banner reads "…accreditation is refused", the operator shows REFUSED, no email is sent, and the application history has "Applicant contacted" but **no** "SLA clock stopped" entry (user decision, task 007: matches the old single-step refuse).
- [ ] **Repeats on a final application (user decision, task 007: as on `main`):** posting Make determination again with the **same** outcome on a Granted or Refused application returns 200 and changes nothing (state, Accreditation ID, audit, no new email). The **other** outcome returns 409. Use the API directly if the UI no longer offers the action.
- [ ] **Step 2 retry (task 008):** an application that the operator side already shows as GRANTED (or REFUSED) while CM is still in the pending state can be confirmed. The retry succeeds and CM reaches Granted (or Refused), with no 409 from the operator side. If the full stack can't reach this state without fault injection, cover it at the operator-backend endpoint level and record the limitation in the task notes.
- [ ] **Work-items list:** the "Approved" and "Refusing" Status filters each return the matching pending item, and both appear in the default list.
- [ ] mgmt-tests `npm run lint` and `npm run format:check` pass. The spec passes locally against the compose stack where possible; record any environment limitation in the task notes.
- [ ] Commits on `feature/ra-527`, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/002-AFK-Low-determination-form-copy.md`
- `.tasks/006-AFK-Low-work-items-status-filter.md`
- `.tasks/007-AFK-Medium-step2-parity-with-single-step.md`
- `.tasks/008-AFK-Low-operator-final-status-push-idempotent.md`
