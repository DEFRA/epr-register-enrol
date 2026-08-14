# Operator Journey: Microservices and Integration

This document describes the full request flow for an operator going through the accreditation application process, covering both development (local) and non-development (deployed) environments.

> This document covers the operator-facing upload side only. For how those files become downloadable from case management, and for the local/CI test infrastructure that makes real uploads work end-to-end, see [`file-download-workflow.md`](./file-download-workflow.md).

---

## Architecture Overview

```
Operator Browser
      │
      ▼
┌──────────────────────────────┐
│ epr-register-enrol-frontend  │  Node.js / Hapi + Nunjucks
│ localhost:3000 (dev)         │
└──────────────┬───────────────┘
               │ HTTP (REST)
               ▼
┌──────────────────────────────────────────────────────┐
│ epr-register-enrol-backend                           │  .NET 10 ASP.NET  
  Core Minimal APIs
│ localhost:5000 (dev)                                 │
└──┬────────────┬─────────────┬─────────────┬──────────┘
   │            │             │             │
   ▼            ▼             ▼             ▼◄────────────┐
MongoDB      ReEx API    CDP Uploader   ManagementBe (CM) │
                            (+ S3)          │  push status/query
                                             └──────────────┘
```

> RA-368/RA-311: ManagementBe pushes work-item state changes and queries back to the backend
> (`case-management/{workItemId}/status`, `case-management/{workItemId}/query`), HMAC-signed
> and authenticated the same way — see [Integration: Case Management](#integration-case-management-managementbe)
> below. This is not shown as a separate box above because it's the same ManagementBe service,
> just calling back in.

**External integration summary:**

| Integration | Direction | When | Adapter / client |
|-------------|-----------|------|-----------------|
| MongoDB | Backend ↔ MongoDB | Every request — read/write application state | `IAccreditationApplicationPersistence` |
| ReEx API | Backend → ReEx | Seed (Step 2), overseas sites (Step 5) | `IReExClient` via `IReExApiAdapter` |
| CDP Uploader | Backend → CDP, CDP → Backend (webhook) | File upload initiation and scan callback (Steps 4, 6) | `ICdpUploaderService` |
| S3 | Backend → S3 | Pre-signed download URL generation | `IS3Service` |
| ManagementBe | Backend → ManagementBe | Submit (Step 7), withdraw (Step 10) | `ICaseWorkingApiAdapter` |
| ManagementBe | ManagementBe → Backend (push) | Any CM work-item status change (RA-368) or query raised (RA-311) | `CaseManagementAuthenticationHandler` (inbound HMAC auth) |

---

## Environment Summary

| Component | Development | Non-Development |
|-----------|------------|-----------------|
| Frontend → Backend URL | `http://localhost:5000` | Set via env var |
| Frontend API client | Stub (in-memory mock) | Real HTTP (`fetch`) |
| ReEx adapter | `StubReExApiAdapter` | `HttpReExApiAdapter` |
| ReEx auth | N/A | HTTP Basic Auth via `REEX_API_BASIC_AUTH_*` env vars |
| MongoDB | `mongodb://127.0.0.1:27017` | Remote Atlas (AWS IAM auth) |
| Organisation data | `FakeOrganisationPersistence` fallback | `OrganisationPersistence` (MongoDB) |
| CDP Uploader | `http://localhost:7337` | `CdpUploader__Url` env var |
| S3 | LocalStack `http://localhost:4566` | AWS S3 (`S3__Endpoint` env var) |
| Case Working adapter | `HttpCaseWorkingApiAdapter` → `localhost:8085` | `HttpCaseWorkingApiAdapter` → configured URL |
| Case Working stub | `UseStub=false` in dev appsettings | Must set `CaseWorking__UseStub=false` at deploy |

---

## Configuration Reference

### Frontend (`src/config/config.js`)

| Key | Default | Purpose |
|-----|---------|---------|
| `api.baseUrl` | `http://localhost:5000` | Backend base URL |
| `api.timeout` | `5000` | HTTP timeout (ms) |
| `api.stubEnabled` | `true` | `true` → in-memory stub; `false` → real HTTP |
| `auth.stubEnabled` | `true` | `true` → skip OAuth for local testing |

### Backend (`appsettings.json` / env vars)

| Key | Default | Non-dev supply |
|-----|---------|----------------|
| `ReExApi.BaseUrl` | `""` | `ReExApi__BaseUrl` env var |
| `REEX_API_BASIC_AUTH_USERNAME` | — | Flat env var (CDP secret) |
| `REEX_API_BASIC_AUTH_PASSWORD` | — | Flat env var (CDP secret) |
| `Mongo.DatabaseUri` | (set by deployment) | Injected by platform |
| `Mongo.DatabaseName` | `epr-register-enrol-backend` | — |
| `App.BaseUrl` | `http://localhost:5000` | Used to build CDP callback URL: `{App.BaseUrl}/api/v1/file-uploads/upload-completed` |
| `CdpUploader.Url` | `http://localhost:7337` | `CdpUploader__Url` env var |
| `CdpUploader.SamplingPlanBucket` | `epr-register-enrol-sampling-plans` | S3 bucket for sampling plan files |
| `CdpUploader.BesEvidenceBucket` | `epr-register-enrol-bes-evidence` | S3 bucket for BES evidence files |
| `CdpUploader.GenericFilesBucket` | `epr-register-enrol-file-uploads` | S3 bucket for generic uploads |
| `S3.Endpoint` | `http://localhost:4566` (LocalStack) | `S3__Endpoint` env var |
| `S3.Region` | `eu-west-2` | — |
| `S3.PresignedUrlExpirySeconds` | `300` | Pre-signed URL TTL |
| `CaseWorking.Url` | `http://localhost:8085` | `CaseWorking__Url` env var |
| `CaseWorking.UseStub` | `true` | `CaseWorking__UseStub=false` |
| `CaseWorking.CognitoClientId` | `epr-register-enrol-backend` | — |
| `CaseWorking.SharedSecret` | `null` | Set to enable HMAC auth headers. Sourced from the flat `CASE_MANAGEMENT_API_SHARED_SECRET` env var (CDP secrets convention), not `CaseWorking__SharedSecret` — RA-345. |
| `CaseManagementAuth.ExpectedCognitoClientId` | `epr-register-enrol-management-be` | — |
| `CaseManagementAuth.SharedSecret` | `null` | Verifies inbound HMAC on CM's push endpoints (RA-368 §5). Sourced from the flat `AUTH_SHARED_SECRET__MANAGEMENT_BE` env var, looked up via its config-key colon form `AUTH_SHARED_SECRET:MANAGEMENT_BE` — not a nested `CaseManagementAuth__*` key. Must match CM's own outbound secret, sourced there from the flat `OPERATOR_BACKEND_SHARED_SECRET` env var. |

> **ReEx URL in development:** `ReExApi.BaseUrl` is blank in all committed configs. This is safe because the DI environment branch registers `StubReExApiAdapter`, which never calls `IReExClient`. The URL must be injected at deployment via `ReExApi__BaseUrl`.

---

## Backend DI Wiring

Two independent switches control adapter selection:

### ReEx — environment-driven (`IsDevelopment()`)

```csharp
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddSingleton<IReExApiAdapter, StubReExApiAdapter>();
    builder.Services.AddSingleton<IOrganisationPersistence, FallbackOrganisationPersistence>();
    // also registers FakeOrganisationPersistence, StubApplicationPersistence, DevScanAutoCompleteService
}
else
{
    builder.Services.AddSingleton<IReExApiAdapter, HttpReExApiAdapter>();
    builder.Services.AddSingleton<IOrganisationPersistence, OrganisationPersistence>();
}
```

`IReExClient` (`ReExClient`) is **always** registered via `AddReExClients()` regardless of environment.

### Case Working — config-driven (`CaseWorking.UseStub`)

```csharp
if (caseWorkingConfig.UseStub)
    builder.Services.AddSingleton<ICaseWorkingApiAdapter, StubCaseWorkingApiAdapter>();
else
    builder.Services.AddSingleton<ICaseWorkingApiAdapter, HttpCaseWorkingApiAdapter>();
```

`UseStub` defaults to `true` in the config class. It is set to `false` in `appsettings.Development.json` (pointing at `localhost:8085`) and must also be set to `false` in every deployed environment via `CaseWorking__UseStub=false`.

---

## Integration: ReEx API

### Endpoints called

| Method | ReEx endpoint | Step |
|--------|--------------|------|
| GET | `v1/organisations/{organisationId}` | Step 2 — seed application from prior-year data |
| GET | `v1/organisations/{orgId}/registrations/{regId}/accreditations/{accId}/overseas-sites` | Step 5 — fetch overseas sites (exporters only) |

There is no longer a write-back call from this service — `IReExApiAdapter` no longer declares
a "write approved accreditation" method. Any ReEx write-back on approval now happens from
ManagementBe's own `ReAccreditationApprovalService` (accreditation id issuance + a queued
"publishing" job), not from `epr-register-enrol-backend`.

Authentication: HTTP Basic Auth injected transparently by `BasicAuthHandler` using `REEX_API_BASIC_AUTH_USERNAME` / `REEX_API_BASIC_AUTH_PASSWORD` env vars.

All calls return `ReExResult<T>`. On failure, `Error.Kind` is one of: `AuthError`, `NotFound`, `ClientError`, `ServerError`, `Timeout`, `TransportError`, `DeserializationError`.

---

## Integration: CDP Uploader & S3

The file upload flow involves three parties — **browser**, **backend**, and **CDP Uploader** — across five distinct steps:

```
Browser                    Backend                     CDP Uploader / S3
   │                          │                               │
   │  POST …/files/initiate   │                               │
   │─────────────────────────▶│                               │
   │                          │  POST {CdpUploader.Url}/initiate
   │                          │──────────────────────────────▶│
   │                          │  ← { uploadId, uploadUrl,     │
   │                          │      statusUrl }              │
   │                          │  (rewrites internal hostnames)│
   │ ← { fileUploadId,        │                               │
   │     uploadUrl, statusUrl}│                               │
   │                          │                               │
   │  PUT {uploadUrl} + file  │                               │
   │─────────────────────────────────────────────────────────▶│
   │                          │                               │ (virus scan)
   │                          │  POST /api/v1/file-uploads/   │
   │                          │       upload-completed        │
   │                          │◀──────────────────────────────│
   │                          │  (CdpCallbackPayload with     │
   │                          │   fileStatus: complete/reject)│
   │                          │  PendingUploadService.Complete│
   │                          │                               │
   │  GET …/{fileUploadId}/status                             │
   │─────────────────────────▶│                               │
   │ ← { uploadStatus: "ready"│                               │
   │     processingStatus:    │                               │
   │     "validated"/"rejected"}                              │
```

**Key points:**
- `statusUrl` returned to the browser points to the **backend's own** `GET /api/v1/file-uploads/{fileUploadId}/status` — not CDP directly
- The backend tracks upload state in `PendingUploadService` (in-memory `ConcurrentDictionary`)
- CDP Uploader rewrites are needed because CDP may return internal Docker hostnames that browsers cannot reach; `CdpUploaderService.RewriteHost()` replaces the host/port with `CdpUploader.Url`
- Files land in S3 (bucket configured per file type — see config table above)
- In **development**, `DevScanAutoCompleteService` (hosted service) polls CDP's real status endpoint (`GetStatusAsync`, via a plain unnamed `HttpClient` — the named `"DefaultClient"` has header-propagation middleware that requires an active HTTP request context and breaks when called from a background service) and calls `PendingUploadService.Complete()` directly in-process once CDP reports `ready`, building the real `s3Key`/`s3Bucket` from the pending upload's tracked `s3Path`/`s3Bucket`/CDP upload id — it does not fabricate file data

### S3 pre-signed download

For generic file downloads, the backend generates a short-lived pre-signed URL:

```
GET /api/v1/file-uploads/{fileUploadId}/download
  └─→ Looks up file record in MongoDB
  └─→ Checks ScanStatus == Clean
  └─→ IS3Service.GeneratePresignedDownloadUrlAsync(bucket, s3Key, filename)
  └─→ Returns { presignedUrl }  (expires after S3.PresignedUrlExpirySeconds)
```

---

## Integration: Case Management (ManagementBe)

This is a **two-way** integration (RA-368/RA-311). Regulator decisions (approve/reject) are
no longer made in this service at all — that moved to ManagementBe's own caseworker UI. The
backend's role is: submit the application, hand off, then receive and project whatever
ManagementBe reports back.

### Outbound — backend calls ManagementBe

| Method | Endpoint | Step | Notes |
|--------|----------|------|-------|
| POST | `{CaseWorking.Url}/work-items` | Submit (Step 7) | Creates the CM work item |
| POST | `{CaseWorking.Url}/work-items/re-accreditation/{workItemId}/resume-from-query` | Resubmit after query (Step 8) | Tells CM the operator has responded; only sent when a `CaseManagementWorkItemId` exists |
| POST | `{CaseWorking.Url}/work-items/re-accreditation/{workItemId}/withdraw` | Withdraw (Step 10) | Tells CM the operator withdrew; only sent when the application already has a `CaseManagementWorkItemId` |
| POST | `{CaseWorking.Url}/work-items/re-accreditation/{workItemId}/site-added` | Overseas site added/interim site added (Step 5/6) | Fire-and-forget notification (RA-297) so CM can track new vs. carried-over sites; silently skipped if there's no `CaseManagementWorkItemId` yet |

### Inbound — ManagementBe calls the backend

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/accreditation-applications/case-management/{workItemId}/status` | Any CM work-item state change (RA-368) — see [Step 9](#step-9--case-management-pushes-a-status-change) |
| POST | `/api/v1/accreditation-applications/case-management/{workItemId}/query` | CM raises a query (RA-311) — see [Step 8](#step-8--case-management-raises-a-query) |

Both are authenticated via `CaseManagementAuthenticationHandler` (HMAC, mirroring the outbound
scheme below) and are the *only* way ManagementBe's decisions reach this service — there is no
polling and no shared database.

### Application reference

Generated locally **before** the submit HTTP call:

```csharp
var applicationReference = $"RA-{RandomNumberGenerator.GetInt32(1_000_000_000):D9}";
```

Stored in MongoDB and returned to the frontend. ManagementBe's `workItemId` (GUID) is **stored**
as `CaseManagementWorkItemId` — it is the correlation key every inbound push above is looked up
by, not just logged.

### Request body

```json
{
  "typeId": "re-accreditation",
  "source": "operator-fe",
  "applicationReference": "RA-042891736",
  "payload": {
    "organisationName": "...",
    "registrationNumber": "...",
    "material": "plastic",
    "accreditationYear": 2025,
    "previousAccreditationYear": 2024,
    "siteAddress": "...",
    "siteAddressPostcode": "SW1A 2AA",
    "operatorApplicationId": "...",
    "operatorEmail": "...",
    "submittedBy": { "fullName": "...", "jobTitle": "...", "email": "..." },
    "prns": { "plannedTonnageBand": "UpTo500", "authorisers": [...] },
    "businessPlan": { "newInfrastructurePercent": 10, ... },
    "samplingPlan": { "files": [{ "filename": "...", "uploadedAt": "...", "scanStatus": "Clean", "s3Key": "...", "s3Bucket": "..." }] },
    "overseasSites": {
      "sites": [{
        "siteId": 1, "siteName": "...", "siteAddress": "...", "country": "...",
        "besEvidence": { "files": [{ "filename": "...", "s3Key": "...", "s3Bucket": "..." }] }
      }]
    }
  }
}
```

`s3Key`/`s3Bucket` per file are what let case management locate and serve the file for download — see [`file-download-workflow.md`](./file-download-workflow.md). They're sourced from the real CDP status/callback response, not generated locally.

### Authentication headers (outbound: submit, withdraw)

| Header | Value | Condition |
|--------|-------|-----------|
| `x-cdp-cognito-client-id` | `CaseWorking.CognitoClientId` | Always |
| `x-cdp-user-id` | Submitter email (fallback: `organisationId`) | If present |
| `x-cdp-user-name` | Submitter full name | If present |
| `x-cdp-auth-signature` | HMAC-SHA256 of canonical payload | Only if `SharedSecret` set |
| `x-cdp-auth-timestamp` | `yyyy-MM-ddTHH:mm:ssZ` | Only if `SharedSecret` set |
| `x-cdp-auth-nonce` | 16 random bytes, base64 | Only if `SharedSecret` set |

`CaseWorking.SharedSecret` (this service's own outbound secret, unaffected
by the change below other than its env var name — see above) must match
`AUTH_SHARED_SECRET__BACKEND` on ManagementBe specifically — ManagementBe
verifies each caller against its own per-caller secret rather than one
value shared with `management-fe` (RA-345; see
`epr-register-enrol-management-be`'s
`docs/adr/0006-per-caller-client-secrets.md`).

HMAC canonical payload (v3 — must stay in sync with ManagementBe):
```
v3\n{clientId}\n{userId}\n{userName}\n{timestamp}\n{nonce}
```

### Inbound push payloads (CM → backend)

`POST case-management/{workItemId}/status` — `StatusChangedFromCaseManagementRequest`:

```json
{
  "toStateId": "duly-made",
  "toStateDisplayName": "Duly made",
  "actionId": "duly-made",
  "actionDisplayName": "Duly made",
  "occurredAt": "2026-05-20T10:00:00Z"
}
```

`toStateId` is projected onto `ApplicationStatus` via a fixed CM-state-id → `ApplicationStatus`
mapping (`submitted`, `duly-made`, `updated`, `approved`, `rejected` map directly today; other
CM states are a deliberate no-op — they only advance the `occurredAt` ordering watermark). A
push is applied only if `occurredAt` is strictly after the application's own
`CaseManagementStatusUpdatedAt`, so a delayed/duplicate retry can never regress the status.

`POST case-management/{workItemId}/query` — `QueryFromCaseManagementRequest`:

```json
{ "queryNote": "Please clarify the tonnage band", "sectionKeys": ["prns", "businessPlan"] }
```

Marks the named sections `Queried`, sets `ApplicationStatus = Queried`, and stores the note —
see [Step 8](#step-8--case-management-raises-a-query).

Authenticated the same way as the outbound calls above, verified against
`CaseManagementAuth` (see Configuration Reference) instead of `CaseWorking`.

---

## Backend API Endpoints

### Accreditation Applications — `/api/v1/accreditation-applications`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/{orgId}/{regId}/{materialType}/seed` | Create application from ReEx prior-year data |
| GET | `/{orgId}` | List all applications for an organisation, newest first |
| GET | `/{orgId}/{appId}` | Fetch a single application |
| PATCH | `/{orgId}/{appId}/prns` | Update PRN issuance section; sets status → `Started` |
| PATCH | `/{orgId}/{appId}/tonnage` | Update tonnage band |
| PATCH | `/{orgId}/{appId}/business-plan` | Update business plan allocations |
| PATCH | `/{orgId}/{appId}/sampling-plan` | Update sampling plan section |
| PATCH | `/{orgId}/{appId}/overseas-sites` | Update overseas sites (exporters only) |
| POST | `/{orgId}/{appId}/overseas-sites` | Add an overseas site (exporters only) |
| POST | `/{orgId}/{appId}/overseas-sites/{siteId}/promote` | Promote a site (RA-297) |
| POST | `/{orgId}/{appId}/overseas-sites/{siteId}/revert` | Revert a promoted site |
| POST | `/{orgId}/{appId}/overseas-sites/{siteId}/interim-site` | Add a 1:1 interim site (RA-294) |
| POST | `/{orgId}/{appId}/overseas-sites/{siteId}/bes-evidence/files` | Add BES evidence file for a site |
| PATCH | `/{orgId}/{appId}/overseas-sites/{siteId}/bes-evidence` | Update BES evidence for a site |
| DELETE | `/{orgId}/{appId}/overseas-sites/{siteId}/bes-evidence/files/{fileId}` | Remove a BES evidence file |
| PATCH | `/{orgId}/{appId}/bes-evidence` | Update BES evidence section status |
| POST | `/{orgId}/{appId}/files/initiate` | Initiate CDP file upload for a sampling plan file |
| POST | `/{orgId}/{appId}/files/bes-evidence/initiate` | Initiate CDP file upload for a BES evidence file |
| POST | `/{orgId}/{appId}/files` | Register a scanned file on the application |
| DELETE | `/{orgId}/{appId}/files/{fileId}` | Remove a file |
| GET | `/{orgId}/{appId}/files/{fileUploadId}/status` | Poll a sampling-plan/BES-evidence file's scan status |
| POST | `/{orgId}/{appId}/submit` | Submit to ManagementBe; sets status → `Submitted` |
| POST | `/{orgId}/{appId}/resubmit` | Resubmit after a query response; sets status → `Updated` (Step 8) |
| POST | `/{orgId}/{appId}/withdraw` | Operator withdraws; sets status → `Withdrawn`; notifies ManagementBe (Step 10) |
| POST | `case-management/{workItemId}/status` | **Inbound**, CM-authenticated — CM pushes a work-item status change (Step 9) |
| POST | `case-management/{workItemId}/query` | **Inbound**, CM-authenticated — CM raises a query (Step 8) |

Regulator decision-making (approve/reject) is **not** an OJ backend endpoint — those actions
happen entirely in ManagementBe's own caseworker UI and reach this service only via the
`case-management/{workItemId}/status` push above. See
[Integration: Case Management](#integration-case-management-managementbe).

### File Uploads — `/api/v1/file-uploads`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/initiate` | Initiate generic CDP file upload; returns `fileUploadId`, `uploadUrl`, `statusUrl` |
| POST | `/upload-completed` | **CDP webhook callback** — receives scan result; updates `PendingUploadService` |
| GET | `/{fileUploadId}/status` | Poll upload/scan status (`uploadStatus: pending\|ready`, `processingStatus: preprocessing\|validated\|rejected`) |
| GET | `/{fileUploadId}/download` | Generate pre-signed S3 download URL (only if `ScanStatus == Clean`) |
| POST | `` | Create a file upload record in MongoDB |
| GET | `` | List file uploads by `organisationId`, optionally filtered by `material` and `year` |
| GET | `/{fileUploadId}` | Fetch a single file upload record |

### Organisation — `/organisation`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/organisation` | Create organisation record |
| GET | `/organisation` | List all organisations (supports `?searchTerm=`) |
| GET | `/organisation/{orgId}` | Fetch by numeric `orgId` |
| PUT | `/organisation/{orgId}` | Update organisation |
| PUT | `/organisation/{orgId}/upsert` | Upsert organisation |
| DELETE | `/organisation/{orgId}` | Delete organisation |

---

## Step-by-Step Operator Journey

### Step 1 — Operator lands on site

- Page: `/operator` — no backend call
- Auth: stub in development; Defra ID (operators) / Azure Entra ID (regulators) in production

---

### Step 2 — Start accreditation application

- Page: `/operator-accreditation/{organisationId}/{registrationId}/{materialType}/{year}`
- Auth scope: `operator`

**`POST /api/v1/accreditation-applications/{orgId}/{regId}/{materialType}/seed`**

```
Frontend
  └─→ seed endpoint
        └─→ IReExApiAdapter.GetAccreditationAsync(orgId, regId, materialType, year)
              │  [non-dev] IReExClient → ReEx API: GET v1/organisations/{organisationId}
              │            Returns OrganisationDto (registrations, accreditations, sites)
              │  [dev]     StubReExApiAdapter returns hardcoded data; no HTTP call
        └─→ Maps prior-year accreditation → AccreditationApplicationModel
        └─→ Persists to MongoDB → returns application to frontend
```

---

### Step 3 — Enter PRN, tonnage, and business plan data

Three separate PATCH calls; each persists to MongoDB only — no external calls.

| Backend call | Updates |
|-------------|---------|
| `PATCH …/{appId}/prns` | `Prns.PlannedTonnageBand`, `Prns.Authorisers`; status → `Started` |
| `PATCH …/{appId}/tonnage` | Tonnage band |
| `PATCH …/{appId}/business-plan` | Allocation percentages and detail fields |

---

### Step 4 — Upload sampling plan files

```
1. POST /api/v1/accreditation-applications/{orgId}/{appId}/files/initiate
   └─→ Backend calls POST {CdpUploader.Url}/initiate (SamplingPlanBucket)
   └─→ Rewrites internal CDP hostnames → returns { fileUploadId, uploadUrl, statusUrl }
       statusUrl = {App.BaseUrl}/api/v1/file-uploads/{fileUploadId}/status  ← backend endpoint

2. Browser: PUT {uploadUrl} + file  (direct upload to CDP/S3)

3. CDP scans file, then posts callback:
   POST /api/v1/file-uploads/upload-completed
   └─→ PendingUploadService.Complete(fileUploadId, scanResult)
       processingStatus → "validated" (clean) or "rejected" (infected)

4. Frontend polls: GET /api/v1/file-uploads/{fileUploadId}/status
   └─→ Returns { uploadStatus: "pending"|"ready", processingStatus: "preprocessing"|"validated"|"rejected" }
   └─→ Stops polling when uploadStatus == "ready"

5. POST /api/v1/accreditation-applications/{orgId}/{appId}/files
   └─→ Stores file reference (fileId, filename, scanStatus) in MongoDB
```

> In **development**, `DevScanAutoCompleteService` polls CDP's status URL and auto-calls `upload-completed`, replacing the real webhook.

---

### Step 5 — Select overseas sites (exporters only)

**`PATCH /api/v1/accreditation-applications/{orgId}/{appId}/overseas-sites`**

```
Frontend
  └─→ overseas-sites endpoint
        └─→ IReExApiAdapter.GetOverseasSiteAsync(orgId, regId, accId)
              │  [non-dev] IReExClient → ReEx API:
              │            GET v1/organisations/{orgId}/registrations/{regId}
              │                /accreditations/{accId}/overseas-sites
              │            Returns OverseasSitesDto (name, country, address, EU/OECD flag)
              │  [dev]     StubReExApiAdapter returns hardcoded sites
        └─→ Maps to OverseasSiteModel list → persists to MongoDB
```

---

### Step 6 — Upload BES evidence (exporters only)

Same five-step CDP flow as Step 4, scoped per overseas site. Files land in `BesEvidenceBucket`.

```
POST /api/v1/accreditation-applications/{orgId}/{appId}/overseas-sites/{siteId}/bes-evidence/files
```

---

### Step 7 — Submit application

**`POST /api/v1/accreditation-applications/{orgId}/{appId}/submit`**

```
Frontend
  └─→ submit endpoint
        └─→ Must be in 'Started' status, all sections Completed
        └─→ Status → Submitted; records submitter identity + timestamp
        └─→ Generates RA-{9 random digits} reference locally
        └─→ ICaseWorkingApiAdapter.SubmitApplicationAsync()
              │  [UseStub=false] POST {CaseWorking.Url}/work-items
              │                  Response: workItemId (GUID)
              │  [UseStub=true]  Stub logs call, returns reference immediately
        └─→ Stores RA- reference + workItemId (as CaseManagementWorkItemId) in MongoDB
             → returns reference to frontend
```

`CaseManagementWorkItemId` is what every subsequent CM interaction below is keyed on.

---

### Step 8 — Case Management raises a query

A CM caseworker can query specific sections instead of approving/rejecting outright. This is
**CM-initiated**, not something the operator or OJ frontend triggers.

```
ManagementBe                                             OJ backend
  │  caseworker raises a query, naming section(s)            │
  │──POST case-management/{workItemId}/query───────────────▶ │
  │                                                            │  QueryFromCaseManagement:
  │                                                            │  sections → Queried,
  │                                                            │  ApplicationStatus → Queried,
  │                                                            │  Query.QueryNote stored
  │ ◀──────────────────────────────────────── 200 ────────────│
```

The OJ frontend surfaces this via a regulator-query banner and a dedicated query task list
(`query-task-list`, `query-declaration`). Once the operator has amended the queried sections
and confirms:

**`POST /api/v1/accreditation-applications/{orgId}/{appId}/resubmit`**

```
Frontend
  └─→ resubmit endpoint
        └─→ Must be in 'Queried' status (idempotent no-op if already 'Updated')
        └─→ ICaseWorkingApiAdapter.ResumeFromQueryAsync()
              └─→ POST {CaseWorking.Url}/work-items/re-accreditation/{workItemId}/resume-from-query
        └─→ Queried sections re-evaluated to their real status
        └─→ Status → Updated
```

---

### Step 9 — Case Management pushes a status change

Every CM work-item state transition — including the regulator's eventual approve/reject
decision, which happens **entirely within ManagementBe's own caseworker UI**, not this
service — is pushed here (RA-368):

```
ManagementBe                                             OJ backend
  │  work item transitions (e.g. duly-made, approved)         │
  │──POST case-management/{workItemId}/status───────────────▶ │
  │                                                            │  StatusChangedFromCaseManagement:
  │                                                            │  ordering guard on OccurredAt,
  │                                                            │  terminal-status guard,
  │                                                            │  toStateId → ApplicationStatus
  │                                                            │  (mapped states only — see
  │                                                            │   Inbound push payloads above)
  │ ◀──────────────────────────────────────── 200 ────────────│
```

There is no OJ backend endpoint for approve/reject and no write-back to ReEx from this
service on decision — both now live in ManagementBe.

---

### Step 10 — Operator withdraws

**`POST /api/v1/accreditation-applications/{orgId}/{appId}/withdraw`**

```
Frontend
  └─→ withdraw endpoint
        └─→ Must be 'Submitted', 'DulyMade', 'Queried' or 'Updated' (already-withdrawn is a no-op)
        └─→ ICaseWorkingApiAdapter.WithdrawApplicationAsync()
              └─→ POST {CaseWorking.Url}/work-items/re-accreditation/{workItemId}/withdraw
        └─→ Status → Withdrawn; any open query's sections re-evaluated
```

An operator can start a fresh application for the same accreditation year afterwards
(`/start-new`) — the withdrawn record is kept untouched for audit.

---

## Authentication & Authorisation

| Environment | Operators | Regulators |
|-------------|-----------|------------|
| Development | Stub auth (`auth.stubEnabled=true`) | Stub auth |
| Non-development | Defra ID (OIDC) | Azure Entra ID |

Frontend enforces route-level scopes:

```javascript
options: requireOperator  // auth.scope: ['operator']
```

> Regulator auth in this table gates OJ frontend routes that display CM-driven read state
> (e.g. the regulator-query banner). Regulator/caseworker **decision-making** — approve,
> reject, raise a query — happens in ManagementBe's own caseworker UI
> (`epr-register-enrol-management-fe`), not here; see
> [Integration: Case Management](#integration-case-management-managementbe).

The backend trusts the authenticated identity forwarded by the frontend. ReEx auth (`BasicAuthHandler`), outbound ManagementBe auth (Cognito headers + optional HMAC via `CaseWorking.SharedSecret`), and inbound ManagementBe auth (`CaseManagementAuthenticationHandler`, verified against `CaseManagementAuth.SharedSecret`) are handled transparently by the respective adapters/handlers.

---

## Backend Project Structure

```
EprRegisterEnrolBackend/
├── AccreditationApplication/
│   ├── Adapters/
│   │   ├── IReExApiAdapter.cs
│   │   ├── HttpReExApiAdapter.cs        ← production: calls IReExClient
│   │   ├── StubReExApiAdapter.cs        ← development: hardcoded data
│   │   ├── ICaseWorkingApiAdapter.cs
│   │   ├── HttpCaseWorkingApiAdapter.cs ← production: submit/resume/withdraw/site-added
│   │   ├── StubCaseWorkingApiAdapter.cs ← development/stub mode
│   │   ├── CaseWorkingApiConfig.cs      ← outbound (backend → ManagementBe) config
│   │   ├── CaseManagementAuthConfig.cs  ← inbound (ManagementBe → backend) config
│   │   └── NotificationStatusResolver.cs ← derives operator-facing notify status from CM audit log
│   ├── Endpoints/
│   │   ├── AccreditationApplicationEndpoints.cs ← includes case-management/{status,query} (RA-368/RA-311)
│   │   └── AccreditationApplicationOrdering.cs
│   ├── Models/
│   │   ├── AccreditationApplicationModel.cs      ← incl. ApplicationStatus, CaseManagementWorkItemId
│   │   ├── AccreditationApplicationQuery.cs       ← CM query note + resubmission history
│   │   └── ... (Prns, BusinessPlan, SamplingPlan, OverseasSites, MaterialType, Requests, ...)
│   ├── Services/
│   │   ├── AccreditationApplicationPersistence.cs
│   │   ├── AccreditationApplicationSections.cs   ← section-editability + status computation
│   │   └── SectionStatusService.cs
│   └── Validators/                       ← one FluentValidation validator per request DTO
├── Auth/
│   ├── CaseManagementAuthenticationHandler.cs ← verifies inbound HMAC from ManagementBe
│   └── CaseManagementAuthenticationOptions.cs
├── ReEx/
│   ├── Config/                           ← ReExConfig, ReExCredentials
│   ├── Dtos/                             ← OrganisationDto, OverseasSitesDto
│   ├── Http/
│   │   └── BasicAuthHandler.cs
│   ├── IReExClient.cs
│   ├── ReExClient.cs
│   └── ServiceCollectionExtensions.cs   ← AddReExClients()
├── CdpUploader/
│   ├── Config/
│   │   └── CdpUploaderConfig.cs         ← Url, bucket names, AppConfig.BaseUrl
│   ├── Models/
│   │   └── CdpModels.cs                 ← CdpInitiateRequest/Response, CdpCallbackPayload, CdpStatusResponse
│   └── Services/
│       ├── ICdpUploaderService.cs
│       ├── CdpUploaderService.cs        ← POST /initiate + hostname rewrite
│       ├── IPendingUploadService.cs
│       ├── PendingUploadService.cs      ← in-memory upload state tracker
│       └── DevScanAutoCompleteService.cs ← dev-only: polls CDP and calls upload-completed
├── FileUpload/
│   ├── Config/
│   │   └── S3Config.cs
│   ├── Endpoints/
│   │   └── FileUploadEndpoints.cs       ← /initiate, /upload-completed, /status, /download
│   ├── Models/
│   │   └── FileUploadModel.cs
│   └── Services/
│       ├── FileUploadPersistence.cs     ← MongoDB file upload records
│       ├── IS3Service.cs
│       └── S3Service.cs                 ← pre-signed download URL generation
├── Organisation/
│   ├── Endpoints/
│   │   └── OrganisationEndpoints.cs     ← CRUD /organisation
│   ├── Models/
│   │   └── OrganisationModel.cs
│   └── Services/
│       ├── OrganisationPersistence.cs
│       ├── FakeOrganisationPersistence.cs
│       └── FallbackOrganisationPersistence.cs
├── Program.cs                            ← DI wiring + env branch
├── appsettings.json
└── appsettings.Development.json
```

---

## Core Data Model

`AccreditationApplicationModel` — central MongoDB document:

```
AccreditationApplicationModel
├── ApplicationId               (string — internal ID, derived from Mongo ObjectId)
├── OrganisationId              (string)
├── OrganisationName            (string)
├── RegistrationId / RegistrationReference (string — e.g. WEX12345)
├── Year                        (int)
├── MaterialType                (plastic | glass | steel — [BsonRepresentation(String)])
├── ApplicationStatus           (Saved | Started | Submitted | DulyMade | Queried | Updated
│                                 | Approved | Rejected | Withdrawn — [BsonRepresentation(String)];
│                                 CM-driven values are set only via the case-management push
│                                 endpoints, never by an OJ-side approve/reject action)
├── IsExporter                  (bool — derived from ReEx)
├── SiteAddress                 (string — formatted from ReEx)
├── SourceReExAccreditationId   (string — links to prior-year ReEx accreditation)
├── ApplicationReference        (string — locally generated "RA-nnnnnnnnn")
├── CaseManagementReference     (string?)
├── CaseManagementWorkItemId    (Guid? — CM's work item id; correlation key for every
│                                 case-management/* call in both directions)
├── CaseManagementStatusUpdatedAt (DateTime? — ordering watermark for inbound CM pushes;
│                                 not displayed)
├── SubmittedBy                 (SubmittedByModel: FullName, JobTitle, Email)
├── WithdrawalReason             (string?)
├── DateSent / DateLastEdited / CreatedAt / UpdatedAt
├── Prns
│   ├── PlannedTonnageBand    (UpTo500 | UpTo1000 | UpTo10000 | Over10000)
│   ├── Authorisers           (List<PrnsAuthoriser>)
│   └── SectionStatus
├── BusinessPlan
│   ├── NewInfrastructurePercent / Detail
│   ├── PriceSupportPercent / Detail
│   ├── BusinessCollectionsPercent / Detail
│   ├── CommunicationsPercent / Detail
│   ├── NewMarketsPercent / Detail
│   ├── NewUsesPercent / Detail
│   └── SectionStatus
├── SamplingPlan
│   ├── Files                 (List<AccreditationApplicationFile>)
│   └── SectionStatus
├── OverseasSites              (exporters only)
│   ├── Sites                 (List<OverseasSiteModel>)
│   └── SectionStatus
├── BesEvidence                (exporters only — evidence not tied to a single site)
│   └── SectionStatus
├── Query                      (set once CM raises a query — RA-311)
│   ├── QueryNote
│   ├── QueriedSectionKeys    (currently-open query, cleared on resubmit)
│   └── QuerySubmissions      (history: time, section keys, submitter contact details)
└── NotificationStatus         ([BsonIgnore], transient — "sent"/"failed", live-derived on
                                 GetById from CM's work-item audit log, RA102-j7s)
```

`SectionStatus` (per-section, distinct from `ApplicationStatus`):
`NotStarted | InProgress | Completed | Submitted | Queried`.
