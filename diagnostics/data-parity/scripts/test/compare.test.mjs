import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, decodeText, parseSnapshot, toCsv, toSummary, SECTIONS } from '../compare.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const shared = readFileSync(join(here, '..', 'src', 'shared.js'), 'utf8')
const { normaliseSections } = new Function(`${shared}; return { normaliseSections }`)()

const plan = (over = {}) => ({
  newInfrastructurePercent: 10, priceSupportPercent: 10, businessCollectionsPercent: 10, communicationsPercent: 10,
  newMarketsPercent: 10, newUsesPercent: 10, otherPercent: 40, newInfrastructureDetail: 'a', ...over
})
const payload = (over = {}) => ({
  businessPlan: plan(),
  prns: { plannedTonnageBand: 'UpTo500', authorisers: [{ fullName: 'Ann', email: 'Ann@x.com', isNew: false }] },
  samplingPlan: { files: [{ fileId: 'f1', filename: 'a.pdf', s3Key: 'k1', scanStatus: 'Clean', uploadedAt: '2026-01-01' }] },
  overseasSites: {
    sites: [{
      siteId: 's1', orsId: 'ORS1', siteName: 'Site', operationCodes: ['R3', 'R1'], isNewSite: false,
      besEvidence: { files: [{ fileId: 'b1', filename: 'b.pdf', s3Key: 'bk', scanStatus: 'Clean' }] }
    }]
  },
  ...over
})

const rec = (service, p, { state = 'DulyMade', app = 'a1', wi = 'w1', updatedAt = '2026-01-01T00:00:00.000Z', audit } = {}) => ({
  snapshot: { service, takenAt: '2026-11-04T10:00:00Z', scriptVersion: 1 },
  key: { applicationId: app, workItemId: wi },
  identity: { applicationReference: 'RA-1', organisationName: 'Org', orgNumber: 1, registrationNumber: 'R', accreditationNumber: 'A', material: 'glass' },
  state: { raw: state, normalised: state, updatedAt },
  ...(audit ? { audit } : {}),
  sections: normaliseSections(p)
})
const run = (oj, cm) => compare(Array.isArray(oj) ? oj : [oj], Array.isArray(cm) ? cm : [cm], { ojTakenAt: '2026-11-04T10:00:00Z', cmTakenAt: '2026-11-04T10:05:00Z', includeMatches: false })
const types = (r) => r.rows.map((x) => x.differenceType)

test('identical data gives zero rows (parity control)', () => {
  const r = run(rec('OJ', payload()), rec('CM', payload(), { state: 'duly-made' }))
  assert.deepEqual(r.rows, [])
  assert.equal(r.gap, 300)
})

test('normalisation: null vs absent, ordering, email case, enum ints', () => {
  const cm = payload({
    businessPlan: plan({ newInfrastructureDetail: '  a ', priceSupportDetail: '' }),
    prns: { plannedTonnageBand: 0, authorisers: [{ fullName: 'Ann', email: 'ann@X.com', isNew: false }] }
  })
  cm.overseasSites.sites[0].operationCodes = ['R1', 'R3']
  cm.samplingPlan.files[0].scanStatus = 1
  assert.deepEqual(run(rec('OJ', payload()), rec('CM', cm, { state: 'duly-made' })).rows, [])
})

test('business plan VALUE_DIFF names the field', () => {
  const r = run(rec('OJ', payload()), rec('CM', payload({ businessPlan: plan({ otherPercent: 41 }) }), { state: 'duly-made' }))
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].section, 'business-plan')
  assert.equal(r.rows[0].fieldPath, 'businessPlan.otherPercent')
  assert.equal(r.rows[0].ojValue, 40)
  assert.equal(r.rows[0].cmValue, 41)
})

test('prn tonnage and authoriser differences', () => {
  const cm = payload({ prns: { plannedTonnageBand: 'Over10000', authorisers: [] } })
  const r = run(rec('OJ', payload()), rec('CM', cm, { state: 'duly-made' }))
  assert.deepEqual(types(r).sort(), ['COUNT_DIFF', 'ITEM_MISSING_CM', 'VALUE_DIFF'])
})

test('sampling file removed in CM; uploadedAt ignored', () => {
  const cm = payload({ samplingPlan: { files: [] } })
  const r = run(rec('OJ', payload()), rec('CM', cm, { state: 'duly-made' }))
  assert.deepEqual(types(r).sort(), ['COUNT_DIFF', 'ITEM_MISSING_CM'])
})

test('BES files differ for a shared site; site missing is reported once under overseas-sites', () => {
  const cm = payload()
  cm.overseasSites.sites[0].besEvidence.files = []
  const r1 = run(rec('OJ', payload()), rec('CM', cm, { state: 'duly-made' }))
  assert.ok(r1.rows.every((x) => x.section === 'bes-evidence'))
  assert.ok(types(r1).includes('ITEM_MISSING_CM'))
  const r2 = run(rec('OJ', payload()), rec('CM', payload({ overseasSites: { sites: [] } }), { state: 'duly-made' }))
  assert.deepEqual([...new Set(r2.rows.map((x) => x.section))], ['overseas-sites'])
})

test('section absent on one side', () => {
  const r = run(rec('OJ', payload()), rec('CM', payload({ samplingPlan: undefined }), { state: 'duly-made' }))
  assert.equal(types(r)[0], 'SECTION_ABSENT_CM')
  assert.equal(r.rows[0].ojValue, 'section present')
  assert.equal(r.rows[0].cmValue, 'section missing')
})

test('operation codes edit is tagged', () => {
  const cm = payload()
  cm.overseasSites.sites[0].operationCodes = ['R1']
  const r = run(rec('OJ', payload()), rec('CM', cm, { state: 'duly-made', audit: { hasRecyclingOpsUpdate: true } }))
  assert.equal(r.rows[0].likelyCause, 'cm-edited-operation-codes')
})

test('query-after-duly-made, oj-edit-not-resubmitted and post-decision tags', () => {
  const diff = payload({ businessPlan: plan({ otherPercent: 1 }) })
  const a = run(rec('OJ', payload()), rec('CM', diff, { state: 'duly-made', audit: { lastQueryAction: 'query-during-duly-made', queryRespondedAt: ['x'] } }))
  assert.equal(a.rows[0].likelyCause, 'query-after-duly-made')
  const later = '2026-02-01T00:00:00.000Z'
  const b = run(rec('OJ', payload(), { state: 'Queried', updatedAt: later }), rec('CM', diff, { state: 'queried' }))
  assert.equal(b.rows[0].likelyCause, 'oj-edit-not-resubmitted')
  const c = run(rec('OJ', payload(), { state: 'Approved', updatedAt: later }), rec('CM', diff, { state: 'approved' }))
  assert.equal(c.rows[0].likelyCause, 'oj-post-decision-edit')
})

test('state mismatch and unmapped are informational rows', () => {
  const a = run(rec('OJ', payload(), { state: 'Submitted' }), rec('CM', payload(), { state: 'duly-made', audit: { statusPushFailed: true } }))
  assert.equal(a.rows[0].differenceType, 'STATE_MISMATCH')
  assert.equal(a.rows[0].likelyCause, 'status-push-failed')
  const b = run(rec('OJ', payload()), rec('CM', payload(), { state: 'weird' }))
  assert.equal(b.rows[0].differenceType, 'STATE_UNMAPPED')
  const ok = run(rec('OJ', payload(), { state: 'AwaitingDecision' }), rec('CM', payload(), { state: 'approved-pending-contact' }))
  assert.deepEqual(ok.rows, [])
})

test('orphans on each side and identity breaks', () => {
  const orphan = run([rec('OJ', payload())], [rec('CM', payload(), { app: 'zz', wi: 'zz' })])
  assert.deepEqual(types(orphan).sort(), ['MISSING_IN_CM', 'MISSING_IN_OJ'])
  const brk = run(
    [rec('OJ', payload(), { app: 'a1', wi: 'w2' })],
    [rec('CM', payload(), { app: 'a1', wi: 'w1', state: 'duly-made' }), rec('CM', payload(), { app: 'a2', wi: 'w2', state: 'duly-made' })]
  )
  assert.deepEqual(types(brk), ['IDENTITY_BREAK'])
  const half = run([rec('OJ', payload(), { app: 'a1', wi: null })], [rec('CM', payload(), { state: 'duly-made' })])
  assert.deepEqual(types(half), ['IDENTITY_BREAK'])
})

test('truncated or mismatched snapshot files are refused', () => {
  const line = JSON.stringify(rec('OJ', payload()))
  assert.throws(() => parseSnapshot(line + '\n', 'oj', 'OJ'), /truncated/)
  const trailer = (n, svc = 'OJ') => JSON.stringify({ trailer: true, service: svc, count: n, takenAt: 't', scriptVersion: 1 })
  assert.throws(() => parseSnapshot(`${line}\n${trailer(2)}\n`, 'oj', 'OJ'), /truncated/)
  assert.throws(() => parseSnapshot(`${line}\n${trailer(1, 'CM')}\n`, 'oj', 'OJ'), /expected OJ/)
  assert.equal(parseSnapshot(`${line}\n${trailer(1)}\n`, 'oj', 'OJ').records.length, 1)
})

test('CSV masks emails by default and truncates long values', () => {
  const cm = payload({ prns: { plannedTonnageBand: 'UpTo500', authorisers: [] } })
  const r = run(rec('OJ', payload()), rec('CM', cm, { state: 'duly-made' }))
  const masked = toCsv(r.rows)
  assert.ok(!masked.includes('Ann@x.com'))
  assert.ok(masked.includes('A***@x.com'))
  assert.ok(toCsv(r.rows, { includePii: true }).includes('Ann@x.com'))
  const long = payload({ businessPlan: plan({ newInfrastructureDetail: 'z'.repeat(900) }) })
  const csv = toCsv(run(rec('OJ', payload()), rec('CM', long, { state: 'duly-made' })).rows)
  assert.ok(!csv.includes('z'.repeat(501)))
})

test('every section is covered', () => {
  assert.deepEqual(Object.keys(normaliseSections(payload())), SECTIONS)
})

test('snapshot files written by PowerShell (UTF-16 BOM) or with a UTF-8 BOM are decoded', () => {
  const line = JSON.stringify({ trailer: true, service: 'OJ', count: 0, takenAt: 't', scriptVersion: 1 })
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line + '\r\n', 'utf16le')])
  const bom8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(line)])
  for (const buf of [utf16, bom8, Buffer.from(line)]) {
    assert.equal(parseSnapshot(decodeText(buf), 'oj', 'OJ').trailer.count, 0)
  }
})

test('matches are included by default: a MATCH row per state and section with no difference', () => {
  const meta = { ojTakenAt: 't', cmTakenAt: 't' }
  const same = compare([rec('OJ', payload())], [rec('CM', payload(), { state: 'duly-made' })], meta)
  assert.equal(same.rows.length, SECTIONS.length + 1)
  assert.ok(same.rows.every((r) => r.differenceType === 'MATCH'))
  assert.deepEqual(same.rows.map((r) => r.section), ['state', ...SECTIONS])
  assert.equal(same.rows[1].ojValue, 'identical')
})

test('with a difference, only the differing section loses its MATCH row; orphans get none', () => {
  const meta = { ojTakenAt: 't', cmTakenAt: 't' }
  const r = compare([rec('OJ', payload())], [rec('CM', payload({ businessPlan: plan({ otherPercent: 41 }) }), { state: 'duly-made' })], meta)
  const matches = r.rows.filter((x) => x.differenceType === 'MATCH').map((x) => x.section)
  assert.ok(!matches.includes('business-plan'))
  assert.equal(matches.length, SECTIONS.length) // state + the five other sections
  assert.equal(r.rows.filter((x) => x.differenceType === 'VALUE_DIFF').length, 1)
  const orphan = compare([rec('OJ', payload())], [], meta)
  assert.deepEqual(orphan.rows.map((x) => x.differenceType), ['MISSING_IN_CM'])
})

const details = (over = {}) => ({
  applicationReference: 'RA-1', organisationName: 'Org', operatorOrgNumber: 5, registrationNumber: 'R', material: 'glass',
  wasteProcessingType: 'exporter', chargeAmountPence: 54600, companiesHouseNumber: '123', companyRegisteredAddress: '1 High St',
  siteAddress: '2 Low Rd, AB1 2CD', siteAddressPostcode: 'AB1 2CD', permitNumbers: ['P1', 'P2'],
  submitterContactDetails: { fullName: 'Sam', email: 'sam@x.com', phone: '01', jobTitle: 'Dir' }, ...over
})

test('application-details: every shown field is compared, nested contact fields individually', () => {
  const o = rec('OJ', payload(details()))
  const cm = rec('CM', payload(details({
    organisationName: 'Other', chargeAmountPence: 1, permitNumbers: ['P1'], material: 'plastic', // material is not compared
    submitterContactDetails: { fullName: 'Sam', email: 'sam@y.com', phone: '01', jobTitle: 'Dir' }
  })), { state: 'duly-made' })
  const paths = run(o, cm).rows.map((r) => r.fieldPath).sort()
  assert.deepEqual(paths, [
    'application.chargeAmountPence', 'application.contact.email', 'application.organisationName', 'application.permitNumbers'
  ])
})

test('file uploadedAt and the extra interim-site fields are compared', () => {
  const oj = payload()
  oj.overseasSites.sites[0].interimSites = [{ siteNumber: 1, siteName: 'I', postcode: 'P1', contactEmail: 'a@x.com', operationCodes: ['R13', 'R12'] }]
  const cmP = payload()
  cmP.samplingPlan.files[0].uploadedAt = '2026-02-02T00:00:00Z'
  cmP.overseasSites.sites[0].interimSites = [{ siteNumber: 1, siteName: 'I', postcode: 'P2', contactEmail: 'a@x.com', operationCodes: ['R12', 'R13'] }]
  const paths = run(rec('OJ', oj), rec('CM', cmP, { state: 'duly-made' })).rows.map((r) => r.fieldPath).sort()
  assert.deepEqual(paths, ['overseasSites.sites[ORS1].interimSites[1].postcode', 'samplingPlan.files[f1].uploadedAt'])
})

test('descriptions say exactly what differs, per section', () => {
  const oj = payload(details())
  oj.overseasSites.sites[0].interimSites = [{ siteNumber: 1, siteName: 'I', postcode: 'P1' }]
  oj.prns.authorisers.push({ fullName: 'Bob', email: 'bob@x.com', isNew: true })
  const cmP = payload(details({ organisationName: 'Other', submitterContactDetails: { fullName: 'Sam', email: 'new@x.com', phone: '01', jobTitle: 'Dir' } }))
  cmP.businessPlan = plan({ otherPercent: 41 })
  cmP.prns.plannedTonnageBand = 'Over10000'
  cmP.samplingPlan.files = []
  cmP.overseasSites.sites[0].operationCodes = ['R1']
  cmP.overseasSites.sites[0].interimSites = [{ siteNumber: 1, siteName: 'I', postcode: 'P2' }]
  cmP.overseasSites.sites[0].besEvidence.files[0].scanStatus = 'Infected'
  const desc = run(rec('OJ', oj), rec('CM', cmP, { state: 'duly-made' })).rows.map((r) => r.description)
  const has = (text) => assert.ok(desc.includes(text), `missing: ${text}\nin:\n${desc.join('\n')}`)
  has('Application details: organisation name differs: OJ has "Org", CM has "Other".')
  has('Application details: contact email differs: OJ has "sam@x.com", CM has "new@x.com".')
  has('Business plan: other percent differs: OJ has 40, CM has 41.')
  has('PRN tonnage: planned tonnage band differs: OJ has "UpTo500", CM has "Over10000".')
  has('Authority to issue: OJ has 2 authorisers, CM has 1 authoriser.')
  has('Authority to issue: authoriser bob@x.com is in OJ but missing from CM (OJ has: full name "Bob", email "bob@x.com", new flag true).')
  has('Sampling plan: file f1 is in OJ but missing from CM (OJ has: file ID "f1", filename "a.pdf", S3 key "k1", scan status "Clean", upload date "2026-01-01T00:00:00.000Z").')
  has('Overseas sites: operation codes for overseas site ORS1 differs: OJ has ["R1", "R3"], CM has ["R1"].')
  has('Sampling plan: OJ has 1 file, CM has 0 files.')
  has('Overseas sites: postcode for interim site 1 of overseas site ORS1 differs: OJ has "P1", CM has "P2".')
  has('BES evidence: scan status for BES evidence file b1 of overseas site ORS1 differs: OJ has "Clean", CM has "Infected".')
})

test('descriptions for orphans, state and matches', () => {
  const meta = { ojTakenAt: 't', cmTakenAt: 't' }
  const a = compare([rec('OJ', payload(), { state: 'Submitted' })], [rec('CM', payload(), { state: 'duly-made' })], meta).rows
  assert.equal(a.find((r) => r.differenceType === 'STATE_MISMATCH').description,
    'OJ status is "Submitted" but CM state is "duly-made", which should show in OJ as "DulyMade".')
  assert.equal(a.find((r) => r.section === 'business-plan').description, 'Business plan: identical in OJ and CM.')
  const o = compare([rec('OJ', payload())], [rec('CM', payload(), { app: 'z', wi: 'z' })], meta).rows.map((r) => r.description)
  assert.ok(o[0].startsWith('Submitted in OJ, but no CM work item matches'))
  assert.ok(o[1].startsWith('In CM with an OJ application ID, but no OJ application matches'))
})

test('compact report: one row per application with every issue in a single cell', async () => {
  const { toCompactRows } = await import('../compact.mjs')
  const { toCompactReport } = await import('../compare.mjs')
  const meta = { ojTakenAt: 't', cmTakenAt: 't' }
  const clean = [rec('OJ', payload(), { app: 'a1', wi: 'w1' }), rec('OJ', payload(), { app: 'a2', wi: 'w2' }), rec('OJ', payload(), { app: 'a3', wi: 'w3' })]
  const cmRecs = [
    rec('CM', payload(), { app: 'a1', wi: 'w1', state: 'duly-made' }),
    rec('CM', payload({ businessPlan: plan({ otherPercent: 41 }), prns: { plannedTonnageBand: 'Over10000', authorisers: [] } }), { app: 'a2', wi: 'w2', state: 'duly-made' })
  ]
  const result = compare(clean, cmRecs, meta)
  const rows = toCompactRows(result.rows)
  assert.equal(rows.length, 3) // one per application, not one per difference
  const [ok, bad, orphan] = rows
  assert.equal(ok.result, 'MATCH')
  assert.equal(ok.issueCount, 0)
  assert.equal(bad.result, 'DIFFERENCES')
  assert.equal(bad['business-plan'], '1 difference')
  assert.equal(bad['prn-tonnage'], '1 difference')
  assert.equal(bad['authority-to-issue'], '2 differences') // count row + missing item
  assert.equal(bad['sampling-plan'], 'OK')
  assert.equal(bad.issueCount, 4)
  assert.equal(bad.issues.split('\n').length, 4)
  assert.ok(bad.issues.startsWith('1. Business plan: other percent differs'))
  assert.equal(orphan.result, 'MISSING_IN_CM')
  assert.equal(orphan['business-plan'], 'not compared')
  const csv = toCompactReport(result.rows)
  assert.equal(csv.trim().split('\n').length > 4, true) // multi-line issues cell is quoted, not split into rows
  assert.ok(!csv.includes('ann@x.com') || csv.includes('a***@x.com'))
})

test('--include-pii is refused without an approver and the approver is recorded in the summary', async () => {
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'parity-pii-'))
  const trailer = (service) => JSON.stringify({ trailer: true, service, count: 0, takenAt: '2026-11-05T10:00:00.000Z', scriptVersion: 1, window: { start: null, end: null } })
  writeFileSync(join(dir, 'oj.jsonl'), trailer('OJ') + '\n')
  writeFileSync(join(dir, 'cm.jsonl'), trailer('CM') + '\n')
  const run = (...extra) =>
    spawnSync(process.execPath, [join(here, '..', 'compare.mjs'), join(dir, 'oj.jsonl'), join(dir, 'cm.jsonl'), '--out', join(dir, 'out'), ...extra], { encoding: 'utf8' })
  const refused = run('--include-pii')
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, /--approved-by/)
  assert.equal(run('--include-pii', '--approved-by').status, 2)
  const ok = run('--include-pii', '--approved-by', 'J Smith DPO-1')
  assert.equal(ok.status, 0)
  const pdf = readFileSync(join(dir, 'out', 'parity-summary.pdf'), 'latin1')
  assert.ok(pdf.startsWith('%PDF-1.4'))
  assert.match(pdf, /UNMASKED PERSONAL DATA/)
  assert.match(pdf, /DPO-1/)
  // Readers of the summary do not have the run book, so the retention rule is stated in full.
  assert.match(pdf, /no later than 14 days/)
  assert.doesNotMatch(pdf, /run book/)
  assert.equal(existsSync(join(dir, 'out', 'parity-summary.md')), false)
  for (const ext of ['docx', 'xlsx']) assert.equal(existsSync(join(dir, 'out', `parity-summary.${ext}`)), false)
  assert.equal(run().status, 0)
})

test('known glassRecyclingProcess label/code pairs (OJ Remelt/Other vs CM glass_re_melt/glass_other) are not differences', () => {
  for (const [oj, cm] of [['Remelt', 'glass_re_melt'], ['Other', 'glass_other']]) {
    const r = run(rec('OJ', payload(details({ glassRecyclingProcess: oj }))), rec('CM', payload(details({ glassRecyclingProcess: cm })), { state: 'duly-made' }))
    assert.deepEqual(r.rows.filter((x) => x.fieldPath === 'application.glassRecyclingProcess'), [])
  }
  const bad = run(rec('OJ', payload(details({ glassRecyclingProcess: 'Remelt' }))), rec('CM', payload(details({ glassRecyclingProcess: 'glass_other' })), { state: 'duly-made' }))
  assert.equal(bad.rows.filter((x) => x.fieldPath === 'application.glassRecyclingProcess').length, 1)
})

test('summary counts applications by state, with identical pairs included under --differences-only', () => {
  const op = (v) => payload({ businessPlan: plan({ otherPercent: v }) })
  const oj = [
    rec('OJ', payload(), { app: 'a1', wi: 'w1' }),
    rec('OJ', op(1), { app: 'a2', wi: 'w2' }),
    rec('OJ', payload(), { app: 'a3', wi: 'w3', state: 'Approved' }),
    rec('OJ', payload(), { app: 'a4', wi: 'w4' })
  ]
  const cm = [
    rec('CM', payload(), { app: 'a1', wi: 'w1', state: 'duly-made' }),
    // Two differences in two sections, still one application.
    rec('CM', { ...op(2), samplingPlan: { files: [] } }, { app: 'a2', wi: 'w2', state: 'duly-made' }),
    rec('CM', payload(), { app: 'a3', wi: 'w3', state: 'queried' })
  ]
  const r = run(oj, cm)
  const md = toSummary(r, { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  assert.match(md, /### OJ applications by status\n\n\| OJ status \| Applications \| % of total \|\n\| --- \| --- \| --- \|\n\| DulyMade \| 3 \| 75\.0% \|\n\| Approved \| 1 \| 25\.0% \|\n\| \*\*Total\*\* \| \*\*4\*\* \| 100\.0% \|/)
  assert.doesNotMatch(md, /### CM work items by state/)
  // a2 (data), a3 (status), a4 (missing in CM).
  assert.match(md, /3 applications do not fully match between OJ and CM/)
  assert.match(md, /- In one system but not the other: 1\n- Found in both, but the link between them is inconsistent \(IDENTITY_BREAK\): 0\n- Application data differs in at least one section: 1\n- Status does not match: 1/)
  // Status is reported in its own section, not as a data section.
  assert.match(md, /### By section\n\n.*\n.*\n\| business-plan \| 1 \| 33\.3% \|\n\| sampling-plan \| 1 \| 33\.3% \|\n\n/)
  assert.doesNotMatch(md, /\| state( \/ \w+)? \|/)
  assert.match(md, /### Status differences\n\nThere are status differences between OJ and CM: 1 application has a status in OJ that does not match CM\.\n/)
  assert.doesNotMatch(md, /How CM states translate|OJ should show \|/)
  const clean = toSummary(run(rec('OJ', payload()), rec('CM', payload(), { state: 'duly-made' })), { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  assert.match(clean, /### Status differences\n\nThere are no status differences between OJ and CM\.\n/)
  assert.match(md, /\| business-plan \/ VALUE_DIFF \| 1 \| 33\.3% \|/)
})

test('top differing applications say where the differences are in one line', () => {
  const ref = (r, applicationReference) => ({ ...r, identity: { ...r.identity, applicationReference } })
  const op = (v) => payload({ businessPlan: plan({ otherPercent: v, newMarketsPercent: v }) })
  const oj = [ref(rec('OJ', payload(), { app: 'a1', wi: 'w1' }), 'RA-1'), ref(rec('OJ', payload(), { app: 'a2', wi: 'w2' }), 'RA-2')]
  const cm = [ref(rec('CM', { ...op(1), samplingPlan: { files: [] } }, { app: 'a1', wi: 'w1', state: 'queried' }), 'RA-1')]
  const md = toSummary(run(oj, cm), { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  const line = (k) => md.split('\n').find((l) => l.includes(`| ${k} |`) && l.split('|').length === 7)
  assert.match(md, /\| # \| Application \| CM state \| Rows \| Where the differences are \|/)
  // Numbered from 1, most rows first; CM state before the row count ("-" when there is no CM work item).
  assert.match(line('RA-1'), /^\| 1 \| RA-1 \| queried \| 4 \| business-plan: 2 VALUE_DIFF; sampling-plan: 1 COUNT_DIFF, 1 ITEM_MISSING_CM; status: OJ should show Queried \(CM queried\), OJ shows DulyMade \|$/)
  assert.equal(line('RA-2'), '| 2 | RA-2 | - | 1 | MISSING_IN_CM |')
})

test('row breakdowns each total the quoted number of difference rows, ITEM_MISSING_* included', () => {
  const op = (v) => payload({ businessPlan: plan({ otherPercent: v, newMarketsPercent: v }) })
  const oj = [rec('OJ', payload(), { app: 'a1', wi: 'w1' }), rec('OJ', payload(), { app: 'a2', wi: 'w2' })]
  // a1: 2 business-plan values, sampling-plan count + ITEM_MISSING_CM, and a status difference; a2: missing in CM.
  const cm = [rec('CM', { ...op(1), samplingPlan: { files: [] } }, { app: 'a1', wi: 'w1', state: 'queried' })]
  const md = toSummary(run(oj, cm), { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  assert.match(md, /\| sampling-plan \/ ITEM_MISSING_CM \| 1 \|/)
  assert.doesNotMatch(md, /left out of this summary/)
  assert.match(md, /- Total rows: 6 \(MATCH rows: 0; status rows: 1; difference rows: 5\)/)
  assert.match(md, /There are 5 difference rows/)
  const tables = md.split('### ').filter((s) => s.startsWith('Difference rows by'))
  assert.equal(tables.length, 3)
  assert.ok(!tables.some((t) => t.startsWith('Difference rows by issue')))
  for (const t of tables) assert.match(t, /\| \*\*Total\*\* \| \*\*5\*\* \| 100\.0% \|/, t.split('\n')[0])
  assert.match(md, /\| \(no section: application missing on one side or identity break\) \| 1 \| 20\.0% \|/)
  assert.match(md, /\| \(no CM work item\) \| 1 \| 20\.0% \|/)
})

test('a swapped file (same count, different id) is counted as a difference in the summary', () => {
  const cm = payload({ samplingPlan: { files: [{ fileId: 'f2', filename: 'a.pdf', s3Key: 'k1', scanStatus: 'Clean', uploadedAt: '2026-01-01' }] } })
  const r = run(rec('OJ', payload()), rec('CM', cm, { state: 'duly-made' }))
  assert.deepEqual(types(r).sort(), ['ITEM_MISSING_CM', 'ITEM_MISSING_OJ'])
  const md = toSummary(r, { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  assert.match(md, /- Applications with at least one difference \(section, status, or missing on one side\): 1/)
  assert.match(md, /- Matched applications with no difference in any section \(status differences aside\): 0 of 1/)
})

test('one CM work item is never matched to two OJ applications, and the identical count never goes negative', () => {
  // a1 and a2 both point at work item w1 (a2 by workItemId only).
  const r = run(
    [rec('OJ', payload(), { app: 'a1', wi: 'w1' }), rec('OJ', payload(), { app: 'a2', wi: 'w1' })],
    [rec('CM', payload(), { app: 'a1', wi: 'w1', state: 'duly-made' })]
  )
  assert.equal(r.matched, 1)
  assert.equal(r.identical, 1)
  const dup = r.rows.find((x) => x.ojApplicationId === 'a2')
  assert.equal(dup.differenceType, 'IDENTITY_BREAK')
  assert.match(dup.cmValue, /already matched to OJ application a1/)
  // Conflicting links: not counted as matched, so the identical count stays within 0..matched.
  const brk = run(
    [rec('OJ', payload(), { app: 'a1', wi: 'w2' })],
    [rec('CM', payload(), { app: 'a1', wi: 'w1', state: 'duly-made' }), rec('CM', payload(), { app: 'a2', wi: 'w2', state: 'duly-made' })]
  )
  assert.equal(brk.matched, 0)
  assert.equal(brk.identical, 0)
  const md = toSummary(brk, { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  assert.match(md, /status differences aside\): 0 of 0/)
})

test('email masking keeps apostrophes in the local part hidden', async () => {
  const { maskEmail } = await import('../compare.mjs')
  assert.equal(maskEmail("john.o'neil@x.com"), 'j***@x.com')
  assert.equal(maskEmail("'ann@x.com'"), "'a***@x.com'")
  assert.equal(maskEmail('["ann@x.com","bob@y.com"]'), '["a***@x.com","b***@y.com"]')
})

test('applications with differences are counted once and the removed breakdown tables are not shown', () => {
  const op = (v) => payload({ businessPlan: plan({ otherPercent: v }) })
  const oj = ['a1', 'a2', 'a3', 'a4', 'a5'].map((app, i) => rec('OJ', payload(), { app, wi: `w${i + 1}` }))
  const cm = [
    rec('CM', { ...op(1), samplingPlan: { files: [] } }, { app: 'a1', wi: 'w1', state: 'duly-made' }), // 2 sections
    rec('CM', op(2), { app: 'a2', wi: 'w2', state: 'queried' }), // 1 section + status: counted under 1 section
    rec('CM', payload(), { app: 'a3', wi: 'w3', state: 'queried' }), // status only
    rec('CM', payload(), { app: 'a4', wi: 'w4', state: 'duly-made' }) // identical; a5 is missing in CM
  ]
  const md = toSummary(run(oj, cm), { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  assert.match(md, /4 applications do not fully match between OJ and CM/)
  assert.doesNotMatch(md, /### By number of sections affected/)
  assert.doesNotMatch(md, /### By issue\n/)
  assert.match(md, /- Status does not match: 2/)
})

test('every difference row gets a likely cause, falling back to what the row itself shows', () => {
  const op = (v) => payload({ businessPlan: plan({ otherPercent: v }) })
  const causeOf = (r, type) => r.rows.find((x) => x.differenceType === type).likelyCause
  const at = (d) => `2026-${d}T00:00:00.000Z`

  // Orphans on either side.
  const orphans = run([rec('OJ', payload(), { app: 'a1', wi: 'w1' })], [rec('CM', payload(), { app: 'zz', wi: 'zz', state: 'duly-made' })])
  assert.equal(causeOf(orphans, 'MISSING_IN_CM'), 'not-transferred-to-cm')
  assert.equal(causeOf(orphans, 'MISSING_IN_OJ'), 'cm-only-work-item')

  // Linked by applicationId only, with a different workItemId.
  assert.equal(causeOf(run(rec('OJ', payload(), { wi: 'w1' }), rec('CM', payload(), { wi: 'w9', state: 'duly-made' })), 'IDENTITY_BREAK'), 'id-link-broken')

  // A change after the first snapshot was taken (snapshots on 2026-11-04).
  const late = run(rec('OJ', payload()), rec('CM', op(1), { state: 'duly-made', updatedAt: '2026-11-04T10:02:00.000Z' }))
  assert.equal(causeOf(late, 'VALUE_DIFF'), 'changed-between-snapshots')

  // CM changed after OJ's last change, well before the snapshots.
  const cmLater = run(rec('OJ', payload(), { updatedAt: at('01-01') }), rec('CM', op(1), { state: 'duly-made', updatedAt: at('02-01') }))
  assert.equal(causeOf(cmLater, 'VALUE_DIFF'), 'cm-edited-after-submission')

  // Section present in OJ, missing in CM, no later edits.
  const { samplingPlan, ...noSampling } = payload()
  assert.ok(samplingPlan)
  assert.equal(causeOf(run(rec('OJ', payload()), rec('CM', noSampling, { state: 'duly-made' })), 'SECTION_ABSENT_CM'), 'section-not-transferred')

  // Nothing else explains it.
  assert.equal(causeOf(run(rec('OJ', payload()), rec('CM', op(1), { state: 'duly-made' })), 'VALUE_DIFF'), 'transfer-or-mapping-difference')

  // A specific signal still wins over the fallback.
  const queried = run(rec('OJ', payload(), { updatedAt: at('03-01') }), rec('CM', op(1), { state: 'queried', updatedAt: at('02-01') }))
  assert.equal(causeOf(queried, 'VALUE_DIFF'), 'oj-edit-not-resubmitted')

  const md = toSummary(orphans, { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  assert.ok(!md.includes('(none identified)'))
  assert.match(md, /\| not-transferred-to-cm \| 1 \| 50\.0% \|/)
})

test('top differing applications lists at most 50, most rows first, ties by application', () => {
  const ref = (r, applicationReference) => ({ ...r, identity: { ...r.identity, applicationReference } })
  // 60 OJ applications with no CM work item: one row each, so all tie.
  const oj = Array.from({ length: 60 }, (_, i) => ref(rec('OJ', payload(), { app: `a${i}`, wi: `w${i}` }), `RA-${String(i).padStart(2, '0')}`))
  const md = toSummary(run(oj, []), { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} })
  const top = md.slice(md.indexOf('### Top differing applications')).split('\n').filter((l) => /^\| \d+ \|/.test(l))
  assert.equal(top.length, 50)
  assert.equal(top[0], '| 1 | RA-00 | - | 1 | MISSING_IN_CM |')
  assert.equal(top[49], '| 50 | RA-49 | - | 1 | MISSING_IN_CM |')
})

test('top differing applications note says whether the list is complete, and names status-only applications', () => {
  const ref = (r, applicationReference) => ({ ...r, identity: { ...r.identity, applicationReference } })
  const meta = { ojTakenAt: 'x', cmTakenAt: 'y', ojWindow: {}, cmWindow: {} }
  const note = (md) => md.slice(md.indexOf('### Top differing applications')).split('\n')[2]
  const orphans = (n) => Array.from({ length: n }, (_, i) => ref(rec('OJ', payload(), { app: `a${i}`, wi: `w${i}` }), `RA-${i}`))

  assert.equal(note(toSummary(run(orphans(1), []), meta)), 'Showing all 1 application with difference rows, most rows first.')
  assert.equal(note(toSummary(run(orphans(50), []), meta)), 'Showing all 50 applications with difference rows, most rows first.')
  assert.equal(note(toSummary(run(orphans(51), []), meta)),
    'Showing the top 50 of 51 applications with difference rows, most rows first; the full list is in parity-report.csv.')
  assert.equal(note(toSummary(run([], []), meta)), 'No applications have difference rows.')

  // One application differs only on status: it cannot be in the table, and the note says so.
  const statusOnly = run([ref(rec('OJ', payload(), { app: 'aS', wi: 'wS' }), 'RA-S'), ...orphans(2)], [ref(rec('CM', payload(), { app: 'aS', wi: 'wS', state: 'queried' }), 'RA-S')])
  assert.equal(note(toSummary(statusOnly, meta)),
    'Showing all 2 applications with difference rows, most rows first. 1 application whose only difference is status is not listed here.')
})
