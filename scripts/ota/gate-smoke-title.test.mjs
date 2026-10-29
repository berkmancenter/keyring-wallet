// node --test scripts/ota/
// strict-proof.mjs and post-release.mjs find a smoke of a Test builds run by gate-smoke.yml's run title ("Test builds
// <id>"). Nothing else ties the two, so a reworded run-name would make every strict publish refuse for want of a
// smoke, and post-release find none, with no error naming the cause. This renders gate-smoke's own run-name formats
// with a run id and hands the titles to the real matchers.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { pickDispatched } from './post-release.mjs'
import { checkSmoke } from './strict-proof.mjs'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const yml = readFileSync(path.join(root, '.github', 'workflows', 'gate-smoke.yml'), 'utf8')
const runName = yml.slice(yml.indexOf('\nrun-name:'), yml.indexOf('\non:'))

const SHA = 'cb36b83a1e0b6a67fb0e8fd32b6b95dd88d9ac3f'
const RUN = '40943746609'
const VALUES = { 'github.event.workflow_run.head_sha': SHA, 'github.event.workflow_run.id': RUN, 'inputs.run-id': RUN }

/** Every format('…', a, b) in the run-name that names a Test builds run, rendered with VALUES. */
const titles = () =>
  [...runName.matchAll(/format\('([^']*)'((?:,\s*[\w.-]+)*)\)/g)]
    .filter(([, template]) => template.includes('Test builds'))
    .map(([, template, args]) => {
      const values = args.split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
        assert.ok(a in VALUES, `run-name passes ${a}, which this test doesn't know`)
        return VALUES[a]
      })
      return 'Gate smoke · ' + template.replace(/\{(\d+)\}/g, (_, i) => values[Number(i)])
    })

test("gate-smoke's run-name names its Test builds run for both a dispatch and a chained run", () => {
  const t = titles()
  assert.deepEqual(t.sort(), [`Gate smoke · ${SHA} (Test builds ${RUN})`, `Gate smoke · Test builds ${RUN}`].sort())
})

test('strict-proof finds a smoke by every title the run-name can give it', () => {
  const builds = [{ id: Number(RUN), head_sha: SHA, event: 'workflow_dispatch', conclusion: 'success' }]
  const jobs = [
    { name: `iOS smoke (macos-26) · ${SHA.slice(0, 8)}`, conclusion: 'success' },
    { name: `Android smoke (ubuntu-latest, KVM) · ${SHA.slice(0, 8)}`, conclusion: 'success' },
  ]
  for (const display_title of titles()) {
    const r = checkSmoke(SHA, builds, [{ id: 1, conclusion: 'success', display_title, jobs }])
    assert.equal(r.met, true, `strict-proof doesn't match the title "${display_title}"`)
  }
})

test('post-release picks its dispatched smoke by the title a dispatch gets', () => {
  const dispatch = titles().find((t) => !t.includes(SHA))
  const run = { id: 7, event: 'workflow_dispatch', display_title: dispatch, created_at: '2026-10-29T20:00:00Z' }
  assert.equal(pickDispatched([run], { title: `Test builds ${RUN}`, since: 0 })?.id, 7)
})
