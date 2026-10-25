// Run Keyring's REAL TypeScript source, not a copy of it.
//
// The two modules below have no imports, so they can be transpiled on the fly
// and executed as-is: the same code every Keyring screen and the witness
// server's JSON-LD context come from. Paths are relative to the repo root, so
// this works in any checkout with the bifold submodule initialized — no build.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../bifold/packages/', import.meta.url))

async function load(rel) {
  const src = readFileSync(root + rel, 'utf8')
  if (/^import\s/m.test(src)) throw new Error(`${rel} gained imports; it can no longer be loaded standalone`)
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

export const credentialTypes = await load('core/src/modules/vrc/credentialTypes.ts')
export const witnessedExchangeContext = await load('vrc-contexts/src/witnessedExchangeContext.ts')

/** Read a Keyring source file as text, for drift guards on shapes the rung relies on. */
export const keyringSource = (rel) => readFileSync(root + rel, 'utf8')
