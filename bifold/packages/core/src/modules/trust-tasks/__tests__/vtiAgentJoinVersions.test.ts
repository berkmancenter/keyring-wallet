/**
 * One build joins a community at whichever version of the join tasks it
 * serves: 0.2 (vta-service up to 0.51) or 0.3 (from vti #1907, which answers
 * the older ones `unsupportedVersion`).
 *
 * The rule that makes the fallback safe is tested as a rule: a request is sent
 * again in another version ONLY when the community's dispatch refused it as a
 * version it does not serve — a refusal made before any handler runs, so the
 * request was not taken. Silence, and every other refusal, is never answered
 * with a resend.
 *
 * The 0.2 answers are a running vtc-service 0.49.0's (fixtures/join-0.3).
 */
import { VtiRefusal, VtiSentNoAnswer, isUnsupportedJoinVersion, joinRequestRefusal, vtiAgent } from '../module/vtiAgent'
import { criterionDigest, readManifest, type VtiCriterion, type VtiManifest } from '../module/joinManifest'

import vtc049 from './fixtures/join-0.3/vtc-0.49.0-answers.json'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest'
const SUBMIT = 'https://trusttasks.org/spec/vtc/join-requests/submit'
const ERROR = 'https://trusttasks.org/spec/trust-task-error/0.5'

const published = (criterion: VtiCriterion): VtiCriterion => ({
  ...criterion,
  requirementsDigest: criterionDigest(criterion),
})
const invited = published({ id: 'invited', admission: 'automatic', invitationRequired: true })
const review = published({ id: 'review', admission: 'review' })
const payload03 = { communityDid: 'did:webvh:QmVtcScid:vtc.example.org', criteria: [invited, review] }
const payload02 = vtc049.manifest02.payload

const refusal = (code: string, details?: unknown) => ({
  type: ERROR,
  body: { payload: { code, message: code, details } },
})
const unsupported = (family: string, served: string[]) =>
  refusal('unsupportedVersion', { servedVersions: served.map((v) => `${family}/${v}`) })
const answer = (type: string, payload: unknown) => ({ type: `${type}#response`, body: { payload } })
const verdict = (effect: string) => ({ requestId: 'r-1', verdict: { effect, with: {} } })

let community = 0
/** A community no other test has spoken to: the agent remembers the version each one answered in. */
const nextCommunity = () => `did:webvh:QmCommunity${++community}:vtc.example.org`

function fakeAgent(communityDid: string) {
  return {
    dids: {
      resolveDidDocument: jest.fn(async () => ({
        id: communityDid,
        service: [{ id: '#rest', type: 'VTCRest', serviceEndpoint: 'https://vtc.example.org/v1' }],
      })),
    },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  } as never
}

/** A community's REST endpoint: what it answers to each task type. Records the types it was asked. */
function restServing(answers: Record<string, { status: number; body: unknown }>) {
  const asked: string[] = []
  global.fetch = jest.fn(async (_url: unknown, init: { body: string }) => {
    const type = JSON.parse(init.body).type as string
    asked.push(type)
    const found = answers[type] ?? { status: 404, body: {} }
    return { ok: found.status < 300, status: found.status, json: async () => found.body }
  }) as unknown as typeof fetch
  return asked
}
const rest03 = { status: 200, body: { type: `${MANIFEST}/0.3#response`, payload: payload03 } }
const rest02 = { status: 200, body: vtc049.manifest02 }
const restRefuses = (served: string[]) => ({
  status: 422,
  body: {
    type: ERROR,
    payload: { code: 'unsupportedVersion', details: { servedVersions: served.map((v) => `${MANIFEST}/${v}`) } },
  },
})

/** The community over DIDComm/TSP: what it answers to each task type, in order. Records the types it was asked. */
function asking(answers: Record<string, unknown[]>) {
  const asked: Array<{ type: string; payload: Record<string, unknown> }> = []
  jest.spyOn(vtiAgent, 'ask').mockImplementation(async (_community, type, payload) => {
    asked.push({ type, payload })
    const queue = answers[type]
    if (!queue?.length) return undefined
    return queue.shift() as never
  })
  return asked
}
const typesOf = (asked: Array<{ type: string }>) => asked.map((a) => a.type)

const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

describe('reading the manifest over REST', () => {
  it('reads a community that serves 0.3 at 0.3', async () => {
    const communityDid = nextCommunity()
    const asked = restServing({ [`${MANIFEST}/0.3`]: rest03 })
    const manifest = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(manifest.wire).toBe('0.3')
    expect(manifest.criteria.map((c) => c.id)).toEqual(['invited', 'review'])
    expect(asked).toEqual([`${MANIFEST}/0.3`])
  })

  it('falls back to 0.2 for a vtc-service 0.49.0 community — its refusal comes with a failing status — and asks 0.2 first from then on', async () => {
    const communityDid = nextCommunity()
    const asked = restServing({
      [`${MANIFEST}/0.3`]: { status: vtc049.unsupportedVersion.status, body: vtc049.unsupportedVersion },
      [`${MANIFEST}/0.2`]: rest02,
    })
    const manifest = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(manifest.wire).toBe('0.2')
    expect(manifest.criteria.map((c) => c.id)).toEqual(['invited-member', 'vetted-member'])
    expect(manifest.branding?.displayName).toBe('Keyring Lab Community')
    expect(asked).toEqual([`${MANIFEST}/0.3`, `${MANIFEST}/0.2`])

    asked.length = 0
    await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(asked).toEqual([`${MANIFEST}/0.2`])
  })

  it('moves up to 0.3 when a community it knew at 0.2 has been upgraded', async () => {
    const communityDid = nextCommunity()
    restServing({ [`${MANIFEST}/0.3`]: restRefuses(['0.1', '0.2']), [`${MANIFEST}/0.2`]: rest02 })
    await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))

    const asked = restServing({ [`${MANIFEST}/0.2`]: restRefuses(['0.3']), [`${MANIFEST}/0.3`]: rest03 })
    const manifest = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(manifest.wire).toBe('0.3')
    expect(asked).toEqual([`${MANIFEST}/0.2`, `${MANIFEST}/0.3`])
  })

  it('says so when the community serves no version this wallet speaks, without asking again over DIDComm', async () => {
    const communityDid = nextCommunity()
    restServing({ [`${MANIFEST}/0.3`]: restRefuses(['0.4']) })
    const asked = asking({})
    const failure = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid)).catch((e) => e)
    expect(failure).toBeInstanceOf(VtiRefusal)
    expect(isUnsupportedJoinVersion(failure)).toBe(true)
    expect(asked).toEqual([])
  })

  it('still falls through to DIDComm, in the same version, for any other REST failure', async () => {
    const communityDid = nextCommunity()
    restServing({
      [`${MANIFEST}/0.3`]: { status: 400, body: { type: ERROR, payload: { code: 'malformedRequest' } } },
    })
    const asked = asking({ [`${MANIFEST}/0.3`]: [answer(`${MANIFEST}/0.3`, payload03)] })
    const manifest = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(manifest.wire).toBe('0.3')
    expect(typesOf(asked)).toEqual([`${MANIFEST}/0.3`])
  })
})

describe('reading the manifest over DIDComm or TSP', () => {
  it('falls back to 0.2 when 0.3 is refused as unsupported', async () => {
    const communityDid = nextCommunity()
    const asked = asking({
      [`${MANIFEST}/0.3`]: [unsupported(MANIFEST, ['0.1', '0.2'])],
      [`${MANIFEST}/0.2`]: [answer(`${MANIFEST}/0.2`, payload02)],
    })
    const manifest = await vtiAgent.fetchManifest(communityDid)
    expect(manifest.wire).toBe('0.2')
    expect(typesOf(asked)).toEqual([`${MANIFEST}/0.3`, `${MANIFEST}/0.2`])
  })

  it('does not ask in another version when the community is silent, or refuses for another reason', async () => {
    const silent = nextCommunity()
    let asked = asking({})
    await expect(vtiAgent.fetchManifest(silent)).rejects.toBeInstanceOf(VtiSentNoAnswer)
    expect(typesOf(asked)).toEqual([`${MANIFEST}/0.3`])

    jest.restoreAllMocks()
    const closed = nextCommunity()
    asked = asking({ [`${MANIFEST}/0.3`]: [refusal('unauthorized')] })
    await expect(vtiAgent.fetchManifest(closed)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(typesOf(asked)).toEqual([`${MANIFEST}/0.3`])
  })
})

describe('submitting', () => {
  const manifest03 = () => readManifest(payload03, '0.3')
  const manifest02 = () => readManifest(payload02 as Partial<VtiManifest>, '0.2')

  it('at 0.3 names the criterion in `criterion`: the invitation criterion for an invitation, none for a plain request', async () => {
    const communityDid = nextCommunity()
    const asked = asking({
      [`${SUBMIT}/0.3`]: [answer(`${SUBMIT}/0.3`, verdict('allow')), answer(`${SUBMIT}/0.3`, verdict('refer'))],
    })
    const admitted = await vtiAgent.apply(communityDid, manifest03(), {
      credentials: [{ id: 'vic' }],
      intent: 'invitation',
    })
    expect(admitted.effect).toBe('allow')
    expect(asked[0].type).toBe(`${SUBMIT}/0.3`)
    expect(asked[0].payload.criterion).toBe(invited.requirementsDigest)
    expect(asked[0].payload).not.toHaveProperty('extensions')

    const referred = await vtiAgent.apply(communityDid, manifest03())
    expect(referred.effect).toBe('refer')
    expect(asked[1].payload).not.toHaveProperty('criterion')
  })

  it('at 0.2 is what it was: the digest in `extensions.requirementsDigest`, and no `criterion`', async () => {
    const communityDid = nextCommunity()
    const asked = asking({ [`${SUBMIT}/0.2`]: [answer(`${SUBMIT}/0.2`, verdict('requestMore'))] })
    await vtiAgent.apply(communityDid, manifest02(), {
      requirementsDigest: 'zQmTJLwAUt6KtpfTFj4t1ypHubDMP2YUYFvJBPA9owPeRhg',
    })
    expect(asked[0].type).toBe(`${SUBMIT}/0.2`)
    expect(asked[0].payload.extensions).toEqual({
      requirementsDigest: 'zQmTJLwAUt6KtpfTFj4t1ypHubDMP2YUYFvJBPA9owPeRhg',
    })
    expect(asked[0].payload).not.toHaveProperty('criterion')
  })

  it('sends a submit again in the other version ONLY because dispatch refused it as unsupported: read again at 0.3, submitted once at 0.3', async () => {
    const communityDid = nextCommunity()
    const asked = asking({
      // Upgraded between the manifest read and the submit.
      [`${SUBMIT}/0.2`]: [unsupported(SUBMIT, ['0.3'])],
      [`${MANIFEST}/0.3`]: [answer(`${MANIFEST}/0.3`, payload03)],
      [`${SUBMIT}/0.3`]: [answer(`${SUBMIT}/0.3`, verdict('allow'))],
    })
    const result = await vtiAgent.apply(communityDid, manifest02(), {
      credentials: [{ id: 'vic' }],
      intent: 'invitation',
    })
    expect(result.effect).toBe('allow')
    expect(typesOf(asked)).toEqual([`${SUBMIT}/0.2`, `${MANIFEST}/0.3`, `${SUBMIT}/0.3`])
    // The second submit is made under the criteria as read at 0.3.
    expect(asked[2].payload.criterion).toBe(invited.requirementsDigest)
  })

  it('never sends a submit again after silence: the community may have taken it', async () => {
    const communityDid = nextCommunity()
    const asked = asking({})
    await expect(vtiAgent.apply(communityDid, manifest03())).rejects.toBeInstanceOf(VtiSentNoAnswer)
    expect(typesOf(asked)).toEqual([`${SUBMIT}/0.3`])
  })

  it.each([
    ['vtc/join-requests/submit:requestAlreadyOpen', 'requestAlreadyOpen'],
    ['vtc/join-requests/submit:notAccepting', 'notAccepting'],
    ['vtc/join-requests/submit:presentationInvalid', 'presentationInvalid'],
    ['vtc/join-requests/submit:policyUnsatisfied', 'policyUnsatisfied'],
  ])('never sends a submit again after %s, and says which refusal it was', async (code, reason) => {
    const communityDid = nextCommunity()
    const asked = asking({ [`${SUBMIT}/0.3`]: [refusal(code)] })
    const failure = await vtiAgent.apply(communityDid, manifest03()).catch((e) => e)
    expect(joinRequestRefusal(failure)).toBe(reason)
    expect(isUnsupportedJoinVersion(failure)).toBe(false)
    expect(typesOf(asked)).toEqual([`${SUBMIT}/0.3`])
  })

  it('gives up when the community serves no version of submit this wallet speaks', async () => {
    const communityDid = nextCommunity()
    const asked = asking({ [`${SUBMIT}/0.3`]: [unsupported(SUBMIT, ['0.4'])] })
    const failure = await vtiAgent.apply(communityDid, manifest03()).catch((e) => e)
    expect(isUnsupportedJoinVersion(failure)).toBe(true)
    expect(typesOf(asked)).toEqual([`${SUBMIT}/0.3`])
  })

  describe('when the criterion named is no longer published (criterionUnknown)', () => {
    const invitedNow = published({ id: 'invited', admission: 'review', invitationRequired: true })
    const changed = { ...payload03, criteria: [invitedNow, review] }
    const unknown = () =>
      refusal('vtc/join-requests/submit:criterionUnknown', { criterion: invited.requirementsDigest })

    it('reads the criteria again and submits once more, for a criterion this wallet chose', async () => {
      const communityDid = nextCommunity()
      const asked = asking({
        [`${SUBMIT}/0.3`]: [unknown(), answer(`${SUBMIT}/0.3`, verdict('refer'))],
        [`${MANIFEST}/0.3`]: [answer(`${MANIFEST}/0.3`, changed)],
      })
      const result = await vtiAgent.apply(communityDid, manifest03(), {
        credentials: [{ id: 'vic' }],
        intent: 'invitation',
      })
      expect(result.effect).toBe('refer')
      expect(typesOf(asked)).toEqual([`${SUBMIT}/0.3`, `${MANIFEST}/0.3`, `${SUBMIT}/0.3`])
      expect(asked[2].payload.criterion).toBe(invitedNow.requirementsDigest)
    })

    it('does so once: a second criterionUnknown is the answer', async () => {
      const communityDid = nextCommunity()
      const asked = asking({
        [`${SUBMIT}/0.3`]: [unknown(), unknown()],
        [`${MANIFEST}/0.3`]: [answer(`${MANIFEST}/0.3`, changed)],
      })
      const failure = await vtiAgent
        .apply(communityDid, manifest03(), { credentials: [{ id: 'vic' }], intent: 'invitation' })
        .catch((e) => e)
      expect(joinRequestRefusal(failure)).toBe('criterionUnknown')
      expect(typesOf(asked)).toEqual([`${SUBMIT}/0.3`, `${MANIFEST}/0.3`, `${SUBMIT}/0.3`])
    })

    it('does not move an application gathered for a digest to another criterion: the refusal is the caller’s', async () => {
      const communityDid = nextCommunity()
      const asked = asking({ [`${SUBMIT}/0.3`]: [unknown()] })
      const failure = await vtiAgent
        .apply(communityDid, manifest03(), { credentials: [], requirementsDigest: invited.requirementsDigest })
        .catch((e) => e)
      expect(joinRequestRefusal(failure)).toBe('criterionUnknown')
      expect(typesOf(asked)).toEqual([`${SUBMIT}/0.3`])
    })
  })
})
