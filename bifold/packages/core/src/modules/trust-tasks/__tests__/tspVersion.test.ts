/**
 * The TSP version marker, now owned by `@bifold/trust-tasks` (`tsp/version.ts`)
 * rather than read from `@openvtc/vti-tsp-js` — step B1 of the TSP 1.0 bridge.
 *
 * B1 changes no behaviour, and this suite is what proves it:
 *  - the markers are the bytes the specification and both implementations
 *    print (Rev 2 `AAB`, Rev 3 `AAC`, 1.0 `BAA`);
 *  - Rev 3 envelope fields are byte-identical to what tsp-js 0.3.0 wrote, and
 *    every published Rev 3 vector carries them;
 *  - the peek that replaced tsp-js's agrees with it on every frame and every
 *    refusal, error code included;
 *  - a control: the comparison against the published vector fails when the
 *    marker is wrong, so the byte-identical checks are not vacuous.
 */
import { cesr, isRevisionError, pack as upstreamPack, peekRevision as upstreamPeek } from '@openvtc/vti-tsp-js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { tsp } from '@bifold/trust-tasks'

import vectors from './fixtures/tsp-rev3-spec-vectors.json'

const b64u = (s: string) => tsp.fromBase64Url(s)
const qb64 = (u8: Uint8Array) => tsp.toBase64Url(u8)
const utf8 = (s: string) => new TextEncoder().encode(s)
const hex = (u8: Uint8Array) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ')
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/** The bytes of `frame` with its version marker replaced by `version`'s. */
function withVersion(frame: Uint8Array, version: tsp.TspVersion): Uint8Array {
  const at = frame[0] === cesr.TSP_MAGIC_BYTE_LONG ? 6 : 3
  const marker = tsp.tspVersionBytes(version)
  const out = frame.slice()
  out.set(marker, at)
  return out
}

/** What a peek threw, as the fields callers branch on. */
function refusal(fn: () => unknown): { code?: string; major?: number; minor?: number; message: string } {
  try {
    fn()
  } catch (error) {
    const e = error as { code?: string; major?: number; minor?: number; message: string }
    return { code: e.code, major: e.major, minor: e.minor, message: e.message }
  }
  throw new Error('expected a refusal')
}

const publishedRev3 = Object.entries(vectors.vectors).map(
  ([name, v]) => [name, b64u((v as { message: string }).message)] as const
)

describe('the version marker', () => {
  test('Rev 2, Rev 3 and 1.0 are YTSP-AAB, YTSP-AAC and YTSP-BAA', () => {
    expect(qb64(tsp.tspVersionBytes(tsp.TSP_REV2))).toBe('YTSP-AAB')
    expect(qb64(tsp.tspVersionBytes(tsp.TSP_REV3))).toBe('YTSP-AAC')
    expect(qb64(tsp.tspVersionBytes(tsp.TSP_V1))).toBe('YTSP-BAA')
    // The bytes affinidi-tsp 0.3.0 asserts for 1.0 (wire.rs version_roundtrip, #967).
    expect(hex(tsp.tspVersionBytes(tsp.TSP_V1))).toBe('61 34 8f f8 10 00')
    expect(hex(tsp.tspVersionBytes(tsp.TSP_REV3))).toBe('61 34 8f f8 00 02')
  })

  // Expected to FAIL when the tsp-js dependency moves to 0.4.0, whose
  // TSP_VERSION is 1.0 and which drops REV2_MINOR. That failure is the signal:
  // at that bump, decide consciously what this package packs, rather than let
  // it drift with the dependency. It is not breakage to silence.
  test("Rev 3 is what tsp-js 0.3.0's encodeVersion writes, so nothing we pack changes", () => {
    const theirs: number[] = []
    cesr.encodeVersion(theirs)
    expect(eq(tsp.tspVersionBytes(tsp.TSP_REV3), new Uint8Array(theirs))).toBe(true)
    expect(cesr.TSP_VERSION).toEqual({ major: tsp.TSP_REV3.major, minor: tsp.TSP_REV3.minor })
    expect(cesr.REV2_MINOR).toBe(tsp.TSP_REV2.minor)
  })

  test('envelope fields are byte-identical to the tsp-js-built ones they replace', () => {
    const sender = 'did:example:sender'
    const receiver = 'did:example:receiver'
    const before: number[] = []
    cesr.encodeVersion(before)
    cesr.encodeVariableData(cesr.TSP_VID, utf8(sender), before)
    cesr.encodeVariableData(cesr.TSP_VID, utf8(receiver), before)
    expect(eq(tsp.encodeFieldsRev3(sender, receiver), new Uint8Array(before))).toBe(true)
  })
})

describe('the published Rev 3 vectors', () => {
  test.each(publishedRev3)('%s carries YTSP-AAC and its envelope fields are ours byte for byte', (_name, message) => {
    expect(tsp.readTspVersion(message)).toEqual({ major: 0, minor: 2 })
    const env = tsp.decodeEnvelopeRev3(message)
    const published = message.slice(env.aad.begin, env.aad.end)
    expect(eq(tsp.encodeFieldsRev3(env.sender, env.receiver), published)).toBe(true)
  })

  test('control: with another marker the same comparison fails, so the check above can fail', () => {
    const [, message] = publishedRev3[0]
    const env = tsp.decodeEnvelopeRev3(message)
    const published = message.slice(env.aad.begin, env.aad.end)
    expect(eq(tsp.encodeFieldsRev3(env.sender, env.receiver, tsp.TSP_V1), published)).toBe(false)
    expect(eq(tsp.encodeFieldsRev3(env.sender, env.receiver, tsp.TSP_REV2), published)).toBe(false)
  })
})

describe("the peek agrees with tsp-js 0.3.0's, which it replaces, except that it reads 1.0", () => {
  const keys = {
    senderSigningKey: ed25519.utils.randomSecretKey(),
    receiverEncryptionKey: x25519.getPublicKey(x25519.utils.randomSecretKey()),
  }

  async function rev3Frame(size = 16): Promise<Uint8Array> {
    return (await upstreamPack(new Uint8Array(size), 'did:example:a', 'did:example:b', keys)).bytes
  }

  test.each(publishedRev3)('%s: same revision, MAJOR and MINOR', (_name, message) => {
    const ours = tsp.peekRevision(message)
    const theirs = upstreamPeek(message)
    expect(ours).toEqual({
      revision: theirs.revision,
      major: theirs.major,
      minor: theirs.minor,
      recognised: theirs.recognised,
    })
  })

  test('a long-framed (0xFB) Rev 3 frame reads the same', async () => {
    const long = await rev3Frame(13_000)
    expect(long[0]).toBe(cesr.TSP_MAGIC_BYTE_LONG)
    expect(tsp.readTspVersion(long)).toEqual({ major: 0, minor: 2 })
    expect(tsp.peekRevision(long)).toEqual(expect.objectContaining({ revision: 'rev3', major: 0, minor: 2 }))
    expect(upstreamPeek(long).revision).toBe('rev3')
  })

  test('a Rev 2 marker is read as rev2 by both', async () => {
    const rev2 = withVersion(await rev3Frame(), tsp.TSP_REV2)
    expect(tsp.peekRevision(rev2).revision).toBe('rev2')
    expect(upstreamPeek(rev2).revision).toBe('rev2')
  })

  test('a 1.0 frame: our peek reads it as v1, where tsp-js 0.3.0 refused it', async () => {
    const v1 = withVersion(await rev3Frame(), tsp.TSP_V1)
    expect(tsp.readTspVersion(v1)).toEqual({ major: 1, minor: 0 })
    expect(tsp.peekRevision(v1)).toEqual({ revision: 'v1', major: 1, minor: 0, recognised: true })
    expect(refusal(() => upstreamPeek(v1)).code).toBe('E_TSP_REVISION')
  })

  test('a MAJOR neither reads is refused by both with the same error code, MAJOR and MINOR', async () => {
    const v2 = withVersion(await rev3Frame(), { major: 2, minor: 0 })
    const ours = refusal(() => tsp.peekRevision(v2))
    const theirs = refusal(() => upstreamPeek(v2))
    expect({ code: ours.code, major: ours.major, minor: ours.minor }).toEqual({
      code: theirs.code,
      major: theirs.major,
      minor: theirs.minor,
    })
    expect(ours.code).toBe('E_TSP_REVISION')
    let thrown: unknown
    try {
      tsp.peekRevision(v2)
    } catch (e) {
      thrown = e
    }
    expect(isRevisionError(thrown)).toBe(true)
  })

  test('bytes that are not a TSP frame, or have no marker, are refused the same way', () => {
    for (const junk of [utf8('not tsp at all'), new Uint8Array(0), new Uint8Array([0xf8, 0x00, 0x01, 0x00])]) {
      const ours = refusal(() => tsp.peekRevision(junk))
      const theirs = refusal(() => upstreamPeek(junk))
      expect(ours).toEqual(theirs)
      expect(ours.code).toBe('E_TSP_REVISION')
    }
  })
})
