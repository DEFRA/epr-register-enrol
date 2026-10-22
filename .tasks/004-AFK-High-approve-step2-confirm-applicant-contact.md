## Parent

`.tasks/spec-ra-527-two-step-determination.md`

## Type

AFK

## Complexity

High

## What to build

Step 2 for approvals. From an `approved-pending-contact` work item, the regulator clicks "Confirm applicant contact", ticks **"I have contacted the applicant about the decision"** and clicks **"Confirm and continue"**. Only then is the outcome applied: the operator sees GRANTED, CM shows Granted, the SLA clock stops, publishing is queued and the Decision email is sent.

Repos: management-be, management-fe, mgmt-tests.

**management-be**
- New bespoke endpoint `POST …/re-accreditation/{id}/confirm-contact`, with the same authorisation as the decision endpoint. Add a confirm-contact transition `approved-pending-contact` → `approved` (CallerInvocable false), part of the v17 template.
- Agreed run order:
  1. **Pre-commit OJ push** (existing decision push with the larger retry pipeline): to-state `approved`, from-state `approved-pending-contact`, a single `OccurredAt`. On failure: 500, **nothing written**.
  2. **One CM write**: state `approved`, SLA clock stopped (`StoppedAt` = the same timestamp), audit "Applicant contacted" with the acting user plus the existing action-applied / sla-clock-stopped / accreditation-issued entries, and publishing enqueued. Reuse the number stamped at step 1.
  3. **Post-action hooks**: Decision Notify email (unchanged template and personalisation).
- Called on an item already `approved` → replay success, no duplicate side effects. Called from any other state → 409. Not found / wrong type → as existing endpoints.

**management-fe**
- Backend client `confirmApplicantContact`, using the existing longer decision timeout.
- New confirm-contact route (GET/POST) under the re-accreditation work-item routes, with `requireStandard` on the POST (route-scope coverage test updated):
  - breadcrumb "Work items > <ref> > Confirm applicant contact", caption "Application number: <ref>", H1 "Confirm applicant contact";
  - a single checkbox "I have contacted the applicant about the decision", a "Confirm and continue" button and a "Cancel" link back to the detail page;
  - controls disabled for read-only users;
  - unticked submit: GOV.UK error summary plus inline error "Confirm you have contacted the applicant about the decision";
  - item not in a pending state: both GET and POST redirect to the detail page;
  - backend failure: an error banner on the page, nothing changed.
- On success: redirect to the detail page with a **one-time** flash banner, title "Applicant contacted", body "The applicant has been contacted and accreditation is granted.". Later visits show no banner.
- Terminal pages (both Granted and Refused): closed assignment panel text "This application is closed and can no longer be assigned or reassigned."; Outcome box "This work item is in a final state. No further decision actions are available." with the tag.
- `data-testid`s on all new controls.

**mgmt-tests**
- Add a `confirmApplicantContact` helper and a confirm-contact page object.
- Re-compose `driveToApproved` as `driveToApprovedPendingContact` + `confirmApplicantContact`, so existing specs reach Granted again.
- Update the approval parts of the decision-moment specs: the OJ status push (RA-368) and the Decision email (RA-203) now happen at step 2, not at the determination. Update the closed-panel wording assertions.

## Acceptance criteria

- [ ] management-be endpoint tests: confirm from `approved-pending-contact` → `approved`, OJ push sent with to-state `approved`, SLA stopped, publishing enqueued, Decision email sent, audit "Applicant contacted" with the user. Push failure → 500 and the work item unchanged (state, SLA, audit, publishing). Replay on `approved` is a no-op success. Other states → 409.
- [ ] The existing log-decision service tests for push-before-write are carried over to the confirm-contact flow.
- [ ] management-fe tests: confirm page GET/POST (copy, validation error, Cancel, wrong-state redirects, read-only disabled, backend failure); success flash once only; terminal wording; backend client.
- [ ] mgmt-tests: the full existing suite that reaches Granted passes again, using the re-composed helper. The RA-368 and RA-203 approval assertions move to step 2.
- [ ] Quality gates pass in all three repos.
- [ ] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/003-AFK-High-approve-step1-pending-contact.md`
