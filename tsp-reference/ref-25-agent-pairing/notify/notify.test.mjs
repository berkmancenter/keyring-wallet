// Offline checks of the step 0.3(f) hooks: the PreToolUse gate and the Stop hook, run as Claude Code
// runs them (JSON on stdin, a decision on stdout). The live runs are in README.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const gate = path.join(here, 'plugin', 'gate.sh')
const stop = path.join(here, 'plugin', 'stop.sh')
const REPLY = 'mcp__plugin_probeplug_probe__reply'

const state = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notify-gate-'))
const run = (script, st, input) =>
  execFileSync(script, { input: JSON.stringify(input), env: { ...process.env, PROBE_STATE: st } }).toString()
const decision = (out) => (out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'none')

for (const tool of ['Bash', 'Write', 'WebFetch', 'ToolSearch', 'Agent', 'mcp__vtamcp__memory_get']) {
  test(`marker "other": ${tool} is denied by the script whatever mode its input names (auto, bypassPermissions); whether Claude Code calls the hook in bypassPermissions is not shown here`, () => {
    for (const mode of ['auto', 'bypassPermissions']) {
      const st = state()
      fs.writeFileSync(path.join(st, 'turn-trust'), 'other')
      assert.equal(decision(run(gate, st, { tool_name: tool, permission_mode: mode })), 'deny')
    }
  })
}

test('marker "other": the plugin\'s own reply is not denied', () => {
  const st = state()
  fs.writeFileSync(path.join(st, 'turn-trust'), 'other')
  assert.equal(decision(run(gate, st, { tool_name: REPLY, permission_mode: 'auto' })), 'none')
})

test('control: with no marker the same tools are not denied', () => {
  const st = state()
  for (const tool of ['Bash', 'Write', 'mcp__vtamcp__memory_get'])
    assert.equal(decision(run(gate, st, { tool_name: tool, permission_mode: 'auto' })), 'none')
})

test('control: a reply tool of another server is denied under the marker (the name is exact)', () => {
  const st = state()
  fs.writeFileSync(path.join(st, 'turn-trust'), 'other')
  assert.equal(decision(run(gate, st, { tool_name: 'mcp__other__reply', permission_mode: 'auto' })), 'deny')
})

test('Stop clears the marker, and the next tool call passes', () => {
  const st = state()
  fs.writeFileSync(path.join(st, 'turn-trust'), 'other')
  assert.equal(decision(run(gate, st, { tool_name: 'Bash' })), 'deny')
  run(stop, st, { hook_event_name: 'Stop' })
  assert.equal(fs.existsSync(path.join(st, 'turn-trust')), false)
  assert.equal(decision(run(gate, st, { tool_name: 'Bash' })), 'none')
})
