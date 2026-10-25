#!/usr/bin/env node
/**
 * Writes e2e/lib/testids.app.json: the testID manifest of the wallet's own
 * app/src, made with bifold's generator (packages/core/scripts/gen-testids.mjs)
 * so both manifests have one shape and one set of rules. The app calls
 * testIdWithKey as bifold does, and the drivers tap those ids too.
 *
 *   node e2e/scripts/gen-app-testids.mjs --generator <bifold>/packages/core/scripts/gen-testids.mjs
 *       [--root app] [--out e2e/lib/testids.app.json]
 *
 * Normally run by sync-testids.sh. The generator resolves its own `typescript`
 * from the bifold checkout it lives in.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const walletDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const parseArgs = (argv) => {
  const opts = { generator: '', root: path.join(walletDir, 'app'), out: path.join(walletDir, 'e2e', 'lib', 'testids.app.json') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const [flag, inline] = a.includes('=') ? a.split(/=(.*)/s) : [a, undefined]
    const value = () => inline ?? argv[++i] ?? ''
    if (flag === '--generator') opts.generator = path.resolve(value())
    else if (flag === '--root') opts.root = path.resolve(value())
    else if (flag === '--out') opts.out = path.resolve(value())
    else {
      console.error(`unknown option: ${a}`)
      process.exit(2)
    }
  }
  if (!opts.generator) {
    console.error('usage: gen-app-testids.mjs --generator <bifold>/packages/core/scripts/gen-testids.mjs [--root app] [--out e2e/lib/testids.app.json]')
    process.exit(2)
  }
  return opts
}

const gitHead = (cwd) => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

const main = async () => {
  const opts = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(opts.generator)) {
    console.error(`generator not found: ${opts.generator}`)
    process.exit(1)
  }
  const { generateManifest, formatManifest } = await import(pathToFileURL(opts.generator).href)
  const manifest = generateManifest({ root: opts.root, generatedFrom: gitHead(walletDir) })
  fs.mkdirSync(path.dirname(opts.out), { recursive: true })
  fs.writeFileSync(opts.out, formatManifest(manifest))
  console.log(
    `wrote ${path.relative(process.cwd(), opts.out)} (${Object.keys(manifest.keys).length} keys, ${Object.keys(manifest.stems).length} stems, ${
      Object.keys(manifest.raw).length
    } raw, ${manifest.derived.length} derived) from ${path.relative(walletDir, opts.root)}/src`
  )
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
