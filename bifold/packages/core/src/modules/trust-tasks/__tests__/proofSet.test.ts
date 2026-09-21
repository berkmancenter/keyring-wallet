/**
 * A community signs its status lists with a PROOF SET — eddsa-jcs-2022 beside
 * a post-quantum mldsa44-jcs-2024 — and the wallet read `proof` as one object,
 * found no proofValue, and reported every genuine list as unsigned. The
 * applicant's checklist then said the vetter's grant "could not be checked".
 *
 * The status-list suite mocks proof verification, which is how this stayed
 * invisible; these tests use the real verifier against the list a live
 * vtc-service served (fixtures/vtc-status-list-proof-set.json, 2026-09-21).
 */
import { checkStatusEntry } from '../module/vtiStatusList'
import { verifyDocumentProof } from '../documentProof'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('./fixtures/vtc-status-list-proof-set.json') as {
  issuer: string
  statusList: Record<string, unknown> & { proof: Record<string, unknown>[] }
  verificationMethod: Record<string, unknown>[]
}

const agent = {
  dids: { resolveDidDocument: async () => ({ verificationMethod: fixture.verificationMethod }) },
} as never

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const LIST_URL = 'https://keyring-vti-vtc.ngrok.app/v1/status-lists/revocation'
const serving = (body: unknown) =>
  (async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })) as unknown as typeof fetch

describe('a proof set', () => {
  it('verifies the list a live community served', async () => {
    expect(fixture.statusList.proof.map((p) => p.cryptosuite)).toEqual(['eddsa-jcs-2022', 'mldsa44-jcs-2024'])
    expect(await verifyDocumentProof(agent, fixture.statusList, fixture.issuer)).toBe(true)
  })

  it('fails when the list is altered after signing', async () => {
    const list = clone(fixture.statusList)
    ;(list.credentialSubject as Record<string, unknown>).statusPurpose = 'suspension'
    expect(await verifyDocumentProof(agent, list, fixture.issuer)).toBe(false)
  })

  it('fails when the proof we can check is broken, whatever its sibling says', async () => {
    const list = clone(fixture.statusList)
    const ours = list.proof[0]
    ours.proofValue = `z${'1'.repeat(String(ours.proofValue).length - 1)}`
    expect(await verifyDocumentProof(agent, list, fixture.issuer)).toBe(false)
  })

  it('does not trust a set that holds no suite we implement', async () => {
    const list = clone(fixture.statusList)
    list.proof = list.proof.filter((p) => p.cryptosuite !== 'eddsa-jcs-2022')
    expect(await verifyDocumentProof(agent, list, fixture.issuer)).toBe(false)
  })

  it('still checks the controller: the same set under another issuer fails', async () => {
    expect(await verifyDocumentProof(agent, fixture.statusList, 'did:webvh:someone-else')).toBe(false)
  })
})

describe('the vetter grant against that list', () => {
  // vtc-service allocates indices at random and seeds decoy bits (6,553 of
  // 131,072 here), so an index read with the wrong bit order lands on a decoy
  // about one time in twenty. 52232 is the live vetter grant: 0 MSB-first,
  // 1 LSB-first — which is how a wrong order would call a good vetter revoked.
  // affinidi-status-list 0.1.5 sets and reads MSB-first ("MSB first per spec").
  it('reads the live grant as not revoked', async () => {
    const result = await checkStatusEntry(
      agent,
      { url: LIST_URL, index: 52232, purpose: 'revocation' },
      fixture.issuer,
      {
        fetchImpl: serving(fixture.statusList),
      }
    )
    expect(result.state).toBe('ok')
  })

  it('reads a set bit as revoked', async () => {
    const result = await checkStatusEntry(agent, { url: LIST_URL, index: 24, purpose: 'revocation' }, fixture.issuer, {
      fetchImpl: serving(fixture.statusList),
    })
    expect(result.state).toBe('revoked')
  })
})
