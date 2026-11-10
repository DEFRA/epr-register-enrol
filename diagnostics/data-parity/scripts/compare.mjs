#!/usr/bin/env node
// OJ vs CM parity compare: diffs the OJ and CM snapshot JSONL files offline.
//   node compare.mjs oj.jsonl cm.jsonl --out ./out [--include-pii --approved-by "<approver and ticket>"]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe } from './describe.mjs'
import { toCompactCsv, appKey, csvEscape } from './compact.mjs'
import { markdownToPdf } from './pdf.mjs'

export const SCRIPT_VERSION = 1
export const SECTIONS = [
  'application-details', 'business-plan', 'prn-tonnage', 'authority-to-issue', 'sampling-plan', 'overseas-sites', 'bes-evidence'
]

// CM stateId -> the OJ applicationStatus it should project to.
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

function likelyCause(row, oj, cm, snapshots = {}) {
  const tags = specificCauses(row, oj, cm)
  return (tags.length ? tags : [fallbackCause(row, oj, cm, snapshots)]).join('|')
}

// When no specific signal applies, a cause is still inferred from what the row itself shows, so every row has one.
function fallbackCause(row, oj, cm, { ojTakenAt, cmTakenAt }) {
  if (row.differenceType === 'MISSING_IN_CM') return 'not-transferred-to-cm'
  if (row.differenceType === 'MISSING_IN_OJ') return 'cm-only-work-item'
  if (row.differenceType === 'IDENTITY_BREAK') return 'id-link-broken'
  const ojAt = oj?.state?.updatedAt ? new Date(oj.state.updatedAt) : null
  const cmAt = cm?.state?.updatedAt ? new Date(cm.state.updatedAt) : null
  const firstSnapshot = ojTakenAt && cmTakenAt ? new Date(Math.min(new Date(ojTakenAt), new Date(cmTakenAt))) : null
  if (firstSnapshot && ((ojAt && ojAt > firstSnapshot) || (cmAt && cmAt > firstSnapshot))) return 'changed-between-snapshots'
  if (ojAt && cmAt && cmAt > ojAt) return 'cm-edited-after-submission'
  if (row.differenceType === 'SECTION_ABSENT_CM' || row.differenceType === 'SECTION_ABSENT_OJ') return 'section-not-transferred'
  return 'transfer-or-mapping-difference'
}

function specificCauses(row, oj, cm) {
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
  return tags
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
  // CM record -> the OJ application it was matched to, so one work item is never matched to two applications.
  const usedBy = new Map()
  const rows = []
  let matched = 0
  // Matched pairs with no difference in any section (status differences aside).
  let identical = 0

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
    row.likelyCause = extra.likelyCause ?? likelyCause(row, oj, cm, { ojTakenAt, cmTakenAt })
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
      for (const c of [byApp, byWi]) if (!usedBy.has(c)) usedBy.set(c, oj.key.applicationId)
      continue
    }
    const cm = byApp ?? byWi
    if (usedBy.has(cm)) {
      push(oj, cm, {
        differenceType: 'IDENTITY_BREAK',
        fieldPath: 'key',
        ojValue: `applicationId=${oj.key.applicationId}`,
        cmValue: `work item ${cm.key.workItemId} is already matched to OJ application ${usedBy.get(cm)}`
      })
      continue
    }
    usedBy.set(cm, oj.key.applicationId)
    matched++
    const firstRow = rows.length
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
    if (!rows.slice(firstRow).some((r) => r.differenceType !== 'MATCH' && r.section !== 'state')) identical++
  }
  for (const c of cmRecords) {
    if (!usedBy.has(c)) push(null, c, { differenceType: 'MISSING_IN_OJ' })
  }
  // Counted from the records, not the rows, so identical pairs are included even with --differences-only.
  const byState = (records) => {
    const m = new Map()
    for (const r of records) m.set(r.state?.raw ?? '(none)', (m.get(r.state?.raw ?? '(none)') ?? 0) + 1)
    return m
  }
  return { rows, matched, identical, gap, ojCount: ojRecords.length, cmCount: cmRecords.length, ojStates: byState(ojRecords) }
}

// ---------- output ----------

// An apostrophe is valid inside the local part (o'neil@x.com), but not as its first character, where it is a quote.
export const maskEmail = (e) => e.replace(/([^\s@"',[\]][^\s@",[\]]*)@([^\s@"',[\]]+)/g, (_, l, d) => `${l[0]}***@${d}`)

function cell(v, { includePii, truncate }) {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'string' ? v : JSON.stringify(v)
  if (!includePii) s = maskEmail(s)
  if (truncate && s.length > 500) s = s.slice(0, 497) + '...'
  return csvEscape(s)
}

// Compact report: one row per application, all issues in one cell.
export const toCompactReport = (rows, { includePii = false } = {}) => toCompactCsv(rows, { includePii, mask: maskEmail })

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

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-')

// Each row lands under exactly one key, so the table is a breakdown of `rows.length` and its total row equals it.
function tally(rows, keyFn, empty) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r) || empty
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
const rowTable = (title, label, entries) => {
  const total = entries.reduce((s, [, n]) => s + n, 0)
  const body = entries.map(([k, n]) => `| ${k} | ${n} | ${pct(n, total)} |`).join('\n') || '| (none) | 0 | - |'
  return `### ${title}\n\n| ${label} | Rows | % of rows |\n| --- | --- | --- |\n${body}\n| **Total** | **${total}** | ${total ? '100.0%' : '-'} |\n`
}

// State -> count, as a table with each state's share of the total.
const stateTable = (title, label, counts, total) => {
  const entries = [...(counts ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  const body = entries.map(([s, n]) => `| ${s} | ${n} | ${pct(n, total)} |`).join('\n') || '| (none) | 0 | - |'
  return `### ${title}\n\n| ${label} | Applications | % of total |\n| --- | --- | --- |\n${body}\n| **Total** | **${total}** | ${total ? '100.0%' : '-'} |\n`
}

// Counts distinct applications (an OJ/CM pair, or an orphan on either side) per key, not rows.
function appTally(rows, keyFn) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r) || '(none)'
    if (!m.has(k)) m.set(k, new Set())
    m.get(k).add(appKey(r))
  }
  return [...m.entries()].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
const appTable = (title, label, entries, total) =>
  `### ${title}\n\n| ${label} | Applications | % of applications with differences |\n| --- | --- | --- |\n` +
  (entries.map(([k, n]) => `| ${k} | ${n} | ${pct(n, total)} |`).join('\n') || '| (none) | 0 | - |') + '\n'

export const TOP_APPLICATIONS = 50

// Says whether the top table is the full list or cut off, and which applications it can never include.
function topNote(listed, statusOnly) {
  const scope = (() => {
    if (listed === 0) return 'No applications have difference rows.'
    if (listed <= TOP_APPLICATIONS) return `Showing all ${listed} application${listed === 1 ? '' : 's'} with difference rows, most rows first.`
    return `Showing the top ${TOP_APPLICATIONS} of ${listed} applications with difference rows, most rows first; the full list is in parity-report.csv.`
  })()
  const status = statusOnly > 0
    ? ` ${statusOnly} application${statusOnly === 1 ? ' whose' : 's whose'} only difference is status ${statusOnly === 1 ? 'is' : 'are'} not listed here.`
    : ''
  return scope + status
}

// States only whether any application's OJ status differs from its CM state (compared through STATE_MAP).
function statusSection(statusRows) {
  const n = new Set(statusRows.map(appKey)).size
  const verdict = n === 0
    ? 'There are no status differences between OJ and CM.'
    : `There are status differences between OJ and CM: ${n} application${n === 1 ? ' has' : 's have'} a status in OJ that does not match CM.`
  return `### Status differences\n\n${verdict}\n`
}

const fmtWindow = (w) => (w?.start || w?.end ? `${w.start ?? 'open'} to ${w.end ?? 'open'}` : 'none (all submitted applications)')

export function toSummary(result, meta) {
  const { matched, identical, ojCount, cmCount, rows } = result
  const matchRows = rows.filter((r) => r.differenceType === 'MATCH')
  const diffRows = rows.filter((r) => r.differenceType !== 'MATCH')
  const diffs = diffRows.filter((r) => !['STATE_MISMATCH', 'STATE_UNMAPPED'].includes(r.differenceType))
  const appName = (r) => r.applicationReference ?? r.ojApplicationId ?? r.cmWorkItemId
  const apps = new Map()
  // Per application: section (or the issue itself, for rows with no section) -> issue -> rows.
  const where = new Map()
  const cmStateOf = new Map()
  for (const r of diffs) {
    const k = appName(r)
    apps.set(k, (apps.get(k) ?? 0) + 1)
    if (r.cmState) cmStateOf.set(k, r.cmState)
    if (!where.has(k)) where.set(k, new Map())
    const place = r.section || r.differenceType
    const issues = where.get(k).get(place) ?? new Map()
    issues.set(r.differenceType, (issues.get(r.differenceType) ?? 0) + 1)
    where.get(k).set(place, issues)
  }
  // Status is compared through the mapping (CM state -> the OJ status it should project to), not by name.
  const statusNote = new Map()
  for (const r of diffRows.filter((x) => x.differenceType === 'STATE_MISMATCH' || x.differenceType === 'STATE_UNMAPPED')) {
    statusNote.set(appName(r), r.differenceType === 'STATE_UNMAPPED'
      ? `status: CM ${r.cmState} has no OJ translation, OJ shows ${r.ojState}`
      : `status: OJ should show ${STATE_MAP[r.cmState]} (CM ${r.cmState}), OJ shows ${r.ojState}`)
  }
  const whereLine = (k) => [
    ...[...where.get(k).entries()].map(([place, issues]) =>
      issues.size === 1 && issues.has(place)
        ? (issues.get(place) > 1 ? `${place} (${issues.get(place)})` : place)
        : `${place}: ${[...issues.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}`).join(', ')}`),
    ...(statusNote.has(k) ? [statusNote.get(k)] : [])
  ].join('; ')
  const top = [...apps.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, TOP_APPLICATIONS)
  const unmatchedOj = rows.filter((r) => r.differenceType === 'MISSING_IN_CM').length
  const unmatchedCm = rows.filter((r) => r.differenceType === 'MISSING_IN_OJ').length
  // Every application that does not fully match: section differences, status differences and orphans.
  const issueApps = new Set(diffRows.map(appKey)).size
  const appsWithDiffRows = new Set(diffs.map(appKey))
  const statusOnlyApps = new Set(diffRows.filter((r) => r.section === 'state' && !appsWithDiffRows.has(appKey(r))).map(appKey)).size
  const appsOf = (pred) => new Set(diffRows.filter(pred).map(appKey)).size
  const statusRows = diffRows.filter((r) => r.section === 'state')
  const dataRows = diffs.filter((r) => r.section)
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
  const appsSection = [
    '## Applications by state',
    '',
    stateTable('OJ applications by status', 'OJ status', result.ojStates, ojCount),
    '## Applications with differences',
    '',
    `${plural(issueApps, 'application does', 'applications do')} not fully match between OJ and CM. ` +
      'An application can have more than one kind of difference, so these can add up to more than the total:',
    '',
    `- In one system but not the other: ${appsOf((r) => r.differenceType === 'MISSING_IN_CM' || r.differenceType === 'MISSING_IN_OJ')}`,
    `- Found in both, but the link between them is inconsistent (IDENTITY_BREAK): ${appsOf((r) => r.differenceType === 'IDENTITY_BREAK')}`,
    `- Application data differs in at least one section: ${new Set(dataRows.map(appKey)).size}`,
    `- Status does not match: ${new Set(statusRows.map(appKey)).size}`,
    '',
    '### Application data differences',
    '',
    'Counts are applications. A section differs when at least one field in it differs. VALUE_DIFF means a field has a ' +
      'different value; COUNT_DIFF means a list has a different number of items. An application can appear under ' +
      'several sections, so the percentages (of all applications with differences) can add up to more than 100%.',
    '',
    appTable('By section', 'Section', appTally(dataRows, (r) => r.section), issueApps),
    appTable('By section and issue', 'Section / issue', appTally(dataRows, (r) => `${r.section} / ${r.differenceType}`), issueApps),
    statusSection(statusRows),
    '## Row counts',
    '',
    `Each row is one individual difference. There are ${diffs.length} difference rows; the ${diffRows.length - diffs.length} status rows ` +
      'are covered under Status differences above. Each table below breaks down the same ' +
      `${diffs.length} rows, so every table totals ${diffs.length}.`,
    '',
    rowTable('Difference rows by section', 'Section', tally(diffs, (r) => r.section, '(no section: application missing on one side or identity break)')),
    rowTable('Difference rows by CM state', 'CM state', tally(diffs, (r) => r.cmState, '(no CM work item)')),
    // A row with several likely causes is counted once, under the combination.
    rowTable('Difference rows by likely cause', 'Likely cause', tally(diffs, (r) => (r.likelyCause ? r.likelyCause.split('|').join(' + ') : ''), '(none identified)'))
  ]
  return [
    '# OJ vs CM parity summary',
    '',
    ...(meta.approvedBy
      ? [
          `- **UNMASKED PERSONAL DATA included (--include-pii). Approved by: ${meta.approvedBy}.**`,
          '- **Handling: this summary and the CSV and JSON reports produced with it contain production personal data (names, ' +
            'emails, phone numbers, addresses). Keep them on CDP, a Defra Virtual Desktop or in the store the data owner approved, never on a personal or local machine, in a git workspace or in a synced folder. Share ' +
            'them only through the channel the data owner approved, with named recipients. Do not paste them, or screenshots of ' +
            'them, into AI tools or chat.**',
          '- **Retention: delete every copy once the report is signed off, and no later than 14 days after the database dump ' +
            '(sooner if the data owner sets a shorter limit). Record the deletion in one line: "deleted <files> on <date> by <name>".**',
          ''
        ]
      : []),
    `- OJ snapshot taken: ${meta.ojTakenAt}`,
    `- CM snapshot taken: ${meta.cmTakenAt}`,
    `- Submission window (start inclusive, end exclusive): ${fmtWindow(meta.ojWindow)}`,
    ...(same(meta.ojWindow, meta.cmWindow)
      ? []
      : [`- **WARNING: the two snapshots used different windows** (OJ ${fmtWindow(meta.ojWindow)}; CM ${fmtWindow(meta.cmWindow)}). MISSING_IN_* rows are not trustworthy.`]),
    `- OJ submitted applications: ${ojCount}; CM re-accreditation work items: ${cmCount}`,
    `- Matched applications (OJ application linked to its CM work item): ${matched}; OJ applications with no CM work item: ${unmatchedOj}; CM work items with no OJ application: ${unmatchedCm}`,
    `- Applications with at least one difference (section, status, or missing on one side): ${issueApps}`,
    `- Matched applications with no difference in any section (status differences aside): ${identical} of ${matched}`,
    `- Total rows: ${rows.length} (MATCH rows: ${matchRows.length}; status rows: ${diffRows.length - diffs.length}; difference rows: ${diffs.length})`,
    '',
    ...appsSection,
    `### Top differing applications\n\n${topNote(apps.size, statusOnlyApps)}\n\n| # | Application | CM state | Rows | Where the differences are |\n| --- | --- | --- | --- | --- |\n${top.map(([k, n], i) => `| ${i + 1} | ${k} | ${cmStateOf.get(k) ?? '-'} | ${n} | ${whereLine(k)} |`).join('\n') || '| | (none) | | 0 | |'}\n`
  ].join('\n')
}

// ---------- CLI ----------

function main(argv) {
  const args = argv.slice(2)
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--approved-by')
  const outIdx = args.indexOf('--out')
  // Defaults to out/, which diagnostics/.gitignore and the Claude Code deny rules cover.
  const outDir = outIdx >= 0 ? args[outIdx + 1] : 'out'
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
