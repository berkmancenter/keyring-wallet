/**
 * The `did:scid:vh:1` form of a `did:webvh` identity (VTI-KEY-160; vta-sdk
 * `did_scid.rs` at vta-service-v0.65.0). `did:scid:vh:1:<scid>` is verified by
 * a did:webvh log but not bound to the host serving it, and its `?src=` query
 * is a locator, not part of the identity. openvtc can make a persona in this
 * form (openvtc #503, opt-in): its agent lists it as the did:webvh of its log,
 * while a community may issue its card to the did:scid form. Both carry one
 * SCID, so they are one identity.
 *
 * String rules only, as vta-sdk keeps them, so nothing here resolves a DID.
 */

const SCID_VH_PREFIX = 'did:scid:vh:1:'
const WEBVH_PREFIX = 'did:webvh:'

/** The SCID a did:webvh or did:scid:vh:1 reference carries (vta-sdk `scid_of`). */
export function scidOf(did: string): string | undefined {
  const bare = did.split('#')[0]
  if (bare.startsWith(SCID_VH_PREFIX)) return bare.slice(SCID_VH_PREFIX.length).split('?')[0] || undefined
  if (!bare.startsWith(WEBVH_PREFIX)) return undefined
  const rest = bare.slice(WEBVH_PREFIX.length)
  const colon = rest.indexOf(':')
  return colon > 0 ? rest.slice(0, colon) : undefined
}

/**
 * Whether `a` and `b` name one identity: the same DID, or a did:scid:vh:1 and
 * the did:webvh (or did:scid:vh:1, whatever its `src`) with the same SCID. Two
 * did:webvh DIDs are compared exactly, as before: the host is part of them.
 */
export function sameIdentity(a: string, b: string): boolean {
  if (a === b) return true
  if (!a.startsWith(SCID_VH_PREFIX) && !b.startsWith(SCID_VH_PREFIX)) return false
  const scid = scidOf(a)
  return !!scid && scid === scidOf(b)
}
