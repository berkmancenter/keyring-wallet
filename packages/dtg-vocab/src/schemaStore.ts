import witnessContextSchema from '../vocab/schemas/witness-context.schema.json'

import type { SchemaStore } from './predicateHandling'

/**
 * The JSON Schemas `configure()` needs to actually validate an accept-list's
 * named `additionalMembers` constraints (cred-spec C4: "configure() runs
 * once and may load schemas"). Static imports, not `fs.readFileSync` — same
 * reasoning as `acceptList.ts`'s `loadAcceptList()`: this is reachable from
 * the wallet app's own bundle, and Metro has no `fs`/`path` polyfill.
 *
 * Every caller of `configure(loadAcceptList())` in the app was passing no
 * `schemaStore` at all, silently defaulting to `{}` — so `witnessContext`'s
 * named schema was never loaded, and `verify()` unconditionally rejected any
 * credential carrying that member (`schema for witnessContext named but not
 * loaded at configuration time`), 100% of the time, for every witnessed
 * credential. Never caught before a real device actually completed a full
 * witness ceremony (2026-09-29) — the package's own test suite already
 * builds its `schemaStore` correctly; only the app's own call sites missed
 * it.
 */
export function loadSchemaStore(): SchemaStore {
  return {
    'witness-context.schema.json': witnessContextSchema as object,
  }
}
