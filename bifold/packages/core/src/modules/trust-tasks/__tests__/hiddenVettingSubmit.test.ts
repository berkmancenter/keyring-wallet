/**
 * A hidden-vetting join submission (`vtc/join-requests/submit/0.3`): the proof
 * rides in `extensions.hiddenVetting`, verbatim, and the presentation carries no
 * vetting statements.
 *
 * Both halves matter. A community refuses a hidden-criterion submission that
 * carries no proof rather than counting named statements (vtc-service
 * vetting/pcs.rs), and a submission carrying statements as well as the proof
 * would name the very vetters the proof exists to keep hidden. The 0.3 schema
 * declares `extensions` ("opaque applicant-supplied extension bag") with
 * `additionalProperties: false` around it; until this, the wallet dropped the
 * bag at 0.3 altogether.
 */
import { classifyCredential } from '../module/vtiInbox'
import { readManifest } from '../module/joinManifest'
import { submitPayload } from '../module/joinWire'
import { vtiAgent } from '../module/vtiAgent'
import { vendoredValidator } from './fixtures/vtcJoinSchemas'
// eslint-disable-next-line import/order
import signed from './fixtures/vti-upstream-signed.json'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const SUBMIT = 'https://trusttasks.org/spec/vtc/join-requests/submit'
const DIGEST = 'zQmYQEnpKD9N2dpLRfVRZfZUVmBZ8BWvnJmNvorLxKeP2NC'
const VP = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiablePresentation'] }
/** The shape `vta/pcs/prove` answers with; opaque to the submit, which must not reshape it. */
const PROOF = {
  suite: 'ps-ddh-bls12381',
  requirementsDigest: DIGEST,
  challenge: 'a961aa3e63df4d15c9ad565feed87c46',
  proof: 'zProofBytesOpaqueToTheWallet',
  nested: { ordered: ['b', 'a'], n: 3 },
}

describe('the submit payload', () => {
  const valid03 = vendoredValidator('vtc-join-requests-submit-0.3.payload.schema.json')

  it('at 0.3 carries the extension bag when there is something in it, and the schema accepts it', () => {
    const payload = submitPayload('0.3', {
      vp: VP,
      registryConsent: false,
      criterion: DIGEST,
      extensions: { hiddenVetting: PROOF },
    })
    expect(payload).toEqual({ vp: VP, registryConsent: false, criterion: DIGEST, extensions: { hiddenVetting: PROOF } })
    expect(valid03(payload)).toBe(true)
  })

  it('at 0.3 is unchanged for an ordinary submission: no bag at all', () => {
    const payload = submitPayload('0.3', { vp: VP, registryConsent: true, criterion: DIGEST })
    expect(payload).not.toHaveProperty('extensions')
    expect(valid03(payload)).toBe(true)
    expect(submitPayload('0.3', { vp: VP, registryConsent: true, extensions: {} })).not.toHaveProperty('extensions')
  })

  it('at 0.2 keeps the digest in the bag, beside whatever else it carries', () => {
    expect(
      submitPayload('0.2', { vp: VP, registryConsent: false, criterion: DIGEST, extensions: { hiddenVetting: PROOF } })
    ).toEqual({ vp: VP, registryConsent: false, extensions: { hiddenVetting: PROOF, requirementsDigest: DIGEST } })
    expect(submitPayload('0.2', { vp: VP, registryConsent: false })).toEqual({
      vp: VP,
      registryConsent: false,
      extensions: {},
    })
  })
})

describe('applying with a hidden-vetting proof', () => {
  const statement = signed.statement as Record<string, unknown>
  const card = signed.card as Record<string, unknown>
  const manifest = () =>
    readManifest(
      {
        communityDid: 'did:webvh:QmCommunity:test-vtc.example',
        criteria: [{ id: 'Vetted-Member', admission: 'automatic', requirementsDigest: DIGEST }],
      },
      '0.3'
    )
  const answer = (effect: string) => ({
    type: `${SUBMIT}/0.3#response`,
    body: { payload: { requestId: 'r-1', verdict: { effect, with: {} } } },
  })
  afterEach(() => jest.restoreAllMocks())

  function asking() {
    const asked: { type: string; payload: Record<string, unknown> }[] = []
    jest.spyOn(vtiAgent, 'ask').mockImplementation(async (_community, type, payload) => {
      asked.push({ type, payload })
      return answer('allow') as never
    })
    return asked
  }

  it('the fixture is what the test needs: one vetting statement, one other card', () => {
    expect(classifyCredential(statement).kind).toBe('vetting-statement')
    expect(classifyCredential(card).kind).not.toBe('vetting-statement')
  })

  it('sends the proof verbatim in extensions.hiddenVetting, under the criterion, and no vetting statement', async () => {
    const asked = asking()
    await vtiAgent.apply('did:webvh:QmCommunity:test-vtc.example', manifest(), {
      credentials: [statement, card],
      requirementsDigest: DIGEST,
      hiddenVetting: PROOF,
    })
    expect(asked).toHaveLength(1)
    const sent = asked[0].payload as {
      criterion?: string
      extensions?: { hiddenVetting?: unknown }
      vp: { verifiableCredential: unknown[] }
    }
    expect(asked[0].type).toBe(`${SUBMIT}/0.3`)
    expect(sent.criterion).toBe(DIGEST)
    // Verbatim: the same value, not a re-shaped copy of it.
    expect(sent.extensions?.hiddenVetting).toBe(PROOF)
    expect(sent.vp.verifiableCredential).toEqual([card])
    expect(vendoredValidator('vtc-join-requests-submit-0.3.payload.schema.json')(sent)).toBe(true)
  })

  it('without a proof, a submission is exactly as before: statements kept, no bag', async () => {
    const asked = asking()
    await vtiAgent.apply('did:webvh:QmCommunity:test-vtc.example', manifest(), {
      credentials: [statement, card],
      requirementsDigest: DIGEST,
    })
    const sent = asked[0].payload as { vp: { verifiableCredential: unknown[] } }
    expect(sent).not.toHaveProperty('extensions')
    expect(sent.vp.verifiableCredential).toEqual([statement, card])
  })
})
