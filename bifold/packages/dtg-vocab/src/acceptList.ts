import { readFileSync } from 'fs'
import { join } from 'path'

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
 * Loads the pre-built accept-list from disk — never derives it from a
 * credential, never dereferences a network URL. This is the verifier's own
 * configuration (cred-spec C4, Predicate Handling step 2), read at
 * configuration time.
 *
 * Resolves relative to this module's own location so it works identically
 * from compiled `build/` output and from `src/` under ts-jest.
 */
export function loadAcceptList(): AcceptList {
  const path = join(__dirname, '..', 'vocab', 'dist', 'accept-list.json')
  return JSON.parse(readFileSync(path, 'utf8')) as AcceptList
}
