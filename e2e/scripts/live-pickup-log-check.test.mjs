import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { checkLivePickupLog } from './live-pickup-log-check.mjs'

const POLL = "INFO Starting explicit pickup of messages from mediator 'med-1' using v2"
const V4 = "INFO Starting explicit pickup of messages from mediator 'med-2' using v4"
const LIVE = "INFO Starting Live Mode pickup of messages from mediator 'med-1'"
const STARTED = 'INFO Live message pickup started'
const RESTART = 'WARN Live message pickup restarting (status check failed: Timeout has occurred); closed 1 socket(s)'

test('a healthy run: agent start polls briefly, goes live, a check restarts once', () => {
  const r = checkLivePickupLog([POLL, LIVE, STARTED, V4, RESTART, LIVE, LIVE, STARTED].join('\n'))
  assert.equal(r.ok, true, r.failures.join('; '))
  assert.deepEqual(r.counts, { started: 2, restarting: 1, failed: 0, credoLive: 3, credoPoll: 1 })
  assert.deepEqual(r.restartReasons, ['status check failed: Timeout has occurred'])
})

test('the Pickup 4.0 loop (v4) is neither a live nor a polling start of the v1 mediator', () => {
  const r = checkLivePickupLog([LIVE, STARTED, V4, V4].join('\n'))
  assert.equal(r.ok, true)
  assert.equal(r.counts.credoPoll, 0)
  assert.equal(r.counts.credoLive, 1)
})

test('fails when nothing went live (the switch was off)', () => {
  const r = checkLivePickupLog([POLL, POLL].join('\n'))
  assert.equal(r.ok, false)
  assert.match(r.failures[0], /no live start/)
})

test('fails when credo started live mode more often than the controller did (a stacked monitor)', () => {
  const r = checkLivePickupLog([LIVE, STARTED, LIVE].join('\n'))
  assert.equal(r.ok, false)
  assert.match(r.failures[0], /something other than utils\/livePickup.ts/)
})

test('fails when pickup ends on polling after going live, and only then', () => {
  const fellBack = checkLivePickupLog([LIVE, STARTED, POLL].join('\n'))
  assert.equal(fellBack.ok, false)
  assert.match(fellBack.failures[0], /ended on polling/)
  // An agent restart polls for a moment and goes live again: a note, not a failure.
  const restarted = checkLivePickupLog([LIVE, STARTED, POLL, LIVE, STARTED].join('\n'))
  assert.equal(restarted.ok, true)
  assert.equal(restarted.notes.length, 1)
})

test('the CLI exits 1 on a failure and 0 on a pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-pickup-log-'))
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live-pickup-log-check.mjs')
  const good = path.join(dir, 'good.log')
  const bad = path.join(dir, 'bad.log')
  fs.writeFileSync(good, [LIVE, STARTED].join('\n'))
  fs.writeFileSync(bad, POLL)
  assert.match(execFileSync('node', [script, good], { encoding: 'utf8' }), /^PASS/)
  assert.throws(() => execFileSync('node', [script, bad], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
