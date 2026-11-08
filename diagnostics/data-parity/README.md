# OJ vs CM parity

Read-only, point-in-time comparison of every application submitted from OJ (`epr-register-enrol-backend`) to CM
(`epr-register-enrol-management-be`). To run it, follow [RUNBOOK.md](RUNBOOK.md).

## Files

| File | Purpose |
| --- | --- |
| `scripts/oj-snapshot.js` | mongosh, OJ `accreditationApplications` -> JSONL |
| `scripts/cm-snapshot.js` | mongosh, CM `workItems` (`re-accreditation`) -> JSONL |
| `scripts/compare.mjs` | Offline diff -> CSV + PDF summary |
| `scripts/pdf.mjs` | Renders the summary to PDF (standard fonts, no dependencies) |
| `scripts/src/` | Sources. The two snapshot scripts are **generated** (`node scripts/build.mjs`) so both share one normaliser. Edit `src/`, rebuild, commit both. |

Both snapshot scripts replace every write method on the collection with a throw. The team has confirmed that the legacy
`accreditationApplications` collection is still the read path (RA-644 dual-write), so OJ is read from it.

## Scope and window

Only work items submitted from OJ are taken on the CM side: those whose `payload.operatorApplicationId` is set. Items
created another way (seed, legacy, manual) have none and are out of scope, so they never appear as `MISSING_IN_OJ`.

The optional `PARITY_START` / `PARITY_END` window (start inclusive, end exclusive) applies to `dateSent` on the OJ
application (`updatedAt` if `dateSent` was never set) and to `submittedAt` on the CM work item. Those are set a moment
apart, so a `MISSING_IN_CM` / `MISSING_IN_OJ` row right at a boundary can be an edge effect. The window is recorded in each
file's trailer and the summary, and the compare warns if the two files used different windows. Without a window the run
covers every submitted application.

## Privacy

Emails are masked (`a***@domain`) in every column of the CSVs by default. Names, phone numbers and addresses are **not**
masked, and the snapshot `.jsonl` files and archives hold every field in full, so treat all of them as production data
and follow the handling rules in [RUNBOOK.md](RUNBOOK.md). `--include-pii` disables masking and also writes
`parity-report.json`; it is refused unless you pass `--approved-by "<approver and ticket>"`, which is recorded in the
summary.

## Reading the report

`parity-report.csv` is the compact report: **one row per application**, with a `result` (`MATCH`, `DIFFERENCES`,
`MISSING_IN_CM`, `MISSING_IN_OJ`), an `issueCount`, one status per section (`OK`, `n differences`, or `not compared` for an
application missing on one side), a `status` column for the OJ/CM state check, and an `issues` cell listing every issue as
numbered lines. `parity-report-detailed.csv` has one row per difference, for filtering and pivoting.

Matched applications are included: every state and section with no difference gets a `MATCH` row (values shown as
`identical`) in the detailed CSV. Add `--differences-only` to drop them. Orphans (`MISSING_IN_*`) have no `MATCH` rows.

The `description` column (and the compact `issues` cell) says in plain words what differs: the section, the exact field or
item, and the OJ and CM values, e.g. `Business plan: other percent differs: OJ has 50, CM has 40.`,
`Authority to issue: authoriser zed@x.com is in CM but missing from OJ (CM has: full name "Zed", ...)` or
`Overseas sites: OJ has 2 overseas sites, CM has 1 overseas site.` The wording lives in `scripts/describe.mjs`.

`differenceType`: `MISSING_IN_CM`, `MISSING_IN_OJ`, `IDENTITY_BREAK`, `SECTION_ABSENT_CM/OJ`, `VALUE_DIFF`,
`ITEM_MISSING_CM/OJ`, `COUNT_DIFF`, plus informational `STATE_MISMATCH` / `STATE_UNMAPPED` (section `state`; a failed
status push is tagged). Filter on `likelyCause`:

- `query-after-duly-made` - CM audit shows a `query-during-duly-made` query and a response: the likeliest defect cohort.
  Uses the last `application-queried` entry only.
- `cm-edited-operation-codes` - CM users may change recycling codes by design.
- `oj-edit-not-resubmitted` / `oj-post-decision-edit` - OJ changed after CM last did; the snapshot gap or a mid-edit.

When none of those apply, every difference row still gets one fallback cause, taken from the row itself (first that
fits):

- `not-transferred-to-cm` - OJ application with no CM work item (`MISSING_IN_CM`).
- `cm-only-work-item` - CM work item with no OJ application (`MISSING_IN_OJ`).
- `id-link-broken` - the OJ and CM IDs do not point at each other (`IDENTITY_BREAK`).
- `changed-between-snapshots` - OJ or CM changed after the first snapshot was taken, before the second.
- `cm-edited-after-submission` - CM was last changed after OJ was.
- `section-not-transferred` - a whole section is on one side only (`SECTION_ABSENT_*`).
- `transfer-or-mapping-difference` - none of the above: OJ and CM hold different values and no later edit explains it.
  These are the rows to look at first for transfer or mapping defects.

## What is compared

Everything CM shows the regulator that OJ supplies, except the two columns used to match records (OJ `_id` / CM
`payload.operatorApplicationId`, and `caseManagementWorkItemId` / CM `_id`):

- **application-details** (case header, summary header rows, Additional information tab): application reference,
  organisation name, organisation number, registration number, glass recycling process, waste processing type
  (exporter / reprocessor), charge amount, Companies House number, registered address, site address and postcode, permit
  numbers, and the contact's full name, email, phone and job title.
- **business-plan**: all seven percentages and seven narrative fields.
- **prn-tonnage** and **authority-to-issue** (name, email, new flag).
- **sampling-plan** and **bes-evidence** files: id, filename, scan status, S3 key, upload date (and BES validity dates).
- **overseas-sites**: every field CM shows for an ORS (address lines, ORS id, coordinates, contact, operation codes,
  Basel/OECD codes, repatriated loads, conditions of export, registered-now-accredited, EU/OECD, new flag) and for each
  active interim site (number, name, new flag, full address, contact, operation codes).

Not compared: material (OJ and CM name materials differently; it is shown as an identity column only), and, because CM
does not show them or they are CM's own: assignee, SLA due date, payment date, status history
(state itself is checked separately), file content type, bucket and size (OJ stores no size), withdrawn interim sites.

Notes:

- OJ is projected like `BuildPayload`: only `selected` sites and active interim sites, so an unselected OJ site never
  appears. `BuildPayload` always sends all four object sections (business plan, PRNs, sampling plan, overseas sites),
  using empty defaults when the OJ document has none, so the OJ snapshot does the same and a missing OJ element is not
  reported as a missing section.
- The charge is not stored in OJ, so the OJ snapshot recomputes it with a port of `AccreditationChargeCalculator`; update
  `TONNAGE_FEES_POUNDS` / `OVERSEAS_SITE_FEE_POUNDS` in `src/oj.body.js` if the fees change. The site-address postcode is
  likewise a port of `ExtractPostcode`.
- `isNewSite` differences surface as `VALUE_DIFF` (see the RA-292 audit).

## Tests

`node --test scripts/test/*.test.mjs` (unit tests, no database needed). The snapshot scripts were also dry-run with
mongosh against throwaway local databases seeded with known divergences; exactly those rows were reported.
