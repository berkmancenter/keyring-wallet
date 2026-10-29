#!/usr/bin/env node
/**
 * Every workflow_run subscription must name a workflow that exists. `on.workflow_run.workflows` lists workflow
 * names, not files, so a subscription naming no workflow can never fire, and renaming a workflow's `name:` silently
 * stops every run chained behind it: no error anywhere, the next run just never starts. (10-29: renaming "OTA publish
 * (ring 0)" would have stopped the smoke after every release.) Whether GitHub matches the workflow's `name:` or a
 * run's title when the workflow sets run-name is not settled here; this check is right either way, since a renamed
 * `name:` breaks the subscription under both. It reads each workflow's top-level `name:` and each `workflows: [...]`
 * list, and fails on a name no workflow has, and on any subscription it cannot read: a shape it doesn't know is
 * never taken as fine.
 *
 *   node scripts/ci/workflow-run-names.mjs [--dir .github/workflows]
 *
 * Exit 0 when every subscribed name exists, 1 otherwise, naming the file and the name.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2')

/** A workflow file's own name (its top-level `name:`), or undefined. */
export const workflowName = (text) => {
  const m = /^name:[ \t]*(.+?)[ \t]*$/m.exec(text)
  return m ? unquote(m[1]) : undefined
}

/**
 * The names a workflow subscribes to through workflow_run, as { names, unreadable }. Only the inline list form
 * (`workflows: ["A", "B"]`) is read; a `workflow_run:` whose list is in another shape is reported unreadable.
 */
export const subscriptions = (text) => {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^\s+workflow_run:\s*$/.test(l))
  if (at < 0) return { names: [], unreadable: false }
  const indent = lines[at].match(/^\s*/)[0].length
  for (let i = at + 1; i < lines.length && (lines[i].trim() === '' || lines[i].match(/^\s*/)[0].length > indent); i++) {
    const m = /^\s+workflows:\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const list = /^\[(.*)\]\s*(#.*)?$/.exec(m[1].trim())
    if (!list) return { names: [], unreadable: true }
    return { names: list[1].split(',').map(unquote).filter(Boolean), unreadable: false }
  }
  return { names: [], unreadable: true }
}

/** Every problem across the files ({ file: text }): a subscription to a name no workflow has, or one not readable. */
export const check = (files) => {
  const names = new Set(Object.values(files).map(workflowName).filter(Boolean))
  const problems = []
  for (const [file, text] of Object.entries(files)) {
    const sub = subscriptions(text)
    if (sub.unreadable) problems.push(`${file}: a workflow_run subscription this check cannot read; write its workflows as an inline list`)
    for (const n of sub.names) if (!names.has(n)) problems.push(`${file}: subscribes to "${n}", which no workflow is named`)
  }
  return { problems, names: [...names].sort() }
}

export const readWorkflows = (dir) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(path.join(dir, f), 'utf8')])
  )

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dir')
  const dir = i > 0 ? process.argv[i + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows')
  const files = readWorkflows(dir)
  const { problems } = check(files)
  const subscribed = Object.entries(files).flatMap(([f, t]) => subscriptions(t).names.map((n) => `${f} → "${n}"`))
  console.log(`workflow_run subscriptions examined (${subscribed.length}, in ${Object.keys(files).length} workflow files):`)
  for (const s of subscribed) console.log(`  ${s}`)
  for (const p of problems) console.error(`ERROR ${p}`)
  process.exitCode = problems.length ? 1 : 0
}
