import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import type { JoinSubmission, VtiCommunityStore, VtiDeparture } from '../module/VtiCommunityStore'
import { selfRemoveRefusal, vtiAgent, VtiRefusal } from '../module/vtiAgent'
import { leaveCommunity, readJoinState } from '../module/vtiJoin'

// p220 item 5: a member leaves a community (members/self-remove/0.1), choosing
// purge or tombstone, and the phone clears what it held for it so a rejoin
// starts from a fresh identity. The join state then reads "left".

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:Qm:vtc.example:c'
const persona = { did: 'did:webvh:Qm:vta.example:p', communityDid: COMMUNITY }
const answer = (payload: unknown, type = 'https://trusttasks.org/spec/vtc/members/self-remove/0.1#response') =>
  ({ type, body: { payload } }) as unknown as DidCommV2PlaintextMessage
const refusal = (code: string) => answer({ code, message: 'no' }, 'https://trusttasks.org/spec/trust-task-error/0.1')

function stores() {
  let departure: VtiDeparture | undefined
  const communityStore = {
    forgetCommunity: jest.fn(async () => undefined),
    getMembership: jest.fn(async () => undefined),
    getSubmission: jest.fn(async () => undefined),
    getDeparture: jest.fn(async () => departure),
    saveDeparture: jest.fn(async (d: VtiDeparture) => void (departure = d)),
  }
  const identityStore = {
    getPersona: jest.fn(async () => persona),
    forgetPersona: jest.fn(async () => undefined),
  }
  const vettingStore = { forget: jest.fn(async () => undefined) }
  return {
    deps: {
      agent: {} as never,
      communityStore: communityStore as unknown as VtiCommunityStore,
      identityStore: identityStore as never,
      vettingStore,
    },
    communityStore,
    identityStore,
    vettingStore,
    departure: () => departure,
  }
}

beforeEach(() => {
  jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('the self-remove task', () => {
  it('sends the chosen disposition and reads what the community applied', async () => {
    const ask = jest
      .spyOn(vtiAgent, 'ask')
      .mockResolvedValue(answer({ did: persona.did, disposition: 'purge', removed: true }))
    await expect(vtiAgent.selfRemove(COMMUNITY, { disposition: 'purge' })).resolves.toEqual({
      did: persona.did,
      disposition: 'purge',
      removed: true,
    })
    expect(ask.mock.calls[0][1]).toBe('https://trusttasks.org/spec/vtc/members/self-remove/0.1')
    expect(ask.mock.calls[0][2]).toEqual({ disposition: 'purge' })
  })

  it('leaves the choice to the community when none is given', async () => {
    const ask = jest.spyOn(vtiAgent, 'ask').mockResolvedValue(answer({ disposition: 'tombstone', removed: true }))
    await expect(vtiAgent.selfRemove(COMMUNITY)).resolves.toMatchObject({ disposition: 'tombstone' })
    expect(ask.mock.calls[0][2]).toEqual({})
  })

  it('reads refusals by their code', () => {
    expect(selfRemoveRefusal(new VtiRefusal('vtc/members/self-remove:notMember', 'x'))).toBe('notMember')
    expect(selfRemoveRefusal(new VtiRefusal('vtc/members/self-remove:LastAdminProtected', 'x'))).toBe('lastAdmin')
    expect(selfRemoveRefusal(new VtiRefusal('vtc/members/self-remove:other', 'x'))).toBeUndefined()
    expect(selfRemoveRefusal(new Error('x'))).toBeUndefined()
  })
})

describe('leaving a community', () => {
  it('leaves, clears what the phone held, and records how', async () => {
    jest.spyOn(vtiAgent, 'ask').mockResolvedValue(answer({ disposition: 'tombstone', removed: true }))
    const s = stores()
    await expect(leaveCommunity(s.deps, COMMUNITY, { disposition: 'tombstone' })).resolves.toEqual({
      disposition: 'tombstone',
      alreadyGone: false,
    })
    expect(vtiAgent.connect).toHaveBeenCalledWith(s.deps.agent, undefined, expect.objectContaining({ persona }))
    expect(s.communityStore.forgetCommunity).toHaveBeenCalledWith(COMMUNITY)
    expect(s.vettingStore.forget).toHaveBeenCalledWith(COMMUNITY)
    expect(s.identityStore.forgetPersona).toHaveBeenCalledWith(COMMUNITY)
    expect(s.departure()).toMatchObject({ communityDid: COMMUNITY, disposition: 'tombstone' })
  })

  it('treats "not a member" as already gone, and clears the same way', async () => {
    jest.spyOn(vtiAgent, 'ask').mockResolvedValue(refusal('vtc/members/self-remove:notMember'))
    const s = stores()
    await expect(leaveCommunity(s.deps, COMMUNITY, { disposition: 'purge' })).resolves.toEqual({
      disposition: 'purge',
      alreadyGone: true,
    })
    expect(s.communityStore.forgetCommunity).toHaveBeenCalled()
    expect(s.identityStore.forgetPersona).toHaveBeenCalled()
  })

  it('clears nothing when the community refuses for another reason', async () => {
    jest.spyOn(vtiAgent, 'ask').mockResolvedValue(refusal('vtc/members/self-remove:LastAdminProtected'))
    const s = stores()
    await expect(leaveCommunity(s.deps, COMMUNITY)).rejects.toBeInstanceOf(VtiRefusal)
    expect(s.communityStore.forgetCommunity).not.toHaveBeenCalled()
    expect(s.identityStore.forgetPersona).not.toHaveBeenCalled()
    expect(s.departure()).toBeUndefined()
  })

  it('needs an identity for the community', async () => {
    const s = stores()
    s.identityStore.getPersona.mockResolvedValue(undefined as never)
    await expect(leaveCommunity(s.deps, COMMUNITY)).rejects.toThrow(/no identity/)
    expect(vtiAgent.connect).not.toHaveBeenCalled()
  })
})

describe('the join state after leaving', () => {
  const sub = (sentAt: string): JoinSubmission => ({
    communityDid: COMMUNITY,
    personaDid: persona.did,
    sentAt,
    acknowledgedAt: sentAt,
    status: 'pending',
    withInvitation: false,
    via: 'join',
  })
  const store = (submission: JoinSubmission | undefined, departure: VtiDeparture) =>
    ({
      getMembership: async () => undefined,
      getSubmission: async () => submission,
      getDeparture: async () => departure,
    }) as unknown as VtiCommunityStore
  const left: VtiDeparture = { communityDid: COMMUNITY, disposition: 'purge', at: '2026-09-24T05:00:00Z' }

  it('is "left" until something is sent again', async () => {
    await expect(
      readJoinState({} as never, COMMUNITY, { communityStore: store(sub('2026-09-24T04:00:00Z'), left), poll: false })
    ).resolves.toEqual({ kind: 'left', disposition: 'purge', at: left.at })
    await expect(
      readJoinState({} as never, COMMUNITY, { communityStore: store(undefined, left), poll: false })
    ).resolves.toMatchObject({ kind: 'left' })
  })

  it('follows a new request sent after leaving', async () => {
    await expect(
      readJoinState({} as never, COMMUNITY, { communityStore: store(sub('2026-09-24T06:00:00Z'), left), poll: false })
    ).resolves.toMatchObject({ kind: 'pending' })
  })
})
