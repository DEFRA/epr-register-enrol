// Concatenates src/shared.js into each snapshot body so the team runs one self-contained mongosh file.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shared = readFileSync(join(here, 'src', 'shared.js'), 'utf8')
const outputs = [
  ['oj.body.js', 'oj-snapshot.js'],
  ['cm.body.js', 'cm-snapshot.js']
]
for (const [body, out] of outputs) {
  const text = readFileSync(join(here, 'src', body), 'utf8')
  const i = text.indexOf('\nconst TARGET_DB')
  if (i < 0) throw new Error(`${body}: TARGET_DB marker not found`)
  writeFileSync(join(here, out), text.slice(0, i) + '\n' + shared + text.slice(i))
}
