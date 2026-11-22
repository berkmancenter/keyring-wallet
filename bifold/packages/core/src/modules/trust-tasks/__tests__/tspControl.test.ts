import { tsp } from '@bifold/trust-tasks'
import {
  __unsafeDeterministicPackAccept,
  __unsafeDeterministicPackCancel,
  __unsafeDeterministicPackInvite,
} from '@openvtc/vti-tsp-js/unsafe-testing'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import type { SigningKey } from '@bifold/trust-tasks'

// The other two relationship control frames — the accept (`XRFA`) and the
// cancel (`XRFD`) — checked against upstream's own implementation, as the
// invite is in tspInvite.test.ts. Ours pack over key PORTS, because a persona's
// signing key lives in Askar and never exists as bytes here; upstream's take
// the raw key. The bytes must still come out identical.

function rawSigningKey(privateKey: Uint8Array): SigningKey {
  return { publicKey: ed25519.getPublicKey(privateKey), sign: async (m: Uint8Array) => ed25519.sign(m, privateKey) }
}

const ikmE = new Uint8Array(32).fill(7)
const senderSk = new Uint8Array(32).fill(3)
const receiverSk = new Uint8Array(32).fill(5)
const senderVid = 'did:webvh:QmSender:example.com'
const receiverVid = 'did:webvh:QmReceiver:example.com'
const receiverEncPk = x25519.getPublicKey(receiverSk)
const resolver: tsp.VidResolver = {
  async resolve() {
    return { signingPublicKey: ed25519.getPublicKey(senderSk), encryptionPublicKey: receiverEncPk }
  },
}
const ports = { signingKey: rawSigningKey(senderSk) }
const theirKeys = { senderSigningKey: senderSk, receiverEncryptionKey: receiverEncPk }
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url')

/** A real invite digest to answer, from upstream's own invite. */
async function inviteDigest(): Promise<Uint8Array> {
  const invite = await __unsafeDeterministicPackInvite(
    receiverVid,
    senderVid,
    { senderSigningKey: receiverSk, receiverEncryptionKey: x25519.getPublicKey(senderSk) },
    { nonce: new Uint8Array(16).fill(9) },
    { __unsafeIkmE: ikmE }
  )
  return invite.threadDigest
}

describe('XRFA — the relationship accept', () => {
  test('is byte-identical to upstream’s, answering the same invite', async () => {
    const digest = await inviteDigest()
    const ours = await tsp.__unsafeDeterministicPackAcceptRev3(digest, senderVid, receiverVid, ports, resolver, {
      __unsafeIkmE: ikmE,
    })
    const theirs = await __unsafeDeterministicPackAccept(digest, senderVid, receiverVid, theirKeys, {
      __unsafeIkmE: ikmE,
    })
    expect(b64(ours.bytes)).toBe(b64(theirs.bytes))
    expect(b64(ours.threadDigest)).toBe(b64(theirs.threadDigest))
  })

  test('refuses to answer nothing', async () => {
    await expect(
      tsp.__unsafeDeterministicPackAcceptRev3(new Uint8Array(31), senderVid, receiverVid, ports, resolver, {
        __unsafeIkmE: ikmE,
      })
    ).rejects.toThrow('must name the invite')
  })
})

describe('XRFD — the relationship cancel', () => {
  test('is byte-identical to upstream’s, ending the same relationship', async () => {
    const digest = await inviteDigest()
    const ours = await tsp.__unsafeDeterministicPackCancelRev3(digest, senderVid, receiverVid, ports, resolver, {
      __unsafeIkmE: ikmE,
    })
    const theirs = await __unsafeDeterministicPackCancel(digest, senderVid, receiverVid, theirKeys, {
      __unsafeIkmE: ikmE,
    })
    expect(b64(ours.bytes)).toBe(b64(theirs.bytes))
    // A cancel names the relationship; it does not mint a digest of its own.
    expect(b64(ours.threadDigest)).toBe(b64(digest))
  })

  test('refuses to end nothing', async () => {
    await expect(
      tsp.__unsafeDeterministicPackCancelRev3(new Uint8Array(0), senderVid, receiverVid, ports, resolver, {
        __unsafeIkmE: ikmE,
      })
    ).rejects.toThrow('must name the relationship')
  })
})
