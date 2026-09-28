// Run Keyring's REAL TypeScript source, not a copy of it.
//
// Transpiled on the fly and executed as-is: the same code every Keyring
// screen and the witness server's JSON-LD context come from. Paths are
// relative to the repo root, so this works in any checkout with the bifold
// submodule initialized — no build.
//
// `credentialTypes.ts` gained a real import (`@bifold/dtg-vocab`, V3's
// isPeerVrcCredential allowlist fix) — a bare specifier can't resolve from a
// `data:` URL, which has no filesystem location for Node's module resolution
// to walk up from. Instead the transpiled output is written to a real file
// under this rung's own `.generated/` (gitignored), so Node resolves
// `@bifold/dtg-vocab` from this package's own `node_modules` exactly as any
// other dependency would — declared in `package.json` as a `file:` reference
// to `bifold/packages/dtg-vocab`, matching `ref-07i`'s pattern for pulling in
// real workspace packages.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../bifold/packages/', import.meta.url))
const generatedDir = fileURLToPath(new URL('./.generated/', import.meta.url))
mkdirSync(generatedDir, { recursive: true })

async function load(rel) {
  const src = readFileSync(root + rel, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  const outPath = generatedDir + rel.replace(/\//g, '__').replace(/\.ts$/, '.mjs')
  writeFileSync(outPath, outputText)
  return import(outPath)
}

export const credentialTypes = await load('core/src/modules/vrc/credentialTypes.ts')
export const witnessedExchangeContext = await load('vrc-contexts/src/witnessedExchangeContext.ts')

/** Read a Keyring source file as text, for drift guards on shapes the rung relies on. */
export const keyringSource = (rel) => readFileSync(root + rel, 'utf8')
