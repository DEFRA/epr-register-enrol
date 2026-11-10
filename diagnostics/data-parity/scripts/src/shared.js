// BEGIN SHARED (must be byte-identical in both snapshot scripts; test/shared-parity.test.mjs enforces it)
const SCRIPT_VERSION = 1
const SCAN_STATUS = ['Pending', 'Clean', 'Infected']
const TONNAGE_BANDS = ['UpTo500', 'UpTo5000', 'UpTo10000', 'Over10000']
const BP_FIELDS = [
  'newInfrastructurePercent', 'priceSupportPercent', 'businessCollectionsPercent',
  'communicationsPercent', 'newMarketsPercent', 'newUsesPercent', 'otherPercent',
  'newInfrastructureDetail', 'priceSupportDetail', 'businessCollectionsDetail',
  'communicationsDetail', 'newMarketsDetail', 'newUsesDetail', 'otherDetail'
]
const SITE_FIELDS = [
  'siteId', 'orsId', 'siteName', 'siteAddress', 'addressLine1', 'addressLine2', 'townOrCity',
  'country', 'coordinates', 'contactName', 'contactEmail', 'contactPhone', 'code1', 'code2',
  'code3', 'repatriatedLoads', 'conditionsOfExport', 'isEu', 'isOecd', 'isNewSite',
  'registeredNowAccredited'
]
// Everything CM renders for an interim site (siteNumber, name, new flag, address lines, contact, operation codes).
const INTERIM_FIELDS = [
  'siteNumber', 'siteName', 'isNewSite', 'addressLine1', 'addressLine2', 'townOrCity', 'stateOrRegion', 'postcode',
  'country', 'contactName', 'contactEmail', 'contactPhone'
]
// Application-level values CM shows in the case header, Additional information tab and summary header rows.
// Material is deliberately not compared: OJ and CM name materials differently (it is shown as an identity column only).
const DETAIL_FIELDS = [
  'applicationReference', 'organisationName', 'operatorOrgNumber', 'registrationNumber',
  'glassRecyclingProcess', 'wasteProcessingType', 'chargeAmountPence', 'companiesHouseNumber',
  'companyRegisteredAddress', 'siteAddress', 'siteAddressPostcode'
]
const CONTACT_FIELDS = ['fullName', 'email', 'phone', 'jobTitle']

// Absent, null and empty string all become null; strings are trimmed.
function nz(v) {
  if (v === undefined || v === null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  return v
}
function iso(d) {
  if (d === undefined || d === null || d === '') return null
  const x = d instanceof Date ? d : new Date(d)
  return isNaN(x.getTime()) ? String(d) : x.toISOString()
}
// Legacy documents may hold enums as ints.
function enumName(v, names) {
  const x = nz(v)
  return typeof x === 'number' ? (names[x] !== undefined ? names[x] : x) : x
}
function idStr(v) {
  const x = nz(v)
  if (x === null) return null
  const s = String(x)
  const m = s.match(/^(?:UUID|ObjectId|BinData)\((?:"|')?([^"')]+)/)
  return m ? m[1] : s
}
function pick(obj, fields) {
  const out = {}
  for (const f of fields) out[f] = nz(obj ? obj[f] : undefined)
  return out
}
function byKey(arr, keyFn) {
  return arr.slice().sort((a, b) => {
    const x = String(keyFn(a) === null ? '' : keyFn(a))
    const y = String(keyFn(b) === null ? '' : keyFn(b))
    return x < y ? -1 : x > y ? 1 : 0
  })
}
function normFile(f, withBesDates) {
  const out = {
    fileId: idStr(f.fileId),
    filename: nz(f.filename),
    s3Key: nz(f.s3Key),
    scanStatus: enumName(f.scanStatus, SCAN_STATUS),
    uploadedAt: iso(f.uploadedAt) // CM shows 'Updated <date>' beside each file
  }
  if (withBesDates) {
    out.besEvidenceValidFromDate = iso(f.besEvidenceValidFromDate)
    out.besEvidenceExpiryDate = iso(f.besEvidenceExpiryDate)
  }
  return out
}
function siteKeyOf(s) {
  const k = nz(s.orsId)
  return k !== null ? String(k) : nz(s.siteId) !== null ? idStr(s.siteId) : null
}
function normSite(s) {
  const out = pick(s, SITE_FIELDS)
  out.siteId = idStr(s.siteId)
  out.siteKey = siteKeyOf(s)
  out.operationCodes = Array.isArray(s.operationCodes)
    ? s.operationCodes.map(nz).filter((c) => c !== null).sort()
    : null
  const interim = Array.isArray(s.interimSites) && s.interimSites.length > 0
    ? s.interimSites
    : s.interimSite ? [s.interimSite] : []
  out.interimSites = byKey(
    interim.filter((i) => nz(i.removedAt) === null).map((i) => {
      const o = pick(i, INTERIM_FIELDS)
      o.operationCodes = Array.isArray(i.operationCodes) ? i.operationCodes.map(nz).filter((c) => c !== null).sort() : null
      return o
    }),
    (i) => i.siteNumber
  )
  return out
}
function normDetails(p) {
  const out = pick(p, DETAIL_FIELDS)
  out.permitNumbers = Array.isArray(p.permitNumbers)
    ? p.permitNumbers.filter((x) => typeof x === 'string').map(nz).filter((x) => x !== null)
    : []
  const c = p.submitterContactDetails
  out.contact = pick(c, CONTACT_FIELDS)
  return out
}
// Both sides are first reshaped to the CM payload shape, then run through this.
function normaliseSections(p) {
  const sections = {}
  sections['application-details'] = { present: true, value: normDetails(p) }
  const bp = p.businessPlan
  sections['business-plan'] = { present: !!bp, value: bp ? pick(bp, BP_FIELDS) : null }
  const prns = p.prns
  sections['prn-tonnage'] = {
    present: !!prns,
    value: prns ? enumName(prns.plannedTonnageBand, TONNAGE_BANDS) : null
  }
  sections['authority-to-issue'] = {
    present: !!prns && Array.isArray(prns.authorisers),
    value: prns && Array.isArray(prns.authorisers)
      ? byKey(
          prns.authorisers.map((a) => ({ fullName: nz(a.fullName), email: nz(a.email), isNew: nz(a.isNew) })),
          (a) => (a.email ? a.email.toLowerCase() : '')
        )
      : null
  }
  const sp = p.samplingPlan
  sections['sampling-plan'] = {
    present: !!sp,
    value: sp && Array.isArray(sp.files)
      ? byKey(sp.files.map((f) => normFile(f, false)), (f) => f.fileId)
      : null
  }
  const os = p.overseasSites
  const sites = os && Array.isArray(os.sites) ? os.sites : null
  sections['overseas-sites'] = {
    present: !!os,
    value: sites ? byKey(sites.map(normSite), (s) => s.siteKey) : null
  }
  sections['bes-evidence'] = {
    present: !!os,
    value: sites
      ? byKey(
          sites.map((s) => ({
            siteKey: siteKeyOf(s),
            files: byKey(
              ((s.besEvidence && s.besEvidence.files) || []).map((f) => normFile(f, true)),
              (f) => f.fileId
            )
          })),
          (s) => s.siteKey
        )
      : null
  }
  return sections
}
function uuidStr(v) {
  if (v === undefined || v === null) return null
  if (typeof v.toUUID === 'function') return v.toUUID().toString().replace(/^UUID\("?|"?\)$/g, '')
  return idStr(v)
}
// A backstop only: it replaces the common write methods on this one collection object with a throw. It does not cover
// aggregate with $out/$merge, db.runCommand, db.getSiblingDB(...) or db.dropDatabase. The real protection is the
// read-only database user and running against a scratch restore.
function installReadOnlyGuard(collection, name) {
  const MUTATING = [
    'insert', 'insertOne', 'insertMany', 'update', 'updateOne', 'updateMany', 'replaceOne', 'save',
    'remove', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'findAndModify',
    'bulkWrite', 'initializeOrderedBulkOp', 'initializeUnorderedBulkOp', 'drop', 'dropIndex', 'dropIndexes',
    'createIndex', 'createIndexes', 'renameCollection'
  ]
  for (const m of MUTATING) {
    collection[m] = function () {
      throw new Error(name + ' is a READ-ONLY snapshot; refusing to call ' + m + '()')
    }
  }
}
// Optional submission window [start, end). Either bound may be omitted. ISO-8601; UTC is assumed if no offset is given.
function parseWindow(startRaw, endRaw) {
  const one = (raw, label) => {
    if (raw === undefined || raw === null || raw === '') return null
    const s = String(raw).trim()
    const hasOffset = /(Z|[+-]\d\d:?\d\d)$/.test(s)
    const d = new Date(hasOffset || s.indexOf('T') === -1 ? s : s + 'Z')
    if (isNaN(d.getTime())) throw new Error(label + ' is not a valid date/time: ' + raw)
    return d
  }
  const start = one(startRaw, 'PARITY_START')
  const end = one(endRaw, 'PARITY_END')
  if (start && end && start >= end) throw new Error('PARITY_START must be earlier than PARITY_END')
  return { start, end }
}
// The window passed with --eval "PARITY_START=...; PARITY_END=...", if any.
function windowFromEval() {
  return parseWindow(
    typeof PARITY_START !== 'undefined' ? PARITY_START : null,
    typeof PARITY_END !== 'undefined' ? PARITY_END : null
  )
}
// Mongo range clause for one date field, or null when no bound is set.
function rangeClause(field, w) {
  if (!w.start && !w.end) return null
  const r = {}
  if (w.start) r.$gte = w.start
  if (w.end) r.$lt = w.end
  const c = {}
  c[field] = r
  return c
}
// END SHARED
