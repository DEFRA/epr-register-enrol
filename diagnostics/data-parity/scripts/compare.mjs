#!/usr/bin/env node
// OJ vs CM parity compare: diffs the OJ and CM snapshot JSONL files offline.
//   node compare.mjs oj.jsonl cm.jsonl --out ./out [--include-pii --approved-by "<approver and ticket>"]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe } from './describe.mjs'
import { toCompactCsv } from './compact.mjs'
import { markdownToPdf } from './pdf.mjs'

export const SCRIPT_VERSION = 1
export const SECTIONS = [
  'application-details', 'business-plan', 'prn-tonnage', 'authority-to-issue', 'sampling-plan', 'overseas-sites', 'bes-evidence'
]

// CM stateId -> the OJ applicationStatus it should project to (plan section 3).
export const STATE_MAP = {
  submitted: 'Submitted',
  'duly-made': 'DulyMade',
  'assessment-started': 'DulyMade',
  'assessment-in-progress': 'Updated',
  updated: 'Updated',
  queried: 'Queried',
  'awaiting-decision': 'AwaitingDecision',
  'approved-pending-contact': 'AwaitingDecision',
  'rejected-pending-contact': 'AwaitingDecision',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
}
const TERMINAL = new Set(['approved', 'rejected', 'withdrawn'])

// ---------- loading ----------

// PowerShell 5.1's `>` writes UTF-16 with a BOM, so decode by BOM rather than assuming UTF-8.
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2)
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3)
  return buf.toString('utf8')
}

export function parseSnapshot(text, label, expectedService) {
  const records = []
  let trailer = null
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      throw new Error(`${label}: line ${i + 1} is not valid JSON (file corrupted or mixed with mongosh output)`)
    }
    if (obj.trailer) trailer = obj
    else records.push(obj)
  }
  if (!trailer) throw new Error(`${label}: no trailer line - the snapshot is truncated, refusing to compare`)
  if (trailer.count !== records.length) {
    throw new Error(`${label}: trailer says ${trailer.count} records but file has ${records.length} - truncated`)
  }
  if (trailer.service !== expectedService) throw new Error(`${label}: expected ${expectedService} snapshot, got ${trailer.service}`)
  for (const r of [trailer, ...records]) {
    const v = r.scriptVersion ?? r.snapshot?.scriptVersion
    if (v !== SCRIPT_VERSION) throw new Error(`${label}: scriptVersion ${v} unsupported (expected ${SCRIPT_VERSION})`)
  }
  return { records, trailer }
}

// ---------- deep comparison ----------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Known representation differences that are not real differences: OJ label -> CM code.
const KNOWN_EQUIVALENT = {
  glassRecyclingProcess: { Other: 'glass_other', Remelt: 'glass_re_melt' }
}

const knownEquivalent = (path, o, c) => {
  const map = KNOWN_EQUIVALENT[path.split('.').pop()]
  return map !== undefined && typeof o === 'string' && map[o] === c
}

// Compares two already-normalised section values and yields difference rows (no application context).
function diffSection(section, oj, cm) {
  const out = []
  const value = (path, o, c) => {
    if (!same(o, c) && !knownEquivalent(path, o, c)) out.push({ differenceType: 'VALUE_DIFF', fieldPath: path, ojValue: o, cmValue: c })
  }
  const listDiff = (ojList, cmList, keyOf, prefix, onPair) => {
    const o = new Map(ojList.map((x) => [keyOf(x), x]))
    const c = new Map(cmList.map((x) => [keyOf(x), x]))
    if (ojList.length !== cmList.length) {
      out.push({ differenceType: 'COUNT_DIFF', fieldPath: prefix, ojValue: ojList.length, cmValue: cmList.length })
    }
    for (const [k, x] of o) {
      if (!c.has(k)) out.push({ differenceType: 'ITEM_MISSING_CM', fieldPath: `${prefix}[${k}]`, ojValue: x, cmValue: null })
      else onPair(`${prefix}[${k}]`, x, c.get(k))
    }
    for (const [k, x] of c) {
      if (!o.has(k)) out.push({ differenceType: 'ITEM_MISSING_OJ', fieldPath: `${prefix}[${k}]`, ojValue: null, cmValue: x })
    }
  }
  const fieldwise = (path, o, c) => {
    for (const f of new Set([...Object.keys(o), ...Object.keys(c)])) {
      if (f === 'interimSites' || f === 'files') continue
      const ov = o[f] ?? null
      const cv = c[f] ?? null
      const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
      if (plain(ov) && plain(cv)) fieldwise(`${path}.${f}`, ov, cv)
      else value(`${path}.${f}`, ov, cv)
    }
  }

  switch (section) {
    case 'application-details':
      fieldwise('application', oj ?? {}, cm ?? {})
      break
    case 'business-plan':
      fieldwise('businessPlan', oj ?? {}, cm ?? {})
      break
    case 'prn-tonnage':
      value('prns.plannedTonnageBand', oj, cm)
      break
    case 'authority-to-issue':
      listDiff(oj ?? [], cm ?? [], (a) => (a.email ?? '').toLowerCase() || `name:${a.fullName}`, 'prns.authorisers',
        (p, o, c) => {
          value(`${p}.fullName`, o.fullName, c.fullName)
          value(`${p}.isNew`, o.isNew, c.isNew)
        })
      break
    case 'sampling-plan':
      listDiff(oj ?? [], cm ?? [], (f) => f.fileId, 'samplingPlan.files', (p, o, c) => fieldwise(p, o, c))
      break
    case 'overseas-sites':
      listDiff(oj ?? [], cm ?? [], (s) => s.siteKey, 'overseasSites.sites', (p, o, c) => {
        fieldwise(p, o, c)
        listDiff(o.interimSites ?? [], c.interimSites ?? [], (i) => i.siteNumber, `${p}.interimSites`, (ip, io, ic) => fieldwise(ip, io, ic))
      })
      break
    case 'bes-evidence': {
      const cmByKey = new Map((cm ?? []).map((s) => [s.siteKey, s]))
      // A site on one side only is already reported under overseas-sites; compare files for shared sites.
      const sharedO = (oj ?? []).filter((s) => cmByKey.has(s.siteKey))
      const sharedC = (cm ?? []).filter((s) => (oj ?? []).some((o) => o.siteKey === s.siteKey))
      listDiff(sharedO, sharedC, (s) => s.siteKey, 'besEvidence', (p, o, c) => {
        listDiff(o.files, c.files, (f) => f.fileId, `${p}.files`, (fp, fo, fc) => fieldwise(fp, fo, fc))
      })
      break
    }
  }
  return out
}

// ---------- tagging ----------

function likelyCause(row, oj, cm) {
  const tags = []
  const cmState = cm?.state?.raw
  const ojAt = oj?.state?.updatedAt
  const cmAt = cm?.state?.updatedAt
  const ojNewer = ojAt && cmAt && new Date(ojAt) > new Date(cmAt)
  if (row.fieldPath?.endsWith('.operationCodes') && cm?.audit?.hasRecyclingOpsUpdate) tags.push('cm-edited-operation-codes')
  if (cmState === 'queried' && ojNewer) tags.push('oj-edit-not-resubmitted')
  if (TERMINAL.has(cmState) && ojNewer) tags.push('oj-post-decision-edit')
  if (cm?.audit?.lastQueryAction === 'query-during-duly-made' && cm.audit.queryRespondedAt?.length > 0) {
    tags.push('query-after-duly-made')
  }
  return tags.join('|')
}

// ---------- matching and compare ----------

// includeMatches (default true): also emit a MATCH row for every state/section of a matched pair that has no difference.
export function compare(ojRecords, cmRecords, { ojTakenAt, cmTakenAt, includeMatches = true } = {}) {
  const gap = ojTakenAt && cmTakenAt ? Math.round(Math.abs(new Date(cmTakenAt) - new Date(ojTakenAt)) / 1000) : null
  const cmByApp = new Map()
  const cmByWi = new Map()
  for (const c of cmRecords) {
    if (c.key.applicationId) cmByApp.set(c.key.applicationId, c)
    if (c.key.workItemId) cmByWi.set(c.key.workItemId, c)
  }
  const used = new Set()
  const rows = []
  let matched = 0

  const base = (oj, cm) => ({
    applicationReference: oj?.identity.applicationReference ?? cm?.identity.applicationReference ?? null,
    organisationName: oj?.identity.organisationName ?? cm?.identity.organisationName ?? null,
    orgNumber: oj?.identity.orgNumber ?? cm?.identity.orgNumber ?? null,
    registrationNumber: oj?.identity.registrationNumber ?? cm?.identity.registrationNumber ?? null,
    accreditationNumber: oj?.identity.accreditationNumber ?? cm?.identity.accreditationNumber ?? null,
    material: oj?.identity.material ?? cm?.identity.material ?? null,
    ojApplicationId: oj?.key.applicationId ?? null,
    cmWorkItemId: cm?.key.workItemId ?? null,
    ojState: oj?.state.raw ?? null,
    cmState: cm?.state.raw ?? null,
    section: '',
    differenceType: '',
    fieldPath: '',
    ojValue: null,
    cmValue: null,
    likelyCause: '',
    ojUpdatedAt: oj?.state.updatedAt ?? null,
    cmLastModifiedAt: cm?.state.updatedAt ?? null,
    snapshotGapSeconds: gap
  })
  const push = (oj, cm, extra) => {
    const row = { ...base(oj, cm), ...extra }
    row.likelyCause = extra.likelyCause ?? likelyCause(row, oj, cm)
    row.description = describe(row, { expectedOjStatus: STATE_MAP[cm?.state?.raw] })
    rows.push(row)
  }

  for (const oj of ojRecords) {
    const byApp = oj.key.applicationId ? cmByApp.get(oj.key.applicationId) : undefined
    const byWi = oj.key.workItemId ? cmByWi.get(oj.key.workItemId) : undefined
    if (!byApp && !byWi) {
      push(oj, null, { differenceType: 'MISSING_IN_CM', fieldPath: oj.key.workItemId ? 'key.workItemId' : '' })
      continue
    }
    if (byApp && byWi && byApp !== byWi) {
      push(oj, byApp, {
        differenceType: 'IDENTITY_BREAK',
        fieldPath: 'key',
        ojValue: `workItemId=${oj.key.workItemId}`,
        cmValue: `applicationId match is work item ${byApp.key.workItemId}; workItemId match has applicationId ${byWi.key.applicationId}`
      })
      used.add(byApp)
      used.add(byWi)
      continue
    }
    const cm = byApp ?? byWi
    used.add(cm)
    matched++
    if (!byApp || !byWi) {
      push(oj, cm, {
        differenceType: 'IDENTITY_BREAK',
        fieldPath: byApp ? 'key.workItemId' : 'key.applicationId',
        ojValue: byApp ? oj.key.workItemId : oj.key.applicationId,
        cmValue: byApp ? cm.key.workItemId : cm.key.applicationId
      })
    }
    // State: informational, separate from section differences.
    const expected = STATE_MAP[cm.state.raw]
    if (expected === undefined) {
      push(oj, cm, { section: 'state', differenceType: 'STATE_UNMAPPED', fieldPath: 'state', ojValue: oj.state.raw, cmValue: cm.state.raw })
    } else if (expected === oj.state.raw) {
      if (includeMatches) push(oj, cm, { section: 'state', differenceType: 'MATCH', fieldPath: 'state', ojValue: oj.state.raw, cmValue: cm.state.raw, likelyCause: '' })
    } else {
      push(oj, cm, {
        section: 'state', differenceType: 'STATE_MISMATCH', fieldPath: 'state', ojValue: oj.state.raw, cmValue: cm.state.raw,
        likelyCause: cm.audit?.statusPushFailed ? 'status-push-failed' : ''
      })
    }
    for (const section of SECTIONS) {
      const o = oj.sections[section]
      const c = cm.sections[section]
      if (o.present !== c.present) {
        push(oj, cm, {
          section, differenceType: o.present ? 'SECTION_ABSENT_CM' : 'SECTION_ABSENT_OJ', fieldPath: section,
          ojValue: o.present ? 'section present' : 'section missing',
          cmValue: c.present ? 'section present' : 'section missing'
        })
        continue
      }
      const found = o.present ? diffSection(section, o.value, c.value) : []
      for (const d of found) push(oj, cm, { section, ...d })
      if (found.length === 0 && includeMatches) {
        push(oj, cm, { section, differenceType: 'MATCH', fieldPath: section, ojValue: 'identical', cmValue: 'identical', likelyCause: '' })
      }
    }
  }
  for (const c of cmRecords) {
    if (!used.has(c)) push(null, c, { differenceType: 'MISSING_IN_OJ' })
  }
  return { rows, matched, gap, ojCount: ojRecords.length, cmCount: cmRecords.length }
}

// ---------- output ----------

const maskEmail = (e) => e.replace(/([^\s@"',[\]]+)@([^\s@"',[\]]+)/g, (_, l, d) => `${l[0]}***@${d}`)
const mask = (s) => maskEmail(s)

function cell(v, { includePii, truncate }) {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'string' ? v : JSON.stringify(v)
  if (!includePii) s = mask(s)
  if (truncate && s.length > 500) s = s.slice(0, 497) + '...'
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Compact report: one row per application, all issues in one cell.
export const toCompactReport = (rows, { includePii = false } = {}) => toCompactCsv(rows, { includePii, mask })

export const CSV_COLUMNS = [
  'applicationReference', 'organisationName', 'orgNumber', 'registrationNumber', 'accreditationNumber', 'material',
  'ojApplicationId', 'cmWorkItemId', 'ojState', 'cmState', 'section', 'differenceType', 'description', 'fieldPath', 'ojValue',
  'cmValue', 'likelyCause', 'ojUpdatedAt', 'cmLastModifiedAt', 'snapshotGapSeconds'
]

export function toCsv(rows, { includePii = false } = {}) {
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => cell(r[c], { includePii, truncate: true })).join(','))
  return lines.join('\n') + '\n'
}

function tally(rows, keyFn) {
  const m = new Map()
  for (const r of rows) for (const k of [].concat(keyFn(r))) m.set(k || '(none)', (m.get(k || '(none)') ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const table = (title, entries) =>
  `### ${title}\n\n| Value | Rows |\n| --- | --- |\n${entries.map(([k, n]) => `| ${k} | ${n} |`).join('\n') || '| (none) | 0 |'}\n`

const fmtWindow = (w) => (w?.start || w?.end ? `${w.start ?? 'open'} to ${w.end ?? 'open'}` : 'none (all submitted applications)')

export function toSummary(result, meta) {
  const { rows, matched, gap, ojCount, cmCount } = result
  const matchRows = rows.filter((r) => r.differenceType === 'MATCH')
  const diffRows = rows.filter((r) => r.differenceType !== 'MATCH')
  const diffs = diffRows.filter((r) => !['STATE_MISMATCH', 'STATE_UNMAPPED'].includes(r.differenceType))
  const apps = new Map()
  for (const r of diffs) {
    const k = r.applicationReference ?? r.ojApplicationId ?? r.cmWorkItemId
    apps.set(k, (apps.get(k) ?? 0) + 1)
  }
  const pairsWithDiffs = new Set(
    diffs.filter((r) => r.ojApplicationId && r.cmWorkItemId).map((r) => `${r.ojApplicationId}|${r.cmWorkItemId}`)
  ).size
  const top = [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  const unmatchedOj = rows.filter((r) => r.differenceType === 'MISSING_IN_CM').length
  const unmatchedCm = rows.filter((r) => r.differenceType === 'MISSING_IN_OJ').length
  return [
    '# OJ vs CM parity summary',
    '',
    ...(meta.approvedBy
      ? [`- **UNMASKED PERSONAL DATA included (--include-pii). Approved by: ${meta.approvedBy}. Delete with the retention rule in the run book.**`, '']
      : []),
    `- OJ snapshot taken: ${meta.ojTakenAt}`,
    `- CM snapshot taken: ${meta.cmTakenAt}`,
    `- Submission window (start inclusive, end exclusive): ${fmtWindow(meta.ojWindow)}`,
    ...(same(meta.ojWindow, meta.cmWindow)
      ? []
      : [`- **WARNING: the two snapshots used different windows** (OJ ${fmtWindow(meta.ojWindow)}; CM ${fmtWindow(meta.cmWindow)}). MISSING_IN_* rows are not trustworthy.`]),
    ...(meta.ojWindow?.start || meta.ojWindow?.end
      ? ['- Windowed run: OJ is filtered on dateSent and CM on submittedAt, which are set at slightly different moments, so MISSING_IN_* rows right at either boundary may be edge effects.']
      : []),
    `- Gap between snapshots: ${gap === null ? 'unknown' : `${gap} seconds`}`,
    `- OJ submitted applications: ${ojCount}; CM re-accreditation work items: ${cmCount}`,
    `- Matched pairs: ${matched}; OJ with no CM item: ${unmatchedOj}; CM with no OJ application: ${unmatchedCm}`,
    `- Applications with at least one difference: ${apps.size}`,
    `- Matched pairs with no difference in any section: ${matched - pairsWithDiffs}`,
    `- Total rows: ${rows.length} (MATCH rows: ${matchRows.length}; informational state rows: ${diffRows.length - diffs.length}; difference rows: ${diffs.length})`,
    '',
    table('Difference rows by section', tally(diffRows, (r) => r.section)),
    table('Rows by difference type', tally(rows, (r) => r.differenceType)),
    table('Difference rows by CM state', tally(diffRows, (r) => r.cmState)),
    table('Difference rows by likely cause', tally(diffRows, (r) => r.likelyCause ? r.likelyCause.split('|') : '')),
    `### Top differing applications\n\n| Application | Rows |\n| --- | --- |\n${top.map(([k, n]) => `| ${k} | ${n} |`).join('\n') || '| (none) | 0 |'}\n`
  ].join('\n')
}

// ---------- CLI ----------

function main(argv) {
  const args = argv.slice(2)
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--approved-by')
  const outIdx = args.indexOf('--out')
  const outDir = outIdx >= 0 ? args[outIdx + 1] : '.'
  const includePii = args.includes('--include-pii')
  const approvedIdx = args.indexOf('--approved-by')
  const approvedBy = approvedIdx >= 0 ? (args[approvedIdx + 1] ?? '').trim() : ''
  const includeMatches = !args.includes('--differences-only')
  if (files.length !== 2) {
    console.error('usage: node compare.mjs oj.jsonl cm.jsonl [--out dir] [--differences-only] [--include-pii --approved-by "<approver and ticket>"]')
    process.exit(2)
  }
  // Unmasked output needs a named approver, which is recorded in the summary.
  if (includePii && (approvedBy === '' || approvedBy.startsWith('--'))) {
    console.error('--include-pii writes unmasked personal data and needs --approved-by "<approver and ticket>"')
    process.exit(2)
  }
  const oj = parseSnapshot(decodeText(readFileSync(files[0])), files[0], 'OJ')
  const cm = parseSnapshot(decodeText(readFileSync(files[1])), files[1], 'CM')
  const meta = {
    ojTakenAt: oj.trailer.takenAt,
    cmTakenAt: cm.trailer.takenAt,
    ojWindow: oj.trailer.window ?? { start: null, end: null },
    cmWindow: cm.trailer.window ?? { start: null, end: null },
    approvedBy: includePii ? approvedBy : null
  }
  const result = compare(oj.records, cm.records, { ...meta, includeMatches })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'parity-report.csv'), toCompactReport(result.rows, { includePii }))
  writeFileSync(join(outDir, 'parity-report-detailed.csv'), toCsv(result.rows, { includePii }))
  writeFileSync(join(outDir, 'parity-summary.pdf'), markdownToPdf(toSummary(result, meta)))
  // The JSON keeps full values and so contains PII; only write it when asked.
  if (includePii) writeFileSync(join(outDir, 'parity-report.json'), JSON.stringify(result.rows, null, 2))
  console.error(`${result.rows.length} rows written to ${outDir}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
