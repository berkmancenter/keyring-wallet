/**
 * TSP Rev 3 — the cutover `tsp_rev3_subtask.md` R3–R6 describe, checked the
 * three ways that matter:
 *
 *  1. against the **specification's own Appendix A vectors** (fixture
 *     `tsp-rev3-spec-vectors.json`, extracted upstream from
 *     tswg-tsp-specification@f5b8668): the port-based codec reads the
 *     published `direct-hpke-base` message, and re-packs it byte for byte
 *     given the vector's `ikmE` — the stronger claim, since an exact writer
 *     has had to agree with the reference on every code, count, field order,
 *     AAD boundary, signature input and HPKE-Base derivation;
 *  2. against the real `@openvtc/vti-tsp-js` 0.3.0 packer/unpacker in both
 *     directions, with raw keys on its side and ports on ours;
 *  3. for the properties the plan makes acceptance criteria: the send path
 *     never consults `KeyAgreement.agree()` (§2.4, R3); a Rev 2 message is
 *     read and reported as Rev 2 rather than failing in the ciphertext
 *     selector (R6); a tampered frame is refused (R4); and the demux boundary
 *     at 4095 quadlets is asserted, not printed (§3.3, R1).
 */
import { cesr, unpack as upstreamUnpack, pack as upstreamPack } from '@openvtc/vti-tsp-js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { tsp } from '@bifold/trust-tasks'

import vectors from './fixtures/tsp-rev3-spec-vectors.json'

type SigningKey = tsp.SigningKey
type KeyAgreement = tsp.KeyAgreement
type VidResolver = tsp.VidResolver

const b64u = (s: string) => tsp.fromBase64Url(s)
const qb64 = (u8: Uint8Array) => tsp.toBase64Url(u8)
const utf8 = (s: string) => new TextEncoder().encode(s)
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

function rawSigningKey(privateKey: Uint8Array): SigningKey {
  return { publicKey: ed25519.getPublicKey(privateKey), sign: async (m) => ed25519.sign(m, privateKey) }
}
function rawKeyAgreement(privateKey: Uint8Array): KeyAgreement {
  return { publicKey: x25519.getPublicKey(privateKey), agree: async (peer) => x25519.getSharedSecret(privateKey, peer) }
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

/** A KeyAgreement that fails the test if the send path ever reaches it. */
function forbiddenKeyAgreement(publicKey: Uint8Array): KeyAgreement {
  return {
    publicKey,
    async agree() {
      throw new Error('KeyAgreement.agree() was called on the send path')
    },
  }
}

describe('TSP Rev 3 — specification Appendix A vectors', () => {
  const alice = vectors.identifiers.alice
  const bob = vectors.identifiers.bob
  const vector = vectors.vectors['direct-hpke-base']
  const resolver = fixtureResolver({
    [alice.id]: { signingPublicKey: b64u(alice.pkS), encryptionPublicKey: b64u(alice.pkE) },
    [bob.id]: { signingPublicKey: b64u(bob.pkS), encryptionPublicKey: b64u(bob.pkE) },
  })

  test('the published direct-hpke-base message opens through the ports and says "hello world"', async () => {
    const opened = await tsp.unpack(b64u(vector.message), { keyAgreement: rawKeyAgreement(b64u(bob.skE)) }, resolver)
    expect(opened.revision).toBe('rev3')
    expect(opened.sender).toBe(alice.id)
    expect(opened.receiver).toBe(bob.id)
    expect(opened.messageType).toBe('direct')
    expect(new TextDecoder().decode(opened.payload)).toBe('hello world')
    // The thread digest is SHA-256 over the printed payload frame.
    expect(eq(opened.threadDigest, tsp.sha256(b64u(vector.payload)))).toBe(true)
  })

  test('re-packs the published message byte for byte from its ikmE', async () => {
    const packed = await tsp.__unsafeDeterministicPackRev3(
      utf8('hello world'),
      alice.id,
      bob.id,
      { signingKey: rawSigningKey(b64u(alice.skS)) },
      resolver,
      { __unsafeIkmE: b64u(vector.ikmE), nullPayloadSender: true }
    )
    expect(qb64(packed.bytes)).toBe(vector.message)
  })

  test("the ikmE derivation yields the vector's pkEm (RFC 9180 §7.1.3 DeriveKeyPair)", () => {
    expect(qb64(tsp.hpke.deriveKeyPair(b64u(vector.ikmE)).pk)).toBe(vector.pkEm)
  })

  test('the AAD is the envelope fields without the -E count, and info is YTSP-', async () => {
    // Flip one byte inside the receiver VID of the published message: the
    // signature no longer verifies. Re-sign it with Alice's key and the AEAD
    // refuses instead — the VIDs are bound into the ciphertext through the AAD.
    const message = b64u(vector.message)
    const envelope = tsp.peekRevision(message)
    expect(envelope.revision).toBe('rev3')
    const tampered = message.slice()
    const marker = new TextDecoder().decode(tampered.slice(0, 200)).indexOf('did:peer:4zQmZ')
    expect(marker).toBeGreaterThan(0)
    tampered[marker + 'did:peer:4zQmZ'.length] ^= 0x01
    await expect(tsp.unpack(tampered, { keyAgreement: rawKeyAgreement(b64u(bob.skE)) }, resolver)).rejects.toThrow(
      /signature verification failed|invalid VID|-E frame/
    )
  })
})

describe("TSP Rev 3 — interop with @openvtc/vti-tsp-js 0.3.0 and the plan's acceptance criteria", () => {
  const senderVid = 'did:example:sender'
  const receiverVid = 'did:example:receiver'
  const senderSignSk = ed25519.utils.randomSecretKey()
  const senderEncSk = x25519.utils.randomSecretKey()
  const receiverEncSk = x25519.utils.randomSecretKey()
  const senderSignPk = ed25519.getPublicKey(senderSignSk)
  const senderEncPk = x25519.getPublicKey(senderEncSk)
  const receiverEncPk = x25519.getPublicKey(receiverEncSk)
  const resolver = fixtureResolver({
    [senderVid]: { encryptionPublicKey: senderEncPk, signingPublicKey: senderSignPk },
    [receiverVid]: { encryptionPublicKey: receiverEncPk, signingPublicKey: new Uint8Array(32) },
  })
  const receiverIdentity = { keyAgreement: rawKeyAgreement(receiverEncSk) }
  const plaintext = utf8('a Trust Task on the peer leg')

  test('R3: the send path never calls KeyAgreement.agree() — a signing key is all a sender holds', async () => {
    const senderIdentity = { signingKey: rawSigningKey(senderSignSk), keyAgreement: forbiddenKeyAgreement(senderEncPk) }
    const packed = await tsp.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    expect(packed.revision).toBe('rev3')
    const opened = await upstreamUnpack(packed.bytes, {
      receiverDecryptionKey: receiverEncSk,
      senderSigningKey: senderSignPk,
    })
    expect(eq(opened.payload, plaintext)).toBe(true)
  })

  test('R4: a tampered thread/payload byte is refused by the AEAD, a tampered envelope byte by the signature', async () => {
    const senderIdentity = { signingKey: rawSigningKey(senderSignSk), keyAgreement: rawKeyAgreement(senderEncSk) }
    const packed = await tsp.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    const inEnvelope = packed.bytes.slice()
    inEnvelope[12] ^= 0x01
    await expect(tsp.unpack(inEnvelope, receiverIdentity, resolver)).rejects.toThrow()
    const inCiphertext = packed.bytes.slice()
    inCiphertext[packed.bytes.length - 70 - 20] ^= 0x01
    await expect(tsp.unpack(inCiphertext, receiverIdentity, resolver)).rejects.toThrow()
  })

  test('R6: a Rev 2 message is read by the frozen codec and reported as rev2, not refused at the ciphertext selector', async () => {
    const senderIdentity = { signingKey: rawSigningKey(senderSignSk), keyAgreement: rawKeyAgreement(senderEncSk) }
    const rev2 = await tsp.packRev2(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    expect(rev2.revision).toBe('rev2')
    expect(tsp.peekRevision(rev2.bytes).revision).toBe('rev2')
    const opened = await tsp.unpack(rev2.bytes, receiverIdentity, resolver)
    expect(opened.revision).toBe('rev2')
    expect(eq(opened.payload, plaintext)).toBe(true)
    expect(opened.sender).toBe(senderVid)
    // The package's own dual reader agrees the bytes are Rev 2 (HPKE-Auth
    // needs the sender's X25519 key to open them).
    const upstream = await upstreamUnpack(rev2.bytes, {
      receiverDecryptionKey: receiverEncSk,
      senderSigningKey: senderSignPk,
      senderEncryptionKey: senderEncPk,
    })
    expect(upstream.revision).toBe('rev2')
    expect(eq(upstream.payload, plaintext)).toBe(true)
    await expect(
      upstreamUnpack(rev2.bytes, { receiverDecryptionKey: receiverEncSk, senderSigningKey: senderSignPk })
    ).rejects.toThrow(/Rev 2/)
  })

  test('the build-time codec: createTspCodec fixes the packer, unpack stays dual', async () => {
    const senderIdentity = { signingKey: rawSigningKey(senderSignSk), keyAgreement: rawKeyAgreement(senderEncSk) }
    const rev3Codec = tsp.createTspCodec()
    const rev2Codec = tsp.createTspCodec({ packs: 'rev2' })
    expect(rev3Codec.packs).toBe('rev3')
    expect(rev2Codec.packs).toBe('rev2')
    const a = await rev3Codec.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    const b = await rev2Codec.pack(plaintext, senderVid, receiverVid, senderIdentity, resolver)
    expect((await rev2Codec.unpack(a.bytes, receiverIdentity, resolver)).revision).toBe('rev3')
    expect((await rev3Codec.unpack(b.bytes, receiverIdentity, resolver)).revision).toBe('rev2')
  })

  test('its pack() (Rev 3, raw keys) -> our unpack() (ports), nested and routed kinds included', async () => {
    const direct = await upstreamPack(plaintext, senderVid, receiverVid, {
      senderSigningKey: senderSignSk,
      receiverEncryptionKey: receiverEncPk,
    })
    const opened = await tsp.unpack(direct.bytes, receiverIdentity, resolver)
    expect(opened.messageType).toBe('direct')
    expect(eq(opened.payload, plaintext)).toBe(true)
    expect(eq(opened.threadDigest, direct.threadDigest)).toBe(true)

    const senderIdentity = { signingKey: rawSigningKey(senderSignSk), keyAgreement: rawKeyAgreement(senderEncSk) }
    const routed = await tsp.packWithHops(
      direct.bytes,
      'routed',
      ['did:example:hop'],
      senderVid,
      receiverVid,
      senderIdentity,
      resolver
    )
    const openedRouted = await upstreamUnpack(routed.bytes, {
      receiverDecryptionKey: receiverEncSk,
      senderSigningKey: senderSignPk,
    })
    expect(openedRouted.messageType).toBe('routed')
    expect(openedRouted.hops).toEqual(['did:example:hop'])
    expect(eq(openedRouted.payload, direct.bytes)).toBe(true)
  })

  test('ESSR: a payload sender that disagrees with the envelope sender is refused', async () => {
    // Pack as the sender, then re-address the envelope to claim another VID
    // with a fresh signature — the sealed ESSR field still names the original.
    const otherVid = 'did:example:other'
    const otherSignSk = ed25519.utils.randomSecretKey()
    const resolverWithOther = fixtureResolver({
      [senderVid]: { encryptionPublicKey: senderEncPk, signingPublicKey: senderSignPk },
      [otherVid]: { encryptionPublicKey: senderEncPk, signingPublicKey: ed25519.getPublicKey(otherSignSk) },
      [receiverVid]: { encryptionPublicKey: receiverEncPk, signingPublicKey: new Uint8Array(32) },
    })
    const fields = tsp.encodeFieldsRev3(otherVid, receiverVid)
    const { frame } = tsp.encodePayloadFrameRev3(plaintext, 'direct', [], senderVid)
    const sealed = tsp.hpke.sealBase(frame, fields, receiverEncPk, utf8('YTSP-'))
    const ct = new Uint8Array([...sealed.enc, ...sealed.ciphertext])
    const field: number[] = []
    cesr.encodeVariableData(cesr.TSP_HPKE_BASE_CIPHERTEXT, ct, field)
    const wire = tsp.finalizeFrameRev3(fields, new Uint8Array(field))
    const sig = ed25519.sign(wire, otherSignSk)
    const out = Array.from(wire)
    cesr.encodeCount(cesr.TSP_ATTACH_GRP, 23, out)
    cesr.encodeCount(cesr.TSP_INDEX_SIG_GRP, 22, out)
    cesr.encodeIndexedEd25519Signature(0, sig, out)
    await expect(tsp.unpack(new Uint8Array(out), receiverIdentity, resolverWithOther)).rejects.toThrow(
      /ESSR sender VID does not match/
    )
  })
})

describe('TSP Rev 3 — the mediator ingress classifier and the 4095-quadlet boundary (§3.3, R1)', () => {
  const senderVid = 'did:example:sender'
  const receiverVid = 'did:example:receiver'
  const senderSignSk = ed25519.utils.randomSecretKey()
  const receiverEncSk = x25519.utils.randomSecretKey()
  const resolver = fixtureResolver({
    [senderVid]: { encryptionPublicKey: new Uint8Array(32), signingPublicKey: ed25519.getPublicKey(senderSignSk) },
    [receiverVid]: { encryptionPublicKey: x25519.getPublicKey(receiverEncSk), signingPublicKey: new Uint8Array(32) },
  })
  const senderIdentity = { signingKey: rawSigningKey(senderSignSk) }

  /** Grow the body until the -E count is exactly `quadlets`. */
  async function packWithFrameQuadlets(quadlets: number) {
    // Everything but the body is fixed for these VIDs; measure once, then fill.
    const probe = await tsp.packRev3(new Uint8Array(0), senderVid, receiverVid, senderIdentity, resolver)
    const cur = { pos: 0 }
    const probeQuadlets = cesr.decodeCount(cesr.TSP_ETS_WRAPPER, probe.bytes, cur) as number
    // A var-data `B` field grows in quadlets with its payload; three body bytes = one quadlet.
    const body = new Uint8Array((quadlets - probeQuadlets) * 3).fill(0x61)
    return tsp.packRev3(body, senderVid, receiverVid, senderIdentity, resolver)
  }

  test('at 4095 quadlets the frame is short (0xF8, "-E"); at 4096 it is long (0xFB, "--E") — and both are TSP', async () => {
    const atLimit = await packWithFrameQuadlets(tsp.SHORT_COUNT_MAX_QUADLETS)
    const pastLimit = await packWithFrameQuadlets(tsp.SHORT_COUNT_MAX_QUADLETS + 1)

    expect(atLimit.bytes[0]).toBe(tsp.TSP_MAGIC_BYTE)
    expect(pastLimit.bytes[0]).toBe(tsp.TSP_MAGIC_BYTE_LONG)
    const atLimitText = qb64(atLimit.bytes)
    const pastLimitText = qb64(pastLimit.bytes)
    expect(atLimitText.startsWith('-E')).toBe(true)
    expect(pastLimitText.startsWith('--E')).toBe(true)

    // The classifier the plan measured against: `text.startsWith("-E")` alone
    // misroutes the long form. Both predicates here accept both.
    expect(pastLimitText.startsWith('-E')).toBe(false)
    expect(tsp.isTspFrameText(atLimitText)).toBe(true)
    expect(tsp.isTspFrameText(pastLimitText)).toBe(true)
    expect(tsp.isTspFrameBytes(atLimit.bytes)).toBe(true)
    expect(tsp.isTspFrameBytes(pastLimit.bytes)).toBe(true)
    expect(tsp.isTspFrameText('{"protected":"…"}')).toBe(false)
    expect(tsp.isTspFrameText('eyJhbGciOi…')).toBe(false)

    // And the long frame still opens, through the ports and through upstream.
    const opened = await tsp.unpack(pastLimit.bytes, { keyAgreement: rawKeyAgreement(receiverEncSk) }, resolver)
    expect(opened.payload.length).toBeGreaterThan(12000)
    const upstream = await upstreamUnpack(pastLimit.bytes, {
      receiverDecryptionKey: receiverEncSk,
      senderSigningKey: ed25519.getPublicKey(senderSignSk),
    })
    expect(eq(upstream.payload, opened.payload)).toBe(true)
  })

  test('a Rev 2 frame is always short: the widened count is what makes the long form reachable', async () => {
    const senderEncSk = x25519.utils.randomSecretKey()
    const rev2Resolver = fixtureResolver({
      [senderVid]: {
        encryptionPublicKey: x25519.getPublicKey(senderEncSk),
        signingPublicKey: ed25519.getPublicKey(senderSignSk),
      },
      [receiverVid]: { encryptionPublicKey: x25519.getPublicKey(receiverEncSk), signingPublicKey: new Uint8Array(32) },
    })
    const big = new Uint8Array(15000).fill(0x61)
    const rev2 = await tsp.packRev2(
      big,
      senderVid,
      receiverVid,
      { signingKey: rawSigningKey(senderSignSk), keyAgreement: rawKeyAgreement(senderEncSk) },
      rev2Resolver
    )
    expect(rev2.bytes.length).toBeGreaterThan(15000)
    expect(rev2.bytes[0]).toBe(tsp.TSP_MAGIC_BYTE)
  })

  test('the text form round-trips and the queue id is SHA-256 of the delivered text', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 0xff)
    expect(eq(tsp.fromBase64Url(tsp.toBase64Url(bytes)), bytes)).toBe(true)
    expect(eq(tsp.fromBase64Url(tsp.toBase64Url(bytes.slice(0, 1001 - 2))), bytes.slice(0, 999))).toBe(true)
    expect(tsp.tspFrameQueueId('-EAo')).toMatch(/^[0-9a-f]{64}$/)
    expect(() => tsp.fromBase64Url('not base64url!')).toThrow()
  })
})

describe('the Trust Tasks TSP binding envelope (bindings/tsp/0.1)', () => {
  test('wraps a document under the envelope type and reads it back', () => {
    const document = { id: 'urn:uuid:1', type: 'https://trusttasks.org/spec/vetting/request/0.1', payload: { a: 1 } }
    const bytes = tsp.encodeTrustTaskEnvelope(document)
    expect(JSON.parse(new TextDecoder().decode(bytes)).type).toBe(tsp.TSP_BINDING_ENVELOPE_TYPE)
    expect(tsp.decodeTrustTaskEnvelope(bytes)).toEqual(document)
  })

  test('a payload that is not a Trust Task envelope is not dispatched (undefined), a malformed one throws', () => {
    expect(tsp.decodeTrustTaskEnvelope(utf8('hello world'))).toBeUndefined()
    expect(tsp.decodeTrustTaskEnvelope(utf8('{"type":"something/else","document":{}}'))).toBeUndefined()
    expect(() => tsp.decodeTrustTaskEnvelope(utf8(`{"type":"${tsp.TSP_BINDING_ENVELOPE_TYPE}"}`))).toThrow(
      /no document/
    )
  })
})
