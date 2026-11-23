import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import type { JoinSubmission, VtiCommunityStore, VtiMembership } from '../module/VtiCommunityStore'
import type { VtiIdentityStore, VtiPersona } from '../module/VtiIdentityStore'
import { vtiAgent, type JoinRequestStatus } from '../module/vtiAgent'
import { askForCardIfOwed, readJoinState, type StatusPoll } from '../module/vtiJoin'
import { cardAskKey } from '../screens/cardAskKey'

// IN-617: approved, and the card never came. Approved with no card reads as
// pending, the card comes only by delivery, and Check again only asked the
// status, so the person saw "approved" every time. The community re-sends what
// it issued when asked (`resendCredentials`, vtc-service 0.12.0), and only
// Check again asks, only after the community's own answer says the card was
// not acknowledged.

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:QmCommunityScid12345:vtc.example:c'
const PERSONA = 'did:webvh:QmPersonaScid12345:vta.example:p'
const STATUS = 'https://trusttasks.org/spec/vtc/join-requests/status/0.1'

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never
const warned = () => logger.warn.mock.calls.map((call) => String(call[0]))

const approved = (extra: Partial<JoinSubmission> = {}): JoinSubmission => ({
  communityDid: COMMUNITY,
  personaDid: PERSONA,
  sentAt: '2026-11-10T05:39:46Z',
  acknowledgedAt: '2026-11-10T05:39:50Z',
  requestId: 'r-1',
  status: 'approved',
  withInvitation: false,
  via: 'join',
  ...extra,
})

const card: VtiMembership = {
  communityDid: COMMUNITY,
  personaDid: PERSONA,
  role: 'member',
  vmc: { id: 'urn:vmc' },
  grantedAt: '2026-11-10T05:41:00Z',
  via: 'approval',
}

function stores(init: { submission?: JoinSubmission; membership?: VtiMembership } = {}) {
  let submission = init.submission
  // Only what these reads call: the rest of each store is never reached.
  const communityStore: Partial<VtiCommunityStore> = {
    getMembership: async () => init.membership,
    getSubmission: async () => submission,
    saveSubmission: async (s: JoinSubmission) => void (submission = s),
  }
  const persona = { did: PERSONA, communityDid: COMMUNITY } as VtiPersona
  const identityStore: Partial<VtiIdentityStore> = { getPersona: async () => persona }
  return {
    communityStore: communityStore as VtiCommunityStore,
    identityStore: identityStore as VtiIdentityStore,
    current: () => submission,
  }
}

/** A status poll answering each ask from `answers` in turn, with what each was asked recorded. */
function polls(...answers: (JoinRequestStatus | undefined)[]) {
  const asked: { requestId?: string; resendCredentials?: boolean }[] = []
  const status: StatusPoll = jest.fn(async (_did, requestId, ask) => {
    asked.push({ requestId, ...(ask?.resendCredentials ? { resendCredentials: true } : {}) })
    return answers.shift()
  })
  return { status, asked }
}

beforeEach(() => logger.warn.mockClear())

describe('the status poll, as sent and as read', () => {
  const answering = (payload: Record<string, unknown>) => {
    const answer: DidCommV2PlaintextMessage = {
      id: 'urn:uuid:status-answer',
      type: `${STATUS}#response`,
      body: { payload },
    }
    return jest.spyOn(vtiAgent, 'ask').mockResolvedValue(answer)
  }
  afterEach(() => jest.restoreAllMocks())

  it('carries resendCredentials only when asked', async () => {
    const ask = answering({ requestId: 'r-1', status: 'approved' })
    await vtiAgent.status(COMMUNITY, { requestId: 'r-1' })
    await vtiAgent.status(COMMUNITY, { requestId: 'r-1', resendCredentials: true })
    expect(ask.mock.calls.map((call) => call[2])).toEqual([
      { requestId: 'r-1' },
      { requestId: 'r-1', resendCredentials: true },
    ])
  })

  it("reads an approved request's delivery and the answer to the re-send", async () => {
    answering({
      requestId: 'r-1',
      status: 'approved',
      credentialsDelivered: false,
      credentialResend: 'rateLimited',
      retryAfter: '2026-11-10T06:00:00Z',
    })
    expect(await vtiAgent.status(COMMUNITY)).toEqual({
      requestId: 'r-1',
      status: 'approved',
      credentialsDelivered: false,
      credentialResend: 'rateLimited',
      retryAfter: '2026-11-10T06:00:00Z',
    })
  })

  it('reads none of them on a request that is not approved, nor an answer it does not know', async () => {
    answering({ requestId: 'r-1', status: 'pending', credentialsDelivered: false, credentialResend: 'queued' })
    expect(await vtiAgent.status(COMMUNITY)).toEqual({ requestId: 'r-1', status: 'pending' })
    jest.restoreAllMocks()
    answering({ requestId: 'r-1', status: 'approved', credentialsDelivered: 'no', credentialResend: 'sometime' })
    expect(await vtiAgent.status(COMMUNITY)).toEqual({ requestId: 'r-1', status: 'approved' })
  })
})

describe('Check again on an approved request whose card never came', () => {
  it('asks for the card again once the community says it was not acknowledged, and says so', async () => {
    const s = stores({ submission: approved() })
    const { status, asked } = polls(
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false },
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false, credentialResend: 'queued' }
    )
    expect(await askForCardIfOwed(agent, COMMUNITY, { ...s, status })).toEqual({ polled: true, resend: 'queued' })
    expect(asked).toEqual([{ requestId: 'r-1' }, { requestId: 'r-1', resendCredentials: true }])
    expect(warned()).toEqual([
      '[VTI] join request at did:webvh:QmCommunitySci…: approved, credentialsDelivered false; asked for the card again: credentialResend queued',
    ])
    expect(warned().join('\n')).not.toContain(COMMUNITY)
  })

  it('never asks a community whose answer does not say, which would refuse the field', async () => {
    const s = stores({ submission: approved() })
    const { status, asked } = polls({ requestId: 'r-1', status: 'approved' })
    expect(await askForCardIfOwed(agent, COMMUNITY, { ...s, status })).toEqual({ polled: true })
    expect(asked).toEqual([{ requestId: 'r-1' }])
    expect(warned()).toEqual([
      '[VTI] join request at did:webvh:QmCommunitySci…: approved, credentialsDelivered absent; the card was not asked for again',
    ])
  })

  it('does not ask when the community holds the acknowledgement', async () => {
    const s = stores({ submission: approved() })
    const { status, asked } = polls({ requestId: 'r-1', status: 'approved', credentialsDelivered: true })
    expect(await askForCardIfOwed(agent, COMMUNITY, { ...s, status })).toEqual({ polled: true })
    expect(asked).toEqual([{ requestId: 'r-1' }])
  })

  it('does not ask the community at all when this phone has no approved request waiting', async () => {
    for (const submission of [approved({ status: 'pending' }), approved({ status: 'deferred' }), undefined]) {
      const { status, asked } = polls({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
      expect(await askForCardIfOwed(agent, COMMUNITY, { ...stores({ submission }), status })).toEqual({
        polled: false,
      })
      expect(asked).toEqual([])
    }
  })

  it('does not ask when the card is held here', async () => {
    const s = stores({ submission: approved(), membership: card })
    const { status, asked } = polls({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
    expect(await askForCardIfOwed(agent, COMMUNITY, { ...s, status })).toEqual({ polled: false })
    expect(asked).toEqual([])
  })

  it('takes a re-send answered with nothing as not supported', async () => {
    const s = stores({ submission: approved() })
    const { status } = polls(
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false },
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false }
    )
    expect(await askForCardIfOwed(agent, COMMUNITY, { ...s, status })).toEqual({ polled: true, resend: 'unsupported' })
    expect(warned()[0]).toContain('asked for the card again: credentialResend absent')
  })

  it('says a request gone between the two polls as gone, not as a re-send not supported', async () => {
    const s = stores({ submission: approved() })
    const { status, asked } = polls({ requestId: 'r-1', status: 'approved', credentialsDelivered: false }, undefined)
    expect(await askForCardIfOwed(agent, COMMUNITY, { ...s, status })).toEqual({ polled: false, resend: 'notFound' })
    expect(asked).toEqual([{ requestId: 'r-1' }, { requestId: 'r-1', resendCredentials: true }])
    expect(warned()).toEqual([
      '[VTI] join request at did:webvh:QmCommunitySci…: approved, credentialsDelivered false; asked for the card again: the community holds no such request now',
    ])
  })

  it('keeps when it may ask again, and records what the community said', async () => {
    const s = stores({ submission: approved() })
    const { status } = polls(
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false },
      {
        requestId: 'r-1',
        status: 'approved',
        credentialsDelivered: false,
        credentialResend: 'rateLimited',
        retryAfter: '2026-11-10T06:00:00Z',
      }
    )
    expect(await askForCardIfOwed(agent, COMMUNITY, { ...s, status })).toEqual({
      polled: true,
      resend: 'rateLimited',
      retryAfter: '2026-11-10T06:00:00Z',
    })
    expect(warned()[0]).toContain('credentialResend rateLimited, retryAfter 2026-11-10T06:00:00Z')
    expect(s.current()).toMatchObject({ status: 'approved', requestId: 'r-1' })
  })
})

describe('every other read of the request', () => {
  it('never asks for the card again: only Check again does', async () => {
    // An open request is polled; the answer says approved and not acknowledged, and still nothing asks for the card.
    const s = stores({ submission: approved({ status: 'pending' }) })
    const { status, asked } = polls({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
    expect(await readJoinState(agent, COMMUNITY, { ...s, status })).toMatchObject({ kind: 'pending' })
    expect(asked).toEqual([{ requestId: 'r-1' }])
  })

  // readJoinState polls only an open request: one not yet acknowledged, or pending, or deferred. An approved
  // request whose answer came is none of those, so before askForCardIfOwed nothing asked about it at all.
  it('does not poll an acknowledged request that is neither pending nor deferred', async () => {
    const s = stores({ submission: approved() })
    const { status, asked } = polls({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
    expect(await readJoinState(agent, COMMUNITY, { ...s, status })).toMatchObject({ kind: 'pending' })
    expect(asked).toEqual([])
  })

  it('polls an approved request not yet acknowledged, and still never asks for the card', async () => {
    const s = stores({ submission: approved({ acknowledgedAt: undefined }) })
    const { status, asked } = polls({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
    await readJoinState(agent, COMMUNITY, { ...s, status })
    expect(asked).toEqual([{ requestId: 'r-1' }])
  })
})

describe('the line under an approved request', () => {
  it.each([
    [{ polled: true, resend: 'queued' as const }, 'Join.CardAskedAgain'],
    [{ polled: true, resend: 'rateLimited' as const, retryAfter: '2026-11-10T06:00:00Z' }, 'Join.CardAskedRecently'],
    // Not final: status/0.1 has a community only SHOULD send retryAfter, and no way to say "no more".
    [{ polled: true, resend: 'rateLimited' as const }, 'Join.CardAskedRecently'],
    [{ polled: false, resend: 'notFound' as const }, undefined],
    [{ polled: true, resend: 'notNeeded' as const }, undefined],
    [{ polled: true, resend: 'unsupported' as const }, undefined],
    [{ polled: true }, undefined],
    [undefined, undefined],
  ])('%j says %s', (ask, key) => expect(cardAskKey(ask)).toBe(key))
})
