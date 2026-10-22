# RA-527 — CM: Regulators follow a 2-step process for the Decision stage

Jira: https://eaflood.atlassian.net/browse/RA-527 (epic RA-613)
Design: Figma "527 - CM: Regulators to follow 2 step process for the Decision stage", page **Design 3** (`217:924`), prototype flow `217:2214`.
Branch: `feature/ra-527` in the parent repo, management-fe, management-be and mgmt-tests (identical names — management-fe's PR check resolves the matching management-be and mgmt-tests branches by name for the e2e stack). If any other repo turns out to need a change, it gets the same branch name.

## Problem Statement

In Case Management (CM), a regulator records a re-accreditation determination with a single "Make determination" submit. That one click mints the accreditation number, moves the work item to its final state (Granted or Refused), stops the SLA clock, queues publishing, sends the operator the automated Decision email and pushes the final status to the Operator Journey (OJ).

In reality regulators make the determination first, then contact the operator with the Notice of Approval or Refusal, and only then is the outcome "applied". Because CM applies the outcome immediately, operators can see GRANTED / REFUSED (and receive the Decision email) before the regulator has spoken to them, which does not reflect the actual procedure. The form also carries a loose instruction ("Contact the applicant when the determination has been made") that nothing enforces.

## Solution

Split the determination into two steps, for both outcomes:

1. **Make determination (step 1)** — the regulator chooses Approved or Refused and optionally adds notes. CM records the determination (and, for approvals, mints and shows the accreditation number) and moves the work item into a new **pending-contact** state. Nothing is pushed to the operator; the operator's status, due date and emails are unchanged.
2. **Confirm applicant contact (step 2)** — after contacting the applicant outside the service, the regulator opens "Confirm applicant contact", ticks "I have contacted the applicant about the decision" and clicks "Confirm and continue". Only now is the final status pushed to the operator, the work item moved to its final state (Granted / Refused), the SLA clock stopped, publishing queued and (for approvals) the Decision email sent.

### Status model

| Regulator action | CM state id → tag (colour) | Operator status |
|---|---|---|
| Before determination | unchanged (e.g. `assessment-in-progress`) | unchanged |
| Approve (step 1) — number minted | **new** `approved-pending-contact` → **"Approved"** (light blue), non-terminal | unchanged — no push |
| Refuse (step 1) — no number | **new** `rejected-pending-contact` → **"Refusing"** (orange), non-terminal | unchanged — no push |
| Confirm applicant contact (step 2) after approval | existing `approved` → "Granted" (green), terminal | existing `Approved` → "GRANTED", pushed now |
| Confirm applicant contact (step 2) after refusal | existing `rejected` → "Refused" (red), terminal | existing `Rejected` → "REFUSED", pushed now |

Existing state ids, labels and OJ mappings are unchanged; the only new states are the two pending-contact states. **Provisional:** the "Refusing" label and both new tag colours (light blue / orange) may change later. Keep each as a single label/colour mapping entry, so that changing it is a one-line edit plus test updates.

## User Stories

### Making the determination (step 1)

1. As a regulator, I want the "Make determination" form to have the heading "Make determination", so that the page title is concise and matches the design.
2. As a regulator, I want the notes field labelled "Notes (optional)", so that it is clear notes are not required.
3. As a regulator, I want the notes hint to read "The determination will be recorded in the application history (audit log). You need to contact the applicant when the determination has been made.", so that I know contacting the applicant is the next step.
4. As a regulator, I want the existing warning "This determination is final and it cannot be changed." to remain, so that I understand the outcome is binding.
5. As a regulator, I want choosing Approved and submitting to record my determination without changing what the operator sees, so that the operator is not told before I contact them.
6. As a regulator, I want an accreditation number minted and shown to me as soon as I approve, so that I can quote it when I contact the applicant.
7. As a regulator, I want choosing Refused and submitting to record my determination without changing what the operator sees, so that the refusal is not visible before I contact them.
8. As a regulator, I want the work item tagged "Approved" after approving, so that I can tell at a glance it is approved but not yet applied.
9. As a regulator, I want the work item tagged "Refusing" after refusing, so that I can tell at a glance a refusal has been made but not yet applied.
10. As a regulator, after approving, I want a banner "Application approved — The application was approved. You now need to contact the applicant about the decision." with "Accreditation ID: <number>", so that I know what to do next.
11. As a regulator, after refusing, I want a banner "Application refused — The application was refused. You now need to contact the applicant about the decision.", so that I know what to do next.
12. As a regulator, I want the step 1 banner to remain on every visit while the work item is pending contact, so that the outstanding action is never lost.
13. As a regulator, I want the Accreditation ID, Accreditation start date and Accreditation year rows shown on the application summary while an approval is pending contact, so that the details are available before contact.
14. As a regulator, I want no accreditation rows for a refusal, so that the page does not imply an accreditation exists.
15. As a regulator, I want my determination and notes recorded in the application history as "Determination made: Approved/Refused", so that there is an audit trail of when and by whom it was made.
16. As a regulator, I want the SLA clock to keep running during pending contact, so that the SLA reflects when the outcome was actually applied.

### While pending contact

17. As a regulator, I want a "Confirm applicant contact" button in the sidebar while a work item is pending contact, so that I can complete step 2.
18. As a regulator, I want only Confirm applicant contact, Reassign and Unassign available while pending contact, so that the determination cannot be altered or the item side-tracked after a decision.
19. As a regulator, I do not want to change or re-make the determination while pending contact, so that a final determination stays final.
20. As a regulator, I do not want Query, due-date change or due-date override actions while pending contact, so that a decided application is not reopened.
21. As a regulator, I do not want to withdraw an application while pending contact, so that a minted accreditation number is never left orphaned.
22. As a regulator, I want to reassign or unassign a pending-contact work item, so that someone else can make the contact if needed.
23. As an operator, I want my application status, due date and emails unchanged while CM is pending contact, so that I only learn the outcome from the regulator first.

### Confirming applicant contact (step 2)

24. As a regulator, I want a "Confirm applicant contact" page (caption "Application number: <ref>", heading "Confirm applicant contact") with the checkbox "I have contacted the applicant about the decision", a "Confirm and continue" button and a "Cancel" link, so that I explicitly confirm the contact.
25. As a regulator, if I click "Confirm and continue" without ticking the box, I want an error summary and an inline error "Confirm you have contacted the applicant about the decision", so that I cannot confirm by accident.
26. As a regulator, I want "Cancel" to return me to the application summary with nothing changed, so that I can back out safely.
27. As a regulator, I want the confirm page to be the same for approvals and refusals, so that the process is consistent.
28. As a regulator, when I confirm contact for an approval, I want the work item to become "Granted" and the operator to see "GRANTED", so that the outcome is applied on both sides at once.
29. As a regulator, when I confirm contact for a refusal, I want the work item to become "Refused" and the operator to see "REFUSED", so that the outcome is applied on both sides at once.
30. As a regulator, after confirming an approval, I want a one-time banner "Applicant contacted — The applicant has been contacted and accreditation is granted.", so that I know it worked.
31. As a regulator, after confirming a refusal, I want a one-time banner "Applicant contacted — The applicant has been contacted and accreditation is refused.", so that I know it worked.
32. As a regulator, on later visits to a Granted/Refused work item, I want no success banner, so that the page shows the settled outcome only.
33. As a regulator, I want the closed assignment panel to read "This application is closed and can no longer be assigned or reassigned.", so that the wording matches the design.
34. As a regulator, I want the Outcome box to read "This work item is in a final state. No further decision actions are available." with the Granted/Refused tag, so that the final outcome is clear.
35. As a regulator, I want "Applicant contacted" recorded in the application history with who confirmed it and when, so that there is an audit trail of the contact confirmation.
36. As a regulator, if the push to the operator fails when I confirm contact, I want an error and nothing to change in CM, so that CM and OJ never disagree and I can simply retry.
37. As a regulator, I want retrying confirm contact after a failure to be safe, so that a transient failure never corrupts the work item.
38. As an operator, I want to receive the automated Decision email for an approval only after the regulator confirms contact, so that the email arrives alongside my GRANTED status.
39. As an operator, I want no automated email for a refusal (as today), so that the regulator's own notice is the only communication.
40. As a regulator, I want the SLA clock stopped when I confirm contact, so that the SLA ends when the outcome is applied.
41. As a service owner, I want the publishing job queued only when the outcome is applied (step 2), so that nothing is published for a determination not yet communicated.

### Access, safety and navigation

42. As a read-only user, I want the "Confirm applicant contact" button and the confirm page controls shown disabled, so that I can see the state but cannot act.
43. As a service owner, I want the confirm-contact route to require a standard (non-read-only) user, so that only authorised regulators can apply an outcome.
44. As a regulator, if I open the confirm page for a work item that is not pending contact, I want to be redirected to the application summary, so that I cannot confirm something that is not awaiting confirmation.
45. As a regulator, I want "Make determination" no longer offered once a work item is pending contact, so that the determination cannot be repeated.

### Work-items list

46. As a regulator, I want "Approved" and "Refusing" options in the Status filter (between "Queried" and "Granted"), so that I can find work items awaiting contact.
47. As a regulator, I want pending-contact work items shown in the default (non-archived) list, so that outstanding contact work is never hidden.
48. As a regulator, I want the "Approved" tag light blue and the "Refusing" tag orange in the list and header, so that pending outcomes are visually distinct from final ones.

### Housekeeping

49. As a developer, I want the obsolete bespoke `/approve` endpoint (and its frontend client and test references) removed, so that there is no route that bypasses the two-step process.
50. As a developer, I want the outdated comment claiming the Decision email reads the latest note corrected, so that future changes are not based on a false premise.
51. As a developer, I want existing Granted/Refused work items left untouched, so that historic data needs no backfill.

## Implementation Decisions

### Workflow / state model (management-be, mirrored in management-fe)
- Add two non-terminal states to the re-accreditation work-item type: `approved-pending-contact` (display "Approved") and `rejected-pending-contact` (display "Refusing").
- Existing `approved` ("Granted") and `rejected` ("Refused") remain the only terminal decision states, with unchanged ids and labels.
- New transitions (CallerInvocable false, so the bespoke endpoints are the only way in): from the decision-entry path into each pending state (step 1), and from each pending state into its terminal state (step 2, "confirm applicant contact").
- From the pending states, only confirm-contact, reassign and unassign are available. Query, withdraw, due-date change/override and re-determination are not available.
- Bump the re-accreditation `templateVersion` from v16 to v17, with a new snapshot migration in management-be (following the existing re-accreditation snapshot migration pattern and registration), and register v17 in management-fe's module mirror and detail-template version map (the boot assert requires it).
- No backfill. Existing terminal items are untouched; open items migrate their snapshot to v17 and follow the new flow when determined.

### Step 1 — Make determination (existing decision endpoint, changed behaviour)
- The existing bespoke decision endpoint (`POST …/re-accreditation/{id}/decision`, body `{ outcome }`) keeps its contract and entry-state eligibility (assessment-in-progress, awaiting-decision, duly-made via the RA-595 auto-start).
- Approved: mint the accreditation number via the OJ number adapter (it is idempotent and is allowed because OJ is not yet terminal), stamp `accreditationId`, `accreditationStartDate` and `accreditationYear` on the payload, and move the item to `approved-pending-contact`.
- Refused: no number is minted; move the item to `rejected-pending-contact`.
- Record an audit entry "Determination made: Approved/Refused". The determination note continues to be posted as a work-item note before the decision call (existing behaviour).
- Step 1 does **not**: push to OJ, stop the SLA clock, queue publishing, or send any email.
- The generic status-push hook must exclude the new step 1 transitions (alongside the existing decision actions) so no pending state is ever pushed.
- Idempotent replay: repeating step 1 with the same outcome on an item already in the matching pending state succeeds without side effects. The opposite outcome, or any terminal state, gives 409 (as today).
- The approval guard that refuses an item already carrying a real-format `accreditationId` while not `approved` must allow `approved-pending-contact` (the number was minted at step 1). Step 2 reuses the step 1 number and never re-mints.

### Step 2 — Confirm applicant contact (new endpoint)
- New bespoke endpoint on the re-accreditation group: `POST …/re-accreditation/{id}/confirm-contact` (no body beyond the acting user, and authorisation as for the decision endpoint). Valid only from the two pending states. Otherwise 409, or 404 / wrong type as for existing endpoints.
- Agreed run order:
  1. **Pre-commit push to OJ** (existing decision push with its larger retry pipeline): to-state `approved` or `rejected`, from-state the pending state, with a single `OccurredAt` timestamp. On failure: 500 (upstream notification failed) and **nothing written**.
  2. **Single CM write**: terminal state, SLA clock stopped (`StoppedAt` = the same timestamp), audit entries ("Applicant contacted" with the acting user, plus the existing action-applied, sla-clock-stopped and accreditation-issued entries for approvals), and publishing enqueued (for approvals, as today's approve path does).
  3. **Post-action hooks**: the Decision Notify email for approvals only (unchanged template and personalisation). No email for refusals (RA-211 behaviour retained).
- Retry safety: if the CM write fails after a successful push, the regulator retries. OJ drops the duplicate push via its `OccurredAt` watermark ordering, and an item already in the target terminal state replays as success.
- management-fe's backend client gets a `confirmApplicantContact` call that uses the existing longer decision timeout (the pre-commit push retries for up to ~28s).

### management-fe UI
- **Decision form:** H1 "Make determination", notes label "Notes (optional)", the new hint text (Design 3). Warning, radios, button and Cancel are unchanged. The success flash after step 1 is replaced by the persistent pending banners.
- **Detail page in pending states:** status tag ("Approved" light blue / "Refusing" orange); the persistent step 1 banner (approval includes "Accreditation ID: <number>"); accreditation summary rows for approvals (decision metadata is built for `approved-pending-contact` as well as `approved`); sidebar shows the "Assigned to you" box with only Reassign/Unassign plus a separate box with a primary "Confirm applicant contact" button (disabled for read-only users); "Make determination", Query and due-date links are hidden.
- **Confirm page:** new GET/POST route under the re-accreditation work-item routes (`…/{id}/confirm-contact`), `requireStandard` on the POST. Controls are disabled for read-only users. The GOV.UK checkbox has the error summary and inline error. Cancel returns to the detail page. If the item is not in a pending state, both GET and POST redirect to the detail page. A successful POST redirects to the detail page with a one-time "Applicant contacted" flash banner whose wording depends on the outcome.
- **Terminal pages:** the closed-panel wording becomes "This application is closed and can no longer be assigned or reassigned."; Outcome box wording "This work item is in a final state. No further decision actions are available."
- **Work-items list:** Status filter options "Approved" → `approved-pending-contact` and "Refusing" → `rejected-pending-contact`, inserted between "Queried" and "Granted". Pending states are not archived. The state badge map gets `approved-pending-contact` light blue and `rejected-pending-contact` orange.
- Follow management-fe conventions: service objects return `{ ok, … }` results, `data-testid`s on new controls (they are a contract with mgmt-tests), `disabled: user.isReadOnly` on every control.

### Removal of the bespoke `/approve` endpoint (option B)
- Delete the RA-132 `POST …/re-accreditation/{id}/approve` endpoint, its handler and tests in management-be; delete the frontend backend-client wrapper and its tests; and remove or adjust the mgmt-tests page-object reference. management-fe and management-be are always released together, so there is no compatibility concern.

### Unchanged
- The OJ backend (status mapping ignores from-state; number endpoint unchanged), the OJ frontend (labels, terminal locking, due date — the due date is read live from CM's fixed SLA `DueAt`, which stopping the clock does not change) and fe-tests. No Welsh/i18n work: CM has no locale files and OJ copy is unchanged.

## Testing Decisions

- Good tests assert externally observable behaviour at the highest seam — HTTP responses, persisted work-item state, payload, audit, SLA clock, outbound push/number/Notify calls, rendered HTML and redirects — not private helpers or call order inside a class (except the agreed push-before-write ordering, which is observable as "nothing written on push failure").
- Tests are written first (red → green) for each task.
- **management-be (xUnit v3 + NSubstitute + EphemeralMongo):** primary seam is the HTTP endpoints via the existing re-accreditation endpoint test harness, with the OJ push, accreditation-number and Notify adapters stubbed. Cover: step 1 approve/refuse → pending state, number minted (approve only), no push, SLA running, no email or publishing, audit entry; idempotent replay and 409s; step 2 from each pending state → terminal, push sent with the correct to-state, SLA stopped, publishing (approve), Decision email (approve only), audit; push failure → 500 and nothing written; confirm from a non-pending state → 409; the status-push hook never pushes pending states; v17 snapshot migration; `/approve` gone. Update the existing log-decision and approval service tests, the type, available-actions, lifecycle and hook-order tests where they assert the old single-step behaviour. Prior art: the existing log-decision endpoint and service tests, the status-push-hook tests, and the decision snapshot migration tests.
- **management-fe (Vitest, `server.inject`, backend client stubbed):** decision form copy; the detail page in each pending state (tag, banner, rows, sidebar actions, hidden links, read-only disabled); confirm page GET/POST (validation error, Cancel, redirects for a wrong state, success flash per outcome, read-only); terminal-page wording; work-items filter options and badge colours; module/templateVersion v17 guard; route-scope coverage for the new POST; backend client for confirm-contact and `/approve` removal. Prior art: the decision controller, service and routes tests, the detail controller tests, the module test, and the route-scope coverage test.
- **mgmt-tests (WebdriverIO + Mocha, full stack):**
  1. Regression first: add `driveToApprovedPendingContact` / `driveToRefusingPendingContact` and a `confirmApplicantContact` helper, and re-compose `driveToApproved` / `driveToRefused` as step 1 + step 2 so existing specs still reach the terminal state. Update the specs that test the decision moment (status push to OJ moves to step 2; Decision email at step 2; hint text) and the page objects (new confirm page, `/approve` reference).
  2. Then a new spec, `ra-527-two-step-determination`, covering each step separately for both outcomes: tag and banner after step 1, OJ status **unchanged** after step 1 (`waitForOperatorApplicationStatus`), unticked-box error, Cancel, OJ GRANTED/REFUSED after step 2, Decision email only at step 2 for approvals, and the work-items Status filter.
- **fe-tests:** no change.

## Out of Scope

- Any change to the OJ backend, the OJ frontend or fe-tests.
- Changing the existing terminal labels ("Granted", "Refused"), OJ labels, or Decision email template/personalisation.
- Backfilling or migrating historic decided work items.
- The other RA-613 tickets (RA-576 duly-made payment date; RA-595 is already on main).
- Figma placeholder inconsistencies (Accreditation ID typo, "Reprocessor accreditation" as the start-date value, payment-date wording) — use real data as today.
- Pushing branches or opening PRs (no push access from the dev container).

## Further Notes

- **For design to confirm (may change later):** the refusal-path copy (banners and "accreditation is refused") and the "Refusing" tag are extrapolated from Design 3's approval-only screens. The new tag colours ("Approved" light blue, "Refusing" orange) are also provisional.
- The ticket's "Log decision" button is today's "Make determination" submit; the code still uses "log decision" naming internally.
- The Jira comment asking what the new state is called and what its entry/exit rules are is answered by the status model above.
- Code changes land in the submodules on `feature/ra-527`. After each task, update the parent repo's submodule pointers on its `feature/ra-527` branch so the parent always references the latest task commits.
- A management-fe PR's e2e check resolves matching management-be and mgmt-tests branches by name. Keep all three on `feature/ra-527`, or the e2e stack runs against the published `latest` images and fails.
