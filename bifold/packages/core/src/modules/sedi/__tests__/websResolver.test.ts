/**
 * Verify-only did:webs (sedi/webs) over the K0 root's artifacts (fixtures/webs-k0-root, written by
 * webs-k0-root.gen.mjs from k0-utah-v2/kel-roy.cesr). Imports only webs/{identifier,document,resolve}, which stay when
 * the SEDI demo moves off main; no approver flag is set anywhere, because resolveWebs has no gate. Every row runs
 * against an injected fetch; nothing touches the network. Each refusal row has a control: the same request with the one thing it changes put back.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { jwkOf, publishedDocument } from '../webs/document'
import { artifactUrl, parseWebsDid } from '../webs/identifier'
import { resolveWebs, type WebsFetch, type WebsResponse } from '../webs/resolve'

const ROOT = 'IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6' // the K0 State root (roy)
const OTHER = 'IBv2DqvYol_GdZH3R6M6X-UiSjqcBm6pooXoikn2alOZ' // another AID served by the same fixture (deb)
const DID = `did:webs:example.org:keyring-demo-state:${ROOT}`
const served = (aid: string) => join(__dirname, 'fixtures', 'webs-k0-root', 'example.org', 'keyring-demo-state', aid)
const SERVED = served(ROOT)
const kelBytes = () => new Uint8Array(readFileSync(join(SERVED, 'keri.cesr')))
const docText = () => readFileSync(join(SERVED, 'did.json'), 'utf8')
const te = new TextEncoder()

const KEL_URL = `https://example.org/keyring-demo-state/${ROOT}/keri.cesr`
const DOC_URL = `https://example.org/keyring-demo-state/${ROOT}/did.json`

type Served = Partial<WebsResponse> & { body?: Uint8Array | string; never?: true; throws?: string }

/** A fetch that serves `routes` by URL; anything unrouted is a 404. Records every URL asked for. */
function fakeFetch(routes: Record<string, Served>): WebsFetch & { asked: string[] } {
  const asked: string[] = []
  const f = (async (url: string): Promise<WebsResponse> => {
    asked.push(url)
    const r = routes[url]
    if (!r) return { ok: false, status: 404, url, arrayBuffer: async () => new ArrayBuffer(0) }
    if (r.throws) throw new Error(r.throws)
    if (r.never) return new Promise<WebsResponse>(() => undefined)
    const body = typeof r.body === 'string' ? te.encode(r.body) : (r.body ?? new Uint8Array())
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      url: r.url ?? url,
      redirected: r.redirected ?? false,
      headers: r.headers ?? { get: () => null },
      arrayBuffer: async () => body.slice().buffer as ArrayBuffer,
    }
  }) as unknown as WebsFetch & { asked: string[] }
  f.asked = asked
  return f
}
const good = (over: { kel?: Served; doc?: Served } = {}) =>
  fakeFetch({ [KEL_URL]: { body: kelBytes(), ...over.kel }, [DOC_URL]: { body: docText(), ...over.doc } })
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? 'valid' : r.reason)
const withDoc = (edit: (d: Record<string, unknown>) => void) => {
  const d = JSON.parse(docText()) as Record<string, unknown>
  edit(d)
  return JSON.stringify(d)
}
/** Replace `from` with `to` in the KEL bytes (same length, so the CESR framing still adds up). */
const kelWith = (from: string, to: string) => {
  expect(to).toHaveLength(from.length)
  const t = new TextDecoder('latin1').decode(kelBytes())
  expect(t.includes(from)).toBe(true)
  return te.encode(t.replace(from, to))
}

describe('identifiers and the published document', () => {
  it('W01: did:webs maps to its two HTTPS artifact URLs, with %3A as a port (control: a malformed DID is refused)', () => {
    const id = parseWebsDid(DID)
    expect(id.ok && [artifactUrl(id.value, 'keri.cesr'), artifactUrl(id.value, 'did.json')]).toEqual([KEL_URL, DOC_URL])
    const port = parseWebsDid(`did:webs:example.org%3A8443:a:b:${ROOT}`)
    expect(port.ok && artifactUrl(port.value, 'did.json')).toBe(`https://example.org:8443/a/b/${ROOT}/did.json`)
    for (const bad of [
      `did:web:example.org:${ROOT}`,
      'did:webs:example.org',
      `did:webs::${ROOT}`,
      `did:webs:ex/ample:${ROOT}`,
      `did:webs:example.org:..:${ROOT}`,
    ])
      expect([bad, parseWebsDid(bad).ok]).toEqual([bad, false])
  })

  it('W02: the committed did.json (an independent derivation) is exactly what publishedDocument derives from the KEL', () => {
    const id = parseWebsDid(DID)
    const keys = [
      (JSON.parse(docText()) as { verificationMethod: { publicKeyJwk: { kid: string } }[] }).verificationMethod[0]
        .publicKeyJwk.kid,
    ]
    expect(id.ok && publishedDocument(id.value, keys)).toEqual(JSON.parse(docText()))
    expect(jwkOf(keys[0])).toMatchObject({ kty: 'EC', crv: 'P-256' })
  })
})

describe('resolveWebs', () => {
  it('W03: the K0 root resolves: its KEL replays, the AID matches, did.json carries its key (the control for every row)', async () => {
    const fetch = good()
    const r = await resolveWebs(DID, { fetch })
    expect(reason(r)).toBe('valid')
    expect(r.ok && [r.aid, r.state.pre, r.state.sn, r.history.length, r.kel.length]).toEqual([
      ROOT,
      ROOT,
      2,
      3,
      kelBytes().length,
    ])
    expect(fetch.asked).toEqual([KEL_URL, DOC_URL])
  })

  it('W04: with no approver flag set, anywhere, it resolves: not switchedOff, and both artifacts are fetched (control: W03 is the same call)', async () => {
    const fetch = good()
    const r = await resolveWebs(DID, { fetch })
    expect(r.ok).toBe(true)
    expect(r.ok === false && r.reason).not.toBe('switchedOff')
    expect(fetch.asked).toEqual([KEL_URL, DOC_URL])
  })

  it('W05: a tampered KEL is refused as kelNotReplaying, even with a matching did.json (control: W03)', async () => {
    const r = await resolveWebs(DID, { fetch: good({ kel: { body: kelWith('"s":"1"', '"s":"3"') } }) })
    expect(reason(r)).toBe('kelNotReplaying')
  })

  it("W06: another AID's KEL served at this DID is refused as aidMismatch (control: W03)", async () => {
    const sam = new Uint8Array(readFileSync(join(served(OTHER), 'keri.cesr')))
    expect(reason(await resolveWebs(DID, { fetch: good({ kel: { body: sam } }) }))).toBe('aidMismatch')
  })

  it("W07: a did.json whose key is not the KEL's is refused, however it differs (control: W03's did.json passes)", async () => {
    const edits: ((d: Record<string, unknown>) => void)[] = [
      (d) => ((d.verificationMethod as { publicKeyJwk: { x: string } }[])[0].publicKeyJwk.x = 'A'.repeat(43)),
      (d) => ((d.verificationMethod as { publicKeyJwk: { kid: string } }[])[0].publicKeyJwk.kid = 'other'),
      (d) => (d.verificationMethod = []),
      (d) => (d.verificationMethod = [...(d.verificationMethod as unknown[]), ...(d.verificationMethod as unknown[])]),
      (d) => (d.id = `did:web:example.org:keyring-demo-state:${OTHER}`),
      (d) => (d.keyAgreement = ['#x']),
      (d) => (d.service = [{ id: '#s', type: 'LinkedDomains', serviceEndpoint: 'https://evil.example' }]),
      (d) => (d.authentication = ['#somethingElse']),
    ]
    for (const [i, e] of edits.entries())
      expect([i, reason(await resolveWebs(DID, { fetch: good({ doc: { body: withDoc(e) } }) }))]).toEqual([
        i,
        'didDocMismatch',
      ])
    expect(reason(await resolveWebs(DID, { fetch: good({ doc: { body: withDoc(() => undefined) } }) }))).toBe('valid')
  })

  it('W08: did:keri in alsoKnownAs for another AID is refused as aliasMismatch (control: its own did:keri, and an unverified did:web alias, pass)', async () => {
    const other = withDoc((d) => (d.alsoKnownAs = [`did:keri:${OTHER}`]))
    expect(reason(await resolveWebs(DID, { fetch: good({ doc: { body: other } }) }))).toBe('aliasMismatch')
    const own = withDoc((d) => (d.alsoKnownAs = [`did:keri:${ROOT}`, 'did:web:elsewhere.example:x']))
    const r = await resolveWebs(DID, { fetch: good({ doc: { body: own } }) })
    expect(r.ok && r.unverifiedAliases).toEqual(['did:web:elsewhere.example:x'])
  })

  it('W09: an artifact served over http is refused as notHttps (control: W03, the same bytes over https)', async () => {
    const r = await resolveWebs(DID, { fetch: good({ doc: { url: DOC_URL.replace('https:', 'http:') } }) })
    expect(reason(r)).toBe('notHttps')
  })

  it('W10: a redirect is refused: one off the origin, one within it, and a bare 3xx (control: W03, served in place)', async () => {
    const off = { url: `https://evil.example/keyring-demo-state/${ROOT}/did.json`, redirected: true }
    const same = { url: `https://example.org/elsewhere/${ROOT}/did.json`, redirected: true }
    expect(reason(await resolveWebs(DID, { fetch: good({ doc: off }) }))).toBe('redirectRefused')
    expect(reason(await resolveWebs(DID, { fetch: good({ kel: same }) }))).toBe('redirectRefused')
    expect(reason(await resolveWebs(DID, { fetch: good({ doc: { ok: false, status: 302 } }) }))).toBe('redirectRefused')
  })

  it('W11: an oversize artifact is refused as tooLarge, by its declared length and by its bytes (control: the same files under the default caps)', async () => {
    const big = { get: (h: string) => (h === 'content-length' ? String(10 * 1024 * 1024) : null) }
    expect(reason(await resolveWebs(DID, { fetch: good({ kel: { headers: big } }) }))).toBe('tooLarge')
    const small = { keriCesrBytes: kelBytes().length - 1 }
    expect(reason(await resolveWebs(DID, { fetch: good(), limits: small }))).toBe('tooLarge')
    expect(reason(await resolveWebs(DID, { fetch: good(), limits: { keriCesrBytes: kelBytes().length } }))).toBe(
      'valid'
    )
  })

  it('W12: no answer within the timeout is refused as timeout (control: an answer inside it, W03)', async () => {
    const r = await resolveWebs(DID, { fetch: good({ doc: { never: true } }), limits: { timeoutMs: 30 } })
    expect(reason(r)).toBe('timeout')
  })

  it('W13: a fetch that throws, or a 404, is refused as unreachable (control: W03)', async () => {
    expect(reason(await resolveWebs(DID, { fetch: good({ kel: { throws: 'offline' } }) }))).toBe('unreachable')
    expect(reason(await resolveWebs(DID, { fetch: fakeFetch({ [KEL_URL]: { body: kelBytes() } }) }))).toBe(
      'unreachable'
    )
  })

  it('W14: a KEL that declares witnesses is refused as witnessesUnsupported, before its replay (control: bt 0, W03)', async () => {
    const r = await resolveWebs(DID, { fetch: good({ kel: { body: kelWith('"bt":"0"', '"bt":"1"') } }) })
    expect(r.ok === false && [r.reason, r.detail]).toEqual([
      'witnessesUnsupported',
      expect.stringContaining('witness receipts'),
    ])
  })

  it('W15: a did.json that is not JSON is refused as didDocMismatch, and a KEL that does not read as CESR as malformedCesr', async () => {
    expect(reason(await resolveWebs(DID, { fetch: good({ doc: { body: '<html>' } }) }))).toBe('didDocMismatch')
    expect(reason(await resolveWebs(DID, { fetch: good({ kel: { body: kelBytes().slice(0, 100) } }) }))).toBe(
      'malformedCesr'
    )
  })
})
