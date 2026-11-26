import { getPublicJwkFromVerificationMethod } from '@credo-ts/core'

import { classifyDid } from '../../src/modules/trust-tasks/module/classifyDid'
import type { WebsFetch, WebsResponse } from '../../src/modules/sedi/webs/resolve'
import { WebsDidResolver, websDocument } from '../../src/utils/WebsDidResolver'

// The SEDI VTC's did.json as its host published it on 2026-11-17 (webvh.storm.ws/sedi-vtc/<AID>/did.json).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SEDI_VTC = require('./fixtures/sedi-vtc.did.json')
const DID = 'did:webs:webvh.storm.ws:sedi-vtc:EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a'
const URL = 'https://webvh.storm.ws/sedi-vtc/EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a/did.json'
const X25519 = `${DID}#CEb2px4Zx72Okzu-IsJAG9BoQ3-gSnfCMjhrAZAG-7Yo`

const answer = (body: unknown, over: Partial<WebsResponse> = {}): WebsResponse => {
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body))
  return { ok: true, status: 200, url: URL, arrayBuffer: async () => bytes.buffer as ArrayBuffer, ...over }
}
const serving = (response: WebsResponse | Error) => {
  const fetchFn = jest.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  return { fetchFn: fetchFn as unknown as WebsFetch, calls: fetchFn.mock.calls as unknown as Array<[string, unknown]> }
}
const resolve = (fetchFn: WebsFetch, did = DID) => new WebsDidResolver(fetchFn).resolve({} as never, did)

describe('WebsDidResolver', () => {
  it('claims did:webs only', () => {
    expect(new WebsDidResolver().supportedMethods).toEqual(['webs'])
  })

  it("resolves the SEDI VTC from its host's did.json, fetched over HTTPS at the DID's own path", async () => {
    const { fetchFn, calls } = serving(answer(SEDI_VTC))
    const result = await resolve(fetchFn)
    expect(calls[0][0]).toBe(URL)
    expect(calls[0][1]).toMatchObject({ redirect: 'manual' })
    expect(result.didResolutionMetadata).toEqual({ contentType: 'application/did+json' })
    expect(result.didDocument?.id).toBe(DID)
    // The host writes each type as a list of one; Credo takes a string.
    expect(result.didDocument?.service?.map((s) => s.type)).toEqual([
      'TSPTransport',
      'VTCRest',
      'VTCStatusList',
      'TrustTaskHTTPS',
      'SignInPortal',
    ])
    expect(result.didDocument?.service?.[1].serviceEndpoint).toBe('https://sedi-vtc.openvti.net/v1')
  })

  it('classifies as a community, as the scan needs', async () => {
    const resolver = new WebsDidResolver(serving(answer(SEDI_VTC)).fetchFn)
    const agent = { dids: { resolve: (did: string) => resolver.resolve({} as never, did) } }
    await expect(classifyDid(agent, DID)).resolves.toEqual({ kind: 'community', did: DID })
  })

  // VtiMediatorTransport reads a peer's key exactly so: keyAgreement[0], dereferenced if a string, then Credo's JWK
  // helper. The SEDI VTC's is a string reference to a "JsonWebKey" VM.
  it("its keyAgreement dereferences to the X25519 key, as the community join's encryption reads it", async () => {
    const doc = (await resolve(serving(answer(SEDI_VTC)).fetchFn)).didDocument!
    const keyAgreement = doc.keyAgreement?.[0]
    expect(typeof keyAgreement).toBe('string')
    const vm = typeof keyAgreement === 'string' ? doc.dereferenceKey(keyAgreement, ['keyAgreement']) : keyAgreement!
    expect(vm.id).toBe(X25519)
    const jwk = getPublicJwkFromVerificationMethod(vm)
    expect(jwk.toJson()).toMatchObject({ kty: 'OKP', crv: 'X25519', x: 'RvanHhnHvY6TO74iwkAb0GhDf6BKd8IyOGsBkAb7tig' })
  })

  // documentProof checks the join's answer and the membership credential against the community's assertion key.
  it('its Ed25519 assertion key reads as a JWK too, as the answer and the credential are checked', async () => {
    const doc = (await resolve(serving(answer(SEDI_VTC)).fetchFn)).didDocument!
    const vm = doc.dereferenceKey(SEDI_VTC.assertionMethod[0], ['assertionMethod'])
    expect(vm.type).toBe('JsonWebKey2020')
    expect(getPublicJwkFromVerificationMethod(vm).toJson()).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'EuA6-u-Lz-wy8BNfWJwgvh8dwr-RIu5pdZCjbUsflu0',
    })
    expect(doc.authentication).toEqual(SEDI_VTC.authentication)
  })

  it('an embedded JsonWebKey method in a relationship is read as JsonWebKey2020; a non-JWK one is left as it is', () => {
    const embedded = SEDI_VTC.verificationMethod[1]
    const multikey = { id: `${DID}#m`, type: 'Multikey', controller: DID, publicKeyMultibase: 'z6LS' }
    const doc = websDocument(DID, { ...SEDI_VTC, keyAgreement: [embedded, multikey] })
    expect(doc.keyAgreement).toEqual([{ ...embedded, type: 'JsonWebKey2020' }, multikey])
  })

  it('refuses a document that names another DID', async () => {
    const other = { ...SEDI_VTC, id: 'did:webs:evil.example:EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a' }
    const result = await resolve(serving(answer(other)).fetchFn)
    expect(result.didDocument).toBeNull()
    expect(result.didResolutionMetadata.error).toBe('invalidDidDocument')
  })

  it('refuses the did:web twin: upstream takes it only with a designated-aliases attestation, read from the KEL', async () => {
    const twin = DID.replace('did:webs:', 'did:web:')
    const published = JSON.parse(JSON.stringify(SEDI_VTC).split(`"${DID}`).join(`"${twin}`))
    const result = await resolve(serving(answer(published)).fetchFn)
    expect(result.didDocument).toBeNull()
    expect(result.didResolutionMetadata.error).toBe('invalidDidDocument')
  })

  it('makes relative references absolute against the subject, as upstream does', async () => {
    const rel = JSON.parse(JSON.stringify(SEDI_VTC).split(`"${DID}#`).join('"#'))
    const doc = (await resolve(serving(answer(rel)).fetchFn)).didDocument!
    expect(doc.keyAgreement).toEqual([X25519])
    expect(doc.dereferenceKey(X25519, ['keyAgreement']).id).toBe(X25519)
    expect(doc.service?.[1].id).toBe(`${DID}#vtc-rest`)
  })

  it('refuses a redirect off the host, and reads 404 as not found', async () => {
    const moved = await resolve(
      serving(answer(SEDI_VTC, { url: 'https://evil.example/did.json', redirected: true })).fetchFn
    )
    expect(moved.didDocument).toBeNull()
    const missing = await resolve(serving(answer('', { ok: false, status: 404 })).fetchFn)
    expect(missing.didResolutionMetadata.error).toBe('notFound')
  })

  it('a network failure, bad JSON or a malformed DID resolves to nothing', async () => {
    expect((await resolve(serving(new Error('offline')).fetchFn)).didDocument).toBeNull()
    expect((await resolve(serving(answer('{not json')).fetchFn)).didResolutionMetadata.error).toBe('invalidDidDocument')
    const { fetchFn, calls } = serving(answer(SEDI_VTC))
    expect((await resolve(fetchFn, 'did:webs:webvh.storm.ws:short')).didResolutionMetadata.error).toBe('invalidDid')
    expect(calls).toHaveLength(0)
  })
})
