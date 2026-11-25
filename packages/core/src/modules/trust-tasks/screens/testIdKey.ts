/**
 * Row and card handles for testIDs, taken from the whole DID.
 *
 * A DID's tail is not unique: two did:peer:2 keys on one mediator end in the
 * same encoded service block, and two communities on one host end in the same
 * host name. So the handle is a hash of the full DID, which runners can compute
 * themselves (the algorithm is spelled out below so a plain-JS copy matches).
 *
 * @module trust-tasks/screens/testIdKey
 */

/**
 * FNV-1a (32-bit) of the full DID, in base 36, left-padded with "0" to 7
 * characters (2^32 < 36^7, so it is always exactly 7). Hashes UTF-16 code
 * units, which for a DID (ASCII) are its bytes. A JS copy:
 *
 * ```js
 * const didHashKey = (did) => {
 *   let h = 0x811c9dc5
 *   for (let i = 0; i < did.length; i++) {
 *     h ^= did.charCodeAt(i)
 *     h = Math.imul(h, 0x01000193) >>> 0
 *   }
 *   return h.toString(36).padStart(7, '0')
 * }
 * ```
 */
export const didHashKey = (did: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < did.length; i++) {
    h ^= did.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(7, '0')
}

/**
 * A readable prefix for a DID: its last ":"-segment (for did:webvh, the host
 * or last path part), runs of anything but letters and digits turned into
 * "-", cut to 16 characters, with "-" trimmed from both ends. Only for
 * reading; uniqueness comes from {@link didHashKey}. A JS copy:
 *
 * ```js
 * const didLabelKey = (did) =>
 *   (did.split(':').pop() ?? '').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 16).replace(/^-+|-+$/g, '')
 * ```
 */
export const didLabelKey = (did: string): string =>
  (did.split(':').pop() ?? '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .slice(0, 16)
    .replace(/^-+|-+$/g, '')
