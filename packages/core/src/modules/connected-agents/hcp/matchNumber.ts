/**
 * The match number (step 7.27 track C, "The match number"): the first 4 bytes of
 * `SHA-256(UTF-8(threadId) || 0x00 || UTF-8(clientVid))`, read as an unsigned big-endian 32-bit integer, modulo
 * 10000, as 4 decimal digits with leading zeros. `threadId` is the full `urn:uuid:…`.
 *
 * Not a secret: anyone who sees the QR can compute it. Its value is the comparison, since a substituted link changes
 * the client's VID or the thread, and with them the number. Keyring never displays it, so the person reads it from
 * their own terminal, and never logs it (plan §6).
 *
 * @module connected-agents/hcp/matchNumber
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** The four-digit match number for a thread and a client. */
export function hcpMatchNumber(threadId: string, clientVid: string): string {
  const digest = sha256(concatBytes(utf8ToBytes(threadId), new Uint8Array([0]), utf8ToBytes(clientVid)))
  const value = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0
  return String(value % 10000).padStart(4, '0')
}

/** Whether `typed` is exactly four ASCII digits and the match number. */
export function hcpNumberMatches(typed: string, threadId: string, clientVid: string): boolean {
  return typeof typed === 'string' && /^[0-9]{4}$/.test(typed) && typed === hcpMatchNumber(threadId, clientVid)
}
