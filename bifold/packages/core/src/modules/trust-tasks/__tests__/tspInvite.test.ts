import { tsp } from '@bifold/trust-tasks'
import { __unsafeDeterministicPackInvite } from '@openvtc/vti-tsp-js/unsafe-testing'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import type { SigningKey } from '@bifold/trust-tasks'

function rawSigningKey(privateKey: Uint8Array): SigningKey {
  return { publicKey: ed25519.getPublicKey(privateKey), sign: async (m: Uint8Array) => ed25519.sign(m, privateKey) }
}

// The relationship-forming invite (`XRFI`), checked against upstream's own
// implementation rather than against our reading of the specification.
//
// This is the frame that makes every other Rev 3 message deliverable: §7.2.2
// says a peer drops — not refuses — an application message from a VID it holds
// no relationship with, so a wallet that cannot invite cannot talk to the
// ecosystem at all. Ours is built over key PORTS because the persona's signing
// key lives in Askar and never appears in memory as bytes; upstream's takes the
// raw key. The bytes must still come out identical, and that is what these
// assert.

const ikmE = new Uint8Array(32).fill(7)
const nonce = new Uint8Array(16).fill(9)
const senderSk = new Uint8Array(32).fill(3)
const receiverSk = new Uint8Array(32).fill(5)

const senderVid = 'did:webvh:QmSender:example.com'
const receiverVid = 'did:webvh:QmReceiver:example.com'

const receiverEncPk = x25519.getPublicKey(receiverSk)
const senderSignPk = ed25519.getPublicKey(senderSk)

const resolver: tsp.VidResolver = {
  async resolve() {
    return { signingPublicKey: senderSignPk, encryptionPublicKey: receiverEncPk }
  },
}
const ports = { signingKey: rawSigningKey(senderSk) }

describe('XRFI — the relationship-forming invite', () => {
  test('is byte-identical to upstream’s, from the same ephemeral and nonce', async () => {
    const ours = await tsp.__unsafeDeterministicPackInviteRev3(
      senderVid,
      receiverVid,
      ports,
      resolver,
      { nonce },
      { __unsafeIkmE: ikmE }
    )
    const theirs = await __unsafeDeterministicPackInvite(
      senderVid,
      receiverVid,
      { senderSigningKey: senderSk, receiverEncryptionKey: receiverEncPk },
      { nonce },
      { __unsafeIkmE: ikmE }
    )
    expect(Buffer.from(ours.bytes).toString('base64url')).toBe(Buffer.from(theirs.bytes).toString('base64url'))
  })

  test('derives the same self-addressing thread digest', async () => {
    // The digest is what an accept echoes and a cancellation names, and it
    // covers the envelope this call builds — so agreeing on it is agreeing on
    // the whole derivation, not just the visible bytes.
    const ours = await tsp.__unsafeDeterministicPackInviteRev3(
      senderVid, receiverVid, ports, resolver, { nonce }, { __unsafeIkmE: ikmE }
    )
    const theirs = await __unsafeDeterministicPackInvite(
      senderVid, receiverVid,
      { senderSigningKey: senderSk, receiverEncryptionKey: receiverEncPk },
      { nonce }, { __unsafeIkmE: ikmE }
    )
    expect(Buffer.from(ours.threadDigest).toString('hex')).toBe(Buffer.from(theirs.threadDigest).toString('hex'))
  })

  test('a Reply_Path travels in the frame and changes the digest', async () => {
    // §7.2.4: the route is how the accept finds its way back, and it is
    // derivation input — an invite that advertises a different return path is a
    // different invite, not the same one re-sent.
    const route = ['did:peer:2.mediator']
    const withRoute = await tsp.__unsafeDeterministicPackInviteRev3(
      senderVid, receiverVid, ports, resolver, { nonce, route }, { __unsafeIkmE: ikmE }
    )
    const theirs = await __unsafeDeterministicPackInvite(
      senderVid, receiverVid,
      { senderSigningKey: senderSk, receiverEncryptionKey: receiverEncPk },
      { nonce, route }, { __unsafeIkmE: ikmE }
    )
    expect(Buffer.from(withRoute.bytes).toString('base64url')).toBe(Buffer.from(theirs.bytes).toString('base64url'))

    const withoutRoute = await tsp.__unsafeDeterministicPackInviteRev3(
      senderVid, receiverVid, ports, resolver, { nonce }, { __unsafeIkmE: ikmE }
    )
    expect(Buffer.from(withRoute.threadDigest).toString('hex')).not.toBe(
      Buffer.from(withoutRoute.threadDigest).toString('hex')
    )
  })

  test('refuses a nonce that is not 128 bits', async () => {
    await expect(
      tsp.packInviteRev3(senderVid, receiverVid, ports, resolver, { nonce: new Uint8Array(32) })
    ).rejects.toThrow(/128-bit nonce/)
  })
})
