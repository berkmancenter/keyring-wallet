/**
 * The handle a connected AI agent is mentioned by in a room (`@notes-helper-7f3k`), as
 * docs/plans/agent-connect-plan.md §3.6 defines it: `<slug>-<suffix>`.
 *
 * - `slug`: the agent's name lower-cased, each space as `-`, every character outside `a-z0-9-` dropped, at most
 *   32 characters. A name that leaves nothing (say, one written only in another script) gives `agent`.
 * - `suffix`: the first 4 characters of the lower-case, unpadded RFC 4648 base32 of SHA-256 over the UTF-8 bytes
 *   of the agent's lasting DID `K_a` (the DID string, as the plugin sees it on the wire).
 *
 * If the handle is already taken by another of the owner's agents, the suffix grows to 6 characters. If that is
 * taken too, no handle is given: the pairing fails with `handle-collision` (two of one owner's agents whose DIDs
 * agree in their first 30 bits; open in the plan, §3.6).
 *
 * The handle is fixed when pairing confirms the entry (§3.2 step 10) and stored, so a later key change does not
 * move it. It is not secret and not an identity.
 *
 * The plugin derives and matches the same handles. The cases it must agree on are in `vectors/handle.json`,
 * shared with it byte for byte (plan §7.2; the plugin's matching tests are step 7.15).
 *
 * Pure: no storage, no network.
 *
 * @module connected-agents/handle
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

/** The longest slug, in characters. */
export const HANDLE_SLUG_MAX = 32

/** The suffix length, and its length after one collision. */
export const HANDLE_SUFFIX_LENGTH = 4
export const HANDLE_SUFFIX_EXTENDED_LENGTH = 6

/** The slug a name that leaves no character gives. */
export const HANDLE_EMPTY_SLUG = 'agent'

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** Lower-case, unpadded RFC 4648 base32. */
export function base32Lower(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
    // keep only the bits not yet written, so the buffer never grows past 12 bits
    buffer &= (1 << bits) - 1
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31]
  return out
}

/** The slug of an agent's name (§3.6). */
export function handleSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, HANDLE_SLUG_MAX)
  return slug === '' ? HANDLE_EMPTY_SLUG : slug
}

/** The full base32 digest a suffix is cut from. */
function didDigest(agentDid: string): string {
  return base32Lower(sha256(utf8ToBytes(agentDid)))
}

/** The handle with a suffix of the given length. */
export function handleWithSuffix(name: string, agentDid: string, suffixLength: number): string {
  return `${handleSlug(name)}-${didDigest(agentDid).slice(0, suffixLength)}`
}

export type HandleResult = { ok: true; handle: string } | { ok: false; reason: 'handle-collision' }

/**
 * The handle for an agent, given the handles the owner's other agents already hold (compared case-insensitively,
 * as the plugin matches them).
 */
export function deriveHandle(name: string, agentDid: string, takenHandles: Iterable<string>): HandleResult {
  const taken = new Set([...takenHandles].map((h) => h.toLowerCase()))
  for (const length of [HANDLE_SUFFIX_LENGTH, HANDLE_SUFFIX_EXTENDED_LENGTH]) {
    const handle = handleWithSuffix(name, agentDid, length)
    if (!taken.has(handle)) return { ok: true, handle }
  }
  return { ok: false, reason: 'handle-collision' }
}
