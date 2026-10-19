# Critical fields by use case — where each comes from in our data today

Ticket: RA-643. Output for the product page; feeds the spec and ongoing data modelling.

## Basis and how to read this

**"Source today" is our own databases:** the ReEx database, the operator backend (**OJ**, `accreditationApplications`)
and the case management backend (**CM**, `workItems` / `payload`). For each field the table says what each system
holds. Where a field is held in none of them, the row says **Gap**, and the gap is listed at the end for a separate
ticket on how to source it. Nothing here proposes a fix.

**What this is built from (and nothing else):**

- **ReEx — read from the code.** `DEFRA/epr-backend`, `main` @ `09fb1f4`, 2026-10-16 (a read-only clone). I read the
  stored data model (the Joi schemas under `src/repositories/organisations/schema/` and
  `src/overseas-sites/repository/schema.js`), the organisation read-model adapter and the response schema of its route,
  the public register transformer, the accreditation date helpers, the exporter summary log validation, the reports
  schema and the PRN model. Field names below are the stored ones. **Not read:** the waste balance module, the
  forms-ingest transformation, Mongo indexes, and any live data.
- **OJ and CM — from the two data-model docs** (`operator-reaccreditation-data-model.md` @ `dd71432`,
  `casemanagement-reaccreditation-data-model.md` @ `ef6a005`), with spot checks in the code marked **checked**.
- **What each use case needs** (not where it comes from): the public register CSV of 8 Oct 2026 (28 columns, UC1) and
  the exporter summary log template V5.1 with its GOV.UK guidance (UC4, UC5, UC8).

**Not established by any of these:** which years each system is the authority for. The data models do not say, so
the table does not assume it (see the open questions at the end).

**Gap / notes** starts with **OK** (held in at least one system in a usable form), **Partial** (held, but stale,
snapshot-only, or missing part of what the use case needs) or **Gap** (held in none). Where a field is in one system
and not another, the note says which.

**"History needed" is my proposal** for product to confirm: None / Current / Point-in-time / Full history.
"Point-in-time" means the use case asks about a past date.

**Not covered:** the interim sites log (the application attachment). The PDF supplied renders only its banner and the
metals "conditions of export" box; its columns are not readable. The exporter summary log's interim-site columns are
covered below.

## What the three data models look like together

1. **ReEx holds the organisation, its registrations and its accreditations.** One accreditation record per year
   per registration (the year is the year of its `validFrom`). It also has modules for PRNs, reports, summary logs and
   waste balances. OJ and CM hold a different thing: a re-accreditation **application** per organisation +
   registration + material + year, seeded from a ReEx snapshot and not refreshed. They carry seed-time copies of
   organisation and registration data, which go stale.
2. **ReEx effective-dates what an accreditation is.** It holds `validFrom` and `validTo` on each accreditation, and a
   `statusHistory` of `{ status, updatedAt, updatedBy }` entries on organisations, registrations and accreditations
   (the current status is the latest entry). Its summary log validation already reads them at a date. OJ and CM hold
   none of this; their only history is OJ's per-section `versions[]` snapshots (stamped with the *submission* time,
   never returned by the API) and the CM audit log (application lifecycle events).
3. **Two different "statuses".** OJ's `applicationStatus` and CM's `stateId` describe the application (`Saved` …
   `Approved`, `Rejected`, `Withdrawn`; `Approved` is terminal in OJ). ReEx holds the registration's and
   accreditation's own status: registrations `created | approved | cancelled | rejected`, accreditations the same plus
   `suspended`. The register publishes `Approved`, `Suspended` and `Cancelled`; OJ and CM cannot record the last two.
4. **ReEx already serves an organisation read model.** `GET /organisations/{organisationNumber}` (optional `?year=`)
   exists in the code, built from the same data (ADR-0052). Its response schema decides what is served, and I use it
   for the "Served by ReEx's route today" column. I did not check whether it is deployed.
5. **Identifier trap (RA-503):** `organisationId` is ReEx's internal ObjectId (never show); `orgId` is the visible
   organisation number (500027 in the register); `LinkedDefraOrganisation.OrgId` is an unrelated Defra UUID.

## Use cases

| # | Use case | Question it answers |
| --- | --- | --- |
| UC1 | Public register | Who is registered and accredited, for what, and where? |
| UC2 | Operator dashboard | What does my organisation hold, and what state is it in? |
| UC3 | Regulator dashboard | What does this organisation hold, and what state is it in? |
| UC4 | Summary log validation: accreditation status | Was this registration accredited on the date of this row? |
| UC5 | Summary log validation: ORS and interim sites | Was this ORS or interim site approved for this accreditation on this date? |
| UC6 | PRN issuing: tonnage band | Is this PRN within the tonnage band in force when it is issued? |
| UC7 | PRN issuing: signatories | Was this person an authorised signatory for this accreditation when they signed? |
| UC8 | Annual reporting | How does the year's activity compare with the business plan? |
| UC9 | Status management (potential) | What is the current status before I suspend, cancel or reinstate? |

**What a summary log row carries (UC4, UC5).** The accredited exporter template has three dates per load: *Date
received for export*, *Date of export* and *Date received by approved overseas reprocessor*. In ReEx's validation the
accreditation must cover **Date of export and Date received by overseas reprocessor**, and the overseas site must be
approved by **Date of export**. The row also names the overseas site and interim site by ID (`OSR_ID`,
`INTERIM_SITE_ID`), plus `OSR_NAME`, `OSR_COUNTRY`, `BASEL_EXPORT_CODE` and
`DID_WASTE_PASS_THROUGH_AN_INTERIM_SITE`. There are four templates by registration type; ReEx picks "registered-only"
when the registration has no linked accreditation with an accreditation number.

## The purpose, and the "served today" column

The mapping feeds the design of an API that serves ReEx's organisation read model **plus the other use cases above**.
The read model was written for one client, so it will not cover them all. The **Served by ReEx's route today** column
says what its response schema returns now (verified in code):

- **Served:** returned by the route. "(via statusTimeline)" means as a dated status timeline built from `statusHistory`.
- **Not served, held:** ReEx stores it but the route does not return it.
- **Not held:** ReEx does not store it.

## Mapping table

### Organisation

| Field | Level | Meaning | Used by | History needed | Served by ReEx route today | In ReEx (stored) | In OJ / CM | Gap / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| organisationNumber | Organisation | Business reference; the register's "Org ID" | All | None | Served | `orgId` | OJ `orgId`; CM `payload.operatorOrgNumber` | **OK.** |
| organisationId | Organisation | ReEx's internal id | UC2, UC3, UC9 (as a key) | None | Not served, held | `id` (ObjectId string) | OJ `organisationId`; CM `payload.operatorOrganisationId` | **OK** as a key. Never user-visible (RA-503). |
| name | Organisation | Company name ("Business name") | UC1, UC2, UC3 | Current | Served | `companyDetails.name` | OJ `organisationName`; CM `payload.organisationName` | **OK** in ReEx. The OJ and CM copies are seed-time snapshots, never refreshed. |
| tradingName | Organisation | Trading name | UC1, UC2, UC3 | Current | Served | `companyDetails.tradingName` (optional) | Not held | **OK** in ReEx only. Register data quality: several trading names are numbers (for example `11678700`, `3799128960`, `14868589`). |
| companiesHouseNumber | Organisation | Companies House number | UC1 | Current | Not served, held | `companyDetails.companiesHouseNumber` (optional, 8 characters) | OJ `companiesHouseNumber`; CM payload copy | **OK** in ReEx. Blank on some register rows (overseas and some UK bodies). OJ and CM copies are snapshots. |
| registeredOffice | Organisation | Registered office / head office / main place of business in the UK | UC1, UC3 | Current | Not served, held | `companyDetails.registeredAddress` (the register falls back to `companyDetails.address`) | OJ `companyRegisteredAddress`, `companyRegisterAddressPostcode`, `isUkRegisteredAddress`; CM payload copies | **OK** in ReEx (address parts, or `fullAddress`). OJ and CM hold a concatenated string plus postcode. Register rows include non-UK addresses. |
| linkedDefraOrganisation | Organisation | The Defra organisation an operator signs in as | UC2 | Current | Served (`linkedBy.id` not served) | `linkedDefraOrganisation` (`orgId` uuid, `orgName`, `linkedBy` email and id, `linkedAt`) | Not stored. OJ resolves it per request through `GET api/v1/organisations/{id}/defra-link` | **OK** in ReEx. |
| contacts | Organisation | Submitter and management contacts | UC3 | Current | Not served, held | `submitterContactDetails`, `managementContactDetails` (name, email, phone, job title); registrations hold `submitterContactDetails`, `applicationContactDetails`, `approvedPersons`; `users[]` collates the people with roles | OJ `submittedBy`, `submitterContactDetails`; CM payload copies | **OK** in ReEx. OJ and CM hold only the latest submitter. |
| organisationStatus | Organisation | created, approved, active, rejected | UC2, UC3 | Current | Served (`status`; no org timeline) | `statusHistory[]` (`status`, `updatedAt`, `updatedBy`); the current status is the latest entry | Not held | **OK** in ReEx. The `status` field itself is computed, not written. |

### Registration

| Field | Level | Meaning | Used by | History needed | Served by ReEx route today | In ReEx (stored) | In OJ / CM | Gap / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| registrationId | Registration | ReEx's id for the registration | UC2, UC3, UC4, UC9 (as a key) | None | Not served, held | `id` | OJ `registrationId`; CM `payload.operatorRegistrationId` | **OK** as a key. |
| registrationNumber | Registration | Public registration number (register "Registration number", for example `R26ER5000270036WO`) | UC1, UC2, UC3, UC4 | Current (plus previous numbers) | Served (the key) | `registrationNumber` (required once approved) | OJ `registrationReference` (server-owned), `previousRegistrationNumbers[]`; CM `payload.registrationNumber` | **Partial.** Two writers: OJ can generate or regenerate the number when CM asks (`…/registration-number`), so OJ's value is not only a copy of ReEx's. |
| wasteProcessingType | Registration | Reprocessor or exporter (register "Type") | UC1, UC2, UC3, UC5, UC8 | Current | Served | `wasteProcessingType` | OJ `wasteProcessingType`, `isExporter`; CM payload copy | **OK.** |
| material | Registration | Packaging waste category (Plastic, Paper and board, Glass-remelt, Glass-other …) | UC1, UC2, UC3, UC6, UC8 | Current | Served (glass split as `glass_re_melt` / `glass_other`) | `material` (plain `glass` for glass) plus `glassRecyclingProcess[]`; the register and route combine them | OJ `materialType` plus `glassRecyclingProcess`; CM `payload.material`, `glassRecyclingProcess` | **Partial.** The glass split is derived from the process list in ReEx's code; OJ and CM hold `Glass` plus a flag. |
| annexIIProcess | Registration | Recycling process code on the register: R3, R4 or R5 | UC1 | Current | Not served, derivable | Not stored. Derived from `material` in the register transformer (`getAnnexIIProcess`) | Not held | **OK**, as a derivation from material. |
| appropriateAgency | Registration | Regulator: EA, NRW, SEPA or NIEA | UC1, UC3 | Current | Served (`submittedToRegulator.code`) | `submittedToRegulator` (ea, nrw, sepa, niea) on the registration | OJ `nation`; CM `payload.nation` | **OK.** OJ and CM hold a nation, taken from the registration's regulator at seed (RA-526); mapping England, Wales, Scotland, NorthernIreland to the four agencies. |
| reprocessingSite | Registration | Registered reprocessing site address (reprocessors only) | UC1, UC2, UC3 | Current | Served (country, region not served) | `site.address` (`line1`, `postcode` required; also `gridReference`, `siteCapacity`) | OJ `siteAddress`; CM `payload.siteAddress`, `payload.siteAddressPostcode` | **OK** in ReEx. OJ and CM hold a snapshot string; the CM adapter extracts the postcode from it. |
| permitNumbers | Registration | Waste management permit numbers | UC1, UC3 | Current | Not served, held | `wasteManagementPermits[]` | OJ `permitNumbers[]`; CM payload copy | **OK.** Not a register column. |
| registrationStatus | Registration | approved, cancelled (also created, rejected before approval) | UC1, UC2, UC3, UC9 | Point-in-time | Served (`status`, `statusTimeline`) | `statusHistory[]` on the registration; a registration is never suspended | Not held | **OK** in ReEx. `applicationStatus` in OJ and CM is the application, not the registration. |
| registrationDates | Registration | Date the registration took effect, and any end | UC1, UC3, UC9 | Point-in-time | Served (`validFrom` only) | `validFrom` (required once approved). The registration schema has no `validTo` | Not held | **Partial.** A start date; an end is only visible as a `cancelled` entry in the status history. |
| registeredNotAccredited | Registration | A registration with no accreditation | UC1, UC2, UC3 | Current | Served (numbered registrations only) | Registrations exist independently; `accreditationId` is an optional link | Not representable (no application, no record) | **OK** in ReEx. |

### Accreditation

| Field | Level | Meaning | Used by | History needed | Served by ReEx route today | In ReEx (stored) | In OJ / CM | Gap / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| accreditationNumber | Accreditation | Public accreditation number (register "Accreditation No", for example `A26ER5000270063WO`) | UC1, UC2, UC3, UC4, UC5, UC6, UC7 | Current (plus previous numbers) | Served | `accreditationNumber` (required once approved or suspended) | OJ `accreditationReference` (server-owned), `previousAccreditationNumbers[]`; CM `payload.accreditationId` (written at approval) | **OK** in ReEx. In OJ and CM it exists only once an application is approved. |
| accreditationYear | Accreditation | The scheme year | UC1, UC2, UC3, UC8 | Current | Served (as the key) | Not stored. Derived: the year of `validFrom` (`deriveAccreditationYear`) | OJ `year`, `sourceYear`; CM `payload.accreditationYear`, `previousAccreditationYear` | **Partial.** CM re-stamps the year from the `Accreditation:CurrentYear` config at approval; do not treat it as a start date (QA bug recorded at `SlaService.cs:190`). |
| accreditationLink | Accreditation | Link between an application and an earlier accreditation | UC1, UC4, UC9 | Full history | Not served | ReEx holds one accreditation record per year per registration (`accreditationsForRegistration`) | OJ `sourceReExAccreditationId`, `sourceYear`, `previousAccreditationNumbers[]` point back at the ReEx accreditation | **Partial.** One OJ key joins an application to a ReEx accreditation. Neither model holds a single history spanning both. |
| activeDate | Accreditation | Date the accreditation takes effect (register "Active Date") | UC1, UC4, UC5, UC6, UC7 | Point-in-time | Not served, held | Accreditation `validFrom` (the register's Active Date is exactly this) | CM `payload.accreditationStartDate`, stamped at approval and derived from the configured year (**checked**). Not in OJ | **OK** in ReEx. **Partial** in CM: its value cannot hold the mid-year dates the register shows (for example 19/01/2026, 15/07/2026). |
| accreditationEndDate | Accreditation | Date the accreditation ends | UC1, UC4, UC5, UC6, UC7 | Point-in-time | Not served, held | Accreditation `validTo` (required once approved or suspended); kept after a cancellation | Not held (**checked**) | **OK** in ReEx. **Gap** in OJ and CM. |
| accreditationStatus | Accreditation | Approved, Suspended or Cancelled (register "Accreditation status") | UC1, UC2, UC3, UC4, UC9 | Point-in-time | Served (`status`) | Accreditation `statusHistory[]` (created, approved, suspended, cancelled, rejected); the current status is the latest entry | OJ `applicationStatus`; CM `stateId` (application lifecycle only) | **OK** in ReEx. **Gap** in OJ and CM: no suspended or cancelled state, and `Approved` is terminal in OJ. |
| statusLastChanged | Accreditation | Date the status last changed (register "Date status last changed") | UC1, UC3, UC9 | Current | Served (via statusTimeline, adjusted) | Accreditation `statusHistory[]`, `updatedAt` of the last entry (what the register publishes) | CM audit log; OJ `caseManagementStatusUpdatedAt` (last push only) | **OK** in ReEx. **Partial** in OJ and CM (application lifecycle only). The route's timeline moves the approval to `validFrom`, so its latest date can differ from the register's. On the register it is often earlier than Active Date (for example 31/12/2025 against 01/01/2026), so they are separate dates. |
| statusHistory | Accreditation | Dated status events that can be read at a date | UC4, UC9 | Full history | Served (via statusTimeline) | Accreditation `statusHistory[]`; ReEx already reads it at a date (`statusHeldAt`, `isSuspendedOrCancelledAtDate`) | CM audit log (application only; a display log, not a query surface) | **OK** in ReEx. **Gap** in OJ and CM: no suspend or cancel events can be recorded. |
| summaryLogClassification | Registration and accreditation | Which of the four summary log templates applies, and whether a row falls inside the accreditation | UC4 | Point-in-time | Not served; logic is in ReEx's backend | Template is "registered-only" when the registration has no linked accreditation number; each row must lie inside `validFrom`..`validTo` and outside any suspended or cancelled period at Date of export and Date received by overseas reprocessor (`isAccreditedAtDates`) | Not derivable | **OK** in ReEx. **Gap** in OJ and CM. |
| applicationStatus | Application | Where the application is in its lifecycle | UC2, UC3, UC9 | Current | Not served (unapproved records are not served) | Unapproved registrations and accreditations hold status `created` or `rejected` | OJ `applicationStatus` (driven partly by CM pushes); CM `stateId` | **OK.** OJ and CM can disagree if a push is lost (RA-606). |
| withdrawalReason | Application | Why an application was withdrawn | UC3 | Current | Not served | Not seen | OJ `withdrawalReason` | **OK** in OJ. |

### Overseas reprocessing sites (ORS) and interim sites (exporters)

The public register does not list ORS or interim sites, so these rows serve UC3 and UC5.

| Field | Level | Meaning | Used by | History needed | Served by ReEx route today | In ReEx (stored) | In OJ / CM | Gap / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orsId | ORS | Summary log `OSR_ID`: 3-digit ID of the approved overseas reprocessor | UC3, UC5 | None | Served (as the key) | Registration `overseasSites`, keyed by a 3-digit `orsId` and pointing at a shared overseas-site record (`overseasSiteId`) | OJ `overseasSites.sites[].orsId` (server-owned string); `siteId` (int) | **Partial.** The guidance says the regulator generates the ID on accreditation, unique to that operator. OJ allocates `orsId` itself for sites added in an application (`UpdateIfOrsIdAbsentAsync`); whether those match the regulator-issued ones was not established. Keep it a string (`001` is no longer reduced to `1`, template change of 19 Jan 2026). |
| ORS name | ORS | Summary log `OSR_NAME` | UC5 | Current | Served | Overseas-site `name` | OJ `siteName`; CM payload copy | **OK.** |
| ORS country | ORS | Summary log `OSR_COUNTRY` (drop-down, for example `Vietnam-VN`) | UC5 | Current | Served | Overseas-site `country` (free string) | OJ `country` (free text such as `Germany`); CM payload copy | **Partial.** The template's value format (name plus code) differs from what either system stores; no mapping exists. |
| ORS address, coordinates | ORS | Location of the site | UC3 | Current | Served | Overseas-site `address` (`line1`, `line2`, `townOrCity`, `stateOrRegion`, `postcode`), `coordinates` | OJ `siteAddress`, `addressLine1/2`, `townOrCity`, `coordinates`; CM payload copy | **OK.** ReEx-seeded sites carry only name, address, coordinates and approval date into OJ, so other details can be missing there (RA-597). |
| ORS isEu / isOecd | ORS | EU or OECD country | UC5 | Current | Not held | Not held (the overseas-site schema has no such flag) | OJ `isEu`, `isOecd`; CM payload copy | **OK** in OJ and CM; not in ReEx. Drives whether BES evidence is required. |
| ORS approval | ORS | Approved for this accreditation, and the date | UC5 | Point-in-time | Served (`approvedOn`, the same for every accreditation year) | Overseas-site `validFrom` (one nullable date per site). ReEx checks the site is approved at Date of export (`isOrsApprovedAtDate`) | OJ `validFrom` (raw ReEx ORS-A approval date) and `selected` (**checked**) | **Partial.** One date per site, not per accreditation year, and no end. In OJ, `selected` is inclusion in an application, not approval, and a site added in an application has no approval date. |
| ORS approvalEnd | ORS | End of a site's approval | UC5 | Point-in-time | Not held | Not held | Not held | **Gap.** |
| ORS Basel codes and operations | ORS | Summary log `BASEL_EXPORT_CODE`; what the site does | UC3, UC5 | Current | Not held | Not held. The summary log row's Basel code is validated as a value, not against a site | OJ `code1/2/3`, `operationCodes`, `repatriatedLoads`, `conditionsOfExport`; CM can correct `operationCodes` (audited) | **Partial.** Operator-entered in OJ only. |
| ORS BES evidence | ORS | Broadly equivalent standards evidence | UC3, UC5 | Point-in-time | Not held | Only the uploaded forms, as `orsFileUploads` file links on the registration and accreditation; no dates | OJ `besEvidence.besEvidenceUploads[]` with `besEvidenceValidFromDate`, `besEvidenceExpiryDate` | **Partial.** Validity periods exist in OJ only; file metadata only, files in S3. For steel and aluminium exported outside the EU to a non-OECD country, an exporter who agrees the log's conditions need not submit BES evidence but must still hold it, so an absent upload is not always a gap. |
| interimSite ID | Interim site | Summary log `INTERIM_SITE_ID`: 3-digit code | UC5 | None | Not held | Not held. ReEx only checks the row's ID has three digits when `DID_WASTE_PASS_THROUGH_AN_INTERIM_SITE` is Yes; it has no interim-site records | OJ `interimSites[].siteNumber` (string, `001` style); `siteId` (int) | **Partial.** In OJ only. The guidance says the regulators provide the ID during accreditation; OJ allocates `siteNumber` itself (`UpdateIfInterimSiteNumberAbsentAsync`). |
| interimSite details | Interim site | Name, address, country, contact, operations (R12/R13) | UC3, UC5 | Current | Not held | Not held | OJ `interimSites[]`: `siteName`, address, `country`, contact, `operationCodes` | **OK** in OJ only. |
| interimSite active period | Interim site | When the interim site was added and removed, and approved | UC5 | Point-in-time | Not held | Not held | OJ `createdAt`, `removedAt` (null means active; soft delete) | **Gap** for approval. **Partial** for an active period: `createdAt` is when the operator entered it and is null on legacy documents. |

### PRN tonnage band and signatories

| Field | Level | Meaning | Used by | History needed | Served by ReEx route today | In ReEx (stored) | In OJ / CM | Gap / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tonnageBand | Accreditation | Tonnage band (register: Up to 500, Up to 5,000, Up to 10,000, Over 10,000 tonnes) | UC1, UC2, UC3, UC6 | Point-in-time | Not served, held | Accreditation `prnIssuance.tonnageBand` (required). The register and PRN tonnage monitoring read it from the registration's resolved accreditation | OJ `prns.plannedTonnageBand` (UpTo500, UpTo5000, UpTo10000, Over10000); CM payload copy | **OK** in ReEx (one band per accreditation record). **Partial** in OJ and CM: the operator's **planned** band, not necessarily the approved one. Labels map one-to-one to the register's. |
| tonnageBand history | Accreditation | Earlier bands and when each applied | UC6 | Full history | Not held | One band per accreditation record (one per year per registration) | OJ `prns.versions[]` (snapshot at each submit and resubmit, `versionedAt`; never returned by the API) | **Partial.** A band per year, not per day; OJ's snapshots carry a submission time, not an effective date. |
| signatories | Accreditation | People authorised to sign PRNs | UC7 | Point-in-time | Not served, held | Accreditation `prnIssuance.signatories[]` (name, email, phone, job title; at least one). The org's `users[]` gets signatories' name and email with roles from the accreditation's current status | OJ `prns.authorisers[]` (`fullName`, `email`, `isNew`); CM payload copy | **Partial.** No identifier ties a person to a sign-in in any system. OJ and CM hold name and email only (no job title or phone). ReEx's PRN route infers the signatory actor from the PRN's status, "until the auth system carries actor identity". |
| signatory authorised period | Accreditation | When each person was authorised and when that ended | UC7 | Point-in-time | Not held | Not held (ReEx signatories carry no dates) | Not held; OJ history only in `prns.versions[]` (submission time) | **Gap.** With one accreditation record per year, "signatory for the accreditation" is answerable per year, not per day. |
| prnIssuanceGate | Accreditation | Whether PRNs may be issued now | UC6, UC7, UC9 | Current | Not served; logic is in ReEx's backend | ReEx blocks PRN issuing while the accreditation is `suspended` or `cancelled` (`issuanceRefusal`), using the current status | Not derivable | **OK** in ReEx (current status, not as at a date). **Gap** in OJ and CM. |

### Business plan, reports and annual reporting

| Field | Level | Meaning | Used by | History needed | Served by ReEx route today | In ReEx (stored) | In OJ / CM | Gap / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| businessPlan | Accreditation | Planned split of PRN income across seven categories, each with a description and an explanation | UC8 | Point-in-time (the plan for the year reported) | Not served, held | Accreditation `prnIssuance.incomeBusinessPlan[7]` (`percentIncomeSpent`, `usageDescription`, `detailedExplanation`); stored, read by nothing beyond the forms ingest | OJ `businessPlan`: seven `*Percent` ints, seven `*Detail` strings; CM payload copy | **Partial.** Percentages only, no amounts. In OJ, one plan per application year, with `versions[]` snapshots. |
| report submission dates | Accreditation | Date each monthly or quarterly report was submitted (register: Jan to Sep and Q1 to Q3 columns; `N/A` where not due) | UC1, UC8 | Full history | Not served | Reports module: periodic reports with `submittedAt` per period and submission number; the register shows the original submission date. Cadence is monthly when the registration has an accreditation number, otherwise quarterly | Not held | **OK** in ReEx. |
| actual activity | Accreditation | PRNs issued, income received and spent in the year | UC8 | Full history | Not served | Reports: PRN `issuedTonnage`, `averagePricePerTonne`, `totalRevenue`, `freeTonnage`; recycling and export activity tonnages (suppliers, overseas sites, refused, stopped, repatriated) | Not held | **Partial.** Income (`totalRevenue`) and tonnages are held in ReEx; spend by business plan category is not (no field), so UC8's plan-versus-actual comparison cannot be made. The waste balance module was not read. |
| complianceIssuesReported | Application | Count of compliance issues reported | UC8, UC3 | Current | Not served | Not seen | CM `payload.complianceIssuesReported` (written by OJ at submit) | **Partial.** Where OJ takes the value from was not traced. |

## What ReEx's route does not serve today, by use case

| Use case | Needs that the route does not serve |
| --- | --- |
| UC1 Public register | Companies House number, registered office, tonnage band and Active Date (`validFrom`) are held but not served; permits not served; report submission dates (reports module) not served. Annex II is derivable from material. The register's "Date status last changed" is the last raw `statusHistory` entry, which the served timeline can shift. |
| UC2 Operator dashboard | Contacts not served; application status for unapproved records not served; anything held only in OJ and CM. |
| UC3 Regulator dashboard | Contacts, permits, `approvedPersons` not served; ORS detail beyond name, address and coordinates; applications. |
| UC4 Accreditation status at a date | The route serves a status timeline, but not the accreditation `validFrom` / `validTo` window that ReEx's own validation uses. OJ and CM hold neither. |
| UC5 ORS and interim sites at a date | Per-site `approvedOn` is served (one date, no end, the same for every year). Interim sites, Basel codes, EU/OECD flags and BES evidence are not held in ReEx. |
| UC6 Tonnage band at issue | Tonnage band held but not served. |
| UC7 Signatory at signing | Signatories held but not served; authorised period not held. |
| UC8 Annual reporting | Business plan held but not served; report data not served; spend by category not held. |
| UC9 Status management | Registration and accreditation `statusTimeline` are served. OJ and CM cannot record suspend or cancel. |

## Gaps (for a separate ticket on how to source them)

**Held in none of the three systems**
- ORS approval end date, and approval per accreditation year (ReEx and OJ hold one `validFrom` per site).
- Regulator approval of an interim site, and an approval date for it (ReEx holds no interim-site records at all; OJ holds
  only what the operator entered).
- Signatory authorised period at day level; an identifier tying a signatory to a sign-in.
- Spend by business plan category (reports hold income and tonnage, not spend).

**Held in ReEx but not in OJ or CM** (matters if OJ or CM data has to serve these)
- Accreditation `validTo`, a start date that can be mid-year, and suspended or cancelled status with its history.
- The summary log and PRN issuing logic that depends on those.
- Trading name, `approvedPersons`, signatory job title and phone, registration status and start date.
- Reports (including submission dates) and PRNs.

**Held in OJ or CM but not in ReEx**
- ORS EU/OECD flags, Basel codes, operations and BES validity periods.
- Interim site records.
- Application lifecycle status, withdrawal reason and the CM audit log.

**Held, but not good enough**
- OJ and CM copies of organisation and registration data are seed-time snapshots.
- ReEx's served `statusTimeline` is built from `statusHistory` and moves the approval to `validFrom` ("until ADR-0051's
  events exist"), so it is not the raw history.
- Glass is `glass` plus a process flag in every stored source; the split is derived.
- ORS and interim site IDs are allocated by OJ; the guidance says the regulator issues them. The country value format differs from the summary log's.
- The operator's planned tonnage band (OJ, CM) is not necessarily the approved band.

**Not examined**
- The waste balance module, the forms-ingest transformation, PRN stored fields beyond status, and live data in either system.

**Held, but unreachable (OJ)**
- `prns.versions[]`, `previousSites` and the other `versions[]` are never returned by the API; the CM audit log is a display log, not a query surface.

## Open questions (not assumed anywhere above)

1. **Which years is each system the authority for?** The team's understanding is that ReEx holds accreditation data up
   to 2026 and OJ and CM hold 2027 onwards. Neither data model says so, so the table does not rely on it. If it holds,
   the "Held in ReEx but not in OJ or CM" gaps become gaps for 2027 onwards.
2. **Where do PRNs, reports and summary logs for later accreditations live?** The ReEx code has those modules; nothing in
   the data models says how an accreditation held only in OJ and CM reaches them.
3. **Should the API serve OJ and CM data as well as ReEx's?** Several rows depend on it.
