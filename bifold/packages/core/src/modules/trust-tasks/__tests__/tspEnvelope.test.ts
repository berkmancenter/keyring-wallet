/**
 * tsp.pack/tsp.unpack — the TSP envelope layer ported onto tsp-core's three
 * ports (SigningKey/KeyAgreement/VidResolver), proven at the reference-script
 * level in tsp-reference/ref-09 through ref-12 (real Askar custody, real
 * Credo VidResolver, real end-to-end round trips). Those don't run under
 * Jest/RN's toolchain, so this suite covers what they can't: the actual
 * compiled TS module, imported and bundled the way the app will, interoperating
 * with the real published @openvtc/vti-tsp-js package. No Agent/KMS needed —
 * every port here is a plain raw-key wrapper, the same reference-adapter shape
 * ref-09/ref-11 use, since the ports themselves carry no custody logic.
 */
import { pack as realPack, unpack as realUnpack } from '@openvtc/vti-tsp-js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { tsp } from '@bifold/trust-tasks'

type SigningKey = tsp.SigningKey
type KeyAgreement = tsp.KeyAgreement
type VidResolver = tsp.VidResolver

function rawKeySigningKey(privateKey: Uint8Array): SigningKey {
  return {
    publicKey: ed25519.getPublicKey(privateKey),
    async sign(message) {
      return ed25519.sign(message, privateKey)
    },
  }
}

function rawKeyAgreement(privateKey: Uint8Array): KeyAgreement {
  return {
    publicKey: x25519.getPublicKey(privateKey),
    async agree(peerPublicKey) {
      return x25519.getSharedSecret(privateKey, peerPublicKey)
    },
  }
}

function fixtureResolver(registry: Record<string, tsp.ResolvedVidKeys>): VidResolver {
  return {
    async resolve(vid) {
      const keys = registry[vid]
      if (!keys) throw new Error(`no fixture registered for vid ${vid}`)
      return keys
    },
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s)
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

describe('tsp.pack / tsp.unpack', () => {
  const senderVid = 'did:example:sender'
  const receiverVid = 'did:example:receiver'

  const senderSignSk = ed25519.utils.randomSecretKey()
  const senderEncSk = x25519.utils.randomSecretKey()
  const receiverEncSk = x25519.utils.randomSecretKey()

  const senderSignPk = ed25519.getPublicKey(senderSignSk)
  const senderEncPk = x25519.getPublicKey(senderEncSk)
  const receiverEncPk = x25519.getPublicKey(receiverEncSk)

  const senderIdentity = { signingKey: rawKeySigningKey(senderSignSk), keyAgreement: rawKeyAgreement(senderEncSk) }
  const receiverIdentity = { keyAgreement: rawKeyAgreement(receiverEncSk) }

  const resolver = fixtureResolver({
    [senderVid]: { encryptionPublicKey: senderEncPk, signingPublicKey: senderSignPk },
    [receiverVid]: { encryptionPublicKey: receiverEncPk, signingPublicKey: new Uint8Array(32) },
  })

  const plaintext = utf8('hello from a jest-run TSP envelope test')

  test('round-trips through our own pack/unpack', async () => {
    const sealed = await tsp.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    const opened = await tsp.unpack(sealed.bytes, receiverIdentity, resolver)
    expect(eq(opened.payload, plaintext)).toBe(true)
    expect(opened.sender).toBe(senderVid)
    expect(opened.receiver).toBe(receiverVid)
    expect(opened.messageType).toBe('direct')
    expect(eq(opened.threadDigest, sealed.threadDigest)).toBe(true)
  })

  test('interoperates with the real published @openvtc/vti-tsp-js: our pack() -> its unpack()', async () => {
    const sealed = await tsp.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    const opened = await realUnpack(sealed.bytes, {
      receiverDecryptionKey: receiverEncSk,
      senderEncryptionKey: senderEncPk,
      senderSigningKey: senderSignPk,
    })
    expect(eq(opened.payload, plaintext)).toBe(true)
    expect(opened.sender).toBe(senderVid)
    expect(opened.receiver).toBe(receiverVid)
  })

  test('interoperates with the real published @openvtc/vti-tsp-js: its pack() -> our unpack()', async () => {
    const sealed = await realPack(plaintext, senderVid, receiverVid, {
      senderSigningKey: senderSignSk,
      senderEncryptionKey: senderEncSk,
      receiverEncryptionKey: receiverEncPk,
    })
    const opened = await tsp.unpack(sealed.bytes, receiverIdentity, resolver)
    expect(eq(opened.payload, plaintext)).toBe(true)
    expect(opened.sender).toBe(senderVid)
    expect(opened.receiver).toBe(receiverVid)
  })

  test('rejects tampered wire bytes', async () => {
    const sealed = await tsp.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    const tampered = sealed.bytes.slice()
    tampered[tampered.length - 1] ^= 0xff
    await expect(tsp.unpack(tampered, receiverIdentity, resolver)).rejects.toThrow()
  })

  test('rejects a different recipient trying to open the message', async () => {
    const sealed = await tsp.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    const wrongRecipient = { keyAgreement: rawKeyAgreement(x25519.utils.randomSecretKey()) }
    await expect(tsp.unpack(sealed.bytes, wrongRecipient, resolver)).rejects.toThrow()
  })
})
