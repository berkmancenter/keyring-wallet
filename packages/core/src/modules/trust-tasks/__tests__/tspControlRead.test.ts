/**
 * Reading a relationship-forming control frame (§7.2, §9.3): what Keyring needs to ANSWER an invite, which it must
 * do as a shared-connect inviter (relationship-over-tsp plan WP9): a scanner sends `XRFI` before its `propose`, and
 * an affinidi-based scanner holds its application frames until the accept comes back.
 *
 * The codec still refuses a control frame as an application message (every caller matching on
 * CONTROL_FRAME_RECEIVED keeps working), but the refusal now carries what the frame said, once the frame was opened,
 * its signature verified and its self-addressing digest recomputed. Checked against the specification's 1.0
 * Appendix A vectors and against upstream's own 1.0 implementation (@openvtc/vti-tsp-js 0.4.0), in both directions.
 */
import {
  packAccept as v1PackAccept,
  packInvite as v1PackInvite,
  resolveAccept as v1ResolveAccept,
  unpack as v1Unpack,
} from '@openvtc/vti-tsp-js-v1'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { tsp } from '@bifold/trust-tasks'

import v1Vectors from './fixtures/tsp-v1-spec-vectors.json'

const b64u = (s: string) => tsp.fromBase64Url(s)
const eq = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])

function rawSigningKey(privateKey: Uint8Array): tsp.SigningKey {
  return { publicKey: ed25519.getPublicKey(privateKey), sign: async (m) => ed25519.sign(m, privateKey) }
}
function rawKeyAgreement(privateKey: Uint8Array): tsp.KeyAgreement {
  return { publicKey: x25519.getPublicKey(privateKey), agree: async (peer) => x25519.getSharedSecret(privateKey, peer) }
}

/** What unpack threw: the control frame it reports, or the error itself when it is not one. */
async function refusal(bytes: Uint8Array, receiver: Pick<tsp.TspIdentity, 'keyAgreement'>, resolver: tsp.VidResolver) {
  try {
    await tsp.unpack(bytes, receiver, resolver)
  } catch (error) {
    return error as Error & Partial<tsp.TspControlFrameReceived>
  }
  throw new Error('unpack opened a control frame as an application message')
}

// Two parties with their own keys; one resolver that knows both.
const ALICE = 'did:example:alice-inviter'
const BOB = 'did:example:bob-scanner'
const sk = {
  aliceSign: new Uint8Array(32).fill(1),
  aliceEnc: new Uint8Array(32).fill(2),
  bobSign: new Uint8Array(32).fill(3),
  bobEnc: new Uint8Array(32).fill(4),
}
const resolver: tsp.VidResolver = {
  async resolve(vid) {
    if (vid === ALICE)
      return {
        signingPublicKey: ed25519.getPublicKey(sk.aliceSign),
        encryptionPublicKey: x25519.getPublicKey(sk.aliceEnc),
      }
    if (vid === BOB)
      return { signingPublicKey: ed25519.getPublicKey(sk.bobSign), encryptionPublicKey: x25519.getPublicKey(sk.bobEnc) }
    throw new Error(`unknown ${vid}`)
  },
}
const alice = { signingKey: rawSigningKey(sk.aliceSign), keyAgreement: rawKeyAgreement(sk.aliceEnc) }
const bob = { signingKey: rawSigningKey(sk.bobSign), keyAgreement: rawKeyAgreement(sk.bobEnc) }
const ROUTE = ['did:example:mediator', BOB]

describe('control frames, read: our own', () => {
  test.each([
    ['v1', tsp.packInviteV1],
    ['rev3', tsp.packInviteRev3],
  ] as const)(
    'an invite (%s) is reported with its digest, nonce, route, sender and receiver',
    async (revision, packInvite) => {
      const nonce = new Uint8Array(16).fill(9)
      const invite = await packInvite(BOB, ALICE, bob, resolver, { route: ROUTE, nonce })
      const error = await refusal(invite.bytes, alice, resolver)
      expect(error.message.startsWith(tsp.CONTROL_FRAME_RECEIVED)).toBe(true)
      expect(tsp.isTspControlFrame(error)).toBe(true)
      expect(error.control?.kind).toBe('invite')
      expect(eq(error.control?.digest, invite.threadDigest)).toBe(true)
      expect(eq(error.control?.nonce, nonce)).toBe(true)
      expect(error.control?.route).toEqual(ROUTE)
      expect([error.sender, error.receiver, error.revision]).toEqual([BOB, ALICE, revision])
    }
  )

  test('an accept is reported with the invite it answers and its own digest', async () => {
    const invite = await tsp.packInviteV1(BOB, ALICE, bob, resolver, { route: ROUTE })
    const accept = await tsp.packAcceptV1(invite.threadDigest, ALICE, BOB, alice, resolver)
    const error = await refusal(accept.bytes, bob, resolver)
    expect(tsp.isTspControlFrame(error)).toBe(true)
    expect(error.control?.kind).toBe('accept')
    expect(eq(error.control?.replyDigest, invite.threadDigest)).toBe(true)
    expect(eq(error.control?.digest, accept.threadDigest)).toBe(true)
  })

  test('a cancel is reported with the relationship it names', async () => {
    const invite = await tsp.packInviteV1(BOB, ALICE, bob, resolver)
    const cancel = await tsp.packCancelV1(invite.threadDigest, BOB, ALICE, bob, resolver)
    const error = await refusal(cancel.bytes, alice, resolver)
    expect(tsp.isTspControlFrame(error)).toBe(true)
    expect(error.control?.kind).toBe('cancel')
    expect(eq(error.control?.digest, invite.threadDigest)).toBe(true)
  })

  test('control: an application frame still opens as one, and is no control frame', async () => {
    const body = new TextEncoder().encode('a Trust Task')
    const opened = await tsp.unpack((await tsp.packV1(body, BOB, ALICE, bob, resolver)).bytes, alice, resolver)
    expect(opened.messageType).toBe('direct')
    expect(tsp.isTspControlFrame(undefined)).toBe(false)
    expect(tsp.isTspControlFrame(new Error(tsp.CONTROL_FRAME_RECEIVED))).toBe(false)
  })

  test('a frame for someone else is never reported: it fails to open first', async () => {
    const invite = await tsp.packInviteV1(BOB, ALICE, bob, resolver)
    const error = await refusal(invite.bytes, bob, resolver) // Bob holds the wrong key for a frame sealed to Alice
    expect(tsp.isTspControlFrame(error)).toBe(false)
    expect(error.message.startsWith(tsp.CONTROL_FRAME_RECEIVED)).toBe(false)
  })
})

describe('control frames, read: against upstream 1.0 (@openvtc/vti-tsp-js 0.4.0)', () => {
  test("upstream's invite is read with upstream's own digest", async () => {
    const invite = await v1PackInvite(
      BOB,
      ALICE,
      { senderSigningKey: sk.bobSign, receiverEncryptionKey: x25519.getPublicKey(sk.aliceEnc) },
      { route: ROUTE }
    )
    const error = await refusal(invite.bytes, alice, resolver)
    expect(tsp.isTspControlFrame(error)).toBe(true)
    expect(eq(error.control?.digest, invite.threadDigest)).toBe(true)
    expect(error.control?.route).toEqual(ROUTE)
  })

  test('our accept answering it is one upstream adopts against its pending invite', async () => {
    const invite = await v1PackInvite(
      BOB,
      ALICE,
      { senderSigningKey: sk.bobSign, receiverEncryptionKey: x25519.getPublicKey(sk.aliceEnc) },
      { route: ROUTE }
    )
    const read = await refusal(invite.bytes, alice, resolver)
    const accept = await tsp.packAcceptV1(read.control!.digest, ALICE, BOB, alice, resolver)
    const opened = await v1Unpack(accept.bytes, {
      receiverDecryptionKey: sk.bobEnc,
      senderSigningKey: ed25519.getPublicKey(sk.aliceSign),
    })
    expect(opened.messageType).toBe('control')
    expect(opened.control?.controlType).toBe('accept')
    expect(v1ResolveAccept('pending', opened.control?.inReplyTo, invite.threadDigest)).toEqual({ action: 'adopt' })
  })

  test('control: an accept answering some other invite is one upstream ignores', async () => {
    const invite = await v1PackInvite(
      BOB,
      ALICE,
      { senderSigningKey: sk.bobSign, receiverEncryptionKey: x25519.getPublicKey(sk.aliceEnc) },
      {}
    )
    const other = await tsp.packInviteV1(BOB, ALICE, bob, resolver)
    const accept = await tsp.packAcceptV1(other.threadDigest, ALICE, BOB, alice, resolver)
    const opened = await v1Unpack(accept.bytes, {
      receiverDecryptionKey: sk.bobEnc,
      senderSigningKey: ed25519.getPublicKey(sk.aliceSign),
    })
    expect(v1ResolveAccept('pending', opened.control?.inReplyTo, invite.threadDigest).action).toBe('ignore')
  })

  test("upstream's accept of our invite is read with the digest it answers", async () => {
    const invite = await tsp.packInviteV1(BOB, ALICE, bob, resolver, { route: ROUTE })
    const accept = await v1PackAccept(invite.threadDigest, ALICE, BOB, {
      senderSigningKey: sk.aliceSign,
      receiverEncryptionKey: x25519.getPublicKey(sk.bobEnc),
    })
    const error = await refusal(accept.bytes, bob, resolver)
    expect(error.control?.kind).toBe('accept')
    expect(eq(error.control?.replyDigest, invite.threadDigest)).toBe(true)
    expect(eq(error.control?.digest, accept.threadDigest)).toBe(true)
  })
})

describe('control frames, read: the specification Appendix A vectors', () => {
  type Identifier = { id: string; pkS: string; pkE: string; skE: string }
  type Vector = { sender: string; receiver: string; message: string }
  const ids = v1Vectors.identifiers as unknown as Record<string, Identifier>
  const vectors = v1Vectors.vectors as unknown as Record<string, Vector>
  const vectorResolver: tsp.VidResolver = {
    async resolve(vid) {
      const found = Object.values(ids).find((i) => i.id === vid)
      if (!found) throw new Error(`no fixture identifier for ${vid}`)
      return { signingPublicKey: b64u(found.pkS), encryptionPublicKey: b64u(found.pkE) }
    },
  }
  const read = (name: string) =>
    refusal(
      b64u(vectors[name].message),
      { keyAgreement: rawKeyAgreement(b64u(ids[vectors[name].receiver].skE)) },
      vectorResolver
    )

  test('control-rfi-direct, control-rfa-direct and control-rfd are read and their digests check', async () => {
    const invite = await read('control-rfi-direct')
    const accept = await read('control-rfa-direct')
    const cancel = await read('control-rfd')
    expect([invite.control?.kind, accept.control?.kind, cancel.control?.kind]).toEqual(['invite', 'accept', 'cancel'])
    // The vectors are one exchange: the accept answers the invite, and the cancel ends it.
    expect(eq(accept.control?.replyDigest, invite.control?.digest)).toBe(true)
    expect(eq(cancel.control?.digest, invite.control?.digest)).toBe(true)
  })

  test('control-rfi-referral is still refused as a control frame, but reported with no message to answer', async () => {
    const error = await read('control-rfi-referral')
    expect(error.message.startsWith(tsp.CONTROL_FRAME_RECEIVED)).toBe(true)
    expect(tsp.isTspControlFrame(error)).toBe(false)
  })
})
