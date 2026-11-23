/**
 * A community's role grant in either of its two shapes, and the roles it
 * confers.
 *
 * - **endorsement** (before DTG Credentials v1): an `EndorsementCredential`
 *   whose `credentialSubject.endorsement` is `{ type: "CommunityRole", role,
 *   communityDid }`.
 * - **VAC** (DTG Credentials v1, VTI 0.47.0 / #1859 on): an
 *   `AuthorityCredential` whose `credentialSubject.authority` is
 *   `{ scope: <community DID>, actions: ["role:<name>", …], maxAttenuation }`,
 *   issued by the community itself (tf vetting/vetters/grant/0.1 as recast by
 *   #691; dtg-credentials 0.12.0 `new_community_role_vac`).
 *
 * The VAC rules are vta-sdk's at 0.47.0 (`vetting/eligibility.rs`
 * `community_roles`): a community role grant is a VAC whose `authority.scope`
 * is its own issuer and that has no `parent` (no attenuation), and its roles
 * are its `role:` actions with the prefix taken off. A VAC may confer several.
 */

export const COMMUNITY_ROLE_ENDORSEMENT_TYPE = 'CommunityRole'
/** vta-sdk `protocols/vetting.rs` `ROLE_ACTION_PREFIX`. */
export const ROLE_ACTION_PREFIX = 'role:'
export const VETTER_ROLE = 'vetter'

export type CommunityRoleShape = 'endorsement' | 'vac'

export interface CommunityRoleCard {
  shape: CommunityRoleShape
  /** The community the roles are in: the endorsement's `communityDid`, or the VAC's `authority.scope`. */
  communityDid: string
  /** The roles conferred, bare (`vetter`, `admin`, `custom:<name>`). Never empty. */
  roles: string[]
}

/** vta-sdk `role_of_action`: the role a `role:<name>` action confers, or undefined. */
export function roleOfAction(action: unknown): string | undefined {
  if (typeof action !== 'string' || !action.startsWith(ROLE_ACTION_PREFIX)) return undefined
  const role = action.slice(ROLE_ACTION_PREFIX.length)
  return role || undefined
}

/** vta-sdk `protocols/vetting.rs` `role_matches`: `vetter` and `custom:vetter` are one role; others match exactly. */
export function roleMatches(held: string, required: string): boolean {
  const bare = (role: string) => (role.startsWith('custom:') ? role.slice('custom:'.length) : role)
  return held === required || (bare(held) === VETTER_ROLE && bare(required) === VETTER_ROLE)
}

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

const issuerOf = (credential: Record<string, unknown>): string =>
  typeof credential.issuer === 'string' ? credential.issuer : String(asObject(credential.issuer)?.id ?? '')

/**
 * The community and roles of a role grant in either shape, from its shape only
 * — no proof, window or scope declaration is checked (vta-sdk
 * `community_roles`: "use it to pick candidates out of a wallet").
 */
export function communityRoleCard(credential: unknown): CommunityRoleCard | undefined {
  const c = asObject(credential)
  if (!c) return undefined
  const types = ([] as unknown[]).concat(c.type ?? []).map(String)
  const subject = asObject(c.credentialSubject)
  if (types.includes('EndorsementCredential')) {
    const endorsement = asObject(subject?.endorsement)
    if (endorsement?.type !== COMMUNITY_ROLE_ENDORSEMENT_TYPE) return undefined
    if (typeof endorsement.communityDid !== 'string' || typeof endorsement.role !== 'string') return undefined
    return { shape: 'endorsement', communityDid: endorsement.communityDid, roles: [endorsement.role] }
  }
  if (types.includes('AuthorityCredential')) {
    const authority = asObject(subject?.authority)
    if (!authority || typeof authority.scope !== 'string') return undefined
    // Issued by the community at its own DID, not attenuated from someone's grant.
    if (authority.scope !== issuerOf(c) || authority.parent !== undefined) return undefined
    const roles = ([] as unknown[])
      .concat(authority.actions ?? [])
      .map(roleOfAction)
      .filter((r): r is string => !!r)
    if (!roles.length) return undefined
    return { shape: 'vac', communityDid: authority.scope, roles }
  }
  return undefined
}

/** Whether a role grant confers `role` (as `roleMatches` reads it). */
export function confersRole(card: CommunityRoleCard | undefined, role: string): boolean {
  return !!card && card.roles.some((held) => roleMatches(held, role))
}
