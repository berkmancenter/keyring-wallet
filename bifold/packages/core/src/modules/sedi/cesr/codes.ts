/**
 * The CESR codes this reader supports: exactly those the K0 test kit's KEL streams contain (keripy 7143832, CESR v2;
 * enumerated from the fixtures, src/modules/sedi/__tests__/fixtures/k0-utah-v2), with the sizes from cesr-ts 2.0.0's
 * generated tables (counter.tables, indexer.tables, matter.tables). Anything else is refused as `unsupportedCesr`,
 * never guessed at or skipped. Add a code only with a fixture that carries it.
 *
 * @module sedi/cesr/codes
 */

/** Event bodies: KERI, protocol 2.0, genus 2.0, JSON; the 4 characters after this prefix are the size, then '.'. */
export const KERI_V2_JSON = 'KERICAACAAJSON'

/** Count codes (CESR v2, small: hard 2, soft 2; the count is in quadlets of the group's content). */
export const COUNTERS: Readonly<Record<string, { name: 'ControllerIdxSigs' }>> = {
  '-K': { name: 'ControllerIdxSigs' },
}

/** Indexed signatures (hard 1, soft 1 = the index; full size 88 characters). */
export const INDEXED_SIGS: Readonly<Record<string, { name: string; curve: 'p256' | 'ed25519'; fs: number }>> = {
  E: { name: 'ECDSA_256r1_Sig', curve: 'p256', fs: 88 },
  A: { name: 'Ed25519_Sig', curve: 'ed25519', fs: 88 },
}

/** Verification keys. */
export const KEYS: Readonly<
  Record<string, { name: string; curve: 'p256' | 'ed25519'; fs: number; transferable: boolean }>
> = {
  '1AAJ': { name: 'ECDSA_256r1', curve: 'p256', fs: 48, transferable: true },
  '1AAI': { name: 'ECDSA_256r1N', curve: 'p256', fs: 48, transferable: false },
  B: { name: 'Ed25519N', curve: 'ed25519', fs: 44, transferable: false },
}

/** Digests (event SAIDs, self-addressing prefixes, next-key commitments). */
export const DIGESTS: Readonly<Record<string, { name: 'Blake3_256' | 'SHA2_256'; fs: number }>> = {
  E: { name: 'Blake3_256', fs: 44 },
  I: { name: 'SHA2_256', fs: 44 },
}
