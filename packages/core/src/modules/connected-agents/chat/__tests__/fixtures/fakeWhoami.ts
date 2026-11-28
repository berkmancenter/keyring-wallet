/**
 * A fake `auth/whoami` that answers who granted the caller's entry (§11 Q7, option 3). The real `auth/whoami/0.1`
 * names no granter today (VTI 97fda9813, trust_tasks/auth.rs), and an agent cannot read its own entry (`acl/show/0.3`
 * is manage-only), so the field is asked upstream; until a VTA serves it, the agent's check runs against this seam.
 * The members follow acl-entry 0.3: `createdBy`, and `delegatedBy` when the entry was written on a granter's behalf.
 */
export interface WhoamiAnswer {
  did: string
  role: string
  createdBy?: string
  delegatedBy?: string
}

/** An `auth/whoami` for `did` whose entry was created by `createdBy`, and delegated by `delegatedBy` when given. */
export function fakeWhoami(answer: { did: string; createdBy?: string; delegatedBy?: string; role?: string }) {
  return async (): Promise<WhoamiAnswer> => ({ role: 'application', ...answer })
}
