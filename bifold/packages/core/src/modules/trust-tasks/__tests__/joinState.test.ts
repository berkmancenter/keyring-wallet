import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { parseJoinNeed, recordAnswer, recordSent, recordStatus, statusOfEffect } from '../module/joinSubmission'
import type { JoinSubmission, VtiCommunityStore, VtiMembership } from '../module/VtiCommunityStore'
import { vtiAgent, VtiRefusal } from '../module/vtiAgent'
import { joinCommunity, readJoinState } from '../module/vtiJoin'
import { vtaAgent } from '../module/vtaAgent'

// p220 items 1, 2 and 7: where a join stands, read from what the phone sent
// and what the community said — "Sent — waiting for the community" until it
// answers, then pending / deferred (and for what) / rejected (and why) /
// withdrawn; a held card is a member, or removed once revoked.

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:Qm:vtc.example:c'
const PERSONA = 'did:webvh:Qm:vta.example:p'
const NOW = new Date('2026-09-24T05:00:00Z')

function memoryStore(init: { submission?: JoinSubmission; membership?: VtiMembership } = {}) {
  let submission = init.submission
  const membership = init.membership
  const store = {
    getMembership: jest.fn(async () => membership),
    getSubmission: jest.fn(async () => submission),
    saveSubmission: jest.fn(async (s: JoinSubmission) => void (submission = s)),
  }
  return { store: store as unknown as VtiCommunityStore, current: () => submission }
}

const sent = (extra: Partial<JoinSubmission> = {}): JoinSubmission => ({
  communityDid: COMMUNITY,
  personaDid: PERSONA,
  sentAt: '2026-09-24T04:59:00Z',
  withInvitation: false,
  via: 'join',
  ...extra,
})

const card: VtiMembership = {
  communityDid: COMMUNITY,
  personaDid: PERSONA,
  role: 'member',
  vmc: { id: 'urn:vmc' },
  grantedAt: 't0',
  via: 'vetting',
}

describe('what a community still needs', () => {
  it.each([
    ['vetting:statements:2', { kind: 'statements', count: 2 }],
    ['vetting:invitation', { kind: 'invitation' }],
    ['vetting', { kind: 'vetting' }],
    ['agreed:code-of-conduct', { kind: 'agreement', id: 'code-of-conduct' }],
    ['personhood:proof', { kind: 'other', raw: 'personhood:proof' }],
  ])('reads %s', (raw, need) => expect(parseJoinNeed(raw)).toEqual(need))

  it('maps verdict effects onto the status task states', () => {
    expect(statusOfEffect('allow')).toBe('approved')
    expect(statusOfEffect('requestMore')).toBe('deferred')
    expect(statusOfEffect('refer')).toBe('pending')
    expect(statusOfEffect('deny')).toBe('rejected')
    expect(statusOfEffect('mystery')).toBeUndefined()
  })
})

describe('recording a submission', () => {
  it('is sent before the send, and acknowledged by the answer', async () => {
    const { store, current } = memoryStore()
    await recordSent(store, { communityDid: COMMUNITY, personaDid: PERSONA, withInvitation: true, via: 'join' }, NOW)
    expect(current()).toMatchObject({ sentAt: NOW.toISOString(), withInvitation: true })
    expect(current()?.acknowledgedAt).toBeUndefined()

    await recordAnswer(
      store,
      COMMUNITY,
      { verdict: { requestId: 'r1', effect: 'requestMore', needs: ['vetting:statements:1'] } },
      NOW
    )
    expect(current()).toMatchObject({
      requestId: 'r1',
      status: 'deferred',
      needs: ['vetting:statements:1'],
      acknowledgedAt: NOW.toISOString(),
    })
  })

  it('counts a refusal as an answer, and no answer as none', async () => {
    const { store, current } = memoryStore({ submission: sent() })
    await recordAnswer(store, COMMUNITY, { refusal: new Error('vtiAgent: the community did not answer (submit)') })
    expect(current()?.acknowledgedAt).toBeUndefined()
    await recordAnswer(store, COMMUNITY, { refusal: new VtiRefusal('x:requestAlreadyOpen', 'open') }, NOW)
    expect(current()?.acknowledgedAt).toBe(NOW.toISOString())
  })

  it('keeps the refusal members only with a rejection', async () => {
    const { store, current } = memoryStore({ submission: sent({ acknowledgedAt: 't', status: 'pending' }) })
    await recordStatus(store, COMMUNITY, {
      status: 'rejected',
      code: 'policy:denied',
      reason: 'Not now',
      decidedAt: 'd',
    })
    expect(current()).toMatchObject({ status: 'rejected', rejection: { code: 'policy:denied', reason: 'Not now' } })
    await recordStatus(store, COMMUNITY, { status: 'pending' })
    expect(current()?.rejection).toBeUndefined()
  })
})

describe('the status task', () => {
  const answer = (payload: unknown, type = 'https://trusttasks.org/spec/vtc/join-requests/status/0.1#response') =>
    ({ type, body: { payload } }) as unknown as DidCommV2PlaintextMessage
  afterEach(() => jest.restoreAllMocks())

  it('asks without an id when none is held, and reads a deferral', async () => {
    const ask = jest
      .spyOn(vtiAgent, 'ask')
      .mockResolvedValue(answer({ requestId: 'r1', status: 'deferred', needs: ['vetting:invitation'] }))
    await expect(vtiAgent.status(COMMUNITY)).resolves.toEqual({
      requestId: 'r1',
      status: 'deferred',
      needs: ['vetting:invitation'],
    })
    expect(ask.mock.calls[0][2]).toEqual({})
  })

  it('never reads refusal members off a status other than rejected', async () => {
    jest.spyOn(vtiAgent, 'ask').mockResolvedValue(answer({ status: 'pending', code: 'x', reason: 'y' }))
    const status = await vtiAgent.status(COMMUNITY, { requestId: 'r1' })
    expect(status).toEqual({ requestId: undefined, status: 'pending' })
  })

  it('is undefined when the community holds no such request', async () => {
    jest
      .spyOn(vtiAgent, 'ask')
      .mockResolvedValue(
        answer(
          { code: 'vtc/join-requests/status:notFound', message: 'no' },
          'https://trusttasks.org/spec/trust-task-error/0.1'
        )
      )
    await expect(vtiAgent.status(COMMUNITY)).resolves.toBeUndefined()
  })
})

describe('where a join stands', () => {
  const agent = {} as never
  const never = jest.fn(async () => {
    throw new Error('should not poll')
  })

  it('none, when nothing was sent and nothing is held', async () => {
    const { store } = memoryStore()
    await expect(readJoinState(agent, COMMUNITY, { communityStore: store, status: never })).resolves.toEqual({
      kind: 'none',
    })
  })

  it('member, or removed once the card is revoked', async () => {
    const { store } = memoryStore({ membership: card })
    const ok = async () => ({ revoked: false })
    const revoked = async () => ({ revoked: true, at: 'r' })
    await expect(readJoinState(agent, COMMUNITY, { communityStore: store, cardStatus: ok })).resolves.toMatchObject({
      kind: 'member',
    })
    await expect(
      readJoinState(agent, COMMUNITY, { communityStore: store, cardStatus: revoked })
    ).resolves.toMatchObject({ kind: 'removed', at: 'r' })
  })

  it('sent, while the community has not answered and nobody polls', async () => {
    const { store } = memoryStore({ submission: sent({ withInvitation: true }) })
    const state = await readJoinState(agent, COMMUNITY, { communityStore: store, poll: false })
    expect(state).toMatchObject({ kind: 'sent', submission: { withInvitation: true } })
  })

  it('polls an unanswered request without an id, and says what is needed', async () => {
    const { store } = memoryStore({ submission: sent() })
    const status = jest.fn(async () => ({
      requestId: 'r9',
      status: 'deferred' as const,
      needs: ['vetting:statements:1', 'vetting:invitation'],
    }))
    const state = await readJoinState(agent, COMMUNITY, { communityStore: store, status })
    expect(status).toHaveBeenCalledWith(COMMUNITY, undefined)
    expect(state).toMatchObject({
      kind: 'deferred',
      submission: { requestId: 'r9' },
      needs: [{ kind: 'statements', count: 1 }, { kind: 'invitation' }],
    })
  })

  it('none, when the community holds no such request', async () => {
    const { store } = memoryStore({ submission: sent() })
    await expect(
      readJoinState(agent, COMMUNITY, { communityStore: store, status: async () => undefined })
    ).resolves.toEqual({ kind: 'none' })
  })

  it('rejected, with the code and the community’s own words', async () => {
    const { store } = memoryStore({ submission: sent({ acknowledgedAt: 't', status: 'pending', requestId: 'r1' }) })
    const status = jest.fn(async () => ({
      status: 'rejected' as const,
      code: 'policy:denied',
      reason: 'Membership is closed this month',
      decidedAt: '2026-09-24T04:00:00Z',
    }))
    const state = await readJoinState(agent, COMMUNITY, { communityStore: store, status })
    expect(status).toHaveBeenCalledWith(COMMUNITY, 'r1')
    expect(state).toMatchObject({
      kind: 'rejected',
      code: 'policy:denied',
      reason: 'Membership is closed this month',
      decidedAt: '2026-09-24T04:00:00Z',
    })
  })

  it('keeps what it last knew when the poll fails, and does not poll a settled request', async () => {
    const { store } = memoryStore({ submission: sent({ acknowledgedAt: 't', status: 'pending' }) })
    const failing = jest.fn(async () => {
      throw new Error('offline')
    })
    await expect(readJoinState(agent, COMMUNITY, { communityStore: store, status: failing })).resolves.toMatchObject({
      kind: 'pending',
    })
    const settled = memoryStore({ submission: sent({ acknowledgedAt: 't', status: 'withdrawn' }) })
    await expect(
      readJoinState(agent, COMMUNITY, { communityStore: settled.store, status: never })
    ).resolves.toMatchObject({ kind: 'withdrawn' })
    expect(never).not.toHaveBeenCalled()
  })
})

describe('a join records what it sent, and what came back', () => {
  const persona = {
    did: PERSONA,
    communityDid: COMMUNITY,
    vtaDid: 'did:webvh:Qm:vta',
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 's', keyAgreement: 'k' },
    createdAt: 't',
  }
  function deps(store: VtiCommunityStore) {
    jest.spyOn(vtaAgent, 'client').mockReturnValue({ ensurePersona: async () => persona } as never)
    jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined)
    jest.spyOn(vtiAgent, 'onInbound').mockReturnValue(() => undefined)
    jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ criteria: [] } as never)
    return {
      agent: {} as never,
      identityStore: { forgetPersona: jest.fn(async () => undefined) } as never,
      communityStore: store,
      vtaDid: 'did:webvh:Qm:vta',
      communityDid: COMMUNITY,
    }
  }
  afterEach(() => jest.restoreAllMocks())

  it('is on record as sent before the community is asked, then answered', async () => {
    const { store, current } = memoryStore()
    let seenAtSend: JoinSubmission | undefined
    jest.spyOn(vtiAgent, 'apply').mockImplementation(async () => {
      seenAtSend = current()
      return { requestId: 'r1', effect: 'refer', needs: [] }
    })
    await joinCommunity(deps(store))
    expect(seenAtSend).toMatchObject({ personaDid: PERSONA, withInvitation: false, via: 'join' })
    expect(seenAtSend?.acknowledgedAt).toBeUndefined()
    expect(current()).toMatchObject({ requestId: 'r1', status: 'pending' })
    expect(current()?.acknowledgedAt).toBeDefined()
  })

  it('stays sent when the community does not answer', async () => {
    const { store, current } = memoryStore()
    jest.spyOn(vtiAgent, 'apply').mockRejectedValue(new Error('vtiAgent: the community did not answer (submit)'))
    await expect(joinCommunity(deps(store))).rejects.toThrow(/did not answer/)
    expect(current()).toMatchObject({ communityDid: COMMUNITY })
    expect(current()?.acknowledgedAt).toBeUndefined()
  })

  it('"Join again" forgets the persona first, so a new one is minted', async () => {
    const { store } = memoryStore()
    jest.spyOn(vtiAgent, 'apply').mockResolvedValue({ effect: 'refer', needs: [] })
    const d = deps(store)
    await joinCommunity(d, undefined, { freshPersona: true })
    expect((d.identityStore as unknown as { forgetPersona: jest.Mock }).forgetPersona).toHaveBeenCalledWith(COMMUNITY)
  })
})
