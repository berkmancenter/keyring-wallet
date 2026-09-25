/**
 * A first link whose key-swap answer is lost must leave a linked phone, not a
 * stranded one (measured on a device, 2026-09-25: the VTA swapped, the answer
 * was dropped, and after a relaunch the phone said "not linked" while the
 * agent held its new key).
 *
 * The phone is linked from the moment the agent granted its temporary key;
 * the swap only moves that grant. So the link is remembered before the swap is
 * sent, and whichever key the agent holds is settled by the next connect —
 * this session's, or a relaunch's. A fresh link attempt with a swap still
 * pending for the same agent settles it first, and never overwrites a key the
 * agent may hold.
 *
 * The VTA is the fake with an ACL from vtaSwapKeyRecovery.test.ts, plus an
 * expired grant (the temporary key's hour lapses; the swap does not carry its
 * expiry over, vta-service `acl.rs`), and a VTA that goes quiet after a swap.
 */
const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'
const SWAP = 'https://trusttasks.org/spec/acl/swap-key/0.1'
const VTA = 'did:webvh:vta'
const CURRENT = 'did:peer:2.current'
const NEXT = 'did:peer:2.next'

type Plain = { from: string; body: { type: string; payload: Record<string, unknown> } }

const mockVta = {
  acl: new Set<string>(),
  /** Perform a swap when asked. */
  performSwap: true,
  /** Say nothing in answer to a swap (performed or not). */
  dropSwapAnswer: false,
  /** Answer nothing at all. */
  down: false,
  /** Answer nothing from these senders. */
  silentFor: new Set<string>(),
  asked: [] as { from: string; type: string }[],
  /** Keys whose grant has lapsed: refused as "ACL entry expired", the way check_acl_entry words it. */
  expired: new Set<string>(),
  /** Stop answering anyone once a swap has been performed. */
  downAfterSwap: false,
  /** Called as a swap arrives — the moment a test "kills the app". */
  onSwap: undefined as undefined | (() => void),
}
const mockSessions: { did: string; onMessage: (m: unknown) => void; open: boolean }[] = []

function mockAnswer(session: { onMessage: (m: unknown) => void }, type: string, payload: Record<string, unknown>) {
  setTimeout(
    () =>
      session.onMessage({
        type: ENVELOPE,
        created_time: Math.floor(Date.now() / 1000),
        body: { type, payload },
      }),
    0
  )
}

jest.mock('@bifold/trust-tasks', () => ({
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
  tsp: { CODEC_FORMS_RELATIONSHIPS: false },
  signDocumentProof: jest.fn(async (_a: unknown, doc: Record<string, unknown>) => doc),
  signCompactJws: jest.fn(async () => 'header.payload.sig'),
}))
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtiTsp', () => ({
  tspSessionForManager: jest.fn(async () => {
    throw new Error('no TSP in this test')
  }),
  packTrustTaskForPeer: jest.fn(),
  unpackTrustTaskFromPeer: jest.fn(),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.next'),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did })),
  resolveDidDocumentRetrying: jest.fn(async () => ({
    service: [{ type: 'DIDCommMessaging', serviceEndpoint: 'did:peer:2.mediator' }],
  })),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  VtiMediatorSession: class {
    readonly record: (typeof mockSessions)[number]
    constructor(_agent: unknown, identity: { did: string }, _m: unknown, opts: { onMessage: (m: unknown) => void }) {
      this.record = { did: identity.did, onMessage: opts.onMessage, open: false }
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
    async sendTo(_to: string, message: Plain) {
      const { from, body } = message
      mockVta.asked.push({ from, type: body.type })
      if (mockVta.down || mockVta.silentFor.has(from)) return
      if (mockVta.expired.has(from)) {
        mockAnswer(this.record, 'https://trusttasks.org/spec/trust-task-error/0.1', {
          code: 'permissionDenied',
          message: `forbidden: ACL entry expired: ${from}`,
        })
        return
      }
      if (!mockVta.acl.has(from)) {
        mockAnswer(this.record, 'https://trusttasks.org/spec/trust-task-error/0.1', {
          code: 'permissionDenied',
          message: `forbidden: DID not in ACL: ${from}`,
        })
        return
      }
      if (body.type === WHOAMI) {
        mockAnswer(this.record, `${WHOAMI}#response`, { roles: ['admin'] })
        return
      }
      if (body.type === SWAP) {
        mockVta.onSwap?.()
        const newSubject = String(body.payload.newSubject)
        if (mockVta.performSwap) {
          // swap_acl: create the new entry, then delete the caller's.
          mockVta.acl.add(newSubject)
          mockVta.acl.delete(from)
          if (mockVta.downAfterSwap) mockVta.down = true
        }
        if (!mockVta.dropSwapAnswer)
          mockAnswer(this.record, `${SWAP}#response`, { entry: { subject: newSubject }, previousSubject: from })
      }
    }
  },
}))

import type { EnrolmentOffer } from '@bifold/trust-tasks'

// The controller's own client, with a fast clock: no drain, short waits for
// the swap's answer and for each probe.
jest.mock('../module/VtaClient', () => {
  const actual = jest.requireActual('../module/VtaClient')
  class FastVtaClient extends actual.VtaClient {
    constructor(a: unknown, vtaDid: string, store: unknown, options: Record<string, unknown> = {}) {
      super(a, vtaDid, store, {
        connectDrainMs: 0,
        swapTimeoutMs: 50,
        probeTimeoutMs: 50,
        consentWaitMs: 0,
        ...options,
      })
    }
  }
  return { ...actual, VtaClient: FastVtaClient }
})

import { setVtaSwapTestHook } from '../module/VtaClient'
import type { VtaLink } from '../module/VtaLinkStore'
import type { VtiManagerIdentity } from '../module/VtiIdentityStore'
import { VtaAgentController } from '../module/vtaAgent'

const offer: EnrolmentOffer = {
  v: 1,
  t: 'vta-enrol',
  vta: VTA,
  label: 'Lab agent',
  url: 'http://page/api/offers/n',
  n: 'NONCE0123456789ABCD',
  exp: 2_000_000_000,
}

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never

const temporary: VtiManagerIdentity = {
  vtaDid: VTA,
  did: CURRENT,
  createdAt: '2026-09-25T00:00:00Z',
  stage: 'temporary',
}
const pending: VtiManagerIdentity = { ...temporary, pendingNext: { did: NEXT, createdAt: '2026-09-25T00:01:00Z' } }

/** The phone's two stores, as the wallet keeps them across a relaunch. */
function phone(initial: { manager?: VtiManagerIdentity; link?: VtaLink } = {}) {
  const disk = { manager: initial.manager, link: initial.link }
  const identities = {
    getManager: jest.fn(async () => disk.manager),
    setManager: jest.fn(async (m: VtiManagerIdentity) => {
      disk.manager = { ...m }
    }),
    forgetManager: jest.fn(async () => {
      disk.manager = undefined
    }),
  }
  const links = {
    get: async () => disk.link,
    set: async (link: VtaLink) => {
      disk.link = { ...link }
    },
    clear: async () => {
      disk.link = undefined
    },
  }
  // The admin grants the temporary key the phone submitted.
  const submit = jest.fn(async (_a: unknown, o: EnrolmentOffer, store: typeof identities) => {
    await store.setManager({ vtaDid: o.vta, did: CURRENT, createdAt: new Date().toISOString(), stage: 'temporary' })
    return { did: CURRENT, code: 'ABCD-EFGH' }
  })
  const waitForGrant = jest.fn(async () => {
    mockVta.acl.add(CURRENT)
  })
  const launch = () => {
    const vta = new VtaAgentController()
    vta.configure({
      linkStore: () => links,
      identityStore: () => identities as never,
      enrol: { submit: submit as never, waitForGrant: waitForGrant as never },
    })
    return vta
  }
  return { disk, submit, waitForGrant, launch }
}

/** Wait for a condition, in 10 ms steps (the test setup pins Date, so it is counted, not timed). */
async function until(done: () => boolean, ms = 4000) {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > ms) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const online = (vta: VtaAgentController) => {
  const link = vta.getState().link
  return link.kind === 'linked' && link.connection.kind === 'online'
}

let alive: VtaAgentController[] = []
function track(vta: VtaAgentController) {
  alive.push(vta)
  return vta
}

beforeEach(() => {
  mockVta.acl = new Set()
  mockVta.performSwap = true
  mockVta.dropSwapAnswer = false
  mockVta.down = false
  mockVta.silentFor = new Set()
  mockVta.asked = []
  mockVta.expired = new Set()
  mockVta.downAfterSwap = false
  mockVta.onSwap = undefined
  mockSessions.length = 0
  setVtaSwapTestHook(undefined)
})

afterEach(async () => {
  // Stop every retry timer a controller left behind.
  for (const vta of alive) await vta.unlink(agent).catch(() => undefined)
  alive = []
})

describe('a first link whose swap answer is lost', () => {
  it('app killed after the agent swapped: the relaunch is linked, as the new key, nothing pending', async () => {
    const first = phone()
    // Kill the app the moment the swap reaches the agent: what is on disk then
    // is all a relaunch has.
    let atKill: { manager?: VtiManagerIdentity; link?: VtaLink } | undefined
    mockVta.onSwap = () => {
      atKill = JSON.parse(JSON.stringify(first.disk))
    }
    mockVta.dropSwapAnswer = true
    const before = track(first.launch())
    before.scanOffer(offer)
    await before.confirmOffer(agent)
    expect(mockVta.acl).toEqual(new Set([NEXT]))

    const relaunched = phone(atKill)
    const vta = track(relaunched.launch())
    await vta.restore(agent)
    await until(() => online(vta))

    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA, label: offer.label })
    expect(relaunched.disk.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
    expect(relaunched.disk.manager?.pendingNext).toBeUndefined()
    expect(vta.getState().managerDid).toBe(NEXT)
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/a key swap is pending on connect/))
  })

  it('in session (the device hook drop-and-stop): linked, not "didn\'t answer", and settled onto the new key', async () => {
    setVtaSwapTestHook('drop-and-stop')
    const p = phone()
    const vta = track(p.launch())
    vta.scanOffer(offer)
    await vta.confirmOffer(agent)

    // Never the failure screen for a swap the agent performed.
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(p.disk.link).toMatchObject({ vtaDid: VTA, label: offer.label })
    await until(() => online(vta))
    expect(p.disk.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
    expect(p.disk.manager?.pendingNext).toBeUndefined()
  })

  it('neither key answers: linked but offline, both keys kept, and it settles once the agent is back', async () => {
    // The agent swaps, and goes quiet before its answer leaves.
    mockVta.downAfterSwap = true
    mockVta.dropSwapAnswer = true
    const p = phone()
    const vta = track(p.launch())
    vta.scanOffer(offer)
    await vta.confirmOffer(agent)
    await until(() => {
      const link = vta.getState().link
      return link.kind === 'linked' && link.connection.kind === 'reconnecting'
    })

    expect(p.disk.link).toMatchObject({ vtaDid: VTA })
    expect(p.disk.manager).toMatchObject({ did: CURRENT, pendingNext: { did: NEXT } })

    mockVta.down = false
    await until(() => online(vta))
    expect(p.disk.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
  })

  it('the temporary key expired before the swap settled, and the agent never wrote the new one: not linked — link again, with Details', async () => {
    const first = phone()
    let atKill: { manager?: VtiManagerIdentity; link?: VtaLink } | undefined
    mockVta.onSwap = () => {
      atKill = JSON.parse(JSON.stringify(first.disk))
    }
    mockVta.performSwap = false
    mockVta.dropSwapAnswer = true
    const before = track(first.launch())
    before.scanOffer(offer)
    await before.confirmOffer(agent)

    // Relaunched after the temporary key's hour: the agent refuses it as
    // expired, and refuses the successor it never wrote.
    mockVta.acl.delete(CURRENT)
    mockVta.expired.add(CURRENT)
    const relaunched = phone(atKill)
    const vta = track(relaunched.launch())
    await vta.restore(agent)
    await until(() => vta.getState().link.kind !== 'linked')

    expect(vta.getState().link).toMatchObject({
      kind: 'notLinked',
      lastError: { reason: 'failed', detail: expect.stringMatching(/neither/) },
    })
    expect(relaunched.disk.link).toBeUndefined()
    // No retry: nothing is asked again.
    const asked = mockVta.asked.length
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(mockVta.asked).toHaveLength(asked)
  })
})

describe('a later swap, from a permanent key', () => {
  it('refused both ways: revoked, as before — not "link again"', async () => {
    // A working link rotated again and lost that answer; meanwhile the admin
    // took the phone off the ACL. Neither key is on it: that is a revocation.
    const p = phone({
      manager: { ...pending, stage: 'permanent' },
      link: { vtaDid: VTA, label: 'Lab agent', linkedAt: '2026-09-25T00:02:00Z' },
    })
    const vta = track(p.launch())
    await vta.restore(agent)
    await until(() => vta.getState().link.kind === 'revoked')

    expect(vta.getState().link).toMatchObject({ kind: 'revoked', vtaDid: VTA })
    expect(p.disk.manager).toMatchObject({ did: CURRENT, pendingNext: { did: NEXT } })
  })
})

describe('a fresh link with an earlier swap still pending for the same agent', () => {
  it('the agent knows the successor: adopted, linked, no new grant asked for', async () => {
    mockVta.acl = new Set([NEXT])
    const p = phone({ manager: pending })
    const vta = track(p.launch())
    vta.scanOffer(offer)
    await vta.confirmOffer(agent)

    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA, connection: { kind: 'online' } })
    expect(p.submit).not.toHaveBeenCalled()
    expect(p.waitForGrant).not.toHaveBeenCalled()
    expect(p.disk.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
    expect(p.disk.link).toMatchObject({ vtaDid: VTA, label: offer.label })
    expect(mockVta.asked.some((a) => a.type === SWAP)).toBe(false)
  })

  it('the same, linking by hand: linked without showing a new key', async () => {
    mockVta.acl = new Set([NEXT])
    const p = phone({ manager: pending })
    const vta = track(p.launch())
    await vta.startManualLink(agent, VTA, 'vta host')

    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(p.disk.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
  })

  it('the agent cannot be asked: the attempt fails, and both keys stay on record', async () => {
    mockVta.down = true
    const p = phone({ manager: pending })
    const vta = track(p.launch())
    vta.scanOffer(offer)
    await vta.confirmOffer(agent)

    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason: 'unreachable' } })
    expect(p.submit).not.toHaveBeenCalled()
    expect(p.disk.manager).toEqual(pending)
  })

  it('the agent refuses both keys: nothing live is left, so it links afresh', async () => {
    const p = phone({ manager: pending })
    const vta = track(p.launch())
    vta.scanOffer(offer)
    await vta.confirmOffer(agent)

    expect(p.submit).toHaveBeenCalled()
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
    expect(p.disk.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
  })
})
