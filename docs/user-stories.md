# Enrolment Management — User Stories (Happy-path demo)

Backlog scoped to the **full happy path** through the BA's user-journey
BPMN. Goal: a demoable end-to-end flow for the wider team — operator
submits → regulator routes → duly-makes → payment received → assessor
assigned → approved → published → archived → operator sees decision.

Edge cases (queries, risk flags, withdrawals, rejects, splits, appeals,
refunds, cancellation, reporting dashboard, etc.) are intentionally
deferred and listed at the bottom.

Each story uses the GOV.UK-style "As a … I want … so that …" form,
followed by Context, Acceptance criteria, Implementation notes, and
Out-of-scope.

## Repo cheat sheet

Four projects, two stacks:

| Project | Path | Stack | Purpose |
|---|---|---|---|
| Mgmt BE | `lib/epr-register-enrol-management-be` | .NET 10, Mongo | Enrolment management API (work-item framework) |
| Mgmt FE | `lib/epr-register-enrol-management-fe` | Node 24, Hapi 21, Nunjucks | Regulator BFF / GOV.UK UI |
| Operator BE | `lib/epr-register-enrol-backend` | .NET 10, Mongo | Operator-facing accreditation API |
| Operator FE | `lib/epr-register-enrol-frontend` | Node 24, Hapi 21, Nunjucks | Operator-facing GOV.UK UI |

Key framework primitives in the Mgmt BE (under `WorkItems/Core/`):

- `IWorkItemType` — declares states, transitions (actions) and tasks per
  state.
- `IWorkItemModule` — entry point: `Type` + `RegisterServices` +
  `MapEndpoints`.
- `IWorkItemService` — `CompleteTaskAsync`, `ApplyActionAsync`,
  `AssignAsync`, `UnassignAsync`, `AddNoteAsync`. All operations append
  to `AuditLog`.
- `WorkItem` — persisted envelope: `id`, `typeId`, `stateId`, `payload`,
  `completedTasks[]`, `Notes[]`, `AuditLog[]`.
- Reference type: `WorkItems/ReAccreditation/`.

Mgmt FE registers modules in
[src/server/work-items/modules.js](lib/epr-register-enrol-management-fe/src/server/work-items/modules.js).
Modules export `{ type, async register(server) }` and own their routes +
Nunjucks templates. Reference: `src/server/work-items/re-accreditation/`.

Auth headers from CDP propagate user identity into the BE:
`x-cdp-cognito-client-id`, `x-cdp-user-id`, `x-cdp-user-name`,
`x-cdp-user-roles` (comma-separated). BE handler:
`Auth/CognitoClientIdAuthenticationHandler.cs`.

## Happy-path coverage map

The 13 stories below cover every node on the BPMN happy path:

| BPMN step | Story |
|---|---|
| Receive application / submission | US-05 (create work item) |
| Determine regulator/nation, route | US-03 |
| Capture submission audit trail | US-04 |
| Status = Submitted | US-04 / US-05 |
| Send submission confirmation email | US-02 |
| View worklist / navigate to work item | US-05 (existing) |
| Start duly making, status = Duly making | US-06 (duly-make action) |
| Add note, tasks page | US-07 |
| Confirm duly made → send "duly made" email (with pay link) | US-02, US-06 |
| Operator pays the duly fee | US-08 (operator FE + payment-completed callback) |
| Payment received → start 12-week timer | US-08 |
| Status = Assessment in Progress, unassign | US-08 |
| Send "assessment in progress" notification | US-02, US-08 |
| Assign assessor (self or colleague) | US-09 |
| Continue assessment | (no story — uses tasks page US-07) |
| Extension / manual override | US-10 |
| Make determination → Approve | US-11 |
| Generate accreditation ID + start date + year | US-12 |
| Publish to PRN/PERN | US-13 |
| Publish to public register | US-14 |
| Stop clock, status = Decision | US-11 |
| Notify operator of decision | US-02, US-11 |
| Archive | US-15 |
| Operator views decision letter | US-16 |

Cross-cutting: US-01 (Swagger), US-02 (Notify infra).

---

## Platform / cross-cutting

### US-01 — Swagger UI on enrolment management backend

*As a* developer
*I want* a Swagger/OpenAPI UI exposed by the Mgmt BE
*so that* I can explore and test endpoints without maintaining Postman
collections.

**Context**
There is no Swagger UI today. The BE uses minimal-API endpoint mapping
per work-item module. We want generated OpenAPI + a UI in non-prod only.

**Acceptance criteria**
- Running the BE locally, `GET /swagger` returns the Swagger UI page.
- `GET /openapi/v1.json` returns a valid OpenAPI 3.x document.
- Document includes every endpoint mounted by every `IWorkItemModule`
  and every framework endpoint under `/work-items/...`.
- Document includes request/response schemas for `WorkItem`,
  `WorkItemResponse`, `WorkItemNote`, `WorkItemAuditEntry`, and the
  re-accreditation payload.
- Swagger UI is **disabled in Production** (gated on
  `app.Environment.IsProduction()` returning false, OR an explicit
  `Swagger:Enabled` config flag).
- README updated with a one-line "Swagger UI:
  http://localhost:PORT/swagger".

**Implementation notes**
- Use `Microsoft.AspNetCore.OpenApi` (built into .NET 10) +
  `Swashbuckle.AspNetCore.SwaggerUI` (UI-only dependency) to avoid
  pulling the legacy Swashbuckle generator.
- Wire-up in
  [Program.cs](lib/epr-register-enrol-management-be/EprRegisterEnrolManagementBe/Program.cs).
- Ensure `[Tags(...)]`/`WithTags(...)` is set on each module's endpoint
  group so the UI groups them by work-item type.

**Out of scope**
- Authenticating Swagger UI with Cognito.
- Generating client SDKs.

---

### US-02 — GOV.UK Notify integration

*As a* regulator
*I want* the system to send transactional emails via GOV.UK Notify
*so that* operators are kept informed automatically at every happy-path
status change.

**Context**
There is **no email integration today**. This story introduces the
plumbing and the five happy-path emails: submission confirmation,
duly-made notice, assessment-in-progress (clock started), SLA extended, and
decision outcome.

**Acceptance criteria**
- `INotifyClient` abstraction in the Mgmt BE with a single
  `SendEmailAsync(templateId, toEmail, personalisation, reference)`
  method.
- Real implementation wraps `GovukNotify.Client` (NuGet `GovukNotify`).
- Configuration: `Notify:ApiKey`, `Notify:BaseUri` (optional override),
  and a `Notify:Templates` section keyed by purpose:
  `SubmissionConfirmation`, `DulyMade`, `AssessmentInProgress`, `SlaExtended`,
  `Decision`.
- `NoOpNotifyClient` is used when `Notify:ApiKey` is missing (logs at
  Information level instead of sending) so local dev still works.
- Every send writes a `WorkItemAuditEntry` with action
  `notification-sent` (or `notification-failed`) and details
  `{ templateKey, recipient, reference, providerMessageId }`.
- Failures are caught and surfaced on the work item; they do **not**
  roll back the originating action. Failed sends are retried via Polly
  (3 attempts, exponential backoff) before the failure audit entry is
  written.
- Sends are wired into the happy-path transitions: submit →
  `SubmissionConfirmation`, duly-make → `DulyMade`, payment-received
  → `AssessmentInProgress`, sla-extend → `SlaExtended`, approve → `Decision`.
- Unit tests cover: success, transient failure + retry success,
  terminal failure (recorded in audit log).

**Implementation notes**
- Place under
  `lib/epr-register-enrol-management-be/EprRegisterEnrolManagementBe/Notifications/`.
- Register in `Program.cs`. Inject `INotifyClient` into module services.
- All template IDs come from config — never hard-code template GUIDs.

**Out of scope**
- SMS templates.
- Operator preference centre.
- Free-text email body authored by an assessor (deferred).

---

## Intake

### US-03 — Route submissions by nation

*As an* assessor
*I want* incoming applications routed to the correct nation/regulator
*so that* only the right team sees them in their worklist.

**Context**
BPMN: "Determine Regulator/nation → Route based on the site address".

**Acceptance criteria**
- `WorkItem.payload` for re-accreditation includes a `Nation` field
  (`England` | `Scotland` | `Wales` | `NorthernIreland`) derived from
  the site address postcode.
- `GET /work-items?nation=...` filters server-side.
- Worklist UI in the Mgmt FE adds a Nation filter (multi-select),
  defaulting to the user's nation if their roles include exactly one
  nation (`role:nation-england` etc.).
- Audit entry `routed-to-nation` recorded on submission with
  `{ nation, derivedFrom: "site-address" }`.

**Implementation notes**
- Derivation lives in an `INationResolver` service. Postcode prefix
  rules: `BT*` → NI; `EH*`/`G*`/`KY*` etc. → Scotland; `CF*`/`SA*`/`LL*`
  etc. → Wales; everything else → England. Document the table in the
  service file.
- Add a Mongo index on `payload.Nation` + `stateId`.
- Reuse the GOV.UK checkboxes pattern from
  `re-accreditation/templates/`.

**Out of scope**
- Cross-nation reassignment workflow.

---

### US-04 — Capture submission in the audit trail

*As a* regulator
*I want* every submission to create an audit entry on the work item
*so that* I can prove when and how an application arrived.

**Context**
BPMN: "Capture submission audit trail entry → Update application status
to submitted". `IWorkItemService` already appends audit entries on most
state changes, but the **initial submission** path does not.

**Acceptance criteria**
- Submitting a new work item via `POST /work-items` appends an audit
  entry with action `submitted` and details
  `{ source, clientId, userId?, applicationReference }`.
- The entry's `CreatedAt` is the server-side receipt time (UTC), not a
  client-supplied value.
- The audit entry is the **first** entry on the work item — visible
  immediately in `GET /work-items/{id}`.
- Integration test asserts the entry exists immediately after
  submission.

**Implementation notes**
- Touch the submission path in `WorkItems/Core/WorkItemService.cs` (and
  the submission endpoint in `WorkItemEndpoints.cs`).
- Use `TimeProvider` (already injected for testability via
  `Microsoft.Extensions.TimeProvider.Testing`).
- Source is `"operator-fe"` for now; future intake channels can pass a
  different value.

---

### US-05 — Create a work item from the Mgmt FE UI

*As a* duly maker
*I want* to create a work item from a dedicated page in the enrolment
management UI
*so that* I can demo end-to-end intake without standing up the full
operator flow.

**Context**
Today the only way to create a work item is via the BE endpoint
directly. For the demo we need a page in the Mgmt FE that posts to the
existing `POST /work-items` endpoint with a re-accreditation payload.

**Acceptance criteria**
- New route `GET /work-items/new` in the Mgmt FE renders a GOV.UK form
  page titled "Create a work item".
- Form fields cover the minimum re-accreditation payload:
  `applicationReference`, `organisationName`, `siteAddress` (line1,
  line2, town, postcode), `material` (select), `tonnageBand` (select),
  `submittedByEmail`. (Nation is **derived** from postcode by US-03 —
  not a form input.)
- `POST /work-items/new` validates with Joi, calls the existing
  `POST /work-items` endpoint on the Mgmt BE via the configured
  backend-api client, then redirects to the new work item's detail page
  on success.
- Validation errors render via the GOV.UK error-summary component with
  in-page anchors to fields.
- Successful creation surfaces a GOV.UK notification banner ("Work item
  created — `<reference>`") on the destination page.
- The page is reachable from the worklist via a "Create work item"
  GOV.UK button (top-right of the worklist).

**Implementation notes**
- Add the route under
  `lib/epr-register-enrol-management-fe/src/server/work-items/re-accreditation/`
  (re-accreditation work item, lives in that module).
- Use the existing backend-api fetch wrapper
  (`src/server/common/helpers/backend-api.js`) — propagates
  `x-cdp-user-id` and the trace header.
- Templates in the module's `templates/` folder; reuse the form macros
  pattern already used in the module.

**Out of scope**
- Bulk creation, file uploads, multi-step wizard. Single page only.
- Editing an existing work item from this page.

---

## Duly making

### US-06 — Start duly making and confirm duly made

*As a* duly maker
*I want* to start duly-making and confirm an application is duly made
*so that* it can move into the 12-week assessment phase.

**Context**
BPMN: "Start or initiate duly making → Update status to duly making →
… → Is application duly made? YES → send duly-made email → Update
status to in assessment".

In our model the duly-make action transitions the work item to a
`duly-made` state — it does **not** start the SLA clock or move into
assessment. The transition into `assessment-in-progress` is driven by
the **operator** paying the duly fee (US-08), per the tech lead's
guidance. This keeps the regulator's confirm-duly-made decision
separate from the system event that actually opens the assessment
phase, and ensures we never enter assessment for an unpaid case.

**Acceptance criteria**
- Re-accreditation `IWorkItemType` has two new states/transitions on
  top of `submitted`:
  - Action `start-duly-making`: `submitted` → `duly-making`.
  - Action `confirm-duly-made`: `duly-making` → `duly-made`.
- `start-duly-making` requires no payload; sets
  `payload.DulyMakingStartedAt` and `payload.DulyMakingStartedByUserId`.
- `confirm-duly-made` body `{ checklistAcknowledged: true }`; rejects
  with 422 if not acknowledged.
- `confirm-duly-made` triggers the `DulyMade` Notify email (US-02).
  The email includes a deep-link the operator follows to pay the duly
  fee — paying that fee is what triggers the next transition (US-08).
- Both actions write audit entries (`duly-making-started`,
  `duly-made-confirmed`).
- Mgmt FE surfaces both as primary GOV.UK buttons on the work-item
  detail page when the current state allows them. The
  `confirm-duly-made` button leads to a confirmation interstitial with
  the duly-making checklist as a single acknowledged checkbox.
- After duly-made the work item appears in the worklist with
  status pill "Duly made" (yellow).

**Implementation notes**
- Update `ReAccreditation/ReAccreditationType.cs` — add states +
  transitions to `States` and `Transitions`.
- The duly-making checklist body is static markdown for the demo —
  hard-coded in the Nunjucks template. A future story turns it into
  per-rule checks (see deferred list).

**Out of scope**
- Negative duly-making outcome (rejection). Demo is happy-path only.
- Risk review / risk flagging.

---

### US-07 — Tasks page (tasks, status, notes consolidated)

*As an* assessor
*I want* a dedicated page for a work item's tasks
*so that* the work-item summary stays focused on the case while task
work happens in one place.

**Context**
Today task progress, status toggles, and notes all render on the
work-item detail page. Lift task functionality to its own page.

**Acceptance criteria**
- New route `GET /work-items/{id}/tasks` in the Mgmt FE renders all
  tasks for the work item's current state, grouped by status
  (Not started / In progress / Blocked / Completed).
- Each task row exposes:
  - Status change controls (Mark in progress / Block / Mark complete)
    posting to `PUT /work-items/{id}/tasks/{taskId}/status`.
  - A "Quick complete" CTA → `POST /work-items/{id}/tasks/{taskId}/complete`.
  - A "Add note" form scoped to the task. Posts to a new endpoint
    `POST /work-items/{id}/tasks/{taskId}/notes` body `{ text }`.
- Per-task notes are persisted on the work item with a `taskId`
  reference (extend `WorkItemNote` with an optional `TaskId` field —
  null means a work-item-level note, set means a task-level note).
- **Every task-level note also produces a `WorkItemAuditEntry` on the
  parent work item's audit log** with action `task-note-added` and
  details `{ taskId, taskDisplayName, noteId, excerpt }` (excerpt =
  first 100 chars). This is in addition to the note being stored —
  one write, one audit entry, atomic from the caller's perspective.
- The tasks page renders task-scoped notes inline under each task row
  (newest first, no pagination needed yet) and work-item-level notes
  in a separate "Work item notes" section above the task list.
- The work-item summary page (`/work-items/{id}`) **no longer** renders
  task controls or the notes form; instead it shows a "Tasks &
  notes (n)" GOV.UK link/button to the tasks page, with task count.
- Read-only progress (e.g. "3 of 5 tasks complete") still appears on
  the summary page.
- The work-item audit log (rendered on the summary page) shows
  task-note-added entries with the task name and excerpt, so a
  reviewer scanning the audit log can see all task-scoped notes
  without opening every task.
- Navigating away and back preserves the page (no destructive state).

**Implementation notes**
- Follow the routing pattern in `re-accreditation/routes.js`. The page
  is module-owned.
- Templates in the module's `templates/` folder
  (`tasks-page.njk`, plus partials for the task-row and notes form).
- Reuse the existing notes-rendering partial; just relocate it.
- Extend `IWorkItemService.AddNoteAsync` to accept an optional
  `taskId`; the existing audit entry (`note-added`) becomes
  `task-note-added` when `taskId` is set, with the extra details
  payload above.
- Index added on `WorkItem.Notes.TaskId` is unnecessary — notes are
  embedded on the work-item document.

**Out of scope**
- Reordering tasks, custom task creation, task comments.
- Notes pagination.
- Editing or deleting task notes (notes are append-only).

---

## Assessment

### US-08 — Operator pays duly fee → start 12-week SLA timer

*As an* operator
*I want* paying the duly fee to move my application into
"Assessment in Progress" and start the 12-week clock
*so that* the regulator only begins their assessment once I've paid,
and the SLA reflects the time they've actually had the case.

**Context**
No SLA tracking today. Per the tech lead, the **operator's payment
action** is the trigger that moves a duly-made work item into
`assessment-in-progress` and starts the 12-week clock — not a
regulator-side action. The work item is **unassigned** on transition
(assessor is chosen afresh — see US-09). The "Payment made" task is
removed because payment is now the system event that drives the
transition, not a checkbox an assessor ticks.

The state is named **`assessment-in-progress`** (not `in-assessment`)
to match the business terminology.

**Acceptance criteria**
- `WorkItem.SlaClock` shape on the persisted document:
  ```
  {
    startedAt: DateTime,
    targetDuration: TimeSpan, // default 12 weeks
    breached: bool             // computed daily by the background job
  }
  ```
- The re-accreditation `IWorkItemType` defines the
  `assessment-in-progress` state with action `payment-completed`:
  `duly-made` → `assessment-in-progress`. There is no manual
  regulator-side transition into this state on the happy path.
- Operator FE adds a "Pay duly fee" page reachable from the deep-link
  in the `DulyMade` Notify email (US-06). For the demo it is a single
  page with a "Confirm payment" button (no real Pay integration).
  Submitting the form calls a new operator BE endpoint
  `POST /accreditation-application/{id}/duly-payment` which records
  the payment and forwards to the Mgmt BE.
- New Mgmt BE endpoint `POST /work-items/{id}/payment-completed` body
  `{ amountPence, reference, paidAt, paidByUserId, paidByEmail }`:
  - Validates the work item is in `duly-made` (returns 409
    `ProblemDetails(type: "invalid-state")` otherwise).
  - Sets `SlaClock.startedAt = paidAt` (UTC, server-validated).
  - Transitions the work item to `assessment-in-progress`.
  - **Unassigns** the work item (clears assignee fields).
  - Writes audit entries `payment-completed`, `sla-clock-started`,
    `unassigned`, `state-changed` — all attributed to the paying
    operator user (via `paidByUserId`), not to a regulator.
  - Triggers the `AssessmentInProgress` Notify email (US-02) to the
    operator confirming the case is with the regulator.
- The `payment-made` task is **removed** from the re-accreditation
  type's `GetTasksForState` for any state where it currently exists.
- `GET /work-items/{id}` response includes `slaRemaining` and
  `slaState` (`OnTrack` | `AtRisk` (≤14 days remaining) | `Breached`).
- A nightly background job re-evaluates `breached` and emits an audit
  entry `sla-breached` once per item.
- Worklist column "SLA" shows a coloured GOV.UK tag and remaining
  time; sortable. Items pre-payment show "Awaiting payment".

**Implementation notes**
- Mgmt BE endpoint lives under the re-accreditation module
  (`WorkItems/ReAccreditation/Endpoints/`) — payment is a
  re-accreditation concern, not a framework one.
- Operator BE endpoint lives under `AccreditationApplication/`.
- Use `TimeProvider` for all timestamps (testability).
- Background job: `BackgroundService` registered in `Program.cs`;
  simple timer.
- The Mgmt BE endpoint is auth-gated such that only the operator BE's
  client id can call it (existing Cognito client-id auth handler) —
  regulators cannot manually trigger the transition.
- For the demo, the operator FE "Confirm payment" button is sufficient;
  no real GOV.UK Pay integration is required. The Notify template name
  changes from `InAssessment` to `AssessmentInProgress` accordingly
  (update US-02's template list).

**Out of scope**
- Pause/resume on queries (queries deferred).
- GOV.UK Pay integration.
- Refund on later withdrawal.

---

### US-09 — Assign assessor (self or colleague)

*As an* assessor or team leader
*I want* to assign a work item to myself or another colleague once it
enters Assessment in Progress
*so that* there's a clear owner driving it through to determination.

**Context**
BPMN: "Start assessment or assign assessor — Assign to self or assign
to colleague". Per US-08, work items are unassigned when they enter
in-assessment, so this is the first assignment step.

**Acceptance criteria**
- Mgmt FE renders an "Assign" panel on the work-item detail page
  whenever the item is in `assessment-in-progress` and unassigned. Two GOV.UK
  buttons: "Assign to me" and "Assign to a colleague".
- "Assign to me" → `POST /work-items/{id}/assign` body
  `{ toUserId, toUserName, toUserEmail }` populated from the current
  user's CDP headers.
- "Assign to a colleague" opens a form (name + email) and posts to the
  same endpoint.
- BE endpoint validates email format; 422 if missing fields.
- Successful assign writes audit entry `assigned` with details
  `{ fromUserId?, toUserId, toUserName }`.
- Once assigned, the panel is replaced with an "Assigned to: <name>"
  summary plus a "Reassign" link that re-opens the colleague form.
- Worklist `assignedTo` column shows the assignee name (or "Unassigned"
  pill).

**Implementation notes**
- `AssignAsync` already exists in `IWorkItemService` per the survey —
  surface it on the FE, and ensure the unassign on transition (US-08)
  is the only path to a clean state.
- No user-directory lookup yet; trust the typed name/email.

**Out of scope**
- User search / autocomplete.
- Bulk assignment (team-leader workflow).

---

### US-10 — SLA extension and manual override

*As a* team leader
*I want* to extend or manually override the SLA clock
*so that* exceptional cases don't breach unfairly.

**Context**
Builds on US-08. BPMN: "Extension needed? YES → Request/trigger
extension / Manual override".

**Acceptance criteria**
- `POST /work-items/{id}/sla/extend` body
  `{ additionalDuration: "P14D", reason }` (ISO-8601 duration). Adds
  `additionalDuration` to `SlaClock.targetDuration`.
- `POST /work-items/{id}/sla/override` body
  `{ newTargetDuration, newStartedAt?, reason }` for full override.
- Both gated to `role:team-leader`. 403 otherwise.
- Both require non-empty `reason`. 422 otherwise.
- Both write audit entries (`sla-extended` / `sla-overridden`)
  including before/after values and the reason.
- Mgmt FE: on the work-item summary page, a team leader sees an
  "Extend SLA" link (modal with duration + reason) and an
  "Override SLA" link (form page). Hidden for non-team-leaders.
- Operator receives a Notify email using the `SlaExtended` template
  for `extend`. `override` is silent (regulator-internal).

**Implementation notes**
- Endpoints live in `WorkItems/Core/` because they're framework-level
  (any work-item type with an SLA clock benefits).

**Out of scope**
- Multiple concurrent extensions / approval workflows.

---

## Determination

### US-11 — Approve determination

*As an* assessor
*I want* to record an Approve determination on a work item
*so that* the case can move to publishing and notification.

**Context**
BPMN: "Make determination → Approve". Happy path only — Reject and
Withdraw are deferred.

**Acceptance criteria**
- New action `approve` available only in `assessment-in-progress` state.
- Body `{ summary?: string }` — summary is optional free text shown on
  the decision letter; max 2000 chars.
- Action triggers (in order, atomically per work item):
  1. State transition `assessment-in-progress` → `approved`.
  2. SLA clock stop — sets `SlaClock.stoppedAt = utcNow`.
  3. Generate accreditation ID + dates (US-12).
  4. Publish to PRN/PERN (US-13) — async via background job, not
     blocking the response.
  5. Publish to public register (US-14) — async via background job.
  6. Send `Decision` Notify email to the operator (US-02) with the
     accreditation ID and start date in personalisation.
- Audit entries: `approved` (action), `sla-clock-stopped`,
  `accreditation-issued`, plus the published/notified entries from
  US-13/14/02.
- Mgmt FE: "Approve" primary button on the work-item page in
  `assessment-in-progress` (visible only to the assignee or a team leader).
  Confirmation interstitial with the optional summary textarea.
- Reaching the `approved` state hides all task/note edit affordances
  on the FE — read-only from here on, except the archive action
  (US-15).

**Implementation notes**
- Add the action to `ReAccreditationType.Transitions`.
- Background publishing jobs use `IBackgroundTaskQueue` — register a
  simple in-memory queue + `BackgroundService` in `Program.cs`.
- The Approve handler enqueues, then returns 200.

**Out of scope**
- Reject / Withdraw paths and their reason capture.
- Reviewer / second-pair-of-eyes approval workflow.

---

### US-12 — Generate accreditation ID, start date and year on approval

*As the* system
*I want* to generate an accreditation ID, start date and accreditation
year when an application is approved
*so that* downstream services have canonical identifiers.

**Context**
BPMN: "Generate accreditation ID, start date & update accreditation
year".

**Acceptance criteria**
- Approving a re-accreditation work item produces:
  - `payload.AccreditationId` — format
    `ACC-{Year}-{Material[:1]}-{8-char ULID}`, unique across all
    approved work items.
  - `payload.AccreditationStartDate` — first day of `AccreditationYear`.
  - `payload.AccreditationYear` — `{compliance-year}` from config (e.g.
    `2026`); rolls over via `Accreditation:CurrentYear`.
- Generation is **idempotent** — re-applying Approve in error doesn't
  produce a new ID; assertion in service layer.
- Audit entry `accreditation-issued` with the ID.
- The accreditation ID is rendered on the work-item summary page in a
  prominent GOV.UK panel after approval.

**Implementation notes**
- ULID via `NUlid` NuGet.
- Uniqueness check is a pre-flight Mongo lookup before the write
  (collision risk negligible with ULID, but defence in depth).
- Compose with US-11 — this story owns the ID-generation service; US-11
  calls it.

**Out of scope**
- Multi-material child IDs (split workflow is deferred).

---

### US-13 — Publish to PRN/PERN service

*As the* system
*I want* to publish approved accreditations to the PRN/PERN service
*so that* note issuance can begin.

**Context**
PRN/PERN service is external. URL + auth from config. For the demo,
the integration target may be a stub HTTP endpoint.

**Acceptance criteria**
- `IPrnPernPublisher` with `PublishAsync(WorkItem item)`.
- Called from the Approve action **after** US-12 has assigned an ID, via
  the background queue from US-11.
- Publishes `POST {PrnPern:BaseUrl}/accreditations` with
  `{ accreditationId, organisationId, material, tonnageBand, startDate, year }`.
- Auth via shared-secret HMAC (mirror the inbound auth pattern in
  `Auth/CognitoClientIdAuthenticationHandler.cs`).
- Failures retried 3× with exponential backoff via Polly. Terminal
  failure writes audit entry `prn-pern-publish-failed`; an admin
  endpoint `POST /work-items/{id}/republish-prn-pern` retriggers.
- Successful publish writes audit entry `prn-pern-published` with
  `{ providerResponseId }`.
- `NoOpPrnPernPublisher` is used when `PrnPern:BaseUrl` is missing
  (logs only) so local dev still works.

**Implementation notes**
- Place under `Notifications/PrnPern/` (or its own folder).
- Use `IHttpClientFactory` named client `prn-pern`.

**Out of scope**
- Two-way sync (PRN service notifying us back).

---

### US-14 — Publish to public register

*As a* member of the public
*I want* approved accreditations to appear on the public register
*so that* I can verify accredited operators.

**Context**
Public register is a separate downstream system. Same shape as US-13.

**Acceptance criteria**
- `IPublicRegisterPublisher` with `PublishAsync(WorkItem item)` called
  after PRN/PERN publish (US-13) succeeds (chained on the background
  queue).
- Sends `{ accreditationId, organisationName, material, status: "Active", startDate }`.
- Same retry + audit entry pattern as US-13
  (`public-register-publish-failed` / `public-register-published`).
- `NoOpPublicRegisterPublisher` when `PublicRegister:BaseUrl` is
  missing.

**Implementation notes**
- Same `IHttpClientFactory` pattern; named client `public-register`.

---

### US-15 — Archive approved cases

*As a* regulator
*I want* approved cases archived
*so that* the active worklist stays focused on in-flight work.

**Context**
BPMN final happy-path step: "Archive". Approved is the only archive
trigger in the demo (rejected/withdrawn are deferred).

**Acceptance criteria**
- Worklist hides items in the `approved` state by default; checkbox
  "Show archived" reveals them.
- `GET /work-items?includeArchived=true` honours the flag (default
  false).
- Items in `approved` state are read-only on the FE (no actions
  exposed).
- Background job (runs nightly) sets `payload.ArchivedAt = utcNow` on
  any item that has been in the `approved` state for >7 days; UI shows
  the archived date.

**Implementation notes**
- "Archived" is a presentation concept layered over state — don't add
  a new state.

---

## Operator

### US-16 — Operator views decision letter

*As an* operator
*I want* to see and download my decision letter once a case is approved
*so that* I have proof of accreditation.

**Context**
BPMN operator-lane end: "Receive determination outcome email → View
decision letter → Download if required". The email comes from US-02
(`Decision` template); this story covers the operator FE pages.

**Acceptance criteria**
- The operator FE work-item view (operator-side equivalent of the Mgmt
  FE work-item page) shows a "Decision" GOV.UK panel once the work
  item is in the `approved` state, including:
  - Outcome ("Approved")
  - Accreditation ID
  - Accreditation start date and year
  - Decision summary text (from US-11) if present
  - Date of decision
- A "Download decision letter (PDF)" GOV.UK button calls a new operator
  BE endpoint
  `GET /accreditation-application/{id}/decision-letter.pdf` that
  generates the PDF on the fly from a server-side template (e.g.
  `QuestPDF` NuGet) and streams it back with
  `Content-Disposition: attachment`.
- Endpoint is gated to the application's owning organisation
  (existing operator BE auth).
- The link in the `Decision` Notify email (US-02) deep-links to this
  page.
- Unit/integration tests cover: panel visibility (only after approval),
  PDF endpoint returns 200 + correct content-type, 403 for a different
  organisation.

**Implementation notes**
- Operator FE work-item view lives under
  `lib/epr-register-enrol-frontend/src/server/worklist-items/` (or
  similar — see operator FE survey).
- PDF template lives in the operator BE under
  `AccreditationApplication/Pdf/`.
- For the demo, the PDF can be a basic single-page layout — branding
  polish is a follow-up.

**Out of scope**
- Email of the PDF as an attachment (Notify supports it but adds
  complexity).
- Bulk download.

---

## Notes on what was cut

The following are intentionally **not** included in this happy-path
slice and remain on the roadmap for a later iteration:

- Payment reconciliation guard with role-based override
- Risk review and auto-flagging on intake (BPMN "Risk review/assign
  risk")
- Richer duly-making payload (org / app type / materials / fees blocks
  beyond the minimum used in US-05)
- Operator-side duly-making validations (the duly-making checklist is
  a single acknowledged checkbox in US-06)
- Group/batch by organisation on the worklist
- Bulk assign / team-leader assignment workflow (US-09 covers individual
  self/colleague assign only)
- Split / group by material (one work item per application for the
  demo)
- Negative duly-making outcome
- Reject and Withdraw determinations (and their reason capture)
- Query loop: raise query, lock down section, free-text email body,
  receive response, close query, pause/resume SLA
- Notes pagination (last 5 + paged) — un-paginated for the demo
- Audit log pagination & filtering — un-paginated for the demo
- Appeals
- Cancellation
- Refund processing
- High-level reporting dashboard
- Worklist search & advanced filter (only nation-filter from US-03 is
  in for the demo)
