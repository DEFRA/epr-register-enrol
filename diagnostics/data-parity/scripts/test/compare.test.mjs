import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, decodeText, parseSnapshot, toCsv, SECTIONS } from '../compare.mjs'

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
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs')
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
  assert.match(readFileSync(join(dir, 'out', 'parity-summary.md'), 'utf8'), /Approved by: J Smith DPO-1/)
  assert.equal(run().status, 0)
})
