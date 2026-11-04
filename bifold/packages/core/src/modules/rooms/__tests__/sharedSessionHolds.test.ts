/**
 * One phone, two communities on one mediator, one shared community session (vtiAgent). The hidden-vetting run of
 * 10-31 (276.10): the rooms polls asked both communities at once, each as its own persona, and every connect took the
 * session from the other — twelve sign-ins in six minutes, 4 s apart, and each one stopped the other persona's asks
 * ("session stopped"). A vetting step that needed the session as its persona lost it the same way.
 *
 * - the rooms backend's poll for two personas switches once per persona and loses no ask;
 * - a background connect while another identity holds the session, or was signed in as for a step just now, is
 *   refused with VtiSessionHeld, and nothing is disconnected;
 * - an ordinary connect waits for another DID's hold to end; holds for one DID share the session;
 * - a hold past its time stops keeping others waiting.
 */
const mockSessions: Array<{ did: string; open: boolean; sent: Record<string, unknown>[] }> = []
/** How long the fake community takes to answer each ask. */
let mockAnswerMs = 20

jest.mock('@bifold/trust-tasks', () => ({
  tsp: { CODEC_FORMS_RELATIONSHIPS: true, peekRevision: () => ({ minor: 0 }) },
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
}))
jest.mock('../../trust-tasks/documentProof', () => ({
  signDocumentProof: jest.fn(async (_a: unknown, doc: Record<string, unknown>) => doc),
}))
jest.mock('../../trust-tasks/module/VtiMediatorTransport', () => ({
  advertisedMediatorDid: jest.fn(async () => undefined),
  advertisedTspMediatorDid: jest.fn(async () => undefined),
  createVtiClientDid: jest.fn(async () => 'did:peer:client'),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did, wsEndpoint: `wss://${did}` })),
  resolveDidDocumentRetrying: jest.fn(),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  vtiClientIdentityFromPersona: jest.fn(async (_a: unknown, did: string) => ({ did })),
  // A community that answers every ask after `mockAnswerMs`, on the socket it was asked on — and only while that
  // socket is open: an answer to a stopped session is lost, as on the mediator.
  VtiMediatorSession: class {
    readonly record: (typeof mockSessions)[number]
    private readonly onMessage: (m: unknown) => void
    constructor(_agent: unknown, identity: { did: string }, _m: unknown, opts: { onMessage: (m: unknown) => void }) {
      this.record = { did: identity.did, open: false, sent: [] }
      this.onMessage = opts.onMessage
      mockSessions.push(this.record)
    }
    get isOpen() {
      return this.record.open
    }
    async start() {
      this.record.open = true
    }
    async stop() {
      this.record.open = false
    }
    async sendTspFrame() {
      throw new Error('[TrustTasks:VtiMediatorTransport] no TSP in this test')
    }
    async sendTo(_to: string, message: { thid?: string; body?: { type?: string } }) {
      if (!this.record.open) throw new Error('[TrustTasks:VtiMediatorTransport] session stopped')
      this.record.sent.push(message as Record<string, unknown>)
      setTimeout(() => {
        if (!this.record.open) return
        this.onMessage({ type: `${message.body?.type}#response`, thid: message.thid, body: { payload: { items: [] } } })
      }, mockAnswerMs)
    }
  },
}))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({
  frameForm: () => 'short',
  getPeerLegCarriage: () => 'didcomm',
  LOG_PREFIX: '[tsp]',
  greetPeerOverTsp: jest.fn(),
  isFreshV1: () => false,
  packTrustTaskForPeer: jest.fn(),
  tspSessionForPersona: jest.fn(),
  unpackTrustTaskFromPeer: jest.fn(),
  GenericRecordsTspPeerRevisionStore: class {
    async list() {
      return []
    }
  },
}))
jest.mock('../../trust-tasks/module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../../trust-tasks/module/tspProbe', () => ({
  GenericRecordsTspProbeStore: class {},
  runTspProbe: jest.fn(async () => 'skipped'),
}))
// The rooms backend's other legs: none is used by a community listing.
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { roomsClient: jest.fn(async () => undefined), agentAddress: () => undefined },
}))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({ leaveCommunity: jest.fn() }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({ GenericRecordsCommunityStore: class {} }))
jest.mock('../../trust-tasks/module/keyedRecords', () => ({ listKeyed: jest.fn(async () => []), putKeyed: jest.fn() }))
jest.mock('../../directory/names', () => ({ dropDirectoryNames: jest.fn() }))
const mockPersonas: Record<string, unknown> = {}
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    async getPersona(communityDid: string) {
      return mockPersonas[communityDid]
    }
  },
}))

import {
  VTI_FOREGROUND_CLAIM_MS,
  VTI_TURN_AFTER_REFUSALS,
  VtiSessionHeld,
  vtiAgent,
} from '../../trust-tasks/module/vtiAgent'
import { createAgentPollsBackend, isPollsListing } from '../../polls/agentPollsBackend'
import { createAgentRoomsBackend, isRoomsListing } from '../real/agentRoomsBackend'

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never
const persona = (did: string, communityDid: string) =>
  ({ did, communityDid, kmsKeyIds: { keyAgreement: 'ka' }, vtaKeyIds: {} }) as never

const A = { community: 'did:webvh:c:community-a', persona: 'did:webvh:p:aaa' }
const B = { community: 'did:webvh:c:first-vtc', persona: 'did:webvh:p:bbb' }
const MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
const OFFERS = 'https://trusttasks.org/spec/vtc/rooms/offers/list/0.4'

const signIns = () => mockSessions.map((s) => s.did)

// A sign-in waits 2 s for a stale backlog to drain (connectNow); not here.
const realSetTimeout = global.setTimeout
let clock = 1_000_000
beforeAll(() => {
  jest
    .spyOn(global, 'setTimeout')
    .mockImplementation(((fn: () => void, ms?: number) =>
      realSetTimeout(fn, ms === 2000 ? 0 : ms)) as typeof setTimeout)
})
afterAll(() => jest.restoreAllMocks())

beforeEach(async () => {
  await vtiAgent.disconnect()
  mockSessions.length = 0
  mockAnswerMs = 20
  vtiAgent.answerTimeoutMs = 400
  clock = 1_000_000
  vtiAgent.now = () => clock
  // vtiAgent is one for the file and disconnecting keeps its claim, while this clock starts again: an earlier test's claim
  // and refusals would still be running, so whether a test passed depended on what ran before it.
  const state = vtiAgent as unknown as { claim?: unknown; refusedByClaim: Map<string, number> }
  state.claim = undefined
  state.refusedByClaim.clear()
  mockPersonas[A.community] = persona(A.persona, A.community)
  mockPersonas[B.community] = persona(B.persona, B.community)
})
// A test that fails while a hold is up must not leave it to the next: every hold a test takes is let go here.
const releases: Array<() => void> = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  await untilHolds(() => holdsNow() === 0, 'a hold never came down')
  await vtiAgent.disconnect()
})
const holdsNow = () => (vtiAgent as unknown as { holds: Map<unknown, unknown> }).holds.size
/** Waits on what the session's holds have become, and says so if they never do, rather than hanging. */
const untilHolds = async (reached: () => boolean, what: string) => {
  const giveUpAt = Date.now() + 2000
  while (!reached()) {
    if (Date.now() > giveUpAt) throw new Error(`${what} within 2 s`)
    await new Promise((r) => realSetTimeout(r, 1))
  }
}
/**
 * Call before asking for a hold; what it returns waits until that hold is up. A hold goes up after a sign-in, so a fixed
 * wait raced it on a loaded runner: the clock here only moves when a test moves it, so a hold that went up after the test
 * moved it never ran out, and the test hung. It waits for one more hold than now, so a hold already there can't answer.
 */
const nextHold = () => {
  const before = holdsNow()
  return () => untilHolds(() => holdsNow() > before, 'the hold never went up')
}
/** A step's body that runs until the test lets it go (or the test ends). */
const untilReleased = () => {
  let release!: () => void
  const done = new Promise<void>((resolve) => (release = resolve))
  releases.push(release)
  return { done, release }
}

describe("the rooms backend's polls for a phone in two communities", () => {
  it('names the listings it polls, and nothing else', () => {
    expect(isRoomsListing(MEMBERSHIPS)).toBe(true)
    expect(isRoomsListing(OFFERS)).toBe(true)
    expect(isRoomsListing('https://trusttasks.org/spec/vtc/rooms/offers/accept/0.1')).toBe(false)
  })

  // The control: before the holds, this poll signed in 4 times and lost asks to "session stopped".
  it('switches the session once per persona and loses no ask', async () => {
    const backend = createAgentRoomsBackend(agent, { mediatorDid: 'did:peer:lab' })
    const results = await Promise.allSettled([
      backend.communityTask(A.community, MEMBERSHIPS, {}),
      backend.communityTask(B.community, MEMBERSHIPS, {}),
      backend.communityTask(A.community, OFFERS, {}),
      backend.communityTask(B.community, OFFERS, {}),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
    expect(signIns()).toEqual([A.persona, B.persona])
  })

  it('leaves a session a step holds as another identity, and lists that one later', async () => {
    const backend = createAgentRoomsBackend(agent, { mediatorDid: 'did:peer:lab' })
    const { done, release } = untilReleased()
    const holdUp = nextHold()
    const step = vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), () => done, {
      reason: 'vetter round',
    })
    await holdUp()
    await expect(backend.communityTask(B.community, MEMBERSHIPS, {})).rejects.toBeInstanceOf(VtiSessionHeld)
    // The step's persona is listed on the session it holds.
    await expect(backend.communityTask(A.community, MEMBERSHIPS, {})).resolves.toEqual({ items: [] })
    expect(vtiAgent.getState().did).toBe(A.persona)
    release()
    await step
    // Once the step is done, and its claim has run out, the other community is listed as before.
    clock += VTI_FOREGROUND_CLAIM_MS + 1
    await expect(backend.communityTask(B.community, MEMBERSHIPS, {})).resolves.toEqual({ items: [] })
    expect(signIns()).toEqual([A.persona, B.persona])
  })
})

describe('the session claim', () => {
  // vtiPersonaInbox reads the refusal by this name, not by its class (a suite that mocks vtiAgent has no class).
  it('names its refusal VtiSessionHeld', () => {
    expect(new VtiSessionHeld('did:webvh:p:any').name).toBe('VtiSessionHeld')
  })

  it('refuses a background connect as another identity during a hold, and disconnects nothing', async () => {
    const { done, release } = untilReleased()
    const holdUp = nextHold()
    const held = vtiAgent.holding(
      agent,
      'did:peer:lab',
      persona(A.persona, A.community),
      async (did) => {
        await done
        return did
      },
      { reason: 'vetter round' }
    )
    await holdUp()
    const refused = vtiAgent.connect(agent, 'did:peer:lab', {
      persona: persona(B.persona, B.community),
      background: true,
    })
    await expect(refused).rejects.toBeInstanceOf(VtiSessionHeld)
    await expect(refused).rejects.toThrow("kept for another of this phone's identities (vetter round)")
    // The message names no DID: a hold may be a hidden-vetting step's.
    await expect(refused).rejects.not.toThrow(A.persona)
    expect(vtiAgent.getState()).toMatchObject({ status: 'connected', did: A.persona })
    expect(mockSessions.filter((s) => s.open).map((s) => s.did)).toEqual([A.persona])
    release()
    await expect(held).resolves.toBe(A.persona)
  })

  it('refuses a background switch for a while after an ordinary connect, then lets it through', async () => {
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    await expect(
      vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(B.persona, B.community), background: true })
    ).rejects.toBeInstanceOf(VtiSessionHeld)
    expect(vtiAgent.getState().did).toBe(A.persona)
    clock += VTI_FOREGROUND_CLAIM_MS + 1
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(B.persona, B.community), background: true })
    expect(vtiAgent.getState().did).toBe(B.persona)
  })

  it("makes an ordinary connect as another DID wait for a hold to end, and shares one DID's holds", async () => {
    const { done, release } = untilReleased()
    const order: string[] = []
    const holdUp = nextHold()
    const held = vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), async () => {
      await done
      order.push('round done')
    })
    await holdUp()
    // A second hold as the same DID runs beside the first, on the same session.
    await vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), async (did) => {
      order.push(`shared as ${did}`)
    })
    const screen = vtiAgent
      .connect(agent, 'did:peer:lab', { persona: persona(B.persona, B.community) })
      .then(() => order.push(`screen as ${vtiAgent.getState().did}`))
    await new Promise((r) => realSetTimeout(r, 30))
    expect(vtiAgent.getState().did).toBe(A.persona)
    release()
    await Promise.all([held, screen])
    expect(order).toEqual([`shared as ${A.persona}`, 'round done', `screen as ${B.persona}`])
    expect(signIns()).toEqual([A.persona, B.persona])
  })

  it('says when a refused background connect would go through: at once, or when the step lets go', async () => {
    await expect(vtiAgent.whenFree(B.persona)).resolves.toBeUndefined()
    const { done, release } = untilReleased()
    const holdUp = nextHold()
    const held = vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), () => done)
    await holdUp()
    let free = false
    const waited = vtiAgent.whenFree(B.persona).then(() => (free = true))
    await new Promise((r) => realSetTimeout(r, 20))
    expect(free).toBe(false)
    // The step's own claim runs out too before a poll may switch the session.
    clock += VTI_FOREGROUND_CLAIM_MS + 1
    release()
    await Promise.all([held, waited])
    expect(free).toBe(true)
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(B.persona, B.community), background: true })
    expect(vtiAgent.getState().did).toBe(B.persona)
  })

  // 34VR-Y58H (277.8, 11-03): a phone in two communities. Each polls read held the session as one community's identity
  // as an ordinary caller and renewed the claim, and the other community's rooms listing was refused every 30 s for as
  // long as the app was open.
  const poll = (who: { persona: string; community: string }) =>
    vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(who.persona, who.community), background: true })

  // Past whatever claim is running now, within a test.
  const noClaimLeft = () => {
    clock += VTI_FOREGROUND_CLAIM_MS + 1
  }

  it("a listing read that claims nothing leaves no claim: another identity's poll goes through at once", async () => {
    await vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), async () => undefined, {
      reason: 'polls',
      claims: false,
    })
    await poll(B)
    expect(vtiAgent.getState().did).toBe(B.persona)
  })

  it('an ordinary hold that claims leaves the claim behind it (control)', async () => {
    await vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), async () => undefined, {
      reason: 'polls',
    })
    await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    expect(vtiAgent.getState().did).toBe(A.persona)
  })

  it('the polls backend claims nothing on a listing read, and does on a ticket request (the wiring)', async () => {
    const holding = jest.spyOn(vtiAgent, 'holding').mockImplementation(async () => undefined as never)
    try {
      const polls = createAgentPollsBackend(agent, { mediatorDid: 'did:peer:lab' })
      await polls.communityTask(A.community, 'https://trusttasks.org/spec/vtc/elections/list/0.3', {})
      await polls.communityTask(A.community, 'https://trusttasks.org/spec/vtc/elections/show/0.2', {})
      await polls.communityTask(A.community, 'https://trusttasks.org/spec/vtc/elections/tickets/issue/0.1', {})
      await polls.sendCompleted(A.community, {})
      expect(holding.mock.calls.map((call) => call[4]?.claims)).toEqual([false, false, true, true])
    } finally {
      holding.mockRestore()
    }
  })

  it('names the polls listing reads, which claim nothing, and not a ticket request', () => {
    expect(isPollsListing('https://trusttasks.org/spec/vtc/elections/list/0.3')).toBe(true)
    expect(isPollsListing('https://trusttasks.org/spec/vtc/elections/show/0.2')).toBe(true)
    expect(isPollsListing('https://trusttasks.org/spec/vtc/elections/tickets/issue/0.1')).toBe(false)
  })

  it(`gives a poll refused by the claim alone the next turn, after ${VTI_TURN_AFTER_REFUSALS} refusals running`, async () => {
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    for (let i = 0; i < VTI_TURN_AFTER_REFUSALS; i++) await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    // Its turn, with the claim still running: whenFree says so too, so the rooms read again now.
    await expect(vtiAgent.whenFree(B.persona)).resolves.toBeUndefined()
    await poll(B)
    expect(vtiAgent.getState().did).toBe(B.persona)
  })

  it('a claim that ran out and came back does not start the count again: the wait is the same wait', async () => {
    // A identity acting just past the claim's length takes a fresh claim each time, and B is refused between them.
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    for (let i = 0; i < VTI_TURN_AFTER_REFUSALS; i++) {
      await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
      noClaimLeft()
      await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    }
    expect(vtiAgent.getState().did).toBe(A.persona)
    await poll(B)
    expect(vtiAgent.getState().did).toBe(B.persona)
  })

  it('an identity that took a claim starts its own count afresh: it was not waiting', async () => {
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    for (let i = 0; i < VTI_TURN_AFTER_REFUSALS; i++) await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    // B signs in as a step would, then A claims: B's earlier refusals are behind it.
    noClaimLeft()
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(B.persona, B.community) })
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    expect(vtiAgent.getState().did).toBe(A.persona)
  })

  it('renewing the claim does not start the count again: that is what starved the other identity', async () => {
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    for (let i = 0; i < VTI_TURN_AFTER_REFUSALS; i++) {
      await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
      await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    }
    await poll(B)
    expect(vtiAgent.getState().did).toBe(B.persona)
  })

  it('one refusal fewer is still refused (control), and the count starts afresh after a turn', async () => {
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    for (let i = 0; i < VTI_TURN_AFTER_REFUSALS - 1; i++) await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    expect(vtiAgent.getState().did).toBe(A.persona)
    await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    await poll(B)
    expect(vtiAgent.getState().did).toBe(B.persona)
    // A claims the session again: B waits its turn again from nothing.
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(A.persona, A.community) })
    await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    expect(vtiAgent.getState().did).toBe(A.persona)
  })

  it("never gives the turn over a step's hold: refused every time, however often", async () => {
    const { done, release } = untilReleased()
    const holdUp = nextHold()
    const step = vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), () => done, {
      reason: 'a step',
    })
    await holdUp()
    for (let i = 0; i < VTI_TURN_AFTER_REFUSALS + 3; i++) await expect(poll(B)).rejects.toBeInstanceOf(VtiSessionHeld)
    expect(vtiAgent.getState().did).toBe(A.persona)
    release()
    await step
  })

  it('stops keeping others waiting once a hold runs past its time', async () => {
    const { done, release } = untilReleased()
    const holdUp = nextHold()
    const held = vtiAgent.holding(agent, 'did:peer:lab', persona(A.persona, A.community), () => done, { maxMs: 50 })
    await holdUp()
    const screen = vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(B.persona, B.community) })
    clock += 51
    await screen
    expect(vtiAgent.getState().did).toBe(B.persona)
    release()
    await held
  })
})
