// Parses the small Markdown subset toSummary emits, for the PDF writer:
// #/##/### headings, "- " bullets, **bold** and `code` spans, pipe tables, paragraphs and blank lines.

export const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isSeparator = (line) => splitRow(line).every((c) => /^:?-{3,}:?$/.test(c))

// Returns blocks: { type: 'heading', level, text } | { type: 'table', rows } | { type: 'bullet', text }
// | { type: 'paragraph', text } | { type: 'blank' }. A table's first row is its header.
export function parseMarkdown(md) {
  const lines = md.split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2] })
    } else if (line.trim().startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!isSeparator(lines[i])) rows.push(splitRow(lines[i]))
        i++
      }
      i--
      blocks.push({ type: 'table', rows })
    } else if (/^\s*[-*]\s+/.test(line)) {
      blocks.push({ type: 'bullet', text: line.replace(/^\s*[-*]\s+/, '') })
    } else if (line.trim() === '') {
      blocks.push({ type: 'blank' })
    } else {
      blocks.push({ type: 'paragraph', text: line })
    }
  }
  return blocks
}

// "a **b** `c`" -> [{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }]. Code spans
// are shown as plain text.
export function spans(text, forceBold = false) {
  return String(text).replace(/`/g, '').split('**')
    .map((part, i) => ({ text: part, bold: forceBold || i % 2 === 1 }))
    .filter((s) => s.text !== '')
}

export const plainText = (text) => spans(text).map((s) => s.text).join('')

// The first level-1 heading, used as the document title.
export const titleOf = (blocks) => blocks.find((b) => b.type === 'heading' && b.level === 1)?.text ?? 'Report'
