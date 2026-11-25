/**
 * B5 of the TSP 1.0 bridge: the witness reads both TSP versions (through
 * `tsp.unpack`) and answers in the version the request used.
 */
import { tsp } from '@bifold/trust-tasks'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { packTspReply } from '../../src/trustTasks/tspReply'

const witnessVid = 'did:example:witness'
const phoneVid = 'did:example:phone'
const witnessSignSk = new Uint8Array(32).fill(21)
const phoneSignSk = new Uint8Array(32).fill(23)
const phoneEncSk = new Uint8Array(32).fill(25)
const witnessEncSk = new Uint8Array(32).fill(27)

const resolver: tsp.VidResolver = {
  async resolve(vid) {
    if (vid === witnessVid)
      return {
        signingPublicKey: ed25519.getPublicKey(witnessSignSk),
        encryptionPublicKey: x25519.getPublicKey(witnessEncSk),
      }
    return { signingPublicKey: ed25519.getPublicKey(phoneSignSk), encryptionPublicKey: x25519.getPublicKey(phoneEncSk) }
  },
}
const signingKey = (sk: Uint8Array): tsp.SigningKey => ({
  publicKey: ed25519.getPublicKey(sk),
  sign: async (m) => ed25519.sign(m, sk),
})
const keyAgreement = (sk: Uint8Array): tsp.KeyAgreement => ({
  publicKey: x25519.getPublicKey(sk),
  agree: async (peer) => x25519.getSharedSecret(sk, peer),
})
const body = new TextEncoder().encode(JSON.stringify({ type: 'https://example/witness/session/0.1#response' }))

describe('the witness answers TSP in the version it was asked in', () => {
  test.each([
    ['v1', tsp.packV1, 1],
    ['rev3', tsp.packRev3, 0],
  ] as const)('a %s request is read, and answered in the same version', async (revision, packer, major) => {
    // The phone's request, as the witness receives it.
    const request = await packer(body, phoneVid, witnessVid, { signingKey: signingKey(phoneSignSk) }, resolver)
    const read = await tsp.unpack(request.bytes, { keyAgreement: keyAgreement(witnessEncSk) }, resolver)
    expect(read.revision).toBe(revision)

    const reply = await packTspReply(
      body,
      witnessVid,
      phoneVid,
      { signingKey: signingKey(witnessSignSk) },
      resolver,
      read.revision
    )
    expect(tsp.readTspVersion(reply.bytes).major).toBe(major)
    const opened = await tsp.unpack(reply.bytes, { keyAgreement: keyAgreement(phoneEncSk) }, resolver)
    expect(opened.revision).toBe(revision)
    expect(new TextDecoder().decode(opened.payload)).toBe(new TextDecoder().decode(body))
  })

  test('with no recorded request version the witness answers Rev 3, as before', async () => {
    const reply = await packTspReply(body, witnessVid, phoneVid, { signingKey: signingKey(witnessSignSk) }, resolver)
    expect(tsp.peekRevision(reply.bytes).revision).toBe('rev3')
  })

  test('a Rev 2 request is answered in Rev 3, as before', async () => {
    const reply = await packTspReply(
      body,
      witnessVid,
      phoneVid,
      { signingKey: signingKey(witnessSignSk) },
      resolver,
      'rev2'
    )
    expect(tsp.peekRevision(reply.bytes).revision).toBe('rev3')
  })
})
