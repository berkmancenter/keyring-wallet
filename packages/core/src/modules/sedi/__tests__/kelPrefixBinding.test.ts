/**
 * Inception checks for key-code prefixes (B, 1AAI, 1AAJ), on KELs built here with @noble and fixed keys: a key-code
 * prefix is its own inception key, a non-transferable prefix commits to no next key and has no later event, and a
 * transferable one (1AAJ) still rotates under pre-rotation. Every refusal row has a control: the same KEL with the one
 * thing it changes put back. The last rows run the same KELs through resolveWebs.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { ed25519 } from '@noble/curves/ed25519.js'
import { p256 } from '@noble/curves/nist.js'

import { setStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { b64Encode } from '../cesr/qb64'
import { DUMMY, digest, replayKel } from '../guardian/kel'
import { parseWebsDid, publishedDocument, resolveWebs, type WebsFetch, type WebsResponse } from '../webs'

const te = new TextEncoder()
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const b64Int = (n: number, width: number) => {
  let s = ''
  for (let i = 0; i < width; i++) s = B64[(n >> (6 * i)) & 63] + s
  return s
}
/** qb64 of `raw` under `code`: lead-pad so the code's characters land on zeroed bits, then write the code. */
const qb64 = (code: string, raw: Uint8Array) => {
  const lead = code.length === 1 ? 1 : code.length === 2 ? 2 : 3
  const padded = new Uint8Array(lead + raw.length)
  padded.set(raw, lead)
  return code + b64Encode(padded).slice(code.length)
}

type Signer = { key: string; sign: (msg: Uint8Array) => Uint8Array; sigCode: 'A' | 'E' }
const seed = (n: number) => new Uint8Array(32).fill(n)
const edSigner = (n: number): Signer => {
  const priv = seed(n)
  return { key: qb64('B', ed25519.getPublicKey(priv)), sign: (m) => ed25519.sign(m, priv), sigCode: 'A' }
}
const p256Signer = (code: '1AAJ' | '1AAI', n: number): Signer => {
  const priv = seed(n)
  return {
    key: qb64(code, p256.getPublicKey(priv, true)),
    sign: (m) => p256.sign(m, priv, { prehash: true }),
    sigCode: 'E',
  }
}

/** One KERI v2 JSON event (fields in keripy's order), sized, with its Blake3 SAID, signed by `signer` at index 0. */
function event(fields: Record<string, unknown>, signer: Signer): string {
  // The body is { v, t, d, ...rest } in that order; the version string carries the body's own size.
  const order = (size: number, d: string) => {
    const { t, ...rest } = fields
    return JSON.stringify({ v: `KERICAACAAJSON${b64Int(size, 4)}.`, t, d, ...rest })
  }
  const size = te.encode(order(0, DUMMY)).length
  const said = digest('E', te.encode(order(size, DUMMY)))
  const body = order(size, said)
  const sig = qb64(signer.sigCode + 'A', signer.sign(te.encode(body)))
  return `${body}-K${b64Int(sig.length / 4, 2)}${sig}`
}
const icp = (i: string, signer: Signer, over: Record<string, unknown> = {}) =>
  event(
    { t: 'icp', i, s: '0', kt: '1', k: [signer.key], nt: '0', n: [], bt: '0', b: [], c: [], a: [], ...over },
    signer
  )
const saidOf = (ev: string) => (JSON.parse(ev.slice(0, ev.indexOf('}-K') + 1)) as { d: string }).d
const replay = (...events: string[]) => replayKel(digest, te.encode(events.join('')))
const verdict = (...events: string[]) => {
  const r = replay(...events)
  return r.ok ? 'valid' : r.reason
}

const alice = edSigner(1)
const bea = edSigner(2)
const alicePN = p256Signer('1AAI', 3)
const beaPN = p256Signer('1AAI', 4)
const carl = p256Signer('1AAJ', 5)
const dana = p256Signer('1AAJ', 6)
const carlNext = p256Signer('1AAJ', 7)

describe('a key-code prefix is its own inception key', () => {
  it('a key-code prefix must equal its inception key (B) (control: the same icp with i = k[0] verifies)', () => {
    expect(verdict(icp(bea.key, alice))).toBe('sn 0 icp: key-code prefix is not its own inception key')
    expect(verdict(icp(alice.key, alice))).toBe('valid')
  })

  it('a key-code prefix must equal its inception key (1AAI) (control: i = k[0] verifies)', () => {
    expect(verdict(icp(beaPN.key, alicePN))).toBe('sn 0 icp: key-code prefix is not its own inception key')
    expect(verdict(icp(alicePN.key, alicePN))).toBe('valid')
  })

  it('a key-code prefix must equal its inception key (1AAJ, transferable) (control: i = k[0] verifies)', () => {
    const n = [digest('E', te.encode(carlNext.key))]
    expect(verdict(icp(dana.key, carl, { nt: '1', n }))).toBe('sn 0 icp: key-code prefix is not its own inception key')
    expect(verdict(icp(carl.key, carl, { nt: '1', n }))).toBe('valid')
  })

  it('a key-code prefix with two inception keys is refused, even when the first is the prefix (control: one key)', () => {
    const two = icp(alice.key, alice, { k: [alice.key, bea.key], kt: '1' })
    expect(verdict(two)).toBe('sn 0 icp: key-code prefix is not its own inception key')
  })

  it('the K0 basic-prefix fixtures still verify: their prefix is their inception key (B and 1AAI)', () => {
    const k0 = join(__dirname, 'fixtures', 'k0-utah-v2')
    for (const f of ['icp-jordan-nt-ed.cesr', 'icp-jordan-nt.cesr']) {
      const r = replayKel(digest, new Uint8Array(readFileSync(join(k0, f))))
      expect([f, r.ok && r.state.pre === r.state.keys[0]]).toEqual([f, true])
    }
  })
})

describe('a non-transferable prefix never commits to a next key', () => {
  const next = [digest('E', te.encode(bea.key))]

  it('a non-transferable prefix cannot commit to next keys: nt "1" with an n digest (control: nt "0", n [])', () => {
    expect(verdict(icp(alice.key, alice, { nt: '1', n: next }))).toBe(
      'sn 0 icp: non-transferable prefix commits to next keys'
    )
    expect(verdict(icp(alice.key, alice))).toBe('valid')
  })

  it('a non-transferable prefix cannot commit to next keys: an n digest alone, or nt alone (1AAI too)', () => {
    expect(verdict(icp(alice.key, alice, { n: next }))).toBe('sn 0 icp: non-transferable prefix commits to next keys')
    expect(verdict(icp(alice.key, alice, { nt: '1' }))).toBe('sn 0 icp: non-transferable prefix commits to next keys')
    expect(verdict(icp(alicePN.key, alicePN, { nt: '1', n: next }))).toBe(
      'sn 0 icp: non-transferable prefix commits to next keys'
    )
  })

  it('a non-transferable prefix has no later event (control: the same ixn after a transferable 1AAJ icp verifies)', () => {
    const first = icp(alice.key, alice)
    const ixn = event({ t: 'ixn', i: alice.key, s: '1', p: saidOf(first), a: [] }, alice)
    expect(verdict(first, ixn)).toBe('sn 1 ixn: non-transferable prefix has no later events')

    const n = [digest('E', te.encode(carlNext.key))]
    const tFirst = icp(carl.key, carl, { nt: '1', n })
    const tIxn = event({ t: 'ixn', i: carl.key, s: '1', p: saidOf(tFirst), a: [] }, carl)
    expect(verdict(tFirst, tIxn)).toBe('valid')
  })

  it('a non-transferable prefix has no later event: a rot is refused (control: a 1AAJ rot to its committed key)', () => {
    const first = icp(alice.key, alice)
    const rot = event(
      {
        t: 'rot',
        i: alice.key,
        s: '1',
        p: saidOf(first),
        kt: '1',
        k: [bea.key],
        nt: '0',
        n: [],
        bt: '0',
        br: [],
        ba: [],
        c: [],
        a: [],
      },
      bea
    )
    expect(verdict(first, rot)).toBe('sn 1 rot: non-transferable prefix has no later events')

    const n = [digest('E', te.encode(carlNext.key))]
    const tFirst = icp(carl.key, carl, { nt: '1', n })
    const tRot = event(
      {
        t: 'rot',
        i: carl.key,
        s: '1',
        p: saidOf(tFirst),
        kt: '1',
        k: [carlNext.key],
        nt: '0',
        n: [],
        bt: '0',
        br: [],
        ba: [],
        c: [],
        a: [],
      },
      carlNext
    )
    const r = replay(tFirst, tRot)
    expect(r.ok && [r.state.sn, r.state.keys]).toEqual([1, [carlNext.key]])
  })
})

describe('the same inceptions through resolveWebs', () => {
  type Routes = Record<string, Uint8Array | string>
  const fetchOf = (routes: Routes): WebsFetch =>
    (async (url: string): Promise<WebsResponse> => {
      const body = routes[url]
      const bytes = body === undefined ? new Uint8Array() : typeof body === 'string' ? te.encode(body) : body
      return {
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        url,
        redirected: false,
        headers: { get: () => null },
        arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
      }
    }) as unknown as WebsFetch
  const served = (aid: string, kel: string, docKeys: string[]) => {
    const did = `did:webs:example.org:people:${aid}`
    const id = parseWebsDid(did)
    if (!id.ok) throw new Error('bad test DID')
    const base = `https://example.org/people/${aid}`
    return {
      did,
      fetch: fetchOf({
        [`${base}/keri.cesr`]: kel,
        [`${base}/did.json`]: JSON.stringify(publishedDocument(id.value, docKeys)),
      }),
    }
  }

  beforeEach(() => setStateVerifiedApproversEnabled(true))
  afterEach(() => setStateVerifiedApproversEnabled(false))

  it('a key-code did:webs whose icp names other keys is refused, never valid (control: its own key resolves)', async () => {
    const n = [digest('E', te.encode(carlNext.key))]
    const other = served(dana.key, icp(dana.key, carl, { nt: '1', n }), [carl.key])
    const r = await resolveWebs(other.did, { fetch: other.fetch })
    expect(r.ok).toBe(false)
    expect(!r.ok && [r.reason, r.detail]).toEqual([
      'kelNotReplaying',
      'keri.cesr does not replay: sn 0 icp: key-code prefix is not its own inception key',
    ])

    const own = served(carl.key, icp(carl.key, carl, { nt: '1', n }), [carl.key])
    const ok = await resolveWebs(own.did, { fetch: own.fetch })
    expect(ok.ok && [ok.aid, ok.state.keys]).toEqual([carl.key, [carl.key]])
  })
})
