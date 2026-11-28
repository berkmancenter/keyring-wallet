// hcp/number.mjs: the HCP match number, a second implementation.
//
// From the track C brief's "The match number": the first 4 bytes of
// SHA-256(UTF-8(threadId) || 0x00 || UTF-8(clientVid)), read as an unsigned big-endian 32-bit integer, modulo
// 10000, written as 4 decimal digits with leading zeros. `threadId` is the full `urn:uuid:…`.
//
// Not a secret (anyone who sees the QR can compute it); its worth is the comparison the person makes between their
// terminal and the link Keyring scanned.

import { sha256 } from "@noble/hashes/sha2.js";

const encoder = new TextEncoder();

/** The four-digit match number of `threadId` and `clientVid`. */
export function hcpMatchNumber(threadId, clientVid) {
  const thread = encoder.encode(threadId);
  const client = encoder.encode(clientVid);
  const input = new Uint8Array(thread.length + 1 + client.length);
  input.set(thread, 0);
  input[thread.length] = 0;
  input.set(client, thread.length + 1);
  const digest = sha256(input);
  const value = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0, false);
  return String(value % 10000).padStart(4, "0");
}
