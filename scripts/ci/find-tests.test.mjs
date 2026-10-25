// node --test scripts/ci/find-tests.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { findTests, loadNeedInstall } from './find-tests.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const tree = (files, needInstall) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-tests-'))
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true })
    fs.writeFileSync(path.join(root, f), '')
  }
  if (needInstall) {
    fs.mkdirSync(path.join(root, 'scripts', 'ci'), { recursive: true })
    fs.writeFileSync(path.join(root, 'scripts', 'ci', 'tests-need-install.json'), JSON.stringify(needInstall))
  }
  return root
}

test('a new test file anywhere under e2e/ or scripts/ is found, .mjs and .sh alike, without naming it', () => {
  const root = tree(['e2e/lib/brandNew.test.mjs', 'e2e/gate/ci/new.test.sh', 'scripts/x/deep/y.test.mjs', 'e2e/lib/helper.mjs', 'app/src/a.test.mjs'])
  try {
    assert.deepEqual(findTests(root, {}).tests, ['e2e/gate/ci/new.test.sh', 'e2e/lib/brandNew.test.mjs', 'scripts/x/deep/y.test.mjs'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('node_modules, fixtures, artifacts and scripts/ota (its own step) are left out; need-install entries too', () => {
  const root = tree([
    'e2e/node_modules/pkg/a.test.mjs',
    'e2e/scripts/fixtures/check-testids/lib/helpers.test.mjs',
    'e2e/artifacts/run/x.test.mjs',
    'scripts/ota/withdraw.test.mjs',
    'e2e/lib/steady.test.mjs',
    'e2e/lib/rows.test.mjs',
  ])
  try {
    assert.deepEqual(findTests(root, { 'e2e/lib/steady.test.mjs': 'needs webdriverio' }), { tests: ['e2e/lib/rows.test.mjs'], stale: [] })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a need-install entry naming a file that is gone is stale (the CLI fails on it); an entry without its reason throws', () => {
  const root = tree(['e2e/lib/rows.test.mjs'], { 'e2e/lib/gone.test.mjs': 'needs webdriverio' })
  try {
    assert.deepEqual(findTests(root).stale, ['e2e/lib/gone.test.mjs'])
    fs.writeFileSync(path.join(root, 'scripts', 'ci', 'tests-need-install.json'), JSON.stringify({ 'e2e/lib/rows.test.mjs': '' }))
    assert.throws(() => loadNeedInstall(root), /needs its reason/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('in this repo: the tests the workflow used to name are all still found, and nothing listed is stale', () => {
  const { tests, stale } = findTests()
  assert.deepEqual(stale, [])
  for (const f of [
    'e2e/gate/refused.test.mjs',
    'e2e/gate/ci/keys-since.test.sh',
    'e2e/gate/ci/rows.test.sh',
    'scripts/release/tier.test.mjs',
    'e2e/openvtc/hvAdmin.test.mjs',
    'e2e/lib/typeExact.test.mjs',
    'scripts/openvtc/fetch-binaries.test.mjs',
    'e2e/scripts/check-testids.test.mjs',
    'scripts/ci/find-tests.test.mjs',
  ]) assert.ok(tests.includes(f), f)
  assert.ok(!tests.some((f) => f.startsWith('scripts/ota/')), 'the OTA step runs those')
  assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'ci', 'tests-need-install.json')))
})
