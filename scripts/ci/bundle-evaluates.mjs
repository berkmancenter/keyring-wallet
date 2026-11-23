#!/usr/bin/env node
// bundle-evaluates.mjs — evaluates the framework's platform-neutral module graph out of a Metro bundle, lazily, as the
// app does on the device, and fails on the first throw with the module's real name.
//
//   node scripts/ci/bundle-evaluates.mjs <dev bundle> [module path …]
//
// The bundle is a Metro DEV bundle for Android (`react-native bundle --dev true`, readable module headers:
// `},<id>,[deps],"<path>")`). Its module table is loaded in a plain Node vm with the app's entry and React Native's
// InitializeCore left unrun, `reflect-metadata` evaluated first (the app's index.js does the same), and then each
// named module is required by id. A module that throws while evaluating fails the run with the message and the
// bundle's own stack, which carries module paths.
//
// Why this exists: the first one-tree Test build (Phase 2 of docs/plans/single-codebase-plan.md) crashed on the device
// at onboarding, "Cannot read property 'prototype' of undefined", at the first lazy require of @bifold/trust-tasks:
// Metro had resolved trust-tasks' `ajv/dist/2020` to the app's ajv 8.12 (no `Ajv2020` named export) instead of the
// 8.20 the package declares. Every jest suite was green (jest resolves from each package's own node_modules), the
// release bundle's module table was clean (one ajv, the wrong one), and only the device ran the real lazily-required
// graph with the bundle's resolution. This step runs that graph, with that resolution, before any device does.
//
// The default list is the framework's platform-neutral entry points and the core modules that first touch them at
// agent start; a module that needs React Native's natives cannot be evaluated here and does not belong in it.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

export const DEFAULT_MODULES = [
  'packages/trust-tasks/src/index.ts',
  'packages/credo-tsp-adapter/src/index.ts',
  'packages/dtg-vocab/src/index.ts',
  'packages/vrc-contexts/src/index.ts',
  'packages/core/src/modules/trust-tasks/messages/TrustTaskMessage.ts',
  'packages/core/src/modules/trust-tasks/messages/TrustTaskEnvelopeV2Message.ts',
  'packages/core/src/modules/trust-tasks/messages/TspEnvelopeMessage.ts',
]
const PRELOAD = ['node_modules/reflect-metadata/Reflect.js']

/** The module table of a Metro dev bundle: path → id, from the `},<id>,[deps],"<path>")` module footers. */
export function moduleTable(text) {
  const byPath = new Map()
  const re = /\},(\d+),\[[0-9,]*\],"([^"]*)"\)/g
  let m
  while ((m = re.exec(text))) byPath.set(m[2].replace(/^\.\.\//, ''), Number(m[1]))
  return byPath
}

/** The bundle text without the trailing entry calls (`__r(<InitializeCore>); __r(<entry>);`). */
export function withoutEntry(text) {
  return text.replace(/(\n__r\(\d+\);)+\s*$/, '\n')
}

/** Loads the table and requires `paths` in order; returns [{ path, ok, error }] (stops at nothing). */
export function evaluate(text, paths, { preload = PRELOAD } = {}) {
  const table = moduleTable(text)
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
    TextEncoder, TextDecoder, URL, URLSearchParams, Buffer, performance, crypto: globalThis.crypto,
    process: { env: {}, platform: 'android' }, navigator: { product: 'ReactNative' }, __fbBatchedBridgeConfig: {},
  }
  sandbox.globalThis = sandbox
  sandbox.global = sandbox
  sandbox.self = sandbox
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(withoutEntry(text), sandbox, { filename: 'bundle.js' })
  const metroRequire = vm.runInContext('__r', sandbox)
  const idOf = (p) => {
    const id = table.get(p) ?? table.get(`../${p}`)
    if (id === undefined) throw new Error(`${p} is not in the bundle (${table.size} modules); a moved or renamed entry point?`)
    return id
  }
  for (const p of preload) metroRequire(idOf(p))
  const results = []
  for (const p of paths) {
    try {
      metroRequire(idOf(p))
      results.push({ path: p, ok: true })
    } catch (error) {
      results.push({ path: p, ok: false, error })
    }
  }
  return results
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const [bundle, ...named] = process.argv.slice(2)
  if (!bundle) {
    console.error('usage: node scripts/ci/bundle-evaluates.mjs <dev bundle> [module path …]')
    process.exit(2)
  }
  const text = readFileSync(bundle, 'utf8')
  const results = evaluate(text, named.length ? named : DEFAULT_MODULES)
  let failed = 0
  for (const r of results) {
    if (r.ok) console.log(`ok    ${r.path}`)
    else {
      failed++
      console.log(`THREW ${r.path}: ${r.error?.message}`)
      console.log(String(r.error?.stack ?? '').split('\n').slice(1, 14).map((l) => `      ${l}`).join('\n'))
    }
  }
  console.log(`${results.length - failed} of ${results.length} framework modules evaluate from the bundle`)
  process.exit(failed ? 1 : 0)
}
