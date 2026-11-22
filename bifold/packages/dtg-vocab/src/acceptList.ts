import acceptListJson from '../vocab/dist/accept-list.json'

/**
 * A predicate profile's machine-checkable constraints, as published in
 * vocab/dist/accept-list.json. Carries exactly what cred-spec's Predicate
 * Handling (C4) needs at verification time — never anything requiring a
 * network fetch.
 */
export interface AdditionalMemberConstraint {
  required: boolean
  schema?: string
  description?: string
}

export interface AcceptListEntry {
  status: 'draft' | 'proposed' | 'active' | 'deprecated'
  objectKind: Array<'id' | 'digestMultibase' | 'value'>
  taskContextRequired: boolean
  minimumIssuerScope?: 'pairwise' | 'directed' | 'public'
  additionalMembers?: Record<string, AdditionalMemberConstraint>
  subjectObjectRelationship?: string
}

export type AcceptList = Record<string, AcceptListEntry>

/**
 * Loads the pre-built accept-list — never derives it from a credential,
 * never dereferences a network URL. This is the verifier's own configuration
 * (cred-spec C4, Predicate Handling step 2), read at configuration time.
 *
 * A static JSON import, not a runtime `fs.readFileSync`: this module is
 * reachable from the wallet app's own bundle (`@bifold/core`'s
 * `credentialTypes.ts`/`witnessCeremony.ts` call it directly, not just
 * `witness-server`), and Metro has no `fs`/`path` polyfill — a runtime read
 * only ever worked under Node (ts-jest, ts-node, the compiled server), never
 * once bundled for a real device until this was caught. `resolveJsonModule`
 * is already on in this package's tsconfig, so this resolves identically
 * from `src/` and from compiled `build/` output, same as the old comment
 * promised for the `fs` version.
 */
export function loadAcceptList(): AcceptList {
  return acceptListJson as AcceptList
}
