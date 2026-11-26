/**
 * TSP 1.0 (`YTSP-BAA`) — step B2 of the TSP 1.0 bridge: the Rev 3 layout under
 * the 1.0 marker, with the sender VID required in every confidential payload
 * (trustoverip/tswg-tsp-specification@ccda6b3 §3.2, §3.7 step 7).
 *
 * Checked three ways:
 *  1. against the specification's 1.0 Appendix A vectors (fixture
 *     `tsp-v1-spec-vectors.json`, copied unchanged from
 *     OpenVTC/vta-browser-plugin@bf92427 `packages/tsp-js/tests/fixtures/
 *     spec-v1-vectors.json`, the pinned clone; identical to affinidi-tsp
 *     0.3.0's): every vector this codec supports opens, and `direct-hpke-base`
 *     re-packs byte for byte from its `ikmE`;
 *  2. against upstream's own 1.0 implementation, `@openvtc/vti-tsp-js` 0.4.0
 *     (test-only alias `@openvtc/vti-tsp-js-v1`), in both directions and byte
 *     for byte for the relationship control frames;
 *  3. for the rules that are new or must not change: a NULL sender is refused
 *     in a 1.0 payload and still read in a Rev 3 one; the dual reader opens
 *     Rev 2, Rev 3 and 1.0; the default codec still packs Rev 3.
 */
import { pack as v1Pack, unpack as v1Unpack, isRevisionError as v1IsRevisionError } from '@openvtc/vti-tsp-js-v1'
import {
  __unsafeDeterministicPackAccept as v1DeterministicAccept,
  __unsafeDeterministicPackCancel as v1DeterministicCancel,
  __unsafeDeterministicPackInvite as v1DeterministicInvite,
} from '@openvtc/vti-tsp-js-v1/unsafe-testing'
import { unpack as rev3Unpack } from '@openvtc/vti-tsp-js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { tsp } from '@bifold/trust-tasks'

import v1Vectors from './fixtures/tsp-v1-spec-vectors.json'

const b64u = (s: string) => tsp.fromBase64Url(s)
const qb64 = (u8: Uint8Array) => tsp.toBase64Url(u8)
const utf8 = (s: string) => new TextEncoder().encode(s)
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

function rawSigningKey(privateKey: Uint8Array): tsp.SigningKey {
  return { publicKey: ed25519.getPublicKey(privateKey), sign: async (m) => ed25519.sign(m, privateKey) }
}
function rawKeyAgreement(privateKey: Uint8Array): tsp.KeyAgreement {
  return { publicKey: x25519.getPublicKey(privateKey), agree: async (peer) => x25519.getSharedSecret(privateKey, peer) }
}

type Identifier = { id: string; pkS: string; pkE: string; skS: string; skE: string }
const ids = v1Vectors.identifiers as unknown as Record<string, Identifier>
const vectorResolver: tsp.VidResolver = {
  async resolve(vid) {
    const found = Object.values(ids).find((i) => i.id === vid)
    if (!found) throw new Error(`no fixture identifier for ${vid}`)
    return { signingPublicKey: b64u(found.pkS), encryptionPublicKey: b64u(found.pkE) }
  },
}
type Vector = { sender: string; receiver: string; message: string; payload: string; ikmE?: string }
const vector = (name: string) => (v1Vectors.vectors as unknown as Record<string, Vector>)[name]
const openAs = (receiver: string) => ({ keyAgreement: rawKeyAgreement(b64u(ids[receiver].skE)) })

describe('TSP 1.0 — the specification Appendix A vectors', () => {
  test('every vector carries YTSP-BAA and peeks as v1', () => {
    for (const [name, v] of Object.entries(v1Vectors.vectors)) {
      const bytes = b64u((v as Vector).message)
      expect([name, tsp.readTspVersion(bytes)]).toEqual([name, { major: 1, minor: 0 }])
      expect([name, tsp.peekRevision(bytes).revision]).toEqual([name, 'v1'])
    }
  })

  test('direct-hpke-base opens through the ports as v1 and says "hello world"', async () => {
    const v = vector('direct-hpke-base')
    const opened = await tsp.unpack(b64u(v.message), openAs(v.receiver), vectorResolver)
    expect(opened.revision).toBe('v1')
    expect(opened.sender).toBe(ids[v.sender].id)
    expect(opened.receiver).toBe(ids[v.receiver].id)
    expect(opened.messageType).toBe('direct')
    expect(new TextDecoder().decode(opened.payload)).toBe('hello world')
    expect(eq(opened.threadDigest, tsp.sha256(b64u(v.payload)))).toBe(true)
  })

  test('direct-hpke-base re-packs byte for byte from its ikmE, with the sender named', async () => {
    const v = vector('direct-hpke-base')
    const packed = await tsp.__unsafeDeterministicPackV1(
      utf8('hello world'),
      ids[v.sender].id,
      ids[v.receiver].id,
      { signingKey: rawSigningKey(b64u(ids[v.sender].skS)) },
      vectorResolver,
      { __unsafeIkmE: b64u(v.ikmE as string) }
    )
    expect(packed.revision).toBe('v1')
    expect(qb64(packed.bytes)).toBe(v.message)
  })

  test.each(['nested-direct', 'routed'])('%s opens as v1 and carries a 1.0 inner frame', async (name) => {
    const v = vector(name)
    const opened = await tsp.unpack(b64u(v.message), openAs(v.receiver), vectorResolver)
    expect(opened.revision).toBe('v1')
    expect(opened.messageType).toBe(name === 'routed' ? 'routed' : 'nested')
    if (name === 'routed') expect(opened.hops.length).toBeGreaterThan(0)
    expect(tsp.readTspVersion(opened.payload)).toEqual({ major: 1, minor: 0 })
  })

  test.each(['control-rfi-direct', 'control-rfa-direct', 'control-rfd', 'control-rfi-referral'])(
    '%s opens, passes the sender rule, and is reported as a control frame',
    async (name) => {
      // This codec forms relationships by sending; it does not consume control
      // frames as application traffic. Reaching CONTROL_FRAME_RECEIVED means the
      // version gate, the signature, the HPKE open and the 1.0 sender rule all
      // passed, since each comes before the payload type is read.
      const v = vector(name)
      await expect(tsp.unpack(b64u(v.message), openAs(v.receiver), vectorResolver)).rejects.toThrow(
        tsp.CONTROL_FRAME_RECEIVED
      )
    }
  )

  test('the suites this codec does not implement are refused by name, not by version', async () => {
    const sealed = vector('direct-sealed-box')
    await expect(tsp.unpack(b64u(sealed.message), openAs(sealed.receiver), vectorResolver)).rejects.toThrow(
      /sealed box/
    )
  })
})

describe('TSP 1.0 — against @openvtc/vti-tsp-js 0.4.0', () => {
  const senderVid = 'did:example:sender'
  const receiverVid = 'did:example:receiver'
  const senderSignSk = new Uint8Array(32).fill(3)
  const receiverEncSk = new Uint8Array(32).fill(5)
  const senderSignPk = ed25519.getPublicKey(senderSignSk)
  const receiverEncPk = x25519.getPublicKey(receiverEncSk)
  const resolver: tsp.VidResolver = {
    async resolve() {
      return { signingPublicKey: senderSignPk, encryptionPublicKey: receiverEncPk }
    },
  }
  const sender = { signingKey: rawSigningKey(senderSignSk) }
  const receiver = { keyAgreement: rawKeyAgreement(receiverEncSk) }
  const upstreamKeys = { senderSigningKey: senderSignSk, receiverEncryptionKey: receiverEncPk }
  const ikmE = new Uint8Array(32).fill(7)
  const nonce = new Uint8Array(16).fill(9)
  const body = utf8('a Trust Task over TSP 1.0')

  test('what we pack in 1.0, upstream 1.0 opens', async () => {
    const packed = await tsp.packV1(body, senderVid, receiverVid, sender, resolver)
    expect(packed.revision).toBe('v1')
    const opened = await v1Unpack(packed.bytes, {
      receiverDecryptionKey: receiverEncSk,
      senderSigningKey: senderSignPk,
    })
    expect(eq(opened.payload, body)).toBe(true)
    expect(eq(opened.threadDigest, packed.threadDigest)).toBe(true)
  })

  test('what upstream packs in 1.0, we open as v1', async () => {
    const packed = await v1Pack(body, senderVid, receiverVid, upstreamKeys)
    const opened = await tsp.unpack(packed.bytes, receiver, resolver)
    expect(opened.revision).toBe('v1')
    expect(eq(opened.payload, body)).toBe(true)
    expect(eq(opened.threadDigest, packed.threadDigest)).toBe(true)
  })

  test('XRFI, XRFA and XRFD are byte-identical to upstream 1.0 from the same ephemeral', async () => {
    const ours = await tsp.__unsafeDeterministicPackInviteV1(
      senderVid,
      receiverVid,
      sender,
      resolver,
      { nonce },
      { __unsafeIkmE: ikmE }
    )
    const theirs = await v1DeterministicInvite(senderVid, receiverVid, upstreamKeys, { nonce }, { __unsafeIkmE: ikmE })
    expect(qb64(ours.bytes)).toBe(qb64(theirs.bytes))

    const digest = ours.threadDigest
    const accept = await tsp.__unsafeDeterministicPackAcceptV1(digest, senderVid, receiverVid, sender, resolver, {
      __unsafeIkmE: ikmE,
    })
    const theirAccept = await v1DeterministicAccept(digest, senderVid, receiverVid, upstreamKeys, {
      __unsafeIkmE: ikmE,
    })
    expect(qb64(accept.bytes)).toBe(qb64(theirAccept.bytes))

    const cancel = await tsp.__unsafeDeterministicPackCancelV1(digest, senderVid, receiverVid, sender, resolver, {
      __unsafeIkmE: ikmE,
    })
    const theirCancel = await v1DeterministicCancel(digest, senderVid, receiverVid, upstreamKeys, {
      __unsafeIkmE: ikmE,
    })
    expect(qb64(cancel.bytes)).toBe(qb64(theirCancel.bytes))
  })

  test('the two versions do not interoperate, in either direction, as the specification says', async () => {
    const rev3 = await tsp.packRev3(body, senderVid, receiverVid, sender, resolver)
    let refused: unknown
    try {
      await v1Unpack(rev3.bytes, { receiverDecryptionKey: receiverEncSk, senderSigningKey: senderSignPk })
    } catch (e) {
      refused = e
    }
    expect(v1IsRevisionError(refused)).toBe(true)

    const v1 = await tsp.packV1(body, senderVid, receiverVid, sender, resolver)
    await expect(
      rev3Unpack(v1.bytes, { receiverDecryptionKey: receiverEncSk, senderSigningKey: senderSignPk })
    ).rejects.toThrow(/MAJOR/)
  })
})

describe('TSP 1.0 — the sender rule, the dual reader and the default packer', () => {
  const senderVid = 'did:example:sender'
  const senderSignSk = new Uint8Array(32).fill(11)
  const receiverEncSk = new Uint8Array(32).fill(13)
  const resolver: tsp.VidResolver = {
    async resolve() {
      return {
        signingPublicKey: ed25519.getPublicKey(senderSignSk),
        encryptionPublicKey: x25519.getPublicKey(receiverEncSk),
      }
    },
  }
  const sender = { signingKey: rawSigningKey(senderSignSk) }
  const receiver = { keyAgreement: rawKeyAgreement(receiverEncSk) }
  const body = utf8('dual')

  test('a payload whose ESSR sender is NULL is refused under 1.0 and read under Rev 3', () => {
    const { frame } = tsp.encodePayloadFrameRev3(body, 'direct', [], '')
    expect(() => tsp.decodePayloadFrameRev3(frame, senderVid, { requireSender: true })).toThrow(/NULL VID/)
    expect(tsp.decodePayloadFrameRev3(frame, senderVid).senderVid).toBe('')
    const named = tsp.encodePayloadFrameRev3(body, 'direct', [], senderVid).frame
    expect(tsp.decodePayloadFrameRev3(named, senderVid, { requireSender: true }).senderVid).toBe(senderVid)
  })

  test('the test-only NULL-sender option is refused for 1.0, as upstream refuses it', async () => {
    await expect(
      tsp.__unsafeDeterministicPackV1(body, senderVid, 'did:example:r', sender, resolver, {
        __unsafeIkmE: new Uint8Array(32).fill(1),
        nullPayloadSender: true,
      })
    ).rejects.toThrow(/must name its sender/)
  })

  test('one reader opens Rev 2, Rev 3 and 1.0 and reports which', async () => {
    // Rev 2 is HPKE-Auth, so the receiver needs the sender's own X25519 key:
    // this resolver answers per VID rather than with one key pair.
    const senderEncSk = new Uint8Array(32).fill(17)
    const receiverVid = 'did:example:r'
    const perVid: tsp.VidResolver = {
      async resolve(vid) {
        return vid === senderVid
          ? {
              signingPublicKey: ed25519.getPublicKey(senderSignSk),
              encryptionPublicKey: x25519.getPublicKey(senderEncSk),
            }
          : { signingPublicKey: new Uint8Array(32), encryptionPublicKey: x25519.getPublicKey(receiverEncSk) }
      },
    }
    const identity = { ...sender, keyAgreement: rawKeyAgreement(senderEncSk) }
    for (const [packer, revision] of [
      [tsp.packRev2, 'rev2'],
      [tsp.packRev3, 'rev3'],
      [tsp.packV1, 'v1'],
    ] as const) {
      const packed = await packer(body, senderVid, receiverVid, identity, perVid)
      expect(packed.revision).toBe(revision)
      const opened = await tsp.unpack(packed.bytes, receiver, perVid)
      expect(opened.revision).toBe(revision)
      expect(eq(opened.payload, body)).toBe(true)
    }
  })

  test('the default codec still packs Rev 3; a 1.0 codec packs 1.0; both read both', async () => {
    const defaultCodec = tsp.createTspCodec()
    const v1Codec = tsp.createTspCodec({ packs: 'v1' })
    expect(defaultCodec.packs).toBe('rev3')
    const a = await defaultCodec.pack(body, senderVid, 'did:example:r', sender as tsp.TspIdentity, resolver)
    const b = await v1Codec.pack(body, senderVid, 'did:example:r', sender as tsp.TspIdentity, resolver)
    expect([a.revision, b.revision]).toEqual(['rev3', 'v1'])
    expect((await v1Codec.unpack(a.bytes, receiver, resolver)).revision).toBe('rev3')
    expect((await defaultCodec.unpack(b.bytes, receiver, resolver)).revision).toBe('v1')
  })

  test('a frame of the other version fails on the version gate, before any key is used, never as an AEAD failure', async () => {
    // The ordering is the diagnosis: "declares MAJOR 1; reads MAJOR 0" is a line
    // someone can act on from a device log, an "invalid tag" is not. A key
    // agreement that fails the test if reached pins that the gate comes first.
    const neverAgree: tsp.KeyAgreement = {
      publicKey: x25519.getPublicKey(receiverEncSk),
      agree: async () => {
        throw new Error('KeyAgreement.agree() was reached before the version gate')
      },
    }
    const v1 = await tsp.packV1(body, senderVid, 'did:example:r', sender, resolver)
    await expect(tsp.unpackRev3(v1.bytes, { keyAgreement: neverAgree }, resolver)).rejects.toThrow(
      'message declares MAJOR 1; this codec reads MAJOR 0 here'
    )
    const rev3 = await tsp.packRev3(body, senderVid, 'did:example:r', sender, resolver)
    await expect(tsp.unpackV1(rev3.bytes, { keyAgreement: neverAgree }, resolver)).rejects.toThrow(
      'message declares MAJOR 0; this codec reads MAJOR 1 here'
    )
    // The frozen Rev 2 reader has its own gate (decodeEnvelopeRev2, MAJOR and
    // MINOR together) and is the one most likely to meet an unexpected version
    // across the cutover: its gate also comes before any key.
    for (const frame of [v1.bytes, rev3.bytes]) {
      await expect(tsp.unpackRev2(frame, { keyAgreement: neverAgree }, resolver)).rejects.toThrow(
        'tsp: not a Rev 2 version marker'
      )
    }
  })

  test('a MAJOR this package does not know is refused with the revision error, before any key is used', () => {
    const frame = tsp.encodeFieldsRev3(senderVid, 'did:example:r', { major: 2, minor: 0 })
    const framed = tsp.finalizeFrameRev3(frame, new Uint8Array(0))
    expect(() => tsp.peekRevision(framed)).toThrow(/MAJOR 2/)
  })
})
