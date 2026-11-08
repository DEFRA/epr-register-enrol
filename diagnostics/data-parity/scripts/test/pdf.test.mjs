import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownToPdf, toWinAnsi, fitColumns } from '../pdf.mjs'

const asText = (buf) => buf.toString('latin1')

// Every xref offset must point at the start of its object, or readers report the file as damaged.
function assertValidXref(pdf) {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)[1])
  assert.ok(pdf.startsWith('xref\n', start))
  const [, count] = /^xref\n0 (\d+)\n/.exec(pdf.slice(start))
  const entries = pdf.slice(start).split('\n').slice(3, 2 + Number(count))
  entries.forEach((e, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj\n`, Number(e.slice(0, 10))), `object ${i + 1}`))
  return Number(count) - 1
}

test('renders headings, bullets, bold spans and tables into a valid PDF', () => {
  const md = [
    '# OJ vs CM parity summary',
    '',
    '- **Approved by: J Smith** and `code`',
    '- Matched pairs: 3',
    '',
    '### Rows by section',
    '',
    '| Value | Rows |',
    '| --- | --- |',
    '| business-plan | 12 |'
  ].join('\n')
  const pdf = asText(markdownToPdf(md))
  assert.ok(pdf.startsWith('%PDF-1.4\n'))
  assert.equal(assertValidXref(pdf), 5 + 2) // catalog, pages, 2 fonts, info + one page and its content
  assert.match(pdf, /\/Title \(OJ vs CM parity summary\)/)
  assert.match(pdf, /\/F2 18 Tf [\d.]+ [\d.]+ Td \(OJ vs CM parity summary\) Tj/)
  assert.match(pdf, /\/F2 10 Tf [\d.]+ [\d.]+ Td \(Approved by: J Smith\) Tj/)
  assert.match(pdf, /\/F1 10 Tf [\d.]+ [\d.]+ Td \(and code\) Tj/)
  assert.match(pdf, /\(business-plan\) Tj/)
  assert.ok(!pdf.includes('(---)'), 'separator row is not drawn')
  assert.match(pdf, /\(Page 1 of 1\) Tj/)
})

test('long tables break across pages and repeat the header', () => {
  const rows = Array.from({ length: 120 }, (_, i) => `| app-${i} | ${i} |`)
  const pdf = asText(markdownToPdf(['# T', '', '| Application | Rows |', '| --- | --- |', ...rows].join('\n')))
  const pages = Number(/\/Count (\d+)/.exec(pdf)[1])
  assert.ok(pages >= 2)
  assertValidXref(pdf)
  assert.equal(pdf.match(/\(Application\) Tj/g).length, pages)
  assert.match(pdf, /\(app-119\) Tj/)
  assert.match(pdf, new RegExp(`\\(Page ${pages} of ${pages}\\) Tj`))
})

test('escapes PDF string delimiters and maps text to WinAnsi', () => {
  const pdf = asText(markdownToPdf('Value (none) \\ ok – café 中'))
  assert.match(pdf, /\(Value \\\(none\\\) \\\\ ok \x96 caf\xe9 \?\) Tj/)
  assert.equal(toWinAnsi('“q”•'), '\x93q\x94\x95')
})

test('a word wider than its table column is split rather than overflowing', () => {
  const long = 'x'.repeat(400)
  const pdf = asText(markdownToPdf(`| A | B |\n| --- | --- |\n| ${long} | 1 |`))
  const pieces = [...pdf.matchAll(/\((x+)\) Tj/g)].map((m) => m[1])
  assert.ok(pieces.length > 1)
  assert.equal(pieces.join(''), long)
})

test('fitColumns narrows only the widest column, keeping short columns on one line', () => {
  assert.deepEqual(fitColumns([20, 80, 30], 495), [20, 80, 30]) // fits: unchanged
  assert.deepEqual(fitColumns([20, 80, 30, 900], 495), [20, 80, 30, 365])
  // The others leave the widest less than 120pt: everything scales together.
  assert.deepEqual(fitColumns([200, 200, 200], 300), [100, 100, 100])
})

test('top differing applications: #, Application, CM state and Rows are never wrapped', () => {
  const where = Array.from({ length: 12 }, (_, i) => `section-${i}: ${i + 1} VALUE_DIFF, 1 COUNT_DIFF`).join('; ')
  const ref = '507f1f77bcf86cd799439011-a-long-application-reference'
  const md = ['### Top differing applications', '', '| # | Application | CM state | Rows | Where the differences are |', '| --- | --- | --- | --- | --- |',
    `| 48 | ${ref} | approved-pending-contact | 1234 | ${where} |`].join('\n')
  const pdf = asText(markdownToPdf(md))
  for (const cell of ['48', ref, 'approved-pending-contact', '1234']) assert.ok(pdf.includes(`(${cell}) Tj`), cell)
  // The long column did wrap onto several lines.
  assert.ok([...pdf.matchAll(/\/F1 9 Tf [\d.]+ [\d.]+ Td \(([^)]*)\) Tj/g)].filter((m) => m[1].includes('section-')).length > 3)
})
