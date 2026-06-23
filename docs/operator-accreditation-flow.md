# Operator Accreditation Flow

End-to-end data flow from the operator frontend through the backend, ReEx API, and ManagementBe case management system.

---

## 1. Seed — Application Creation

The operator lands at `/operator-accreditation/{orgId}/{registrationId}/{materialType}/{year}`. The frontend calls the backend seed endpoint.

```
POST /api/v1/accreditation-applications/{orgId}/{registrationId}/{materialType}/seed
Body: { "year": 2027 }
```

The backend `Seed` method:

1. Calls **ReEx API** via `IReExApiAdapter.GetAccreditationAsync(orgId, materialType, year - 1)` to fetch prior-year accreditation data (PRN tonnage bands, authorisers, business plan percentages)
2. Resolves org context from `IOrganisationPersistence` (company name, site address, registration reference, exporter flag)
3. Creates an `AccreditationApplicationModel` with status `Saved`, pre-populated from prior-year data but all sections marked `NotStarted`
4. Returns the new application (with its MongoDB `_id` as the `applicationId`)

**Key files:**

- Frontend entry: `epr-register-enrol-frontend/src/server/operator-accreditation/controller.js`
- Backend endpoint: `EprRegisterEnrolBackend/AccreditationApplication/Endpoints/AccreditationApplicationEndpoints.cs` — `Seed` method
- ReEx adapter: `EprRegisterEnrolBackend/AccreditationApplication/Adapters/IReExApiAdapter.cs`

---

## 2. Section Completion — Building the Application

The operator works through a task list at `/accreditation/task-list/{appId}`. Sections unlock sequentially.

| Section | Backend endpoint | Completion rule |
|---|---|---|
| PRNs / Tonnage | `PATCH .../tonnage` | PlannedTonnageBand + Authorisers set |
| Business Plan | `PATCH .../business-plan` | All 6 percentages set, sum = 100% |
| Sampling Plan | `POST .../files` (via CDP upload) | At least 1 file with `scanStatus: Clean` |
| Overseas Sites (exporter only) | `PATCH .../overseas-sites` | At least 1 site selected |
| BES Evidence (exporter only) | `POST .../bes-evidence/files` | Evidence uploaded for all sites |

Each edit transitions the application from `Saved` to `Started`. Section statuses (`NotStarted` / `InProgress` / `Completed`) are computed server-side by `SectionStatusService`. The submit button only appears when all required sections show `Completed`.

**Key files:**

- Frontend task list: `epr-register-enrol-frontend/src/server/accreditation/task-list/controller.js`
- Backend section endpoints: `AccreditationApplicationEndpoints.cs` — `PatchTonnage`, `PatchBusinessPlan`, `PatchSamplingPlan`
- Status computation: `EprRegisterEnrolBackend/AccreditationApplication/Services/SectionStatusService.cs`

---

## 3. Declaration and Submit — Sending to Backend

The operator fills in the declaration form (name, job title, email) and submits.

```
POST /api/v1/accreditation-applications/{orgId}/{appId}/submit
Body: { "fullName": "Jane Smith", "jobTitle": "Operations Manager", "email": "jane@example.com" }
```

The backend `Submit` method:

1. Validates the request (FullName and JobTitle required)
2. Checks application is in `Started` status (not already `Sent`)
3. Verifies all sections are `Completed`
4. Sets status to `Sent`, captures `SubmittedBy` and `DateSent`
5. Calls `ICaseWorkingApiAdapter.SubmitApplicationAsync(application)` **before persisting** — if the adapter fails, the DB stays unchanged and the caller can safely retry
6. Stores the `applicationReference` returned by ManagementBe
7. Persists and returns `{ "accreditationReference": "RA-123456789" }`

**Key files:**

- Frontend declaration: `epr-register-enrol-frontend/src/server/accreditation/submit-declaration/controller.js`
- Frontend API service: `epr-register-enrol-frontend/src/server/common/helpers/accreditationApiService.js` — `submitApplication`
- Backend endpoint: `AccreditationApplicationEndpoints.cs` — `Submit` method

---

## 4. Backend to ManagementBe — Work Item Creation

The `HttpCaseWorkingApiAdapter` maps the application model and POSTs to ManagementBe.

```
POST http://case-management-backend:8085/work-items

Headers:
  x-cdp-cognito-client-id: epr-register-enrol-backend
  x-cdp-auth-signature: <HMAC-SHA256 base64>    (when SharedSecret configured)
  x-cdp-auth-timestamp: <ISO-8601 UTC>
  x-cdp-auth-nonce: <base64 random 16 bytes>

Body:
{
  "typeId": "re-accreditation",
  "source": "operator-fe",
  "payload": {
    "organisationName": "Acme Recycling Ltd",
    "registrationNumber": "EPR-100023",
    "materialsHandled": ["plastic"],
    "previousAccreditationYear": 2026,
    "complianceIssuesReported": 0,
    "operatorEmail": "jane@example.com",
    "siteAddressPostcode": "SW1A 1AA"
  }
}
```

### Payload mapping

| ManagementBe field | Source |
|---|---|
| `organisationName` | `application.OrganisationName` |
| `registrationNumber` | `application.RegistrationReference` |
| `materialsHandled` | `[application.MaterialType]` (lowercase) |
| `previousAccreditationYear` | `application.Year - 1` |
| `complianceIssuesReported` | `0` (not tracked in citizen app) |
| `operatorEmail` | `application.SubmittedBy.Email` |
| `siteAddressPostcode` | Last segment of `application.SiteAddress` (comma-delimited) |

### Authentication

HMAC-SHA256 signing using the v2 canonical payload, matching ManagementBe's `CognitoClientIdAuthenticationHandler`:

```
canonical = "v2\n{clientId}\n{userId}\n{userName}\n{userRoles}\n{timestamp}\n{nonce}"
signature = Base64(HMAC-SHA256(sharedSecret, canonical))
```

In development without `AUTH_SHARED_SECRET`, ManagementBe falls back to header-trust mode (only `x-cdp-cognito-client-id` required).

**Key files:**

- Adapter: `EprRegisterEnrolBackend/AccreditationApplication/Adapters/HttpCaseWorkingApiAdapter.cs`
- Config: `EprRegisterEnrolBackend/AccreditationApplication/Adapters/CaseWorkingApiConfig.cs`
- ManagementBe auth handler: `EprRegisterEnrolManagementBe/Auth/CognitoClientIdAuthenticationHandler.cs`

---

## 5. ManagementBe Processing — Work Item and Hooks

ManagementBe's `WorkItemService.SubmitAsync()` processes the incoming request:

1. **Generates `applicationReference`** server-side (`RA-XXXXXXXXX`, 9 cryptographic random digits, unique-indexed with collision retry)
2. Snapshots the current `ReAccreditationType` template alongside the work item
3. Creates the work item in state `"submitted"` with a birth audit entry (`"work-item-submitted"`)
4. Persists work item and audit entry in a single atomic write

### Post-submission hooks

After persistence, two hooks fire:

**ReAccreditationNationRoutingHook:**
- Extracts postcode from `payload.siteAddressPostcode`
- Resolves nation (England, Scotland, Wales, Northern Ireland) via `INationResolver`
- Stamps `payload.nation` on the work item
- Appends audit entry: `"routed-to-nation"`

**ReAccreditationNotificationHook:**
- Sends a GOV.UK Notify "Submission Confirmation" email to the operator email
- Personalisation includes organisation name, registration number, reference
- Appends audit entry: `"notification-sent"` or `"notification-failed"` (never re-throws on failure)

### Response

ManagementBe returns `201 Created` with the full work item, including `payload.applicationReference`. The backend adapter extracts this and passes it back through the chain.

**Key files:**

- Work item creation: `EprRegisterEnrolManagementBe/WorkItems/Core/WorkItemEndpoints.cs` — `Submit` method
- Work item engine: `EprRegisterEnrolManagementBe/WorkItems/Core/WorkItemService.cs` — `SubmitAsync`
- Reference generation: `EprRegisterEnrolManagementBe/WorkItems/Core/ApplicationReferenceGenerator.cs`
- Nation routing: `EprRegisterEnrolManagementBe/WorkItems/ReAccreditation/ReAccreditationNationRoutingHook.cs`
- Notifications: `EprRegisterEnrolManagementBe/WorkItems/ReAccreditation/ReAccreditationNotificationHook.cs`

---

## 6. Confirmation — Reference Displayed

The frontend receives `{ accreditationReference: "RA-123456789" }`, stores it in session, clears declaration data, and redirects to `/accreditation/submit-confirmation/{appId}`.

The confirmation page displays the reference number, material type, and links to payment details and return home.

**Key files:**

- Confirmation controller: `epr-register-enrol-frontend/src/server/accreditation/submit-confirmation/controller.js`

---

## 7. Regulator Case Management — State Machine

The work item progresses through the ManagementBe state machine via the case management frontend.

### States

```
submitted ──(duly-make)──> duly-made ──(payment-received)──> assessment-in-progress
    │                                                              │
    │                                                    (submit-for-decision)
    │                                                              │
    │                                                              v
    │                                                      awaiting-decision
    │                                                         │         │
    │                                                    (approve)  (reject)
    │                                                         │         │
    │                                                         v         v
    │                                                      approved  rejected
    │
    └──────────────(withdraw from any non-terminal state)──> withdrawn
```

### Tasks per state

| State | Tasks |
|---|---|
| `submitted` | Verify organisation details, Confirm application completeness |
| `duly-made` | Confirm registration fee paid |
| `assessment-in-progress` | Review compliance history, Assess technical capacity, Assess financial capacity |
| `awaiting-decision` | Record decision rationale |

### Key transitions

| Action | From | To | Notes |
|---|---|---|---|
| `duly-make` | submitted | duly-made | All submitted tasks must be complete |
| `payment-received` | duly-made | assessment-in-progress | Starts SLA clock, sends notification, unassigns |
| `sla-extend` | assessment-in-progress | assessment-in-progress | Self-loop for extending the SLA |
| `submit-for-decision` | assessment-in-progress | awaiting-decision | All assessment tasks must be complete |
| `approve` | awaiting-decision | approved | Requires `reaccreditation-decision-maker` role |
| `reject` | awaiting-decision | rejected | Requires `reaccreditation-decision-maker` role |
| `withdraw` | any non-terminal | withdrawn | Available at any point before a final decision |

**Key files:**

- State machine definition: `EprRegisterEnrolManagementBe/WorkItems/ReAccreditation/ReAccreditationType.cs`
- Payment service: `EprRegisterEnrolManagementBe/WorkItems/ReAccreditation/ReAccreditationPaymentService.cs`
- Approval service: `EprRegisterEnrolManagementBe/WorkItems/ReAccreditation/ReAccreditationApprovalService.cs`

---

## 8. Approval — Writing Back to ReEx

When a decision-maker approves in ManagementBe, the backend's `Approve` endpoint is called.

The backend:

1. Validates the application is in `Sent` status
2. Builds an `ApprovedAccreditationDto` containing the application reference, PRNs, and business plan
3. Calls `IReExApiAdapter.WriteApprovedAccreditationAsync(approvedDto)` to write the approved accreditation data back to ReEx
4. Sets `ApplicationStatus` to `Approved` and persists

ReEx receives the full accreditation data (application ID, organisation, material type, year, PRNs, business plan) so it can record the approved status in its system.

**Key files:**

- Backend approve endpoint: `AccreditationApplicationEndpoints.cs` — `Approve` method
- ReEx write adapter: `EprRegisterEnrolBackend/AccreditationApplication/Adapters/IReExApiAdapter.cs` — `WriteApprovedAccreditationAsync`

---

## Visual Summary

```
Operator FE                    Backend                        ReEx              ManagementBe
    │                            │                             │                     │
    │──POST /seed───────────────>│──GetAccreditation(year-1)──>│                     │
    │                            │<──prior year Prns/BPlan─────│                     │
    │<──application (Saved)──────│                             │                     │
    │                            │                             │                     │
    │  (operator edits sections) │                             │                     │
    │──PATCH /tonnage───────────>│                             │                     │
    │──PATCH /business-plan─────>│                             │                     │
    │──POST /files (sampling)───>│                             │                     │
    │                            │                             │                     │
    │──POST /submit─────────────>│                             │                     │
    │                            │──POST /work-items──────────────────────────────────>│
    │                            │                             │  generate RA-ref     │
    │                            │                             │  NationRoutingHook   │
    │                            │                             │  NotificationHook    │
    │                            │<──{ applicationReference }──────────────────────────│
    │<──{ accreditationRef }─────│                             │                     │
    │                            │                             │                     │
    │  Confirmation page         │                             │                     │
    │  (shows RA-XXXXXXXXX)      │                             │                     │
    │                            │                             │                     │
    │                     ... regulator works the case in ManagementBe ...            │
    │                            │                             │                     │
    │                            │<──approve────────────────────────────────────────────│
    │                            │──WriteApprovedAccreditation─>│                     │
    │                            │  status = Approved          │                     │
```
