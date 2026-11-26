#!/usr/bin/env node
/**
 * Runs each integration suite in its OWN jest process.
 *
 * Why: askar-nodejs's FFI struct registry is process-global, but jest
 * re-executes modules per test file (fresh sandbox: new module registry,
 * globalThis AND process), so the second suite in any shared process dies at
 * import with "Duplicate type name 'ByteBuffer'". One process per suite is
 * the supported mode for native-FFI agents; suites were already written to
 * be independently runnable (worker-aware ports, per-suite wallets).
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const integrationDir = join(packageRoot, '__tests__', 'integration')

const suites = readdirSync(integrationDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()

// Stale wallets from aborted runs make agents fail to open stores
rmSync(join(packageRoot, '.wallets'), { recursive: true, force: true })

const failed = []
for (const suite of suites) {
  const rel = join('__tests__', 'integration', suite)
  console.log(`\n=== ${rel} ===`)
  try {
    execFileSync('yarn', ['jest', rel, '--runInBand', ...process.argv.slice(2)], {
      cwd: packageRoot,
      stdio: 'inherit',
      env: { ...process.env, TZ: process.env.TZ ?? 'GMT' },
    })
  } catch {
    failed.push(rel)
  }
}

console.log(`\n=== integration summary: ${suites.length - failed.length}/${suites.length} suites passed ===`)
if (failed.length > 0) {
  console.log(`failed:\n  ${failed.join('\n  ')}`)
  process.exit(1)
}
