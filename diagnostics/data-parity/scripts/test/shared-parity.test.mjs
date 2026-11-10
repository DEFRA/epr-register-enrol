import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from '../build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
// Line endings depend on git's autocrlf setting, so compare content only.
const lf = (s) => s.replace(/\r\n/g, '\n')

test('generated snapshot scripts match src/ (run node scripts/build.mjs and commit both)', () => {
  const shared = lf(readFileSync(join(here, '..', 'src', 'shared.js'), 'utf8'))
  for (const [out, text] of build()) {
    const committed = lf(readFileSync(join(here, '..', out), 'utf8'))
    assert.equal(committed, lf(text), `${out} is out of date`)
    assert.ok(committed.includes(shared), `${out} does not contain shared.js byte for byte`)
  }
})

test('build leaves no stray carriage return where shared.js is inserted', () => {
  for (const [out, text] of build()) assert.ok(!/\r(?!\n)/.test(text), out)
})
