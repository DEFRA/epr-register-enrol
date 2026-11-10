// Plain-English description of one report row: which section, exactly what differs, and the OJ and CM values.

const SECTION_LABELS = {
  'application-details': 'Application details',
  'business-plan': 'Business plan',
  'prn-tonnage': 'PRN tonnage',
  'authority-to-issue': 'Authority to issue',
  'sampling-plan': 'Sampling plan',
  'overseas-sites': 'Overseas sites',
  'bes-evidence': 'BES evidence',
  state: 'Status'
}

// Field names that read badly when split from camelCase.
const FIELD_LABELS = {
  operatorOrgNumber: 'organisation number',
  chargeAmountPence: 'charge amount (pence)',
  siteAddressPostcode: 'site address postcode',
  isNewSite: 'new-site flag',
  isNew: 'new flag',
  isEu: 'EU country flag',
  isOecd: 'OECD country flag',
  orsId: 'ORS ID',
  siteId: 'site ID',
  fileId: 'file ID',
  s3Key: 'S3 key',
  code1: 'waste code 1',
  code2: 'waste code 2',
  code3: 'waste code 3',
  registeredNowAccredited: 'registered-now-accredited flag',
  conditionsOfExport: 'conditions of export',
  plannedTonnageBand: 'planned tonnage band',
  besEvidenceValidFromDate: 'BES evidence valid-from date',
  besEvidenceExpiryDate: 'BES evidence expiry date',
  uploadedAt: 'upload date',
  scanStatus: 'scan status',
  fullName: 'full name',
  jobTitle: 'job title'
}

const humanise = (name) =>
  FIELD_LABELS[name] ?? name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()

// Nouns for list containers, singular and plural.
const ITEM_NOUNS = {
  authorisers: ['authoriser', 'authorisers'],
  files: ['file', 'files'],
  sites: ['overseas site', 'overseas sites'],
  interimSites: ['interim site', 'interim sites']
}

export function fmt(v) {
  if (v === null || v === undefined || v === '') return 'no value'
  if (typeof v === 'string') return `"${v}"`
  if (Array.isArray(v)) return v.length === 0 ? 'an empty list' : `[${v.map(fmt).join(', ')}]`
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Splits a fieldPath such as `overseasSites.sites[ORS1].interimSites[1].postcode` into { name, key } tokens.
function tokens(fieldPath) {
  return [...String(fieldPath ?? '').matchAll(/([A-Za-z0-9_]+)(?:\[([^\]]*)\])?/g)].map((m) => ({ name: m[1], key: m[2] }))
}

// Context phrases for the keyed tokens, innermost first, e.g. ['interim site 1', 'overseas site ORS1'].
function contexts(toks, section) {
  const out = []
  for (const { name, key } of toks) {
    if (key === undefined) continue
    if (name === 'besEvidence') out.push(`overseas site ${key}`)
    else if (name === 'files') out.push(`${section === 'bes-evidence' ? 'BES evidence file' : 'file'} ${key}`)
    else if (ITEM_NOUNS[name]) out.push(`${ITEM_NOUNS[name][0]} ${key}`)
  }
  return out.reverse()
}

function fieldLabel(toks) {
  const last = toks[toks.length - 1]
  const parent = toks.length > 1 ? toks[toks.length - 2] : null
  const base = humanise(last.name)
  return parent && parent.name === 'contact' ? `contact ${base}` : base
}

// Lists the populated scalar fields of a missing item, so the description says what the item is.
function summarise(item) {
  if (item === null || typeof item !== 'object') return fmt(item)
  const parts = []
  for (const [k, v] of Object.entries(item)) {
    if (v === null || v === undefined || k === 'siteKey') continue // siteKey is internal
    if (Array.isArray(v)) {
      if (v.length > 0 && v.every((x) => typeof x !== 'object')) parts.push(`${humanise(k)} ${fmt(v)}`)
      else if (v.length > 0) parts.push(`${v.length} ${ITEM_NOUNS[k]?.[v.length === 1 ? 0 : 1] ?? humanise(k)}`)
    } else if (typeof v !== 'object') parts.push(`${humanise(k)} ${fmt(v)}`)
  }
  return parts.join(', ')
}

function itemLabel(toks, section) {
  const last = toks[toks.length - 1]
  const outer = contexts(toks.slice(0, -1), section)
  let noun
  if (last.name === 'files') noun = section === 'bes-evidence' ? 'BES evidence file' : 'file'
  else if (last.name === 'besEvidence') noun = 'BES evidence'
  else noun = ITEM_NOUNS[last.name]?.[0] ?? humanise(last.name)
  return `${noun} ${last.key}${outer.length ? ` of ${outer.join(' of ')}` : ''}`
}

export function describe(row, { expectedOjStatus } = {}) {
  const section = SECTION_LABELS[row.section] ?? row.section ?? ''
  const prefix = section ? `${section}: ` : ''
  const toks = tokens(row.fieldPath)

  switch (row.differenceType) {
    case 'MATCH':
      return row.section === 'state'
        ? `OJ status ${fmt(row.ojValue)} is consistent with CM state ${fmt(row.cmValue)}.`
        : `${prefix}identical in OJ and CM.`
    case 'VALUE_DIFF': {
      const ctx = contexts(toks, row.section)
      const where = ctx.length ? ` for ${ctx.join(' of ')}` : ''
      return `${prefix}${fieldLabel(toks)}${where} differs: OJ has ${fmt(row.ojValue)}, CM has ${fmt(row.cmValue)}.`
    }
    case 'ITEM_MISSING_CM':
      return `${prefix}${itemLabel(toks, row.section)} is in OJ but missing from CM (OJ has: ${summarise(row.ojValue)}).`
    case 'ITEM_MISSING_OJ':
      return `${prefix}${itemLabel(toks, row.section)} is in CM but missing from OJ (CM has: ${summarise(row.cmValue)}).`
    case 'COUNT_DIFF': {
      const last = toks[toks.length - 1]
      const outer = contexts(toks.slice(0, -1), row.section)
      const plural = (n, name) => {
        const [one, many] = ITEM_NOUNS[name] ?? [humanise(name), humanise(name)]
        const bes = row.section === 'bes-evidence' && name === 'files' ? 'BES evidence ' : ''
        return `${bes}${n === 1 ? one : many}`
      }
      const where = outer.length ? ` for ${outer.join(' of ')}` : ''
      return `${prefix}OJ has ${row.ojValue} ${plural(row.ojValue, last.name)}${where}, CM has ${row.cmValue} ${plural(row.cmValue, last.name)}.`
    }
    case 'SECTION_ABSENT_CM':
      return `${prefix}the section is present in OJ but missing from CM.`
    case 'SECTION_ABSENT_OJ':
      return `${prefix}the section is present in CM but missing from OJ.`
    case 'MISSING_IN_CM':
      return 'Submitted in OJ, but no CM work item matches it on application ID or work item ID, so no section could be compared.'
    case 'MISSING_IN_OJ':
      return 'In CM with an OJ application ID, but no OJ application matches it, so no section could be compared.'
    case 'IDENTITY_BREAK':
      return `The OJ and CM link keys disagree (${row.fieldPath}): OJ has ${fmt(row.ojValue)}, CM has ${fmt(row.cmValue)}.`
    case 'STATE_MISMATCH':
      return `OJ status is ${fmt(row.ojValue)} but CM state is ${fmt(row.cmValue)}, which should show in OJ as ${fmt(expectedOjStatus)}.`
    case 'STATE_UNMAPPED':
      return `CM state ${fmt(row.cmValue)} has no mapping to an OJ status, so the OJ status ${fmt(row.ojValue)} could not be checked.`
    default:
      return ''
  }
}
