// node --test scripts/ci/workflow-run-names.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { check, readWorkflows, subscriptions, workflowName } from './workflow-run-names.mjs'

const wf = (name, subs) =>
  `name: ${name}\n\non:\n${subs ? `  workflow_run:\n    workflows: [${subs.map((s) => `"${s}"`).join(', ')}]\n    types: [completed]\n` : '  push:\n'}\njobs: {}\n`

test("a workflow's own name, quoted or not", () => {
  assert.equal(workflowName('name: OTA release\non: {}'), 'OTA release')
  assert.equal(workflowName("name: 'Test builds'\n"), 'Test builds')
  assert.equal(workflowName('on: {}\n'), undefined)
  // A job's or step's name is not the workflow's.
  assert.equal(workflowName('on: {}\njobs:\n  a:\n    name: Not this\n'), undefined)
})

test('the names a workflow subscribes to through workflow_run', () => {
  assert.deepEqual(subscriptions(wf('Smoke', ['Test builds'])), { names: ['Test builds'], unreadable: false })
  assert.deepEqual(subscriptions(wf('Post', ['OTA publish (ring 0)', 'OTA release'])).names, ['OTA publish (ring 0)', 'OTA release'])
  assert.deepEqual(subscriptions(wf('Plain')), { names: [], unreadable: false })
})

test('a subscription in a shape it cannot read is reported, never taken as fine', () => {
  const block = 'name: X\non:\n  workflow_run:\n    workflows:\n      - "Test builds"\n    types: [completed]\n'
  assert.equal(subscriptions(block).unreadable, true)
  assert.equal(subscriptions('name: X\non:\n  workflow_run:\n    types: [completed]\n').unreadable, true)
  assert.match(check({ 'x.yml': block }).problems[0], /cannot read/)
})

test('a subscription to a renamed workflow fails, naming the file and the name', () => {
  const files = { 'build.yml': wf('OTA release'), 'post.yml': wf('Post', ['OTA publish (ring 0)']) }
  assert.deepEqual(check(files).problems, ['post.yml: subscribes to "OTA publish (ring 0)", which no workflow is named'])
  // Listing the old and the new name keeps it working across the rename only once one of them exists.
  assert.deepEqual(check({ ...files, 'post.yml': wf('Post', ['OTA publish (ring 0)', 'OTA release']) }).problems, [
    'post.yml: subscribes to "OTA publish (ring 0)", which no workflow is named',
  ])
})

test("this repository's workflows: every subscribed name exists", () => {
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '.github', 'workflows')
  const files = readWorkflows(dir)
  // The control: the repository has at least one subscription, so a pass is not a pass over nothing.
  assert.ok(Object.values(files).some((t) => subscriptions(t).names.length), 'no workflow_run subscription found to check')
  assert.deepEqual(check(files).problems, [])
})
