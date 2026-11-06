// Minimal Markdown -> PDF renderer for the parity summary. No dependencies: it uses the PDF standard fonts
// (Helvetica, Helvetica-Bold), so nothing is embedded or downloaded.
// Handles what toSummary emits: #/##/### headings, "- " bullets, **bold** and `code` spans, pipe tables, paragraphs.

// Advance widths (1/1000 em) for character codes 32..126, from the standard Helvetica AFM metrics.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
]
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
]

const PAGE_W = 595.28 // A4
const PAGE_H = 841.89
const MARGIN = 50
const CONTENT_W = PAGE_W - 2 * MARGIN
const BOTTOM = MARGIN + 16 // keeps clear of the page-number footer
const BODY = 10
const HEADINGS = { 1: 18, 2: 14, 3: 12 }
const TABLE = 9
const PAD = 4

// Characters outside Latin-1 that WinAnsiEncoding still has; anything else is drawn as '?'.
const WIN_ANSI_EXTRA = {
  '€': 128, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151
}
const BULLET = String.fromCharCode(149)

export function toWinAnsi(s) {
  let out = ''
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch
    else if (WIN_ANSI_EXTRA[ch]) out += String.fromCharCode(WIN_ANSI_EXTRA[ch])
    else if (ch === '\t') out += ' '
    else out += '?'
  }
  return out
}

const widthOf = (s, bold, size) => {
  const table = bold ? HELVETICA_BOLD : HELVETICA
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    w += c >= 32 && c <= 126 ? table[c - 32] : 556
  }
  return (w * size) / 1000
}

const esc = (s) => s.replace(/[\\()]/g, (m) => '\\' + m)
const num = (n) => (Math.round(n * 100) / 100).toString()

// "a **b** `c`" -> words tagged with their font, ready for wrapping.
function words(text, forceBold = false) {
  const out = []
  String(text).replace(/`/g, '').split('**').forEach((part, i) => {
    const bold = forceBold || i % 2 === 1
    for (const w of toWinAnsi(part).split(' ')) if (w) out.push({ text: w, bold })
  })
  return out
}

// Breaks words into lines no wider than maxW; a single word wider than the line is split by character.
function wrap(ws, maxW, size) {
  const lines = []
  let line = []
  let lineW = 0
  const space = widthOf(' ', false, size)
  const push = (w, width) => {
    if (line.length && lineW + space + width > maxW) {
      lines.push(line)
      line = []
      lineW = 0
    }
    lineW += (line.length ? space : 0) + width
    line.push(w)
  }
  for (const w of ws) {
    const width = widthOf(w.text, w.bold, size)
    if (width <= maxW) {
      push(w, width)
      continue
    }
    let chunk = ''
    for (const ch of w.text) {
      if (chunk && widthOf(chunk + ch, w.bold, size) > maxW) {
        push({ text: chunk, bold: w.bold }, widthOf(chunk, w.bold, size))
        chunk = ''
      }
      chunk += ch
    }
    if (chunk) push({ text: chunk, bold: w.bold }, widthOf(chunk, w.bold, size))
  }
  if (line.length) lines.push(line)
  return lines.length ? lines : [[]]
}

const lineWidth = (line, size) =>
  line.reduce((w, x, i) => w + widthOf(x.text, x.bold, size) + (i ? widthOf(' ', false, size) : 0), 0)

class Layout {
  constructor() {
    this.pages = []
    this.newPage()
  }

  newPage() {
    this.ops = []
    this.pages.push(this.ops)
    this.y = PAGE_H - MARGIN
  }

  atTop() {
    return this.y === PAGE_H - MARGIN
  }

  // Starts a new page if `height` does not fit; returns true when it did.
  ensure(height) {
    if (this.y - height >= BOTTOM || this.atTop()) return false
    this.newPage()
    return true
  }

  // Draws one wrapped line with its baseline at `baseline`, grouping same-font words into one text run.
  drawLine(line, x, baseline, size) {
    let i = 0
    while (i < line.length) {
      const bold = line[i].bold
      let j = i
      while (j < line.length && line[j].bold === bold) j++
      const text = line.slice(i, j).map((w) => w.text).join(' ')
      this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${num(x)} ${num(baseline)} Td (${esc(text)}) Tj ET`)
      x += widthOf(text, bold, size) + widthOf(' ', false, size)
      i = j
    }
  }

  text(ws, { size = BODY, indent = 0, bullet = false } = {}) {
    const lead = size * 1.4
    const x = MARGIN + indent + (bullet ? 14 : 0)
    for (const [n, line] of wrap(ws, PAGE_W - MARGIN - x, size).entries()) {
      this.ensure(lead)
      const baseline = this.y - size
      if (bullet && n === 0) this.drawLine([{ text: BULLET, bold: false }], MARGIN + indent + 3, baseline, size)
      this.drawLine(line, x, baseline, size)
      this.y -= lead
    }
  }

  heading(text, level) {
    const size = HEADINGS[level] ?? HEADINGS[3]
    if (!this.atTop()) this.y -= level === 1 ? 4 : 10
    // Keep a heading on the same page as at least a couple of lines of what follows it.
    this.ensure(size * 1.4 + BODY * 4)
    this.text(words(text, true), { size })
    this.y -= 2
  }

  gap(h) {
    if (!this.atTop()) this.y -= h
  }

  table(rows) {
    const [header, ...body] = rows
    const cols = Math.max(...rows.map((r) => r.length))
    const isNumber = (s) => /^-?\d[\d,]*(\.\d+)?%?$/.test(s.trim())
    // Natural column widths, then scaled down to the page width if they do not fit.
    const natural = Array.from({ length: cols }, (_, c) =>
      Math.max(...rows.map((r, i) => lineWidth(words(r[c] ?? '', i === 0), TABLE))) + 2 * PAD)
    const total = natural.reduce((a, b) => a + b, 0)
    const widths = total > CONTENT_W ? natural.map((w) => (w * CONTENT_W) / total) : natural
    const lead = TABLE * 1.3

    const drawRow = (cells, isHeader) => {
      const wrapped = widths.map((w, c) => wrap(words(cells[c] ?? '', isHeader), w - 2 * PAD, TABLE))
      const height = Math.max(...wrapped.map((l) => l.length)) * lead + 2 * PAD
      const brokePage = this.ensure(height)
      if (brokePage && !isHeader) {
        drawRow(header, true)
        return drawRow(cells, false)
      }
      const top = this.y
      let x = MARGIN
      if (isHeader) this.ops.push(`0.92 g ${num(MARGIN)} ${num(top - height)} ${num(widths.reduce((a, b) => a + b, 0))} ${num(height)} re f 0 g`)
      for (const [c, w] of widths.entries()) {
        this.ops.push(`0.6 G 0.5 w ${num(x)} ${num(top - height)} ${num(w)} ${num(height)} re S 0 G`)
        const right = !isHeader && isNumber(cells[c] ?? '')
        for (const [n, line] of wrapped[c].entries()) {
          const lx = right ? x + w - PAD - lineWidth(line, TABLE) : x + PAD
          this.drawLine(line, lx, top - PAD - TABLE * 0.8 - n * lead, TABLE)
        }
        x += w
      }
      this.y = top - height
    }

    // Header plus the first row must fit together, so a header is never left alone at the bottom of a page.
    this.ensure((lead + 2 * PAD) * 2)
    drawRow(header, true)
    for (const r of body) drawRow(r, false)
    this.y -= 8
  }
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isSeparator = (line) => splitRow(line).every((c) => /^:?-{3,}:?$/.test(c))

export function markdownToPdf(md) {
  const layout = new Layout()
  const lines = md.split(/\r?\n/)
  let title = 'Report'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      if (h[1].length === 1 && title === 'Report') title = h[2]
      layout.heading(h[2], h[1].length)
    } else if (line.trim().startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!isSeparator(lines[i])) rows.push(splitRow(lines[i]))
        i++
      }
      i--
      layout.table(rows)
    } else if (/^\s*[-*]\s+/.test(line)) {
      layout.text(words(line.replace(/^\s*[-*]\s+/, '')), { bullet: true })
    } else if (line.trim() === '') {
      layout.gap(BODY * 0.6)
    } else {
      layout.text(words(line))
    }
  }

  // Footer, now that the page count is known.
  const n = layout.pages.length
  layout.pages.forEach((ops, i) => {
    const label = `Page ${i + 1} of ${n}`
    ops.push(`BT /F1 8 Tf ${num(PAGE_W - MARGIN - widthOf(label, false, 8))} ${num(MARGIN - 12)} Td (${label}) Tj ET`)
  })
  return assemble(layout.pages, toWinAnsi(title))
}

// Writes the PDF objects and cross-reference table. Content is Latin-1 throughout, so string length equals byte length.
function assemble(pages, title) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    null, // page tree, filled in once the page objects are numbered
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${esc(title)}) /Producer (data-parity compare.mjs) >>`
  ]
  const kids = []
  for (const ops of pages) {
    const content = ops.join('\n')
    const contentRef = objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    kids.push(objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentRef} 0 R >>`
    ))
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
