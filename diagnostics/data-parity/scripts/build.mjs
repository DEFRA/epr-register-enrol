// Concatenates src/shared.js into each snapshot body so the team runs one self-contained mongosh file.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const OUTPUTS = [
  ['oj.body.js', 'oj-snapshot.js'],
  ['cm.body.js', 'cm-snapshot.js']
]

// Returns [output file name, generated text] pairs. Keeps the body's own line endings (LF or CRLF).
export function build() {
  const shared = readFileSync(join(here, 'src', 'shared.js'), 'utf8')
  return OUTPUTS.map(([body, out]) => {
    const text = readFileSync(join(here, 'src', body), 'utf8')
    const m = /\r?\n(?=const TARGET_DB)/.exec(text)
    if (!m) throw new Error(`${body}: TARGET_DB marker not found`)
    return [out, text.slice(0, m.index) + m[0] + shared + text.slice(m.index)]
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [out, text] of build()) writeFileSync(join(here, out), text)
}
