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

- [x] **Approve, step 1:** the tag is "Approved", the banner "Application approved…" shows the Accreditation ID, and the Accreditation ID row is present, but there are **no** Accreditation start date or Accreditation year rows (user decision, task 007: both are set only at step 2). The **operator status is unchanged** (checked against the OJ backend with the existing operator-status wait helper or an equivalent negative assertion). No Decision email has been sent.
- [x] **Refuse, step 1:** the tag is "Refusing", the banner reads "Application refused…", there are no accreditation rows, and the operator status is unchanged.
- [x] **While pending:** only Reassign, Unassign and Confirm applicant contact are available. Make determination, Query and Withdraw are absent.
- [x] **Confirm page:** submitting unticked shows the error summary and the inline error. Cancel returns to the application summary with nothing changed.
- [x] **Approve, step 2:** the tag is "Granted", the one-time banner reads "…accreditation is granted", the Accreditation ID (unchanged from step 1), start date and year rows are present, the operator shows GRANTED, and the Decision email is sent at this point. On a revisit, the banner is gone.
- [x] **Refuse, step 2:** the tag is "Refused", the one-time banner reads "…accreditation is refused", the operator shows REFUSED, no email is sent, and the application history has "Applicant contacted" but **no** "SLA clock stopped" entry (user decision, task 007: matches the old single-step refuse).
- [x] **Repeats on a final application (user decision, task 007: as on `main`):** posting Make determination again with the **same** outcome on a Granted or Refused application returns 200 and changes nothing (state, Accreditation ID, audit, no new email). The **other** outcome returns 409. Use the API directly if the UI no longer offers the action.
- [x] **Step 2 retry (task 008):** an application that the operator side already shows as GRANTED (or REFUSED) while CM is still in the pending state can be confirmed. The retry succeeds and CM reaches Granted (or Refused), with no 409 from the operator side. If the full stack can't reach this state without fault injection, cover it at the operator-backend endpoint level and record the limitation in the task notes.
- [x] **Work-items list:** the "Approved" and "Refusing" Status filters each return the matching pending item, and both appear in the default list.
- [x] mgmt-tests `npm run lint` and `npm run format:check` pass. The spec passes locally against the compose stack where possible; record any environment limitation in the task notes.
- [x] Commits on `feature/ra-527`, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/002-AFK-Low-determination-form-copy.md`
- `.tasks/006-AFK-Low-work-items-status-filter.md`
- `.tasks/007-AFK-Medium-step2-parity-with-single-step.md`
- `.tasks/008-AFK-Low-operator-final-status-push-idempotent.md`

## Notes

Done (mgmt-tests `344a60b`). Lint and format-check pass. **The spec was not run:** this environment has no Docker, so the compose stack could not start. Task 010 should run it against the stack.

- **New spec** `test/specs/ra-527-two-step-determination.e2e.js`. It uses two operator-backed (Path B) items, an approval and a refusal, in one `uniqueOrganisationIdGroup`, so the worklist can be searched for exactly those two. Its describe blocks run in this order:
  1. approval step 1;
  2. refusal step 1;
  3. the worklist while both items are pending;
  4. the confirm page (unticked submit, then Cancel, on the approval);
  5. approval step 2;
  6. refusal step 2;
  7. repeats on the final applications.
- **Old spec folded in.** `ra-527-approve-step1-pending-contact.e2e.js` was folded into the new spec and deleted, as the task 003 notes anticipated. Every assertion it made is carried over, including the button label, tag colour, banner, rows, refresh, sidebar, push count and operator status.
- **"Operator status unchanged" after step 1** is checked two ways:
  - `waitForOperatorApplicationStatus(…, 'Updated')`;
  - the `status-push-sent` count staying at 2. That count is the real negative check, because 'Updated' was already the status before step 1.
- **No email at refusal step 2** is checked two ways:
  - no "Decision recorded" entry and no `Decision` template send;
  - the stored `notification-sent` count is the same before and after step 2, so no email of any kind was sent.
- **Approval step 2** asserts one `sla-clock-stopped` entry. Refusal step 2 asserts none (task 007).
- **Repeats on a final application.** These use the new `test/support/decision-api.js`, which has `getWorkItem` and `postDecision`. Both call management-be as the stub caseworker.
  - The same outcome returns 200 with `x-idempotent-replay: true`. `stateId`, `lastModifiedAt`, `payload.accreditationId` and the audit log length are unchanged, so no new email was sent either.
  - The other outcome returns 409, with the same values unchanged.
  - The Granted item still has exactly one Decision email and the step 1 ID.
- **Step 2 retry (task 008) is not covered end to end.** That would need a pending application that the operator side already shows as GRANTED or REFUSED. The stack can't reach that state without fault injection:
  - the operator backend's `case-management/{id}/status` endpoint needs management-be's HMAC secret (`AUTH_SHARED_SECRET__MANAGEMENT_BE`), and the test runner doesn't hold it;
  - there is no hook that makes the case-management write fail after the push.

  Task 008's operator-backend endpoint tests cover it instead: a repeated final status returns 200 and nothing is written. This limitation is also recorded in the spec's docblock.
- **No management-fe change.** Every selector the spec needed already existed. One page-object helper was added: `hasPendingContactAccreditationId`.
- **Code review.** A standards and spec review was run. Fixes applied:
  - the button-label assertion is restored;
  - the approval asserts its SLA stop;
  - the refusal checks that no email of any kind was sent;
  - the step 1 accreditation ID is captured in `before`;
  - a redundant field and redundant count checks are removed.

  Left as is: the accreditation-ID regex is now copied in four specs (an existing pattern).
