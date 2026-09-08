/**
 * The real `@openvtc/trust-tasks` runtime, loaded into this CommonJS service.
 *
 * The package is ESM-only with an `import`-condition-only exports map, so
 * `require()` cannot load it even on Node 20.19's require(esm) (the
 * condition set has no `default`/`require` entry) — dynamic `import()` is the
 * one legal bridge. TypeScript with `module: commonjs` rewrites a literal
 * `import()` into `require()`, so the call goes through `Function` to reach
 * Node's native dynamic import untouched. Types resolve through the tsconfig
 * `paths` map onto the package's .d.ts files. Loaded once, cached.
 *
 * Why this replaced the local ./framework.ts pipeline: one §7.2
 * implementation for wallet and witness (the wallet consumes through the
 * same runtime), so conformance cannot drift between the two sides.
 */

export type TrustTaskRuntime = typeof import('@openvtc/trust-tasks')
export type WitnessSessionPayload = typeof import('@openvtc/trust-tasks/witness/session/0.1/payload')
export type WitnessSubmitPayload = typeof import('@openvtc/trust-tasks/witness/session/submit/0.1/payload')

export interface LoadedTrustTaskRuntime {
  runtime: TrustTaskRuntime
  session: WitnessSessionPayload
  submit: WitnessSubmitPayload
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>

let loaded: Promise<LoadedTrustTaskRuntime> | undefined

export function loadTrustTaskRuntime(): Promise<LoadedTrustTaskRuntime> {
  if (!loaded) {
    loaded = Promise.all([
      dynamicImport('@openvtc/trust-tasks') as Promise<TrustTaskRuntime>,
      dynamicImport('@openvtc/trust-tasks/witness/session/0.1/payload') as Promise<WitnessSessionPayload>,
      dynamicImport('@openvtc/trust-tasks/witness/session/submit/0.1/payload') as Promise<WitnessSubmitPayload>,
    ]).then(([runtime, session, submit]) => ({ runtime, session, submit }))
  }
  return loaded
}
