# In-year changes and the domain model: follow-up work

Status: draft for discussion (to be grilled). Written 2026-11-13, after checking James's IYC vs domain model
analysis against the RA-739 branches (`feature/ra-739-in-year-change-cm`) and `cdp-app-config` `origin/main`.
Nothing here has been changed in code. RA-739 PRs go ahead unchanged.

## Constraint this plan assumes

Every dual-write phase is done before in-year changes (IYC) are released to production, **including the phase 6
cut** (legacy writes stopped). That is the "After phase 6" row of the rollout table in
`lib/epr-register-enrol-backend/docs/analysis/register-enrol-application-types.md` ("When in-year changes ship"):
no legacy bridging work is needed.

## Where things stand

### Flags (cdp-app-config `origin/main`, backend)

| Env | ExpandEnabled | DualWriteSeed | DualWrite | InYearChangesEnabled | SubmitToCaseManagement |
| --- | --- | --- | --- | --- | --- |
| dev, test, ext-test, perf-test | true | true | true | false | not set (false) |
| prod | true | false | false | false | not set (false) |

IYC has never been on in a deployed environment, so there is no `accreditationChangeRequests` data to migrate.
`FeatureFlags.cs:32` already refuses `InYearChangesEnabled` without `DualWrite` outside Development.

### James's analysis, checked

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | RA-739 breaks the backend submit (response shape, three new required fields, per-site details never sent) | Already handled on the RA-739 backend branch (James checked backend `main`). `HttpCaseWorkingApiAdapter` parses `{ submissionReference, workItems[] }` and sends every field management-be's `SubmissionPayload.Validate` requires, plus per-site projection and charge. Remaining risk is deploy order only: merge and deploy backend and management-be RA-739 together. |
| 2 | Three places decide "accredited" from legacy `selected` | True: `AccreditationApi/AccreditationApiMapper.cs:70` (ReEx API, still reads legacy), `AccreditationChanges/ChangeRequestRules.cs:38`, `DomainModel/ReadModel/ApplicationProjection.cs:158`. |
| 3 | An IYC approval creates reconciliation diffs | True before the cut (projection shows current ORS over unchanged legacy). Irrelevant after the cut. |
| 4a | The one-open-change-per-ORS check works one way only | True but latent: registration-only requests have no write route (dev seed only). |
| 4b | 2027-onward rule not enforced on IYC endpoints | True: `LoadGrantedAsync` only checks Approved. |
| - | Phases 2 and 3 can ship unchanged | True: IYC only writes `accreditationChangeRequests`, never `accreditationApplications`. |
| - | Nothing sends a CM decision back | True on both sides: management-be's push is ReAccreditation-only (`ReAccreditationStatusPushHook`); backend IYC statuses stop at `Submitted`. |

His questions:

- **Payload/response decision to Chris before PRs?** Already in RA-739.
- **Who writes the backend half of RA-739?** Done, on `feature/ra-739-in-year-change-cm`.
- **Removed site: delete the draft or mark Withdrawn?** Delete. Sites can only be removed before submission (fixed once
  sent, `SitesFixedMessage`). Withdrawn is for submitted cases, via Case Management.

### Dropped from James's plan (given the constraint)

Dual-writing IYC, migrating existing requests, setting the legacy `selected` flag on approval, reconciliation
workarounds. All are legacy bridging.

## Data models: re-accreditation vs in-year changes

| | Re-accreditation | In-year changes (today) | Domain model target |
| --- | --- | --- | --- |
| Store | `accreditationApplications` (legacy), mirrored to `applicationVersions` under dual-write | `accreditationChangeRequests` | `applicationVersions` |
| Shape | `AccreditationApplicationModel`; model: `ApplicationEntity` + `AccreditationDetails` | `AccreditationChangeRequest`: one doc per batch, `Sites[]` items + `TonnageBandUpgrade` item | `ApplicationEntity` envelope + `OrsChangeDetails` / `TonnageChangeDetails`, one application per ORS, batch via `SubmissionReference` |
| History | Versioned (model side) | None. `Version` is an optimistic-concurrency counter only | Versioned (`VersionedEntityBase`: `entityId`, `version`, `validFrom`/`validTo`, `isCurrent`, `lastChange`) |
| Site data | `ApplicationOverseasSiteEntry` (proposedChanges overlay, BES, interim sites) | `ChangeRequestSite.Answers` (4 fields) + BES | Same `ApplicationOverseasSiteEntry` on `OrsChangeDetails.Site` |
| One open change per ORS | n/a | `HeldElsewhere` check in code (one direction) | `ors-change|{overseasSiteId}` exclusivity key + partial unique index |

The model already has the IYC types (`ApplicationType.OrsChange`, `TonnageChange`); nothing writes them yet.

**Recommendation: same versioned model.** They aren't too different. The envelope already covers what they share
(status lifecycle with the same status names, case reference, work item id, payment reference, submitter, query,
withdrawal). The differences (targets an Accreditation not a Registration, one ORS not many, no business plan / PRNs /
sampling) are what the per-type `details` is for. Gains: history, the exclusivity key, 2027-onward enforced by
targeting an Accreditation (only 2027+ exist), one less collection to retire.

## Decisions needed before building

- **D1. Draft batch grouping.** `SubmissionReference` (`SUB-`) only exists once Case Management assigns it. Proposal:
  the draft is the Saved `OrsChange` applications targeting the Accreditation (fits one draft per accreditation).
  With James.
- **D2. Registration-only requests (RA-697).** `OrsChangeDetails.TargetAccreditationId` is required, so they don't
  fit. Nullable target, a separate type, or drop them? Product and James.
- **D3. Site key.** Key IYC sites by ORS (`orsId` / ORS `entityId`) instead of the legacy per-application `siteId`.
  `AccreditationOverseasSiteEntry` has no `siteId`, and today two schemes coexist (legacy `siteId` on the
  accreditation view, `int(orsId)` on the registration-only view, reconciled by `ChangeRequestRules.IsForSite`).
  Touches frontend routes, backend routes, and the `siteId` CM echoes back (CM only uses it to match, so not
  breaking).
- **D4. Where an IYC approval shows for the operator.** Does the existing accreditation view (via the read model)
  show in-year-added sites, or does it move to reading the Accreditation?
- **D5. Product.** Is 2027-onward still the rule? What should registration-only changes do?

## Recommended work

1. **IYC on the versioned model** (backend, us; after D1-D3)
   - `OrsChange` per site, `TonnageChange` for tonnage, written to `applicationVersions` via the versioned repository.
   - Write the `ors-change|{site}` exclusivity key; remove `HeldElsewhere`.
   - On submit, copy declaration, charge, payment reference and submitter to each application; stamp each one's
     case reference and work item id.
   - Keep the frontend API's view shape, built from the applications, so the frontend barely changes.
   - Reconciler and anything else scanning `applicationVersions` ignores non-Accreditation types.
2. **IYC reads from the model** (backend, us; after 1 and D3)
   - Accreditation, its sites, current ORS versions and Registration instead of `IAccreditationApplicationPersistence`
     (today `AccreditationChangeEndpoints.cs:121`).
   - Approved / suspended / cancelled / exporter checks from Accreditation and Registration.
   - Locked fields and effective values from the current ORS version.
3. **"Accredited" from `Accreditation.AccreditationOverseasSites` everywhere** (James's phase 5, plus D4)
   - ReEx accreditation API moves onto the model, as the design (§6, D3) says.
   - `ApplicationProjection` and other readers stop deriving "accredited" from `Selected`.
4. **Decisions back for IYC** (management-be and backend; after 1)
   - management-be: move duly-making, query, determination and decision push out of ReAccreditation into the shared
     workflow (RA-495).
   - backend: decision route for `OrsChange`. Approve in one transaction: new Accreditation version with the site,
     new ORS version with proposed changes applied, application status, exclusivity key released. Reject: discard
     any Proposed site.
   - Query and resume for IYC: needed for first release?
5. **Withdraw a submitted IYC** (both sides): via management-be's withdraw, same pattern as re-accreditation.
6. **Phases 5 to 7** (James): `ReadFromModel` read switch, `LegacyWrites` cut and 4-week soak, archive. Not built yet.
   The IYC release waits for the cut.
7. **Release guard** (backend, small): extend the `FeatureFlags` check so `InYearChangesEnabled` can't be on outside
   Development until legacy writes are off (today it only requires `DualWrite`).
8. **Tests**: fe-tests and mgmt-tests e2e for IYC submit, decision and withdraw against the model; retest against a
   migrated dataset.
9. **Clean-up**: retire `accreditationChangeRequests`, `ChangeRequestItemBackfill`, the old dev seed; rewrite the seed
   to create `OrsChange` applications.

## To discuss

- **Test environments before the cut.** Model-only IYC rows would be lost if the model is truncated and the migration
  re-run (phase 3/4 rollback). Acceptable for test data?
- **Payments.** GOV.UK Pay and batch part-payments in this work, or a separate ticket?
- **Ticket split.** 1 and 2 as one ticket? 4 split into management-be and backend tickets? 3 and 6 stay with James.
- **Deploy order for RA-739.** Merge and deploy backend and management-be together.
