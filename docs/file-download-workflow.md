# File Download Workflow: Case Management & Test Infrastructure

This document covers the second half of the file lifecycle that `operator-journey.md` doesn't: how a file uploaded by an operator (sampling plan, BES evidence) becomes downloadable from case management, and the local/CI test infrastructure required to make that whole chain actually work end to end. It also captures the non-obvious bugs found while building this (RA-319) so they don't have to be re-discovered.

---

## Architecture Overview

```
Operator uploads file                Case management downloads file
        │                                       ▲
        ▼                                       │
┌──────────────────────┐   POST /work-items  ┌──────────────────────────────┐
│ epr-register-enrol-   │ ───────────────────▶│ epr-register-enrol-           │
│ backend                │  payload includes   │ management-be                 │
│ (CDP Uploader client)  │  s3Key/s3Bucket per  │ (stores payload as-is,       │
└──────────────────────┘  file                 │  schemaless BsonDocument)     │
        │                                       └──────────────┬────────────────┘
        ▼                                                      │
     S3 bucket                                                 ▼
   (real S3 in test/prod,                          ┌──────────────────────────────┐
    floci locally/CI)                               │ epr-register-enrol-           │
        ▲                                            │ management-fe                 │
        │  GetObjectCommand (direct S3 read,          │ GET /work-items/{id}/files/   │
        │  not a pre-signed URL)                       │     {fileId}/download         │
        └───────────────────────────────────────────  │ (s3Client.js, streams object) │
                                                        └──────────────────────────────┘
```

**Key distinction from `operator-journey.md`'s download section:** the backend's `/api/v1/file-uploads/{fileUploadId}/download` endpoint (pre-signed URL) is a *separate, generic* mechanism. The case-management download route added in RA-319 does **not** use it — `download-file.controller.js` in `epr-register-enrol-management-fe` reads `s3Key`/`s3Bucket` directly off the file record in the work-item payload and streams the object itself via `GetObjectCommand`. Access control is inherited from `getWorkItem`'s existing work-item tenancy check — there's no separate ownership check on the download route, deliberately, to avoid drifting from the backend's rules.

---

## How a file becomes downloadable

1. Operator uploads a file (sampling plan or BES evidence) — see `operator-journey.md` Steps 4/6 for the initiate → PUT → scan → poll flow.
2. Once CDP reports the scan result, the backend's `AddBesEvidenceFile` / sampling-plan file endpoints store the file record — **critically including `S3Key` and `S3Bucket`**, sourced from the real CDP status/callback response (`CdpCallbackFile.S3Bucket`/`S3Key` in production; `DevScanAutoCompleteService`'s `GetStatusAsync` polling in local dev).
3. On submit, `HttpCaseWorkingApiAdapter.BuildPayload()` forwards these fields into the `POST /work-items` payload:
   - `samplingPlan.files[].s3Key` / `.s3Bucket`
   - `overseasSites.sites[].besEvidence.files[].s3Key` / `.s3Bucket` (added in RA-319 — previously only sampling-plan files reached case-mgmt at all)
4. `management-be` stores the payload verbatim (schemaless `BsonDocument` — no model changes needed to receive new fields).
5. `management-fe`'s `application-details.controller.js` renders a download link per file (sampling plan table + a new "Overseas sites — BES evidence" section, one table per site), **gated on `scanStatus === 'Clean'`**.
6. Clicking the link hits `GET /work-items/{id}/files/{fileId}/download`, which searches both `samplingPlan.files` and every site's `besEvidence.files` for a matching `fileId`, then streams straight from S3.

**If a file's `s3Key` is missing** (legacy record, or upload predates RA-319), the download link doesn't render at all — the njk template only emits a link when `f.fileId and f.scanStatus == "Clean"`.

---

## Config required for download to work in a real environment

| Where | Key | Notes |
|---|---|---|
| `management-fe` | `FILE_UPLOAD_S3_BUCKET` env var (`fileStorage.fallbackBucket`, default `epr-register-enrol-file-uploads`) | Only a **fallback** — real downloads use the `s3Bucket` stored on the file record, not this default. Matters only for records missing `s3Bucket` (legacy uploads). Renamed from `SAMPLING_PLAN_S3_BUCKET` (`fileStorage.samplingPlanBucket`, default `epr-register-enrol-sampling-plans`) in management-fe#119 — that name/default never matched what the operator side actually uploads to (see next row) and would have silently looked in the wrong bucket if the fallback path were ever exercised. **Must match `epr-register-enrol-frontend`'s `FILE_UPLOAD_S3_BUCKET` (`fileUpload.s3Bucket`)** — same env var name by design, so the two are set together via shared CDP config rather than needing to be reconciled by hand. |
| `epr-register-enrol-frontend` | `FILE_UPLOAD_S3_BUCKET` env var (`fileUpload.s3Bucket`, default `epr-register-enrol-file-uploads`) | The bucket the operator side actually uploads to when initiating a CDP upload. Both the sampling-plan and BES-evidence upload controllers use this **same** config key — there is no per-file-type bucket split on the upload path today, even though `epr-register-enrol-backend`'s `appsettings.json` defines separate `SamplingPlanBucket` / `BesEvidenceBucket` / `GenericFilesBucket` keys (`sampling-plans` / `bes-evidence` / `file-uploads`). Those backend keys aren't currently wired to anything — don't assume they're the real bucket names in a given environment. |
| `management-fe` | `AWS_ENDPOINT_URL` | **Must be unset** in test/prod. `s3-client.js` only overrides the S3 endpoint (and sets `forcePathStyle: true`) when this is set — it exists purely for local floci. If accidentally set in a deployed environment, downloads will silently try to hit floci. |
| `management-fe` | `AWS_REGION` | Standard. |
| `management-fe` | *(none — no access key/secret)* | `s3Client.js` uses `fromNodeProviderChain()`, resolving credentials from the service's IAM role automatically on CDP's platform. |
| Platform/infra (not app config) | S3 `GetObject` IAM permission | `management-fe`'s IAM role needs read access to whatever bucket sampling-plan and BES-evidence files actually land in for that environment — check the real per-environment bucket name against `epr-register-enrol-frontend`'s `FILE_UPLOAD_S3_BUCKET`, not the backend's `SamplingPlanBucket`/`BesEvidenceBucket`/`GenericFilesBucket` config (see row above — those aren't what's actually used). |

---

## Local Docker / CI test infrastructure — floci and cdp-uploader gotchas

These were all found and fixed while getting this feature to actually work end-to-end in Docker (`floci` is a local S3/SQS emulator; `defradigital/cdp-uploader` is the real CDP Uploader image). None of them are obvious from reading application code — they only show up when a real file genuinely tries to flow through the whole pipeline.

### 1. floci's healthcheck races its own init script
floci's HTTP port opens and starts answering (with a valid, empty `ListBuckets` response) **before** its init hook — which provisions the S3 buckets and SQS queues `cdp-uploader` depends on — has finished running (confirmed via floci's own logs: `Listening on: ...` fires ~4s before `=== AWS Local Emulator Ready ===`). A healthcheck that just checks "is the port open" (`wget http://localhost:4566`) reports healthy too early. `cdp-uploader` (gated on `floci: condition: service_healthy`) can then start subscribing to SQS queues before they exist, and its consumers never recover for the rest of the container's life: `SQS receive message failed: The specified queue does not exist`.

**Fix:** the init script (`docker/scripts/localstack/10-setup-buckets.sh` in whichever repo owns the compose file) writes a completion marker file after provisioning finishes; the healthcheck waits on that marker instead of the port:
```yaml
healthcheck:
  test: ['CMD', 'test', '-f', '/tmp/floci-init-complete']
  interval: 2s
  start_period: 15s
  retries: 10
```

### 2. `cdp-uploader` needs a quarantine bucket that's easy to forget
`cdp-uploader` stages every upload in an S3 "quarantine" bucket first (`cdp-uploader`'s own `config.quarantineBucket`, defaults to `cdp-uploader-quarantine`) and only copies it into the destination bucket once the mock scan clears it (`CopyObjectCommand`, found in `cdp-uploader`'s bundled source at `server/common/helpers/s3/move-s3-object.js`). If that bucket doesn't exist, the copy's *source* reference 404s with `NoSuchBucket` immediately after every upload — easy to misdiagnose as a destination-bucket or endpoint-config problem, since the actual PUT into quarantine succeeds fine.

**Fix:** create `cdp-uploader-quarantine` alongside the other buckets in the init script.

### 3. The mock virus scanner needs S3 event notifications explicitly wired
`cdp-uploader`'s mock virus scanner (`server/test-harness/mock-virus-scanner.js`) is a listener on the `mock-clamav` SQS queue that expects **real S3 `ObjectCreated` event notifications** (`Records[].s3.object.key`) — it does not self-trigger on a timer. Without wiring the quarantine bucket's notifications to that queue, nothing ever publishes to it, so uploads sit at `pending` indefinitely and never reach a scan verdict. This is the exact mechanism behind a "Clean" status never appearing / a browser wait timing out at 60s in e2e tests.

**Fix:**
```bash
aws --endpoint-url=$ENDPOINT s3api put-bucket-notification-configuration \
  --bucket cdp-uploader-quarantine \
  --notification-configuration '{"QueueConfigurations":[{"QueueArn":"arn:aws:sqs:eu-west-2:000000000000:mock-clamav","Events":["s3:ObjectCreated:*"]}]}' \
  --region eu-west-2
```

### How these three were actually diagnosed
Reading `cdp-uploader`'s own bundled source **inside the running container** (`docker exec <container> cat /home/node/.server/...`) was far more reliable than guessing at S3 client config from the outside — it's the real `defradigital/cdp-uploader` image, so its actual behaviour (quarantine bucket name, notification-based trigger, `forcePathStyle` logic) is right there in `/home/node/.server/`. Each fix was verified by driving a real upload with `curl` against a freshly cold-started `floci` + `redis` + `cdp-uploader` stack (no reused container state) and checking `GET /status/{uploadId}` reaches `uploadStatus: "ready"` / `fileStatus: "complete"` with a correct `s3Key`/`s3Bucket`.

### Where these fixes live
- `epr-register-enrol-fe-tests` repo (`compose.yml` + `docker/scripts/localstack/10-setup-buckets.sh`) — used by `epr-register-enrol-frontend`'s and `epr-register-enrol-backend`'s CI via the `run-journey-tests` composite action.
- Local dev compose files (e.g. the root `epr-register-enrol/compose.yml`, `epr-register-enrol-management-fe/compose/`) may have their own separate floci setup and are not automatically in sync with `fe-tests`' — check for the same three gaps if uploads hang locally.

---

## Other infrastructure quirks worth knowing

- **Windows checkouts (`core.autocrlf=true`) corrupt shell scripts.** A CRLF-converted `.sh` init script fails with cryptic errors like `set: line 2: illegal option -` (the `\r` after `-e` in `set -e`). If a local floci init script is failing on Windows, check line endings before anything else.
- **Cookie collision between two Node frontends on the same host.** `epr-register-enrol-frontend` and `epr-register-enrol-management-fe` both default their session cookie name to `"session"`. Browser cookie scoping is by hostname only, not port — running both on `localhost` (different ports) causes intermittent 403s from session cookie collisions. Fix: distinct `SESSION_CACHE_NAME` per service (`operator-session` / `case-mgmt-session`).
- **floci can crash under load** (its init hook has an internal ~30s timeout that concurrent build/test load can exceed). `restart: on-failure` on the floci service is a cheap mitigation — but note this does *not* fix the healthcheck race above (floci doesn't crash in that scenario, it just reports healthy too early); the two are separate failure modes.

---

## Debugging checklist for "file upload/download isn't working"

1. **Is the "Clean" status never appearing / browser wait timing out?** → almost certainly one of the three floci/cdp-uploader gaps above. Check `docker compose logs cdp-uploader` for `SQS receive message failed` (gap #1) or `NoSuchBucket` (gap #2), or just confirm nothing in the logs ever shows `fileStatus: "complete"` (gap #3 — scan trigger never fires).
2. **Does the download link not render at all** on `application-details`? → the file record is missing `s3Key` (check `scanStatus` is `Clean` and the record actually has `s3Key`/`s3Bucket` populated — a pre-RA-319 record won't).
3. **Does the download 404 or 422 from `management-fe`?** → 422 means `scanStatus !== 'Clean'`; 404 means either the work item/file wasn't found (tenancy check) or the S3 `GetObject` itself failed (check bucket name mismatch, IAM permissions, or `AWS_ENDPOINT_URL` accidentally set in a non-local environment).
4. **Upload works locally but not in CI**, or vice versa? → compare the compose files being used; they are **not** the same file in every repo (see "Where these fixes live" above) and can drift out of sync.
