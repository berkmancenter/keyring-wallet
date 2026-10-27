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

// The runtime alone: the package root also loads every prebuilt spec module (over 1,200 at 0.27),
// and this service needs three of them, loaded below by path.
export type TrustTaskRuntime = typeof import('@openvtc/trust-tasks/runtime')
export type WitnessSessionPayload = typeof import('@openvtc/trust-tasks/witness/session/0.1/payload')
export type WitnessSubmitPayload = typeof import('@openvtc/trust-tasks/witness/session/submit/0.1/payload')
export type TrustTaskDiscoveryPayload = typeof import('@openvtc/trust-tasks/trust-task-discovery/0.1/payload')

export interface LoadedTrustTaskRuntime {
  runtime: TrustTaskRuntime
  session: WitnessSessionPayload
  submit: WitnessSubmitPayload
  discovery: TrustTaskDiscoveryPayload
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>

let loaded: Promise<LoadedTrustTaskRuntime> | undefined

export function loadTrustTaskRuntime(): Promise<LoadedTrustTaskRuntime> {
  if (!loaded) {
    loaded = Promise.all([
      dynamicImport('@openvtc/trust-tasks/runtime') as Promise<TrustTaskRuntime>,
      dynamicImport('@openvtc/trust-tasks/witness/session/0.1/payload') as Promise<WitnessSessionPayload>,
      dynamicImport('@openvtc/trust-tasks/witness/session/submit/0.1/payload') as Promise<WitnessSubmitPayload>,
      dynamicImport('@openvtc/trust-tasks/trust-task-discovery/0.1/payload') as Promise<TrustTaskDiscoveryPayload>,
    ]).then(([runtime, session, submit, discovery]) => ({ runtime, session, submit, discovery }))
  }
  return loaded
}

/**
 * The two stateful §7.2 checks the framework requires a consumer to choose since 0.27. A wallet's
 * submission can be delayed by its mediator, so this keeps no acceptance window and no duplicate
 * record, as before; the freshness floor refuses only a future-dated document or an empty
 * validity interval. The skew is the wallet's five-minute clock allowance, the same as the
 * wallet's own consumer (@bifold/core TrustTasksService), so the two sides judge alike.
 */
export function witnessConsumeChecks(
  runtime: TrustTaskRuntime
): ReturnType<TrustTaskRuntime['notConsequentialChecks']> {
  return { ...runtime.notConsequentialChecks(), freshness: { ...runtime.DEFAULT_FRESHNESS, skewMs: 5 * 60_000 } }
}
