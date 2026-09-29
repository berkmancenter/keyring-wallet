/** The start of a DID, enough to tell identities apart in a log, never the whole identifier. */
export function didPrefix(did: unknown): string {
  if (typeof did !== 'string' || !did) return 'none'
  return did.length > 24 ? `${did.slice(0, 24)}…` : did
}
