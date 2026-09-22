// Enrolment code shown on both screens (admin page and phone). The phone
// computes the same thing; any change here is a protocol change.
//
//   SHA-256( UTF-8 "keyring-vta-enrol/v1|" + n + "|" + did )
//   -> first 5 bytes (40 bits) -> 8 Crockford base32 chars, MSB first
//   -> "XXXX-XXXX"
import { createHash } from 'node:crypto'

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function enrolmentCode(nonce, did) {
  const digest = createHash('sha256').update(`keyring-vta-enrol/v1|${nonce}|${did}`, 'utf8').digest()
  let bits = 0n
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(digest[i])
  let out = ''
  for (let i = 7; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}
