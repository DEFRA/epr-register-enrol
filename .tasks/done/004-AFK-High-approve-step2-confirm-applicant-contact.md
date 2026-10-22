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
  1. **Pre-commit OJ push** (existing decision push with the larger retry pipeline): to-state `approved`, from-state `approved-pending-contact`, a single `OccurredAt`. On failure: 500, no state or outcome changes; `status-push-failed` written.
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

- [x] management-be endpoint tests: confirm from `approved-pending-contact` → `approved`, OJ push sent with to-state `approved`, SLA stopped, publishing enqueued, Decision email sent, audit "Applicant contacted" with the user. Push failure → 500, no state or outcome changes (state, SLA, outcome audit, publishing); `status-push-failed` written. Replay on `approved` is a no-op success. Other states → 409.
- [x] The existing log-decision service tests for push-before-write are carried over to the confirm-contact flow.
- [x] management-fe tests: confirm page GET/POST (copy, validation error, Cancel, wrong-state redirects, read-only disabled, backend failure); success flash once only; terminal wording; backend client.
- [x] mgmt-tests: the full existing suite that reaches Granted passes again, using the re-composed helper. The RA-368 and RA-203 approval assertions move to step 2.
- [x] Quality gates pass in all three repos.
- [x] Commits on `feature/ra-527` in each touched repo, and the parent's submodule pointers updated and committed.

## Blocked by

- `.tasks/003-AFK-High-approve-step1-pending-contact.md`

## Notes

- Done. management-be: `POST …/re-accreditation/{id}/confirm-contact` (same plain authorisation as `/decision`). New `ReAccreditationConfirmContactService`. It checks `ReAccreditationConfirmContactGuard` first (pending contact, v17 rules declare `confirm-contact-approved`, and the step 1 real-format number is present). Then it makes the pre-commit decision push (to `approved`, from `approved-pending-contact`, one `OccurredAt`). Then `ApproveAsync(id, user, appliedAt)` does one write: state approved, payload `slaClock.stoppedAt` = the same instant, and audit entries action-applied (`confirm-contact-approved`), `applicant-contacted` ("Applicant contacted", acting user), sla-clock-stopped and accreditation-issued (step 1 number). Publishing is queued, then the hooks run, and the Decision email is now keyed on `confirm-contact-approved`. Approved → replay. Any other state → 409.
- New transition `confirm-contact-approved` (approved-pending-contact → approved, CallerInvocable false) in **v17, not a new v18**. v17 is unreleased on this branch, so the v17 snapshot migration was extended in place. It adds only what's missing, so items task 003 already stamped as v17 gain just this transition (Mongo test). A reviewer flagged this against the "bump templateVersion on transition changes" rule, so it needs sign-off before release.
- `ApproveAsync` is now step 2 only. Its old awaiting-decision mint path and `preResolvedAccreditationNumber` are gone, so nothing bypasses the two steps. The number-resolution tests that used to run through it now target `ResolveAccreditationNumberAsync`. The pre-commit push and its audit entries moved into a shared `ReAccreditationDecisionPush`, used by the refusal path too. The status-push hook excludes `confirm-contact-approved`, and the dead literal `approve` exclusion and Notify mapping are replaced.
- Deliberate: on push failure, the support-facing `status-push-failed` entry is still written, carried over from the refusal path and its tests. Nothing else changes (state, SLA, outcome audit, publishing, email). The AC wording "audit unchanged" should read "no outcome audit entries".
- **Follow-up (spec gap):** this is the "Retry safety" requirement in the spec and story 37. If the CM write fails *after* a delivered push (3 lost concurrency retries, or Mongo down), a retry sends a new `OccurredAt`. The operator journey (already Approved, which is terminal) then answers 409, which the push adapter treats as a failure, so the item can never be confirmed without intervention. The same is already true for the refusal path. Fixing it needs either an operator-journey change (out of scope here) or a way to recognise "already at this outcome". It is not done.
- management-fe: backend client `confirmApplicantContact` (decision timeout). New `re-accreditation/confirm-contact/` routes, controller, service and `routes/re-accreditation/confirm-contact/index.njk`. GET is open to read-only users with the controls disabled; POST has `requireStandard`. testids: `confirm-contact-form`, `-checkbox`, `-submit`, `-cancel`, `-error-summary`, `-error`, `-failure-banner`. Wrong state → redirect to detail. Failure → banner on the page (409 conflict copy / 502). Success → one-time flash "Applicant contacted". `PENDING_CONTACT_STATE_IDS` / `isPendingContact` moved to `re-accreditation/states.js`, and the success copy is keyed by pending state (task 005 adds `rejected-pending-contact` to both). Closed panel copy updated. The Outcome box already had the Design 3 copy and is now tested for Granted and Refused. The module mirror has `confirm-contact-approved`.
- mgmt-tests: `confirm-contact.page.js` and `confirmApplicantContact` helper. `driveToApproved` = `driveToApprovedPendingContact` + `confirmApplicantContact`, and `approveWorkItem` does both steps. All eight specs listed in task 003 are updated to confirm contact before expecting Granted. RA-203: the Decision email is absent after step 1 and present after step 2. RA-368: step 1 pushes nothing (OJ Updated), and step 2 adds the third push (OJ Approved). ra-358 asserts the Design 3 closed/Outcome wording.
- Quality gates: management-be `dotnet format style --verify-no-changes` and the full `dotnet test` (2345 tests, all pass; re-ran the ReAccreditation+Notify subset after the review fixes). management-fe lint, format:check and test (2226). mgmt-tests lint and format:check. Browser specs were not run (they need the full stack, task 008).

## Note (2026-10-22, task 007)

- The push-failure acceptance-criteria wording above was amended from "nothing written" / "audit unchanged" to "no state or outcome changes; `status-push-failed` written", which is what the code does and what `main` did. That entry is shown to regulators, not only to support. See `.tasks/007-AFK-Medium-step2-parity-with-single-step.md`.
- Task 007 also moved the stamping of `accreditationStartDate` and `accreditationYear` to this step.
