// Compact report: one row per application, every issue for it in a single cell, one short status per section.

export const SECTION_COLUMNS = [
  'application-details', 'business-plan', 'prn-tonnage', 'authority-to-issue', 'sampling-plan', 'overseas-sites',
  'bes-evidence'
]

export const COMPACT_COLUMNS = [
  'applicationReference', 'organisationName', 'orgNumber', 'registrationNumber', 'accreditationNumber', 'material',
  'ojApplicationId', 'cmWorkItemId', 'ojState', 'cmState', 'result', 'issueCount', ...SECTION_COLUMNS, 'status',
  'issues', 'likelyCause', 'ojUpdatedAt', 'cmLastModifiedAt', 'snapshotGapSeconds'
]

// One application: an OJ/CM pair, or an orphan on either side.
export const appKey = (r) => `${r.ojApplicationId ?? ''}|${r.cmWorkItemId ?? ''}`

// Quotes a CSV cell when it holds a quote, comma or line break.
export const csvEscape = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

const plural = (n) => (n === 1 ? '1 difference' : `${n} differences`)

// rows: the output of compare(). Returns one object per application (matched pair or orphan), in first-seen order.
export function toCompactRows(rows) {
  const groups = new Map()
  for (const r of rows) {
    const key = appKey(r)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const out = []
  for (const group of groups.values()) {
    const first = group[0]
    const orphan = group.find((r) => r.differenceType === 'MISSING_IN_CM' || r.differenceType === 'MISSING_IN_OJ')
    const issues = group.filter((r) => r.differenceType !== 'MATCH')
    const row = {
      applicationReference: first.applicationReference,
      organisationName: first.organisationName,
      orgNumber: first.orgNumber,
      registrationNumber: first.registrationNumber,
      accreditationNumber: first.accreditationNumber,
      material: first.material,
      ojApplicationId: first.ojApplicationId,
      cmWorkItemId: first.cmWorkItemId,
      ojState: first.ojState,
      cmState: first.cmState,
      issueCount: issues.length,
      likelyCause: [...new Set(issues.flatMap((r) => (r.likelyCause ? r.likelyCause.split('|') : [])))].join('|'),
      ojUpdatedAt: first.ojUpdatedAt,
      cmLastModifiedAt: first.cmLastModifiedAt,
      snapshotGapSeconds: first.snapshotGapSeconds
    }
    if (orphan) {
      row.result = orphan.differenceType
      for (const s of [...SECTION_COLUMNS, 'status']) row[s] = 'not compared'
    } else {
      const sectionIssues = issues.filter((r) => r.section !== 'state')
      row.result = sectionIssues.length === 0 ? 'MATCH' : 'DIFFERENCES'
      for (const s of SECTION_COLUMNS) {
        const n = issues.filter((r) => r.section === s).length
        row[s] = n === 0 ? 'OK' : plural(n)
      }
      const stateIssues = issues.filter((r) => r.section === 'state').length
      row.status = stateIssues === 0 ? 'OK' : 'mismatch'
    }
    // One numbered line per issue, in a single cell.
    row.issues = issues.map((r, i) => `${i + 1}. ${r.description}`).join('\n')
    out.push(row)
  }
  return out
}

// maskFn masks personal data; the issues cell is never truncated (it is the whole point of the compact report).
export function toCompactCsv(rows, { includePii = false, mask = (s) => s } = {}) {
  const lines = [COMPACT_COLUMNS.join(',')]
  for (const r of toCompactRows(rows)) {
    lines.push(
      COMPACT_COLUMNS.map((c) => {
        const v = r[c]
        if (v === null || v === undefined || v === '') return ''
        let s = typeof v === 'string' ? v : String(v)
        if (!includePii) s = mask(s)
        return csvEscape(s)
      }).join(',')
    )
  }
  return lines.join('\n') + '\n'
}
