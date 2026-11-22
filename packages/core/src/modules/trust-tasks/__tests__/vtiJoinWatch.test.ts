import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_CHANGED_EVENT } from '../module/communityChanged'
import type { JoinSubmission, VtiCommunityStore, VtiMembership } from '../module/VtiCommunityStore'
import type { VtiIdentityStore, VtiPersona } from '../module/VtiIdentityStore'
import { vtiAgent, VtiNoOwnSession, type JoinRequestStatus } from '../module/vtiAgent'
import { JOIN_WATCH } from '../module/joinWatchSwitch'
import { readJoinState } from '../module/vtiJoin'
import { JOIN_WATCH_EVERY_MS, startJoinWatch, watchesJoin, type StatusAs } from '../module/vtiJoinWatch'

// An attendee joins the SEDI VTC (a did:webs) and leaves the join page: nothing asked where the request stood until
// they came back, and SEDI did not send the card on approval (K2QJ-Z9G9, 3K8Y-BHKN, 11-17). A did:webs community's
// open request is asked about every 5 s, and its card asked for once; a did:webvh community's never is, from here.

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const WEBS = 'did:webs:webvh.example:sedi-vtc:EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a'
const WEBVH = 'did:webvh:QmCommunityScid12345:vtc.example:first-vtc'
const PERSONA = 'did:webvh:QmPersonaScid12345:vta.example:p'

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never

const request = (communityDid: string, extra: Partial<JoinSubmission> = {}): JoinSubmission => ({
  communityDid,
  personaDid: PERSONA,
  sentAt: '2026-11-17T16:56:15Z',
  acknowledgedAt: '2026-11-17T16:56:17Z',
  requestId: 'r-1',
  status: 'pending',
  withInvitation: false,
  via: 'join',
  ...extra,
})

function world(submissions: JoinSubmission[], memberships: VtiMembership[] = []) {
  const held = new Map(submissions.map((s) => [s.communityDid, s]))
  const communityStore: Partial<VtiCommunityStore> = {
    getMembership: async (did: string) => memberships.find((m) => m.communityDid === did),
    getSubmission: async (did: string) => held.get(did),
    saveSubmission: async (s: JoinSubmission) => void held.set(s.communityDid, s),
  }
  const personas = [...new Set([...held.keys(), ...memberships.map((m) => m.communityDid)])].map(
    (communityDid) => ({ did: PERSONA, communityDid }) as VtiPersona
  )
  const identityStore: Partial<VtiIdentityStore> = {
    getPersona: async (did: string) => personas.find((p) => p.communityDid === did),
    listPersonas: async () => personas,
  }
  return {
    communityStore: communityStore as VtiCommunityStore,
    identityStore: identityStore as VtiIdentityStore,
    held,
    memberships,
  }
}

/** A status ask answering from `answers` in turn (the last one again after that), with each ask recorded. */
function asks(...answers: (JoinRequestStatus | undefined | Error)[]) {
  const asked: { communityDid: string; requestId?: string; resendCredentials?: boolean }[] = []
  const statusAs: StatusAs = jest.fn(async (_persona, communityDid, options) => {
    asked.push({ communityDid, ...options })
    const answer = answers.length > 1 ? answers.shift() : answers[0]
    if (answer instanceof Error) throw answer
    return answer
  })
  return { statusAs, asked }
}

const looks = async (n: number) => {
  for (let i = 0; i < n; i++) await jest.advanceTimersByTimeAsync(JOIN_WATCH_EVERY_MS)
}

let stop: (() => void) | undefined
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  stop?.()
  stop = undefined
  jest.useRealTimers()
  jest.clearAllMocks()
  JOIN_WATCH.on = true
  JOIN_WATCH.remoteOff = false
})

describe('which communities are watched', () => {
  it('a did:webs community, and no other', () => {
    expect(watchesJoin(WEBS)).toBe(true)
    expect(watchesJoin(WEBVH)).toBe(false)
    expect(watchesJoin('did:web:vtc.example')).toBe(false)
    expect(watchesJoin(undefined)).toBe(false)
  })
})

describe('an open request, with the person elsewhere in the app', () => {
  it('at a did:webs community is asked about every 5 s, and what the community says is stored', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks(
      { requestId: 'r-1', status: 'pending' },
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false }
    )
    stop = startJoinWatch(agent, { ...w, statusAs })
    await jest.advanceTimersByTimeAsync(JOIN_WATCH_EVERY_MS - 1)
    expect(asked).toEqual([])
    await jest.advanceTimersByTimeAsync(1)
    expect(asked).toEqual([{ communityDid: WEBS, requestId: 'r-1' }])
    expect(w.held.get(WEBS)?.status).toBe('pending')
    await looks(1)
    expect(asked).toHaveLength(2)
    expect(w.held.get(WEBS)?.status).toBe('approved')
  })

  it('CONTROL: at a did:webvh community is never asked about from here', async () => {
    const w = world([request(WEBVH)])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(6)
    expect(asked).toEqual([])
    expect(w.held.get(WEBVH)?.status).toBe('pending')
  })

  it('with both held, only the did:webs one is asked about', async () => {
    const w = world([request(WEBVH), request(WEBS)])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'pending' })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(3)
    expect(asked.map((a) => a.communityDid)).toEqual([WEBS, WEBS, WEBS])
  })

  it('is not asked about once the card is held', async () => {
    const w = world(
      [request(WEBS, { status: 'approved' })],
      [
        {
          communityDid: WEBS,
          personaDid: PERSONA,
          role: 'member',
          vmc: { id: 'urn:vmc' },
          grantedAt: 't',
          via: 'approval',
        },
      ]
    )
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'approved', credentialsDelivered: true })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(4)
    expect(asked).toEqual([])
  })

  it('a request sent after the watch began is picked up when the phone stores it', async () => {
    const w = world([])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'pending' })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(2)
    expect(asked).toEqual([])
    w.held.set(WEBS, request(WEBS))
    ;(w.identityStore.listPersonas as unknown) = async () => [{ did: PERSONA, communityDid: WEBS } as VtiPersona]
    ;(w.identityStore.getPersona as unknown) = async () => ({ did: PERSONA, communityDid: WEBS }) as VtiPersona
    DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid: WEBS, what: 'submission' })
    await looks(1)
    expect(asked).toEqual([{ communityDid: WEBS, requestId: 'r-1' }])
  })
})

describe('the community says it holds no such request', () => {
  it('is believed: the request is recorded as lost, and nothing more is asked for it', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks(undefined)
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(1)
    expect(asked).toEqual([{ communityDid: WEBS, requestId: 'r-1' }])
    expect(w.held.get(WEBS)?.lostAt).toEqual(expect.any(String))
    expect(await readJoinState(agent, WEBS, { local: true, ...w })).toEqual({ kind: 'none', lost: true })
    await looks(6)
    expect(asked).toHaveLength(1)
  })

  it('CONTROL: no answer is not that: nothing is recorded as lost, and it is asked about again', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks(new Error('no answer'), { requestId: 'r-1', status: 'pending' })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(1)
    expect(w.held.get(WEBS)?.lostAt).toBeUndefined()
    expect(await readJoinState(agent, WEBS, { local: true, ...w })).toMatchObject({ kind: 'pending' })
    await looks(2) // rests one look after the failure, then asks again
    expect(asked).toHaveLength(2)
  })
})

describe('approved, and the card did not come', () => {
  it('is asked for once, a look after the approval was learned, and never again', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks(
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false },
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false },
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false, credentialResend: 'queued' }
    )
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(1) // learns of the approval
    expect(asked).toEqual([{ communityDid: WEBS, requestId: 'r-1' }])
    await looks(1) // the card had one look's time: status, then the ask for the card
    expect(asked.slice(1)).toEqual([
      { communityDid: WEBS, requestId: 'r-1' },
      { communityDid: WEBS, requestId: 'r-1', resendCredentials: true },
    ])
    await looks(5)
    expect(asked).toHaveLength(3)
  })

  it('already approved when the watch begins: the first look asks nothing, the second asks for the card', async () => {
    const w = world([request(WEBS, { status: 'approved' })])
    const { statusAs, asked } = asks(
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false },
      { requestId: 'r-1', status: 'approved', credentialsDelivered: false, credentialResend: 'queued' }
    )
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(1)
    expect(asked).toEqual([])
    await looks(1)
    expect(asked).toEqual([
      { communityDid: WEBS, requestId: 'r-1' },
      { communityDid: WEBS, requestId: 'r-1', resendCredentials: true },
    ])
  })

  it('is not asked for when the community says the card was acknowledged', async () => {
    const w = world([request(WEBS, { status: 'approved' })])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'approved', credentialsDelivered: true })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(4)
    expect(asked.some((a) => a.resendCredentials)).toBe(false)
  })

  it('CONTROL: is never asked for at a did:webvh community', async () => {
    const w = world([request(WEBVH, { status: 'approved' })])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(6)
    expect(asked).toEqual([])
  })
})

describe('the switch', () => {
  it.each([
    ['remoteOff', () => (JOIN_WATCH.remoteOff = true)],
    ['on false', () => (JOIN_WATCH.on = false)],
  ])('%s: nothing is asked, at a did:webs community either', async (_name, flip) => {
    flip()
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'approved', credentialsDelivered: false })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(6)
    expect(asked).toEqual([])
    expect(watchesJoin(WEBS)).toBe(false)
  })

  it('remoteOff set while it runs: the looks stop', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'pending' })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(2)
    expect(asked).toHaveLength(2)
    JOIN_WATCH.remoteOff = true
    await looks(4)
    expect(asked).toHaveLength(2)
  })
})

describe('a community that fails or is slow', () => {
  it('is asked less and less often (10 s, 20 s, 40 s, then every 60 s), and at full rate again once it answers', async () => {
    const w = world([request(WEBS)])
    const down = new Error('no answer')
    const answers: (JoinRequestStatus | Error)[] = [down]
    const at: number[] = []
    const start = Date.now()
    const statusAs: StatusAs = jest.fn(async () => {
      at.push(Math.round((Date.now() - start) / 1000))
      const a = answers[0]
      if (a instanceof Error) throw a
      return a
    })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(48) // 240 s
    expect(at).toEqual([5, 15, 35, 75, 135, 195])
    answers[0] = { requestId: 'r-1', status: 'pending' }
    await looks(5) // answered at 255 s, then every 5 s
    expect(at.slice(6)).toEqual([255, 260, 265])
  })

  it('CONTROL: one that answers is asked every 5 s', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'pending' })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(6)
    expect(asked).toHaveLength(6)
  })
})

describe('never in the way', () => {
  it('skips a look when the identity has no session of its own, and asks at the next', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks(new VtiNoOwnSession(PERSONA), { requestId: 'r-1', status: 'pending' })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(1)
    expect(asked).toHaveLength(1)
    expect(w.held.get(WEBS)?.status).toBe('pending')
    expect(logger.info).not.toHaveBeenCalled()
    await looks(1)
    expect(asked).toHaveLength(2)
  })

  it('does not start a second look while one is still out', async () => {
    const w = world([request(WEBS)])
    let release: (v: JoinRequestStatus) => void = () => undefined
    const statusAs: StatusAs = jest.fn(() => new Promise<JoinRequestStatus>((resolve) => (release = resolve)))
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(4)
    expect(statusAs).toHaveBeenCalledTimes(1)
    release({ requestId: 'r-1', status: 'pending' })
    await looks(1)
    expect(statusAs).toHaveBeenCalledTimes(2)
  })

  it('asks nothing after it is stopped', async () => {
    const w = world([request(WEBS)])
    const { statusAs, asked } = asks({ requestId: 'r-1', status: 'pending' })
    stop = startJoinWatch(agent, { ...w, statusAs })
    await looks(1)
    stop()
    await looks(3)
    expect(asked).toHaveLength(1)
  })
})

describe("the status ask, over an identity's own session", () => {
  const STATUS = 'https://trusttasks.org/spec/vtc/join-requests/status/0.1'
  const answer = {
    id: 'urn:uuid:a',
    type: `${STATUS}#response`,
    body: { payload: { requestId: 'r-1', status: 'pending' } },
  }
  const persona = { did: PERSONA, communityDid: WEBS } as VtiPersona
  afterEach(() => jest.restoreAllMocks())

  it('goes as that identity with `as`, and never through the shared session', async () => {
    const own = jest.spyOn(vtiAgent, 'askAs').mockResolvedValue(answer as never)
    const shared = jest.spyOn(vtiAgent, 'ask').mockResolvedValue(answer as never)
    expect(await vtiAgent.status(WEBS, { requestId: 'r-1', as: persona })).toEqual({
      requestId: 'r-1',
      status: 'pending',
    })
    expect(own.mock.calls).toEqual([[persona, WEBS, STATUS, { requestId: 'r-1' }]])
    expect(shared).not.toHaveBeenCalled()
  })

  it('CONTROL: without `as` goes through the shared session, as before', async () => {
    const own = jest.spyOn(vtiAgent, 'askAs').mockResolvedValue(answer as never)
    const shared = jest.spyOn(vtiAgent, 'ask').mockResolvedValue(answer as never)
    await vtiAgent.status(WEBVH, { requestId: 'r-1', resendCredentials: true })
    expect(shared.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      [WEBVH, STATUS, { requestId: 'r-1', resendCredentials: true }],
    ])
    expect(own).not.toHaveBeenCalled()
  })
})
