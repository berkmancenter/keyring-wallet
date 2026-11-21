/**
 * The phone's own KERI events replay under this package's own KEL replay (guardian/kel.ts replayKel), the one the
 * Guardian check and the did:webs resolver use: so an AID the phone makes is one the verifier reads, with no second
 * writer or reader. Keys here are made with @noble/curves, as the KMS would make them.
 */
import { p256 } from '@noble/curves/nist.js'
import { ed25519 } from '@noble/curves/ed25519.js'

import { digest, replayKel } from '../guardian/kel'
import {
  compressP256,
  ed25519NQb64,
  inceptionBody,
  indexedP256Sig,
  interactionBody,
  nextKeyDigest,
  p256KeyQb64,
  signedEvent,
} from '../identity/keriEvents'

const te = new TextEncoder()

/** A P-256 key pair as the KMS hands its public half back: JWK coordinates. */
function p256Pair() {
  const secretKey = p256.utils.randomSecretKey()
  const pub = p256.getPublicKey(secretKey, false) // 0x04 || x || y
  const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')
  return { secretKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) }
}

/** ES256 as the KMS signs: ECDSA over SHA-256 of the data, raw r || s. */
const es256 = (secretKey: Uint8Array, data: Uint8Array) => p256.sign(data, secretKey, { prehash: true })

describe('the phone inception (holder code)', () => {
  it('E01: replays under kel.ts replayKel, with a SHA2-256 self-addressing prefix and a Blake3 SAID', () => {
    const now = p256Pair()
    const next = p256Pair()
    const key = p256KeyQb64(compressP256(now.x, now.y))
    const body = inceptionBody(key, nextKeyDigest(p256KeyQb64(compressP256(next.x, next.y))))
    const stream = signedEvent(body, [indexedP256Sig(es256(now.secretKey, body.raw), 0)])
    const replay = replayKel(digest, te.encode(stream))
    expect(replay).toMatchObject({ ok: true, state: { pre: body.pre, sn: 0, keys: [key], ilk: 'icp' } })
    expect(body.pre[0]).toBe('I')
    expect(body.said[0]).toBe('E')
    expect(body.pre).toHaveLength(44)
  })

  it('E02: an interaction anchoring a seal replays after it, signed by the same key (the shape S2 needs later)', () => {
    const now = p256Pair()
    const key = p256KeyQb64(compressP256(now.x, now.y))
    const icp = inceptionBody(key, nextKeyDigest(p256KeyQb64(compressP256(p256Pair().x, p256Pair().y))))
    const seal = { i: 'E' + 'A'.repeat(43), s: '0', d: 'E' + 'A'.repeat(43) }
    const ixn = interactionBody(icp.pre, 1, icp.said, [seal])
    const stream =
      signedEvent(icp, [indexedP256Sig(es256(now.secretKey, icp.raw), 0)]) +
      signedEvent(ixn, [indexedP256Sig(es256(now.secretKey, ixn.raw), 0)])
    const replay = replayKel(digest, te.encode(stream))
    expect(replay).toMatchObject({ ok: true, state: { sn: 1, ilk: 'ixn' } })
    expect(replay.ok && replay.history[1].seals).toEqual([seal])
  })

  it('E03: control: signed by another key, the same inception is refused (so E01 is the signature, not the shape)', () => {
    const now = p256Pair()
    const key = p256KeyQb64(compressP256(now.x, now.y))
    const body = inceptionBody(key, nextKeyDigest(key))
    const stream = signedEvent(body, [indexedP256Sig(es256(p256Pair().secretKey, body.raw), 0)])
    expect(replayKel(digest, te.encode(stream))).toMatchObject({
      ok: false,
      reason: 'sn 0 icp: controller signatures 0/1',
    })
  })

  it('E04: control: one character of the body changed after the SAID is refused (the SAID is the bytes signed)', () => {
    const now = p256Pair()
    const key = p256KeyQb64(compressP256(now.x, now.y))
    const body = inceptionBody(key, nextKeyDigest(key))
    const tampered = { ...body, text: body.text.replace('"kt":"1"', '"kt":"2"') }
    tampered.raw = te.encode(tampered.text)
    const stream = signedEvent(tampered, [indexedP256Sig(es256(now.secretKey, tampered.raw), 0)])
    expect(replayKel(digest, te.encode(stream)).ok).toBe(false)
  })

  it('E05: a compressed key keeps the y parity (both parities, each equal to the curve own compressed key)', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 24 && seen.size < 2; i++) {
      const pair = p256Pair()
      const c = compressP256(pair.x, pair.y)
      seen.add(c[0])
      const full = p256.getPublicKey(pair.secretKey, true)
      expect(Buffer.from(c).equals(Buffer.from(full))).toBe(true)
    }
    expect([...seen].sort()).toEqual([2, 3])
  })
})

describe('the ward code', () => {
  it('E06: an Ed25519 key as a basic non-transferable AID: B + the key', () => {
    const secretKey = ed25519.utils.randomSecretKey()
    const aid = ed25519NQb64(ed25519.getPublicKey(secretKey))
    expect(aid).toMatch(/^B[A-Za-z0-9_-]{43}$/)
  })
})
