/**
 * A session with the agent starts from what the agent last said about itself, and asks again behind
 * (agentLastKnownSwitch.ts): which tasks it serves, and what it is called. `auth/whoami` stays first and live.
 *
 * Each claim has its control beside it: the same steps with the switch off, or with nothing kept, ask at once as before.
 */
import {
  AGENT_LAST_KNOWN_AT_CONNECT,
  AGENT_LAST_KNOWN_MAX_AGE_MS,
  AGENT_LAST_KNOWN_MAX_CHARS,
  AGENT_LAST_KNOWN_MAX_TYPES,
  AGENT_LAST_KNOWN_REFRESH_AFTER_MS,
  AGENT_LAST_KNOWN_REWRITE_MS,
  isAgentLastKnownOn,
} from '../module/agentLastKnownSwitch'
import { VtaAgentController } from '../module/vtaAgent'
import { VtiRefusal } from '../module/vtiAgent'
import type { VtaLink } from '../module/VtaLinkStore'

const AGENT = 'did:webvh:Qm:alice'
const OTHER = 'did:webvh:Qm:bob'
const A = 'https://trusttasks.org/spec/rooms/keys/browse/0.3'
const B = 'https://trusttasks.org/spec/rooms/keys/browse/0.4'
const C = 'https://trusttasks.org/spec/rooms/keys/read/0.2'

const mockClient = {
  connect: jest.fn(async () => {
    mockClient.isConnected = true
  }),
  disconnect: jest.fn(async () => {
    mockClient.isConnected = false
  }),
  whoAmI: jest.fn(async (): Promise<unknown> => ({ roles: ['admin'] })),
  agentLabel: jest.fn(async (): Promise<{ label: string; source: string } | undefined> => undefined),
  supportedTypes: jest.fn(async (): Promise<string[] | undefined> => [A, B]),
  managerDid: 'did:peer:2.permanent',
  isConnected: false,
  holdPersonaKeys: jest.fn(async () => false),
  borrowKey: jest.fn(async () => ({ keyId: 'k', curve: 'Ed25519' as const, publicKeyMultibase: 'z' })),
  carryApproversAcrossSwap: jest.fn(async () => 'none'),
  task: jest.fn(async (): Promise<unknown> => ({})),
  dropQueued: jest.fn(),
  listContexts: jest.fn(async () => []),
}

jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  refusedAsNotOnAcl: jest.requireActual('../module/VtaClient').refusedAsNotOnAcl,
  TspReplyBreaker: jest.requireActual('../module/VtaClient').TspReplyBreaker,
  consentPendingOf: jest.requireActual('../module/VtaClient').consentPendingOf,
  ManagerKeyUnresolved: jest.requireActual('../module/VtaClient').ManagerKeyUnresolved,
  SwapDoneSignInFailed: jest.requireActual('../module/VtaClient').SwapDoneSignInFailed,
  VtaClient: jest.fn(() => mockClient),
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.temporary'),
  createVtiTemporaryDidKey: jest.fn(async () => 'did:key:z6Mktemporary'),
}))

const DAY = 24 * 60 * 60 * 1000
const START = 100 * DAY
const agent = {} as never

/** A phone linked to {@link AGENT}, with whatever the link keeps; `saved` is every link written since. */
function linkedPhone(kept: Partial<VtaLink> = {}) {
  let clock = START
  const links: VtaLink[] = [{ vtaDid: AGENT, label: 'Lab agent', linkedAt: 't0', introSeenAt: 't1', ...kept }]
  const saved: VtaLink[] = []
  const read = jest.fn(async () => links.map((l) => ({ ...l })))
  /** Writes held back until released: each waits where the store would be writing, holding the copy it was given. */
  let held: (() => void)[] | undefined
  const vta = new VtaAgentController()
  vta.configure({
    now: () => clock,
    linkStore: () => ({
      get: async () => (await read())[0],
      list: read,
      set: async (link) => {
        if (held) await new Promise<void>((resolve) => held?.push(resolve))
        saved.push(link)
        const at = links.findIndex((l) => l.vtaDid === link.vtaDid)
        if (at >= 0) links[at] = link
        else links.push(link)
      },
      clear: async () => {
        links.shift()
      },
      remove: async (vtaDid: string) => {
        const at = links.findIndex((l) => l.vtaDid === vtaDid)
        if (at >= 0) links.splice(at, 1)
      },
    }),
    identityStore: () => ({ setManager: async () => undefined, forgetManager: async () => undefined }) as never,
  })
  return {
    vta,
    saved,
    links,
    read,
    /** From now, each write of a link waits until `release`. */
    holdWrites: () => {
      held = []
    },
    /** How many writes have reached the store and wait there. */
    writesHeld: () => held?.length ?? 0,
    /** Let every write held so far go on, and later ones go straight through. */
    release: async () => {
      const waiting = held ?? []
      held = undefined
      for (const go of waiting) go()
      await jest.advanceTimersByTimeAsync(0)
    },
    /** Move the phone's clock, without running any timer. */
    clockTo: (ms: number) => (clock = ms),
    /** Let time pass: the clock and the timers together. */
    pass: async (ms: number) => {
      clock += ms
      await jest.advanceTimersByTimeAsync(ms)
    },
    /** The app starts: the link is read and the session opens. */
    start: async () => {
      await vta.restore(agent)
      await jest.advanceTimersByTimeAsync(0)
    },
    /** The session drops and opens again (an unlock, a network change). */
    reopen: async () => {
      mockClient.isConnected = false
      await vta.connect(agent, AGENT)
      await jest.advanceTimersByTimeAsync(0)
    },
  }
}

/**
 * Each different `served` written with the link, in order, leaving out `kept`: other writes of the link (when it was
 * last reached, its name) carry what is kept along unchanged.
 */
const servedWrites = (saved: VtaLink[], kept?: VtaLink['served']) => {
  const seen = new Set<string>(kept ? [JSON.stringify(kept)] : [])
  const out: VtaLink['served'][] = []
  for (const link of saved) {
    const key = JSON.stringify(link.served)
    if (!link.served || seen.has(key)) continue
    seen.add(key)
    out.push(link.served)
  }
  return out
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  mockClient.isConnected = false
  mockClient.connect.mockImplementation(async () => {
    mockClient.isConnected = true
  })
  mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
  mockClient.agentLabel.mockImplementation(async () => undefined)
  mockClient.supportedTypes.mockImplementation(async () => [A, B])
  AGENT_LAST_KNOWN_AT_CONNECT.on = true
  AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = false
})

afterEach(() => {
  jest.useRealTimers()
  AGENT_LAST_KNOWN_AT_CONNECT.on = true
  AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = false
})

describe('the switch', () => {
  it('ships on, and reads as off for anything but on true and remoteOff false', () => {
    expect(AGENT_LAST_KNOWN_AT_CONNECT).toEqual({ on: true, remoteOff: false })
    expect(isAgentLastKnownOn()).toBe(true)
    AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = true
    expect(isAgentLastKnownOn()).toBe(false)
    AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = false
    AGENT_LAST_KNOWN_AT_CONNECT.on = false
    expect(isAgentLastKnownOn()).toBe(false)
    for (const odd of [undefined, null, 1, 'true']) {
      AGENT_LAST_KNOWN_AT_CONNECT.on = true
      AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = odd as never
      expect(isAgentLastKnownOn()).toBe(false)
      AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = false
      AGENT_LAST_KNOWN_AT_CONNECT.on = odd as never
      expect(isAgentLastKnownOn()).toBe(false)
    }
  })
})

describe('which tasks the agent serves', () => {
  it('is given from the last answer at once, with the agent not asked, after a live whoami', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    expect(mockClient.whoAmI).toHaveBeenCalledTimes(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A])
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
  })

  it('control: with the switch off the agent is asked each time, and the kept answer is not read', async () => {
    AGENT_LAST_KNOWN_AT_CONNECT.on = false
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(2)
  })

  it('is asked again once the session has been open a while, and not before', async () => {
    const phone = linkedPhone({ served: { types: [A, B], at: START - 1000 } })
    await phone.start()
    await phone.vta.servedTypes(agent)
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS - 1)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    await phone.pass(1)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    // The same answer: nothing moved, and nothing written for an answer under a day old.
    expect(phone.vta.servedTypesStamp()).toBe(0)
    expect(servedWrites(phone.saved, { types: [A, B], at: START - 1000 })).toEqual([])
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
  })

  it('is asked again even when nobody read it this session: the kept answer is checked each launch', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
  })

  it('a different answer replaces the kept one, moves the stamp, and is written with the link', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY }, nickname: 'mine' })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A])
    expect(phone.vta.servedTypesStamp()).toBe(0)
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(phone.vta.servedTypesStamp()).toBe(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(servedWrites(phone.saved, { types: [A], at: START - DAY })).toEqual([
      { types: [A, B], at: START + AGENT_LAST_KNOWN_REFRESH_AFTER_MS },
    ])
    // The rest of the link is carried along as it was.
    expect(phone.links[0]).toMatchObject({ vtaDid: AGENT, label: 'Lab agent', nickname: 'mine' })
  })

  it('the same tasks in another order are the same answer', async () => {
    mockClient.supportedTypes.mockImplementation(async () => [B, A])
    const phone = linkedPhone({ served: { types: [A, B], at: START - 1000 } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    expect(phone.vta.servedTypesStamp()).toBe(0)
    expect(servedWrites(phone.saved, { types: [A, B], at: START - 1000 })).toEqual([])
  })

  it('an answer that only lost a task is a different answer', async () => {
    mockClient.supportedTypes.mockImplementation(async () => [A])
    const phone = linkedPhone({ served: { types: [A, B], at: START - 1000 } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(phone.vta.servedTypesStamp()).toBe(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A])
  })

  it('as many tasks but not the same ones is a different answer', async () => {
    mockClient.supportedTypes.mockImplementation(async () => [A, C])
    const phone = linkedPhone({ served: { types: [A, B], at: START - 1000 } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(phone.vta.servedTypesStamp()).toBe(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, C])
  })

  it('the same answer, kept over a day ago, is written again with the new time and moves nothing', async () => {
    const phone = linkedPhone({ served: { types: [A, B], at: START - AGENT_LAST_KNOWN_REWRITE_MS } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(servedWrites(phone.saved, { types: [A, B], at: START - AGENT_LAST_KNOWN_REWRITE_MS })).toEqual([
      { types: [A, B], at: START + AGENT_LAST_KNOWN_REFRESH_AFTER_MS },
    ])
    expect(phone.vta.servedTypesStamp()).toBe(0)
  })

  it('with nothing kept the agent is asked now, the answer is kept, and it is not asked again this run', async () => {
    const phone = linkedPhone()
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    expect(servedWrites(phone.saved)).toEqual([{ types: [A, B], at: START }])
    // From here it is the kept one: given at once, and nothing older to check it against.
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    expect(phone.vta.servedTypesStamp()).toBe(0)
  })

  it('with nothing kept and nobody asking, the wait asks nothing', async () => {
    const phone = linkedPhone()
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
  })

  it('an agent that could not say is not kept: asked again by the next caller', async () => {
    mockClient.supportedTypes.mockImplementation(async () => undefined)
    const phone = linkedPhone()
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toBeUndefined()
    expect(servedWrites(phone.saved)).toEqual([])
    mockClient.supportedTypes.mockImplementation(async () => [C])
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([C])
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a day under the limit', AGENT_LAST_KNOWN_MAX_AGE_MS - DAY, [A], 0],
    ['one millisecond under the limit', AGENT_LAST_KNOWN_MAX_AGE_MS - 1, [A], 0],
    ['at the limit', AGENT_LAST_KNOWN_MAX_AGE_MS, [A, B], 1],
    ['long past it', 10 * AGENT_LAST_KNOWN_MAX_AGE_MS, [A, B], 1],
  ])('a kept answer %s', async (_name, age, given, asked) => {
    const phone = linkedPhone({ served: { types: [A], at: START - age } })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual(given)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(asked)
  })

  it('a kept answer dated in the future beyond the limit (a clock set back) is not used', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START + AGENT_LAST_KNOWN_MAX_AGE_MS } })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no list', { at: START - DAY }],
    ['an empty list', { types: [], at: START - DAY }],
    ['no time', { types: [A] }],
    ['a list of something else', { types: [1, null], at: START - DAY }],
    ['not an object', 'yes'],
  ])('what is kept in a shape it does not know (%s) is not used', async (_name, served) => {
    const phone = linkedPhone({ served: served as never })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })

  it('the link is read for it once a run: later answers come from memory', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await phone.vta.servedTypes(agent)
    const reads = phone.read.mock.calls.length
    await phone.vta.servedTypes(agent)
    await phone.vta.servedTypes(agent)
    expect(phone.read.mock.calls).toHaveLength(reads)
  })

  it('an agent that does not answer the later ask keeps the kept answer, and is asked again next session', async () => {
    mockClient.supportedTypes.mockImplementation(async () => undefined)
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A])
    expect(phone.vta.servedTypesStamp()).toBe(0)
    expect(servedWrites(phone.saved, { types: [A], at: START - DAY })).toEqual([])

    mockClient.supportedTypes.mockImplementation(async () => [A, B])
    await phone.reopen()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(2)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(phone.vta.servedTypesStamp()).toBe(1)
  })

  it('is asked again once per run: a later session of the same run does not ask', async () => {
    const phone = linkedPhone({ served: { types: [A, B], at: START - 1000 } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    await phone.reopen()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })

  it('a session that ended before the wait is not asked, and not reopened for it', async () => {
    const phone = linkedPhone({
      served: { types: [A], at: START - DAY },
      agentName: { label: 'runner', source: 'vtaName' },
    })
    await phone.start()
    const connects = mockClient.connect.mock.calls.length
    mockClient.isConnected = false
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    expect(mockClient.agentLabel).not.toHaveBeenCalled()
    expect(mockClient.connect.mock.calls).toHaveLength(connects)
  })

  it('a session that opens during the wait starts the wait over: one ask, a full wait after the later open', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS - 1000)
    await phone.reopen()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS - 1)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    await phone.pass(1)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })

  it('turned off during the wait: nothing is asked when it ends', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = true
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
  })

  it('whoami stays first and live: an agent that no longer accepts this phone gives no kept answer', async () => {
    mockClient.whoAmI.mockImplementation(async () => {
      throw new Error('unauthorized: DID not in ACL')
    })
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toBeUndefined()
    expect(phone.vta.getState().link.kind).not.toBe('linked')
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
  })

  it('an agent that cannot be reached gives no kept answer either: the session comes first, as before', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    mockClient.isConnected = false
    mockClient.connect.mockImplementationOnce(async () => {
      throw new Error('the mediator did not answer')
    })
    await expect(phone.vta.servedTypes(agent)).rejects.toMatchObject({ reason: 'unreachable' })
  })

  it('with no agent linked there is nothing to say', async () => {
    const vta = new VtaAgentController()
    await expect(vta.servedTypes(agent)).resolves.toBeUndefined()
    expect(mockClient.connect).not.toHaveBeenCalled()
  })

  it('kill: remoteOff asks live each time, reads and writes nothing kept, and no wait asks', async () => {
    AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = true
    const phone = linkedPhone({
      served: { types: [A], at: START - DAY },
      agentName: { label: 'runner', source: 'vtaName' },
    })
    await phone.start()
    // The name is asked at once, as before.
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    await phone.pass(10 * AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
    expect(phone.saved.every((l) => l.served?.at === START - DAY)).toBe(true)
    expect(phone.links[0].served).toEqual({ types: [A], at: START - DAY })
    expect(phone.vta.servedTypesStamp()).toBe(0)
  })

  it('unlinking the agent forgets what it said, and the wait set for its session asks nothing', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A])
    await phone.vta.unlink(agent)
    await jest.advanceTimersByTimeAsync(0)
    await expect(phone.vta.servedTypes(agent)).resolves.toBeUndefined()
    // The wait set for the session that is gone asks nothing.
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    // Nothing it said is held any more: linked again in this run, it would be asked.
    expect((phone.vta as unknown as { servedKept: Map<string, unknown> }).servedKept.size).toBe(0)
  })
})

describe('a task the agent refuses as one it does not serve', () => {
  const unserved = () => new VtiRefusal('unsupportedVersion', 'rooms/keys/browse/0.4 is not served')

  it('has the kept answer asked for again at once, not at the end of the wait', async () => {
    const phone = linkedPhone({ served: { types: [B], at: START - DAY } })
    mockClient.supportedTypes.mockImplementation(async () => [A])
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([B])
    phone.vta.servedRefused(agent, unserved())
    await jest.advanceTimersByTimeAsync(0)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A])
    expect(phone.vta.servedTypesStamp()).toBe(1)
    // The wait's own ask is the same one: not made a second time.
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })

  it('`unsupportedType` reads the same way', async () => {
    const phone = linkedPhone({ served: { types: [B], at: START - DAY } })
    await phone.start()
    phone.vta.servedRefused(agent, new VtiRefusal('unsupportedType', 'no version of it is served'))
    await jest.advanceTimersByTimeAsync(0)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })

  it('asks once: refused again after the agent answered, it is not asked each time', async () => {
    const phone = linkedPhone({ served: { types: [B], at: START - DAY } })
    await phone.start()
    for (let i = 0; i < 3; i++) phone.vta.servedRefused(agent, unserved())
    await jest.advanceTimersByTimeAsync(0)
    phone.vta.servedRefused(agent, unserved())
    await jest.advanceTimersByTimeAsync(0)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a refusal of what was asked', () => new VtiRefusal('permissionDenied', 'not yours')],
    ['a host’s refusal the agent passes on', () => new VtiRefusal('taskFailed', 'x', { code: 'a:unsupportedVersion' })],
    ['an error that is no refusal', () => new Error('unsupportedVersion')],
    ['nothing', () => undefined],
  ])('control: %s asks nothing', async (_name, error) => {
    const phone = linkedPhone({ served: { types: [B], at: START - DAY } })
    await phone.start()
    phone.vta.servedRefused(agent, error())
    await jest.advanceTimersByTimeAsync(0)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
  })

  it('control: with the switch off a refusal asks nothing here', async () => {
    AGENT_LAST_KNOWN_AT_CONNECT.remoteOff = true
    const phone = linkedPhone({ served: { types: [B], at: START - DAY } })
    await phone.start()
    phone.vta.servedRefused(agent, unserved())
    await jest.advanceTimersByTimeAsync(0)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
  })

  it('with nothing kept there is nothing out of date: nothing is asked', async () => {
    const phone = linkedPhone()
    await phone.start()
    phone.vta.servedRefused(agent, unserved())
    await jest.advanceTimersByTimeAsync(0)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
  })

  it('with the session gone it asks nothing, and opens none', async () => {
    const phone = linkedPhone({ served: { types: [B], at: START - DAY } })
    await phone.start()
    const connects = mockClient.connect.mock.calls.length
    mockClient.isConnected = false
    phone.vta.servedRefused(agent, unserved())
    await jest.advanceTimersByTimeAsync(0)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    expect(mockClient.connect.mock.calls).toHaveLength(connects)
  })
})

describe('more than one agent, and a lock', () => {
  it('an agent unlinked while it was being asked leaves nothing kept', async () => {
    let answer: (types: string[]) => void = () => undefined
    mockClient.supportedTypes.mockImplementation(() => new Promise<string[]>((resolve) => (answer = resolve)))
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    await phone.vta.unlink(agent)
    answer([A, B])
    await jest.advanceTimersByTimeAsync(0)
    expect((phone.vta as unknown as { servedKept: Map<string, unknown> }).servedKept.size).toBe(0)
    expect(phone.vta.servedTypesStamp()).toBe(0)
    expect(phone.saved.some((l) => l.served?.types.length === 2)).toBe(false)
  })

  it('an answer kept for another linked agent is not this one’s: this one is asked', async () => {
    const phone = linkedPhone()
    phone.links.push({ vtaDid: OTHER, label: 'Other', linkedAt: 't9', served: { types: [C], at: START - DAY } })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    // Kept with this agent's link, the other's untouched.
    expect(phone.links.find((l) => l.vtaDid === AGENT)?.served).toEqual({ types: [A, B], at: START })
    expect(phone.links.find((l) => l.vtaDid === OTHER)?.served).toEqual({ types: [C], at: START - DAY })
  })

  it('a lock inside the wait ends it; the unlock’s session sets its own, a full wait long', async () => {
    const phone = linkedPhone({
      served: { types: [A], at: START - DAY },
      agentName: { label: 'runner', source: 'vtaName' },
    })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS - 1000)
    // The lock shut the app's agent down; the unlock hands over a new one.
    await phone.vta.restore({ tag: 'after the unlock' } as never)
    await jest.advanceTimersByTimeAsync(0)
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS - 1)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    expect(mockClient.agentLabel).not.toHaveBeenCalled()
    await phone.pass(1)
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
  })

  it('a lock with no unlock yet: the wait that was running asks nothing', async () => {
    const phone = linkedPhone({
      served: { types: [A], at: START - DAY },
      agentName: { label: 'runner', source: 'vtaName' },
    })
    await phone.start()
    mockClient.connect.mockImplementation(() => new Promise(() => undefined))
    void phone.vta.restore({ tag: 'after the unlock' } as never)
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    expect(mockClient.agentLabel).not.toHaveBeenCalled()
  })

  it('a session let go whose client still reads connected (its close failed) is asked nothing either', async () => {
    const phone = linkedPhone({
      served: { types: [A], at: START - DAY },
      agentName: { label: 'runner', source: 'vtaName' },
    })
    await phone.start()
    mockClient.disconnect.mockImplementationOnce(async () => {
      throw new Error('the socket would not close')
    })
    // The unlock's session is a client of its own, as in the app, and has not opened yet.
    const next = { ...mockClient, isConnected: false, connect: jest.fn(() => new Promise<void>(() => undefined)) }
    const VtaClientMock = jest.requireMock('../module/VtaClient').VtaClient as jest.Mock
    VtaClientMock.mockImplementationOnce(() => next)
    void phone.vta.restore({ tag: 'after the unlock' } as never)
    await jest.advanceTimersByTimeAsync(0)
    expect(next.connect).toHaveBeenCalledTimes(1)
    expect(mockClient.isConnected).toBe(true)
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.supportedTypes).not.toHaveBeenCalled()
    expect(mockClient.agentLabel).not.toHaveBeenCalled()
  })
})

// `set` replaces the whole link record, so each change is a read, a change and a write of all of it. Side by side, the
// later write puts back what it read before the earlier one. Every change of a link goes one at a time (`changeLink`).
describe('changes of the same link, side by side', () => {
  const NAMED = { label: 'renamed', source: 'vtaName' }

  it('a name the person types while the later ask is being kept is not lost, and neither is the answer', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    phone.holdWrites()
    // The later ask's answer is on its way to the store, holding the link as it read it: with no name.
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    const naming = phone.vta.nameAgent(agent, AGENT, 'Home agent')
    await jest.advanceTimersByTimeAsync(0)
    await phone.release()
    await naming
    expect(phone.links[0].nickname).toBe('Home agent')
    expect(phone.links[0].served?.types).toEqual([A, B])
  })

  it('the name typed first, the answer kept while it is being written: both stand', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS - 1)
    phone.holdWrites()
    const naming = phone.vta.nameAgent(agent, AGENT, 'Home agent')
    await jest.advanceTimersByTimeAsync(0)
    await phone.pass(1)
    await phone.release()
    await naming
    expect(phone.links[0].nickname).toBe('Home agent')
    expect(phone.links[0].served?.types).toEqual([A, B])
  })

  it('the agent’s new name and its new answer, both kept from the same wait, both stand', async () => {
    mockClient.agentLabel.mockImplementation(async () => NAMED)
    const phone = linkedPhone({
      served: { types: [A], at: START - DAY },
      agentName: { label: 'runner', source: 'vtaName' },
    })
    await phone.start()
    phone.holdWrites()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    await phone.release()
    expect(phone.links[0].agentName).toEqual(NAMED)
    expect(phone.links[0].served?.types).toEqual([A, B])
  })

  it('clearing the name while the answer is being kept leaves no name, and the answer', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY }, nickname: 'Home agent' })
    await phone.start()
    phone.holdWrites()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    const clearing = phone.vta.nameAgent(agent, AGENT, '')
    await jest.advanceTimersByTimeAsync(0)
    await phone.release()
    await clearing
    expect(phone.links[0].nickname).toBeUndefined()
    expect(phone.links[0].served?.types).toEqual([A, B])
  })

  it('"seen the introduction", marked while the answer is being kept, is not lost', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY }, introSeenAt: undefined })
    await phone.start()
    phone.holdWrites()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    const marking = phone.vta.markIntroSeen(agent)
    await jest.advanceTimersByTimeAsync(0)
    await phone.release()
    await marking
    expect(phone.links[0].introSeenAt).toEqual(expect.any(String))
    expect(phone.links[0].served?.types).toEqual([A, B])
  })

  it('an unlink while the answer is being kept takes the link out for good: the write does not put it back', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    phone.holdWrites()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    const unlinking = phone.vta.unlink(agent)
    await jest.advanceTimersByTimeAsync(0)
    await phone.release()
    await unlinking
    expect(phone.links).toEqual([])
  })

  it('"reached the agent", noted as the session opens, does not put back a link from before a name was typed', async () => {
    const phone = linkedPhone()
    phone.holdWrites()
    // The session opens and notes when the agent was reached: that write is held, with the link as it read it.
    await phone.start()
    const naming = phone.vta.nameAgent(agent, AGENT, 'Home agent')
    await jest.advanceTimersByTimeAsync(0)
    await phone.release()
    await naming
    expect(phone.links[0].nickname).toBe('Home agent')
    expect(phone.links[0].lastOnlineAt).toBe(START)
  })

  it('unlinking another agent while its link is being written takes it out for good', async () => {
    const phone = linkedPhone()
    phone.links.push({ vtaDid: OTHER, label: 'Other', linkedAt: 't9' })
    await phone.start()
    phone.holdWrites()
    const naming = phone.vta.nameAgent(agent, OTHER, 'Work agent')
    await jest.advanceTimersByTimeAsync(0)
    const unlinking = phone.vta.unlinkAgent(agent, OTHER)
    await jest.advanceTimersByTimeAsync(60_000)
    await phone.release()
    await jest.advanceTimersByTimeAsync(60_000)
    await Promise.all([naming, unlinking])
    expect(phone.links.map((l) => l.vtaDid)).toEqual([AGENT])
  })

  it('a change of one agent’s link does not wait for another agent’s', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    phone.links.push({ vtaDid: OTHER, label: 'Other', linkedAt: 't9' })
    await phone.start()
    phone.holdWrites()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(phone.writesHeld()).toBe(1)
    // This agent's write waits at the store. The other agent's reaches the store too: it did not wait behind it.
    const naming = phone.vta.nameAgent(agent, OTHER, 'Work agent')
    await jest.advanceTimersByTimeAsync(0)
    expect(phone.writesHeld()).toBe(2)
    await phone.release()
    await naming
    expect(phone.links.find((l) => l.vtaDid === OTHER)?.nickname).toBe('Work agent')
  })

  it('control: a second change of the same agent’s link does wait: it has not reached the store', async () => {
    const phone = linkedPhone({ served: { types: [A], at: START - DAY } })
    await phone.start()
    phone.holdWrites()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    const naming = phone.vta.nameAgent(agent, AGENT, 'Home agent')
    await jest.advanceTimersByTimeAsync(0)
    expect(phone.writesHeld()).toBe(1)
    await phone.release()
    await naming
  })
})

describe('an answer too long to keep', () => {
  const long = (count: number, each = 40) =>
    Array.from({ length: count }, (_, i) => `https://trusttasks.org/spec/${String(i).padStart(each, 'x')}/0.1`)

  it.each([
    ['one type over the limit', () => long(AGENT_LAST_KNOWN_MAX_TYPES + 1, 4), false],
    ['at the limit of types', () => long(AGENT_LAST_KNOWN_MAX_TYPES, 4), true],
    ['over the limit of characters', () => long(100, AGENT_LAST_KNOWN_MAX_CHARS / 100), false],
  ])('%s', async (_name, list, kept) => {
    const types = list()
    mockClient.supportedTypes.mockImplementation(async () => types)
    const phone = linkedPhone()
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual(types)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual(types)
    // Kept: asked once. Not kept: used, and asked each time, as before.
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(kept ? 1 : 2)
    expect(Boolean(phone.links[0].served)).toBe(kept)
  })

  it('takes away a shorter one kept before, and whoever held that one reads again', async () => {
    const types = long(AGENT_LAST_KNOWN_MAX_TYPES + 1, 4)
    mockClient.supportedTypes.mockImplementation(async () => types)
    const phone = linkedPhone({ served: { types: [A], at: START - DAY }, nickname: 'mine' })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A])
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(phone.links[0].served).toBeUndefined()
    expect(phone.links[0].nickname).toBe('mine')
    expect(phone.vta.servedTypesStamp()).toBe(1)
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual(types)
  })

  it('one kept by an earlier build beyond the limit is not used', async () => {
    const phone = linkedPhone({ served: { types: long(AGENT_LAST_KNOWN_MAX_TYPES + 1, 4), at: START - DAY } })
    await phone.start()
    await expect(phone.vta.servedTypes(agent)).resolves.toEqual([A, B])
    expect(mockClient.supportedTypes).toHaveBeenCalledTimes(1)
  })
})

describe('what the agent is called', () => {
  it('with a name already kept, is asked behind, not at the session open', async () => {
    mockClient.agentLabel.mockImplementation(async () => ({ label: 'renamed', source: 'vtaName' }))
    const phone = linkedPhone({ agentName: { label: 'runner', source: 'vtaName' } })
    await phone.start()
    expect(phone.vta.getState().agentNames?.[AGENT]).toEqual({ label: 'runner', source: 'vtaName' })
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS - 1)
    expect(mockClient.agentLabel).not.toHaveBeenCalled()
    await phone.pass(1)
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
    // A new name is shown and kept, as it was when asked at once.
    expect(phone.vta.getState().agentNames?.[AGENT]).toEqual({ label: 'renamed', source: 'vtaName' })
    expect(phone.links[0].agentName).toEqual({ label: 'renamed', source: 'vtaName' })
  })

  it('control: with the switch off a kept name is asked again at the session open', async () => {
    AGENT_LAST_KNOWN_AT_CONNECT.on = false
    const phone = linkedPhone({ agentName: { label: 'runner', source: 'vtaName' } })
    await phone.start()
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
  })

  it('with no name kept, is asked at the session open, and not a second time behind', async () => {
    mockClient.agentLabel.mockImplementation(async () => ({ label: 'runner', source: 'vtaName' }))
    const phone = linkedPhone()
    await phone.start()
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
    expect(phone.vta.getState().agentNames?.[AGENT]).toEqual({ label: 'runner', source: 'vtaName' })
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
  })

  it('a name the person gave the agent also puts the ask behind: the agent’s own name is not shown meanwhile', async () => {
    const phone = linkedPhone({ nickname: 'mine' })
    await phone.start()
    expect(mockClient.agentLabel).not.toHaveBeenCalled()
    await phone.pass(AGENT_LAST_KNOWN_REFRESH_AFTER_MS)
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
  })

  it('another agent’s kept name does not put this one’s ask behind', async () => {
    const phone = linkedPhone()
    phone.links.push({ vtaDid: OTHER, label: 'Other', linkedAt: 't9', agentName: { label: 'bob', source: 'vtaName' } })
    await phone.start()
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
  })
})
