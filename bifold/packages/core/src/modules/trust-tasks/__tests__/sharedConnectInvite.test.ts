/**
 * Keyring as the inviter of a shared-connect code (relationship-over-tsp plan WP9, §2.8): the one choke point, the
 * standing rule, the per-code bound, the relationship accept, and the teardown. Every effect is a stand-in here;
 * the codec half (a real upstream scanner's XRFI answered) is sharedConnectInviteTsp.test.ts.
 */
const mockKeyed = new Map<string, Record<string, unknown>>()
jest.mock('../module/keyedRecords', () => ({
  putKeyed: async (_a: unknown, _t: string, _k: string, key: string, value: Record<string, unknown>) =>
    void mockKeyed.set(key, JSON.parse(JSON.stringify(value))),
  getKeyed: async (_a: unknown, _t: string, _k: string, key: string) => mockKeyed.get(key),
  listKeyed: async () => [...mockKeyed.values()],
}))

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import {
  SHARED_CONNECT_EXP_GRACE_MS,
  SHARED_CONNECT_INVITE_MAX_FRAMES,
  SHARED_CONNECT_INVITE_MAX_INVITES,
} from '../module/sharedConnectDecisions'
import { setSharedConnectEnabled, setSharedConnectInviteEnabled } from '../module/sharedConnectFlag'
import {
  buildSharedConnectLink,
  createSharedConnectInvite,
  getSharedConnectInviter,
  newInviteEnactment,
  proposeStanding,
  SharedConnectInviter,
  sweepStaleInvites,
  type InboundFrame,
  type InviteRecord,
  type InviterCeremony,
  type InviterDeps,
  type StandingInput,
} from '../module/sharedConnectInvite'
import { readTrigger, SHARED_CONNECT_MAX_LINK_LENGTH, triggerAction } from '../module/triggerLink'

const ME = 'did:peer:2.Ez6LSinviterAgreement.Vz6MkinviterSigning.SeyJpZCI6IiN0c3AifQ'
const ENACTMENT = 'XOcGXOQTCHb5iz4T2JD2RQ'
const PROPOSE_ID = 'AAECAwQFBgcICQoLDA0ODw'
const T0 = 1_800_000_000_000 // ms
const EXP = T0 / 1000 + 600
const scanner = (n: number) => `did:peer:2.Ez6LSscanner${n}.Vz6Mkscanner${n}`
const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() }
// Distinct bytes per call, as a KMS gives: two codes never share an `_id`.
let randomCalls = 0
const agent = {
  config: { logger },
  kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(++randomCalls % 256) },
} as never

/** A propose as a conforming scanner sends it: every field the standing rule reads, right. */
const proposeFrom = (sender: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: PROPOSE_ID,
  type: propose.TYPE_URI,
  threadId: PROPOSE_ID,
  issuer: sender,
  recipient: ME,
  ceremony: { enactment: ENACTMENT, step: 'propose' },
  payload: { relationshipDid: 'did:peer:0z6MkScannerRel', witnessed: false },
  proof: { type: 'DataIntegrityProof' },
  ...over,
})

/**
 * One inviter on fake effects. Frames are queued by the test (`frames`), each `admit` takes the next one. Timers are
 * a registry, run by hand; `persisted` is every write, in order; `events` interleaves writes and sends, for order.
 */
function rig(options: { record?: Partial<InviteRecord>; deps?: Partial<InviterDeps>; ceremony?: boolean } = {}) {
  let now = T0
  const timers = new Map<number, { fn: () => void; at: number }>()
  let nextTimer = 1
  const persisted: InviteRecord[] = []
  const events: string[] = []
  const frames: InboundFrame[] = []
  const deps: InviterDeps = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimer: (id) => void timers.delete(id as number),
    persist: jest.fn(async (r: InviteRecord) => {
      persisted.push(JSON.parse(JSON.stringify(r)))
      events.push(`persist:${r.state}:${r.invited.length}:${r.accepted ? 'accepted' : '-'}`)
    }),
    open: jest.fn(async () => frames.shift() ?? { kind: 'none' as const }),
    sendAccept: jest.fn(async (vid: string) => void events.push(`xrfa:${vid}`)),
    verifyProof: jest.fn(async (d: Record<string, unknown>) => !(d as { badProof?: boolean }).badProof),
    stopRelay: jest.fn(async () => void events.push('stopRelay')),
    ...options.deps,
  }
  const record: InviteRecord = {
    enactment: ENACTMENT,
    myVid: ME,
    relay: 'did:webvh:relay',
    exp: EXP,
    state: 'waiting',
    invited: [],
    createdAt: new Date(T0).toISOString(),
    ...options.record,
  }
  const inviter = new SharedConnectInviter(agent, record, deps)
  const ceremony = {
    onProposal: jest.fn(async () => void events.push('onProposal')),
    onProposalAgain: jest.fn(async () => void events.push('onProposalAgain')),
    onDocument: jest.fn(async () => void events.push('onDocument')),
  } satisfies InviterCeremony
  if (options.ceremony !== false) inviter.attach(ceremony)
  const admit = (frame: InboundFrame) => {
    frames.push(frame)
    return inviter.admit(new Uint8Array([1]))
  }
  const invite = (sender: string) =>
    admit({ kind: 'invite', sender, digest: new Uint8Array(32).fill(5), revision: 'v1' })
  const doc = (sender: string, document: Record<string, unknown>) =>
    admit({ kind: 'document', sender, document, revision: 'v1' })
  const runTimers = (until: number) => {
    now = until
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= until && timers.has(id)) {
        timers.delete(id)
        t.fn()
      }
    }
  }
  return {
    inviter,
    deps,
    record,
    ceremony,
    persisted,
    events,
    timers,
    admit,
    invite,
    doc,
    runTimers,
    setNow: (ms: number) => (now = ms),
    flush: () => new Promise((r) => setImmediate(r)),
  }
}

/**
 * Nothing went out and nothing moved: the shape of every silent drop. The one write a dropped frame causes is its own
 * count against the code's work budget, written before it is opened: every write after `writesBefore` differs from
 * the record before the act in `handled` alone.
 */
function expectSilent(r: ReturnType<typeof rig>, writesBefore: number) {
  expect(r.deps.sendAccept).not.toHaveBeenCalled()
  expect(r.ceremony.onProposal).not.toHaveBeenCalled()
  expect(r.ceremony.onProposalAgain).not.toHaveBeenCalled()
  expect(r.ceremony.onDocument).not.toHaveBeenCalled()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const strip = ({ handled: _h, ...rest }: InviteRecord) => rest
  const before = writesBefore > 0 ? strip(r.persisted[writesBefore - 1]) : undefined
  const after = r.persisted.slice(writesBefore)
  expect(after.length).toBeLessThanOrEqual(1)
  for (const written of after) expect(strip(written)).toEqual(before)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockKeyed.clear()
  // The inviter runs only with both switches on; the switch's own tests turn them off.
  setSharedConnectEnabled(true)
  setSharedConnectInviteEnabled(true)
})
afterEach(() => {
  setSharedConnectInviteEnabled(false)
  setSharedConnectEnabled(false)
})

// ---- the code -------------------------------------------------------------------------------------------------

describe('the code', () => {
  test("the link is one Keyring's own reader takes as shared-connect, with its _from, _id and _exp", () => {
    setSharedConnectEnabled(true)
    const link = buildSharedConnectLink({ from: ME, id: ENACTMENT, exp: EXP })
    const read = readTrigger(link, { channel: 'scan', now: EXP - 300 })
    expect(read).toMatchObject({ outcome: 'accept', flow: 'shared-connect', from: ME, id: ENACTMENT, exp: EXP })
    expect(read.outcome === 'accept' && read.label).toBeFalsy() // no _label: "no name given"
    expect(triggerAction(read)).toMatchObject({ kind: 'proceed', flow: 'shared-connect' })
  })

  test('a code made from a real-sized encounter DID on the ic3 relay fits the flow budget', () => {
    // As createEncounterDid mints one: E and V keys (48-character multikeys), #didcomm and #tsp naming the relay.
    const relay = 'did:webvh:QmVeszezSFYBaALnaTpwAasz7C29Hgah7U6EeQWyazBUq5:dids.ic3.dev:ic3-mediator'
    const service = (s: object) => 'S' + Buffer.from(JSON.stringify(s)).toString('base64url') // test-side encoding only
    const did = [
      'did:peer:2',
      'Ez6LS' + 'a'.repeat(43),
      'Vz6Mk' + 'b'.repeat(43),
      service({ t: 'dm', s: { uri: relay, a: ['didcomm/v2'] }, id: '#didcomm' }),
      service({ t: 'TSPTransport', s: relay, id: '#tsp' }),
    ].join('.')
    const link = buildSharedConnectLink({ from: did, id: ENACTMENT, exp: EXP })
    expect([...link].length).toBeLessThanOrEqual(SHARED_CONNECT_MAX_LINK_LENGTH)
  })

  test('refuses to build a link from a malformed field (control: the same call with good fields builds)', () => {
    expect(() => buildSharedConnectLink({ from: `${ME}&_exp=9`, id: ENACTMENT, exp: EXP })).toThrow()
    expect(() => buildSharedConnectLink({ from: ME, id: 'short', exp: EXP })).toThrow()
    expect(() => buildSharedConnectLink({ from: ME, id: ENACTMENT, exp: 1.5 })).toThrow()
    expect(() => buildSharedConnectLink({ from: ME, id: ENACTMENT, exp: EXP })).not.toThrow()
  })

  test('_id is 16 random bytes as 22 base64url characters, through Credo, never Buffer', () => {
    const id = newInviteEnactment((n) => new Uint8Array(n).map((_, i) => i * 17))
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(() => newInviteEnactment(() => new Uint8Array(15))).toThrow()
    // The code, not its comments: the app's Buffer has no base64url (jest's Node Buffer does, so only this sees it).
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    // Every source this path runs through, not only the inviter's own file.
    const moduleDir = join(__dirname, '../module')
    const tspDir = join(__dirname, '../../../../../trust-tasks/src/tsp')
    const sources = [
      ...readdirSync(moduleDir)
        .filter((f) => /^sharedConnect.*\.ts$/.test(f) || f === 'vtiTsp.ts')
        .map((f) => join(moduleDir, f)),
      ...readdirSync(tspDir)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(tspDir, f)),
    ]
    expect(sources.length).toBeGreaterThan(10)
    const withBuffer = sources.filter((file) => /\bBuffer\b/.test(code(readFileSync(file, 'utf8'))))
    expect(withBuffer).toEqual([])
    expect(code('/** Buffer */ const x = Buffer.from([])')).toMatch(/\bBuffer\b/) // control: the check bites on code
  })
})

// ---- the standing rule ----------------------------------------------------------------------------------------

describe('the standing rule (§2.8)', () => {
  const base = (): StandingInput => ({
    document: proposeFrom(scanner(1)),
    sender: scanner(1),
    myVid: ME,
    enactment: ENACTMENT,
    exp: EXP,
    nowSeconds: EXP - 60,
    proofOk: true,
    related: true,
    accepted: undefined,
    graceSeconds: SHARED_CONNECT_EXP_GRACE_MS / 1000,
  })

  test('control: a conforming first propose is accepted', () => {
    expect(proposeStanding(base())).toBe('accept')
  })

  test.each([
    ['another type', { document: proposeFrom(scanner(1), { type: `${propose.TYPE_URI}#response` }) }],
    ['a recipient that is not this code', { document: proposeFrom(scanner(1), { recipient: scanner(9) }) }],
    ['an issuer that is not its sender', { document: proposeFrom(scanner(2)) }],
    ['another enactment', { document: proposeFrom(scanner(1), { ceremony: { enactment: 'YOcGXOQTCHb5iz4T2JD2RQ' } }) }],
    ['no ceremony member', { document: proposeFrom(scanner(1), { ceremony: undefined }) }],
    ['an id that is not a challenge', { document: proposeFrom(scanner(1), { id: 'x', threadId: 'x' }) }],
    ['a thread that is not its own id', { document: proposeFrom(scanner(1), { threadId: 'BBECAwQFBgcICQoLDA0ODw' }) }],
    ['a proof that does not verify', { proofOk: false }],
    ['a sender with no relationship', { related: false }],
    ['an expired code', { nowSeconds: EXP + 1 }],
    ['a code already spent on another scanner', { accepted: { theirVid: scanner(2), proposeId: PROPOSE_ID } }],
    [
      'a code spent on another propose of the same scanner',
      { accepted: { theirVid: scanner(1), proposeId: 'BBECAwQFBgcICQoLDA0ODw' } },
    ],
  ])('drops %s', (_why, over) => {
    expect(proposeStanding({ ...base(), ...over } as StandingInput)).toBe('drop')
  })

  test('exactly at _exp is still live; one second past is not', () => {
    expect(proposeStanding({ ...base(), nowSeconds: EXP })).toBe('accept')
    expect(proposeStanding({ ...base(), nowSeconds: EXP + 1 })).toBe('drop')
  })

  test('the accepted propose, re-sent by its scanner, is answered again, through the grace and not after', () => {
    const accepted = { theirVid: scanner(1), proposeId: PROPOSE_ID }
    const grace = SHARED_CONNECT_EXP_GRACE_MS / 1000
    expect(proposeStanding({ ...base(), accepted })).toBe('again')
    expect(proposeStanding({ ...base(), accepted, nowSeconds: EXP + grace })).toBe('again')
    expect(proposeStanding({ ...base(), accepted, nowSeconds: EXP + grace + 1 })).toBe('drop')
    expect(proposeStanding({ ...base(), accepted, proofOk: false })).toBe('drop') // a forged re-send is not one
  })
})

// ---- the choke point ------------------------------------------------------------------------------------------

describe('the choke point: every refusal is silent', () => {
  // One test per reply-shaped exit: each would, if it answered, tell a stranger something about the code.

  test("control: a related scanner's conforming propose is accepted and handed to the ceremony", async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    expect(r.ceremony.onProposal).toHaveBeenCalledTimes(1)
    expect(r.inviter.state).toBe('proposed')
  })

  // Each case: a setup (which may form a relationship, and so send one XRFA), then the act under test. The mocks
  // are cleared between the two, so "nothing sent" is about the act alone.
  type Case = [
    string,
    { setup?: (r: ReturnType<typeof rig>) => Promise<unknown>; act: (r: ReturnType<typeof rig>) => Promise<void> },
  ]
  const related = (r: ReturnType<typeof rig>) => r.invite(scanner(1))
  test.each<Case>([
    ['a propose with no relationship first', { act: (r) => r.doc(scanner(1), proposeFrom(scanner(1))) }],
    [
      'a propose whose proof fails',
      { setup: related, act: (r) => r.doc(scanner(1), proposeFrom(scanner(1), { badProof: true })) },
    ],
    [
      'a propose for another code',
      {
        setup: related,
        act: (r) => r.doc(scanner(1), proposeFrom(scanner(1), { ceremony: { enactment: 'YOcGXOQTCHb5iz4T2JD2RQ' } })),
      },
    ],
    [
      'a propose to another recipient',
      { setup: related, act: (r) => r.doc(scanner(1), proposeFrom(scanner(1), { recipient: scanner(7) })) },
    ],
    [
      'a propose after _exp',
      {
        setup: related,
        act: async (r) => {
          r.setNow((EXP + 1) * 1000)
          await r.doc(scanner(1), proposeFrom(scanner(1)))
        },
      },
    ],
    [
      'a document before any propose was accepted',
      {
        setup: related,
        act: (r) =>
          r.doc(scanner(1), {
            type: 'https://trusttasks.org/spec/vrc/relationships/issue/0.1',
            threadId: PROPOSE_ID,
            recipient: ME,
            ceremony: { enactment: ENACTMENT },
          }),
      },
    ],
    ['a frame with nothing for this code (an accept, a cancel, unreadable)', { act: (r) => r.admit({ kind: 'none' }) }],
    [
      'an invite after _exp',
      {
        act: async (r) => {
          r.setNow((EXP + 1) * 1000)
          await r.invite(scanner(1))
        },
      },
    ],
  ])('%s: nothing sent, nothing handed on, nothing written', async (_why, { setup, act }) => {
    const r = rig()
    await r.inviter.start()
    await setup?.(r)
    jest.clearAllMocks()
    const writes = r.persisted.length
    await act(r)
    expectSilent(r, writes)
  })

  test("a second scanner's propose after the first was accepted: dropped, and the first stands", async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    await r.invite(scanner(2))
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    const writes = r.persisted.length
    ;(r.deps.sendAccept as jest.Mock).mockClear()
    r.ceremony.onProposal.mockClear()
    await r.doc(scanner(2), proposeFrom(scanner(2)))
    expectSilent(r, writes)
    expect(r.inviter.snapshot().accepted?.theirVid).toBe(scanner(1))
  })

  test('the same work for every propose: the proof is checked before the verdict, accepted or dropped', async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    await r.doc(scanner(1), proposeFrom(scanner(1), { ceremony: { enactment: 'YOcGXOQTCHb5iz4T2JD2RQ' } })) // drop
    await r.doc(scanner(1), proposeFrom(scanner(1), { recipient: scanner(7) })) // drop
    await r.doc(scanner(1), proposeFrom(scanner(1))) // accept
    await r.doc(
      scanner(1),
      proposeFrom(scanner(1), { id: 'BBECAwQFBgcICQoLDA0ODw', threadId: 'BBECAwQFBgcICQoLDA0ODw' })
    ) // spent
    expect(r.deps.verifyProof).toHaveBeenCalledTimes(4)
  })

  test('a frame that cannot be opened yet rejects (the relay keeps it), and the next frame is still handled', async () => {
    const r = rig()
    await r.inviter.start()
    ;(r.deps.open as jest.Mock).mockRejectedValueOnce(new Error('resolver offline'))
    await expect(r.inviter.admit(new Uint8Array([1]))).rejects.toThrow('resolver offline')
    await r.invite(scanner(1))
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(1)
  })
})

// ---- the bound ------------------------------------------------------------------------------------------------

describe('the bound: 8 relationships, 1 connection, per code', () => {
  test(`exactly ${SHARED_CONNECT_INVITE_MAX_INVITES} scanners are answered; the next is dropped`, async () => {
    const r = rig()
    await r.inviter.start()
    for (let n = 1; n <= SHARED_CONNECT_INVITE_MAX_INVITES; n++) await r.invite(scanner(n))
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(SHARED_CONNECT_INVITE_MAX_INVITES)
    const writes = r.persisted.length
    await r.invite(scanner(SHARED_CONNECT_INVITE_MAX_INVITES + 1))
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(SHARED_CONNECT_INVITE_MAX_INVITES)
    expect(r.persisted).toHaveLength(writes + 1) // its frame count, and nothing else
    expect(r.persisted[writes].invited).toHaveLength(SHARED_CONNECT_INVITE_MAX_INVITES)
    expect(r.inviter.snapshot().invited).toHaveLength(SHARED_CONNECT_INVITE_MAX_INVITES)
  })

  test('a scanner re-sending its invite (a dropped socket, a re-scan) is answered again and uses no slot', async () => {
    const r = rig()
    await r.inviter.start()
    for (let n = 1; n <= SHARED_CONNECT_INVITE_MAX_INVITES; n++) await r.invite(scanner(n))
    await r.invite(scanner(3)) // at the bound, a known scanner still gets its accept
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(SHARED_CONNECT_INVITE_MAX_INVITES + 1)
    expect(r.inviter.snapshot().invited).toHaveLength(SHARED_CONNECT_INVITE_MAX_INVITES)
  })

  test('the same propose re-sent is the same acceptance: asked once, answered again, no new slot', async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    await r.invite(scanner(1)) // the re-scan re-forms the relationship first
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    expect(r.ceremony.onProposal).toHaveBeenCalledTimes(1)
    expect(r.ceremony.onProposalAgain).toHaveBeenCalledTimes(1)
    expect(r.inviter.snapshot().invited).toEqual([scanner(1)])
  })

  test('once a propose is accepted, no new scanner is answered at all', async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    await r.invite(scanner(2))
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(1)
  })

  test('the bound is in the stored record: a restarted inviter on it still refuses the 9th and the spent code', async () => {
    const first = rig()
    await first.inviter.start()
    for (let n = 1; n <= SHARED_CONNECT_INVITE_MAX_INVITES; n++) await first.invite(scanner(n))
    await first.doc(scanner(1), proposeFrom(scanner(1)))
    const stored = first.persisted[first.persisted.length - 1]
    expect(stored.invited).toHaveLength(SHARED_CONNECT_INVITE_MAX_INVITES)
    expect(stored.accepted?.theirVid).toBe(scanner(1))

    const again = rig({ record: stored })
    await again.inviter.start()
    await again.invite(scanner(SHARED_CONNECT_INVITE_MAX_INVITES + 1))
    await again.doc(scanner(2), proposeFrom(scanner(2)))
    expect(again.deps.sendAccept).not.toHaveBeenCalled()
    expect(again.ceremony.onProposal).not.toHaveBeenCalled()
    // Control: the restarted inviter does answer its accepted scanner's re-sent propose.
    await again.doc(scanner(1), proposeFrom(scanner(1)))
    expect(again.ceremony.onProposalAgain).toHaveBeenCalledTimes(1)
  })

  test(`the work budget: exactly ${SHARED_CONNECT_INVITE_MAX_FRAMES} frames are opened; the next is dropped unopened and the code ends`, async () => {
    const r = rig()
    await r.inviter.start()
    // One related scanner sending proposes the rule drops: each costs a proof check, and no slot would stop it.
    await r.invite(scanner(1))
    for (let n = 2; n <= SHARED_CONNECT_INVITE_MAX_FRAMES; n++)
      await r.doc(scanner(1), proposeFrom(scanner(1), { recipient: scanner(7) }))
    expect(r.deps.open).toHaveBeenCalledTimes(SHARED_CONNECT_INVITE_MAX_FRAMES)
    expect(r.deps.verifyProof).toHaveBeenCalledTimes(SHARED_CONNECT_INVITE_MAX_FRAMES - 1)
    expect(r.inviter.state).toBe('waiting') // at the budget, still showing
    const writes = r.persisted.length
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    await r.invite(scanner(1))
    expect(r.deps.open).toHaveBeenCalledTimes(SHARED_CONNECT_INVITE_MAX_FRAMES)
    expect(r.deps.verifyProof).toHaveBeenCalledTimes(SHARED_CONNECT_INVITE_MAX_FRAMES - 1)
    expect(r.ceremony.onProposal).not.toHaveBeenCalled()
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(1)
    // The first frame past it ends the code, so the screen can say "make a new code": one final write, the relay
    // stopped, and nothing sent to anyone. The frame after that is dropped unopened by the end itself.
    expect([r.inviter.state, r.inviter.failure]).toEqual(['failed', 'exhausted'])
    expect(r.persisted).toHaveLength(writes + 1)
    expect(r.persisted[writes]).toMatchObject({
      state: 'failed',
      failure: 'exhausted',
      handled: SHARED_CONNECT_INVITE_MAX_FRAMES,
    })
    expect(r.deps.stopRelay).toHaveBeenCalledTimes(1)
  })

  test('the work budget is in the stored record: a restarted inviter on a spent budget opens nothing', async () => {
    const spent = rig({ record: { handled: SHARED_CONNECT_INVITE_MAX_FRAMES } })
    await spent.inviter.start()
    await spent.invite(scanner(1))
    expect(spent.deps.open).not.toHaveBeenCalled()
    expect(spent.inviter.failure).toBe('exhausted')
    // Control: one frame under the budget is opened.
    const under = rig({ record: { handled: SHARED_CONNECT_INVITE_MAX_FRAMES - 1 } })
    await under.inviter.start()
    await under.invite(scanner(1))
    expect(under.deps.open).toHaveBeenCalledTimes(1)
  })

  test('the budget sits above the worst legitimate case, frames that open to nothing included', () => {
    // A static check on a constant: it documents the tally the number rests on (sharedConnectDecisions).
    const scanners = SHARED_CONNECT_INVITE_MAX_INVITES * 2 * 2 // XRFI + propose each, each re-sent once
    const ceremony = 2 * 2 // the accepted scanner's receipt and issue, each re-sent once
    const duplicated = (scanners + ceremony) * 2 // the relay delivering every frame twice
    const nothing = 8 // cancels, unreadable frames: counted before they are classified
    expect(duplicated + nothing).toBe(80)
    expect(SHARED_CONNECT_INVITE_MAX_FRAMES).toBeGreaterThan(duplicated + nothing)
  })

  test('a frame whose count cannot be written is not opened', async () => {
    let fail = false
    const r = rig({
      deps: {
        persist: jest.fn(async () => {
          if (fail) throw new Error('store busy')
        }),
      },
    })
    await r.inviter.start()
    fail = true
    await r.invite(scanner(1))
    expect(r.deps.open).not.toHaveBeenCalled()
    expect(r.inviter.snapshot().handled ?? 0).toBe(0)
  })

  test('a count that cannot be written is not answered, and not counted', async () => {
    let fail = false
    const r = rig({
      deps: {
        persist: jest.fn(async () => {
          if (fail) throw new Error('store busy')
        }),
      },
    })
    await r.inviter.start()
    fail = true
    await r.invite(scanner(1))
    expect(r.deps.sendAccept).not.toHaveBeenCalled()
    expect(r.inviter.snapshot().invited).toEqual([])
    fail = false
    await r.invite(scanner(1))
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(1)
  })
})

// ---- the relationship accept ----------------------------------------------------------------------------------

describe('XRFI answered with XRFA', () => {
  test('the accept names the invite and goes back in its version', async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    expect(r.deps.sendAccept).toHaveBeenCalledWith(scanner(1), new Uint8Array(32).fill(5), 'v1')
  })

  test('a duplicate invite gets a duplicate accept, from one slot', async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    await r.invite(scanner(1))
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(2)
    expect(r.inviter.snapshot().invited).toEqual([scanner(1)])
  })

  test('an invite after the end is dropped unopened', async () => {
    const r = rig()
    await r.inviter.start()
    await r.inviter.cancel()
    await r.invite(scanner(1))
    expect(r.deps.open).not.toHaveBeenCalled()
    expect(r.deps.sendAccept).not.toHaveBeenCalled()
  })

  test('an invite arriving before the code is first written waits for the write, and is answered after it', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const r = rig({
      deps: {
        persist: jest.fn(async (rec: InviteRecord) => {
          if (rec.invited.length === 0) await gate
        }),
      },
    })
    const started = r.inviter.start()
    const answered = r.invite(scanner(1))
    await r.flush()
    expect(r.deps.open).not.toHaveBeenCalled()
    expect(r.deps.sendAccept).not.toHaveBeenCalled()
    release()
    await started
    await answered
    expect(r.deps.sendAccept).toHaveBeenCalledTimes(1)
  })

  test('the count is written before the accept goes out; an accepted propose before the ceremony hears of it', async () => {
    const r = rig()
    await r.inviter.start()
    r.events.length = 0
    await r.invite(scanner(1))
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    expect(r.events).toEqual([
      'persist:waiting:0:-', // the invite's frame, counted before it is opened
      'persist:waiting:1:-', // the scanner, counted before it is answered
      `xrfa:${scanner(1)}`,
      'persist:waiting:1:-', // the propose's frame, counted before it is opened
      'persist:proposed:1:accepted', // the acceptance, written before the ceremony hears of it
      'onProposal',
    ])
  })
})

// ---- the end --------------------------------------------------------------------------------------------------

describe('teardown', () => {
  test('cancel twice: one ending, one relay stop, one final write, listeners gone, no timers left', async () => {
    const r = rig()
    await r.inviter.start()
    const seen: string[] = []
    r.inviter.subscribe((s) => seen.push(s))
    expect(r.timers.size).toBe(1) // the expiry
    const writes = r.persisted.length
    await Promise.all([r.inviter.cancel(), r.inviter.cancel()])
    await r.inviter.cancel()
    expect(r.deps.stopRelay).toHaveBeenCalledTimes(1)
    expect(r.persisted).toHaveLength(writes + 1)
    expect(r.persisted[r.persisted.length - 1].state).toBe('cancelled')
    expect(seen).toEqual(['cancelled'])
    expect(r.timers.size).toBe(0)
    expect(getSharedConnectInviter(ENACTMENT)).toBeUndefined()
  })

  test('expiry first, then cancel: ends expired, once', async () => {
    const r = rig()
    await r.inviter.start()
    r.runTimers(EXP * 1000)
    await r.inviter.cancel()
    await r.flush()
    expect(r.inviter.state).toBe('expired')
    expect(r.deps.stopRelay).toHaveBeenCalledTimes(1)
    expect(r.timers.size).toBe(0)
  })

  test('cancel first, then the expiry moment passes: ends cancelled, once, and the timer was cleared', async () => {
    const r = rig()
    await r.inviter.start()
    await r.inviter.cancel()
    r.runTimers(EXP * 1000 + SHARED_CONNECT_EXP_GRACE_MS + 1)
    await r.flush()
    expect(r.inviter.state).toBe('cancelled')
    expect(r.deps.stopRelay).toHaveBeenCalledTimes(1)
  })

  test('both at once (the expiry fires while a cancel is ending) converge on one ending', async () => {
    const r = rig()
    await r.inviter.start()
    const cancelling = r.inviter.cancel()
    r.runTimers(EXP * 1000)
    await cancelling
    await r.flush()
    expect(r.deps.stopRelay).toHaveBeenCalledTimes(1)
    expect(r.persisted.filter((p) => ['cancelled', 'expired'].includes(p.state))).toHaveLength(1)
  })

  test('an accepted code is kept through the grace after _exp, then ends', async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    await r.inviter.advance('connecting')
    r.runTimers(EXP * 1000)
    expect(r.inviter.state).toBe('connecting')
    r.runTimers(EXP * 1000 + SHARED_CONNECT_EXP_GRACE_MS)
    await r.flush()
    expect(r.inviter.state).toBe('failed')
    expect(r.inviter.failure).toBe('unknown')
    expect(r.timers.size).toBe(0)
  })

  test('a waiting code ends expired at _exp', async () => {
    const r = rig()
    await r.inviter.start()
    r.runTimers(EXP * 1000 - 1)
    expect(r.inviter.state).toBe('waiting')
    r.runTimers(EXP * 1000)
    await r.flush()
    expect(r.inviter.state).toBe('expired')
  })

  test('a code that ends while a frame is being opened writes nothing more for it: one final write', async () => {
    let release!: (f: InboundFrame) => void
    const r = rig({
      deps: {
        open: jest.fn(() => new Promise<InboundFrame>((resolve) => (release = resolve))),
      },
    })
    await r.inviter.start()
    const handling = r.inviter.admit(new Uint8Array([1]))
    await r.flush()
    await r.inviter.cancel()
    const writesAtEnd = r.persisted.length
    release({ kind: 'invite', sender: scanner(1), digest: new Uint8Array(32).fill(5), revision: 'v1' })
    await handling
    expect(r.persisted).toHaveLength(writesAtEnd)
    expect(r.persisted[writesAtEnd - 1].state).toBe('cancelled')
    expect(r.inviter.snapshot().invited).toEqual([])
    expect(r.deps.sendAccept).not.toHaveBeenCalled()
  })

  test('a frame being handled when the code ends sends nothing after the end', async () => {
    let release!: () => void
    const r = rig({
      deps: {
        verifyProof: jest.fn(() => new Promise<boolean>((resolve) => (release = () => resolve(true)))),
      },
    })
    await r.inviter.start()
    await r.invite(scanner(1))
    const handling = r.doc(scanner(1), proposeFrom(scanner(1)))
    await r.flush()
    await r.inviter.cancel()
    release()
    await handling
    expect(r.ceremony.onProposal).not.toHaveBeenCalled()
    expect(r.inviter.snapshot().accepted).toBeUndefined()
  })
})

// ---- making a code --------------------------------------------------------------------------------------------

describe('making a code', () => {
  const relay = () => ({
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    sendTspFrame: jest.fn(),
  })
  const baseDeps = (r = relay()) => ({
    resolveMediator: jest.fn(async () => ({ did: 'did:webvh:relay', wsEndpoint: 'wss://relay' }) as never),
    createDid: jest.fn(async () => ME),
    tspIdentity: jest.fn(async () => ({}) as never),
    openRelay: jest.fn(async () => r),
    persist: jest.fn(
      async (_a: unknown, rec: InviteRecord) => void mockKeyed.set(rec.enactment, JSON.parse(JSON.stringify(rec)))
    ),
  })

  test('mints, writes, opens the relay, and shows the link; then cancels cleanly', async () => {
    const r = relay()
    const deps = baseDeps(r)
    const made = await createSharedConnectInvite(agent, { now: () => T0, deps })
    expect(made.kind).toBe('showing')
    if (made.kind !== 'showing') return
    expect(made.exp).toBe(EXP)
    expect(made.link).toBe(buildSharedConnectLink({ from: ME, id: made.inviter.enactment, exp: EXP }))
    expect(made.inviter.state).toBe('waiting')
    expect(deps.persist.mock.calls.map((c) => (c[1] as InviteRecord).state)).toEqual(['minting', 'waiting'])
    await made.inviter.cancel()
    expect(r.stop).toHaveBeenCalledTimes(1)
  })

  test('a relay that will not open is `failed: relay`, with the code ended and nothing registered', async () => {
    const r = relay()
    r.start.mockRejectedValue(new Error('socket'))
    const made = await createSharedConnectInvite(agent, { now: () => T0, deps: baseDeps(r) })
    expect(made).toEqual({ kind: 'failed', failure: 'relay' })
    const stored = [...mockKeyed.values()][0] as unknown as InviteRecord
    expect(stored.state).toBe('failed')
    expect(getSharedConnectInviter(stored.enactment)).toBeUndefined()
    expect(r.stop).toHaveBeenCalledTimes(1)
  })

  test('a mediator that cannot be resolved is `failed: relay`, before anything is written', async () => {
    const deps = baseDeps()
    deps.resolveMediator.mockRejectedValue(new Error('dns'))
    expect(await createSharedConnectInvite(agent, { deps })).toEqual({ kind: 'failed', failure: 'relay' })
    expect(deps.persist).not.toHaveBeenCalled()
  })

  test('asks for at most ten minutes, whatever the screen asks', async () => {
    const made = await createSharedConnectInvite(agent, { now: () => T0, ttlSeconds: 3600, deps: baseDeps() })
    expect(made.kind === 'showing' && made.exp).toBe(EXP)
    if (made.kind === 'showing') await made.inviter.cancel()
  })

  test("a code left 'waiting' by a closed app is swept to cancelled; a live one is not", async () => {
    const made = await createSharedConnectInvite(agent, { now: () => T0, deps: baseDeps() })
    mockKeyed.set('orphan', { enactment: 'orphan', state: 'waiting', invited: [] })
    mockKeyed.set('done', { enactment: 'done', state: 'connected', invited: [] })
    expect(await sweepStaleInvites(agent)).toBe(1)
    expect(mockKeyed.get('orphan')?.state).toBe('cancelled')
    expect(mockKeyed.get('done')?.state).toBe('connected')
    if (made.kind === 'showing') {
      expect(mockKeyed.get(made.inviter.enactment)?.state).toBe('waiting')
      await made.inviter.cancel()
    }
  })
})

// ---- the switch -----------------------------------------------------------------------------------------------

describe('the switch governs the function, not only the button', () => {
  const relay = () => ({
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    sendTspFrame: jest.fn(),
  })
  const deps = (r = relay()) => ({
    resolveMediator: jest.fn(async () => ({ did: 'did:webvh:relay', wsEndpoint: 'wss://relay' }) as never),
    createDid: jest.fn(async () => ME),
    tspIdentity: jest.fn(async () => ({}) as never),
    openRelay: jest.fn(async () => r),
    persist: jest.fn(async () => undefined),
  })

  test('on: a code starts (control)', async () => {
    const d = deps()
    const made = await createSharedConnectInvite(agent, { now: () => T0, deps: d })
    expect(made.kind).toBe('showing')
    expect(d.openRelay).toHaveBeenCalledTimes(1)
    if (made.kind === 'showing') await made.inviter.cancel()
  })

  test.each([
    ['the inviter switch off', () => setSharedConnectInviteEnabled(false)],
    ['the shared-connect switch under it off', () => setSharedConnectEnabled(false)],
  ])('%s: nothing starts: no DID minted, no relay login, nothing written', async (_why, off) => {
    off()
    const d = deps()
    expect(await createSharedConnectInvite(agent, { now: () => T0, deps: d })).toEqual({ kind: 'off' })
    expect(d.resolveMediator).not.toHaveBeenCalled()
    expect(d.createDid).not.toHaveBeenCalled()
    expect(d.openRelay).not.toHaveBeenCalled()
    expect(d.persist).not.toHaveBeenCalled()
  })

  test('off: an inbound XRFI is ignored, unopened, and the code ends', async () => {
    const r = rig()
    await r.inviter.start()
    setSharedConnectInviteEnabled(false)
    jest.clearAllMocks()
    await r.invite(scanner(1))
    expect(r.deps.open).not.toHaveBeenCalled()
    expect(r.deps.sendAccept).not.toHaveBeenCalled()
    expect(r.inviter.state).toBe('cancelled')
  })

  test('a code rebuilt from its stored record while the switch is off answers nothing (no toggle event fires)', async () => {
    const first = rig()
    await first.inviter.start()
    await first.invite(scanner(1))
    const stored = first.persisted[first.persisted.length - 1]
    await first.inviter.cancel()
    setSharedConnectInviteEnabled(false) // already off when the rebuilt code starts: only the per-frame check stops it
    const again = rig({ record: { ...stored, state: 'waiting' } })
    await again.inviter.start()
    await again.invite(scanner(1))
    expect(again.deps.open).not.toHaveBeenCalled()
    expect(again.deps.sendAccept).not.toHaveBeenCalled()
    expect(again.inviter.state).toBe('cancelled')
  })

  test('off: an inbound propose is ignored too, even from a scanner already answered', async () => {
    const r = rig()
    await r.inviter.start()
    await r.invite(scanner(1))
    setSharedConnectInviteEnabled(false)
    jest.clearAllMocks()
    await r.doc(scanner(1), proposeFrom(scanner(1)))
    expect(r.deps.open).not.toHaveBeenCalled()
    expect(r.ceremony.onProposal).not.toHaveBeenCalled()
  })

  test.each([
    ['its own switch', () => setSharedConnectInviteEnabled(false)],
    ['the shared-connect switch', () => setSharedConnectEnabled(false)],
  ])('turning %s off mid-session ends every live code at once: relay stopped, timers cleared', async (_why, off) => {
    const r1 = relay()
    const r2 = relay()
    const a = await createSharedConnectInvite(agent, { now: () => T0, deps: deps(r1) })
    const b = await createSharedConnectInvite(agent, { now: () => T0, deps: deps(r2) })
    if (a.kind !== 'showing' || b.kind !== 'showing') throw new Error('codes did not start')
    off()
    await new Promise((resolve) => setImmediate(resolve))
    expect([a.inviter.state, b.inviter.state]).toEqual(['cancelled', 'cancelled'])
    expect([r1.stop.mock.calls.length, r2.stop.mock.calls.length]).toEqual([1, 1])
    expect(getSharedConnectInviter(a.inviter.enactment)).toBeUndefined()
  })

  test('control: setting the switch on again, or on while on, ends nothing', async () => {
    const made = await createSharedConnectInvite(agent, { now: () => T0, deps: deps() })
    if (made.kind !== 'showing') throw new Error('code did not start')
    setSharedConnectInviteEnabled(true)
    setSharedConnectEnabled(true)
    await new Promise((resolve) => setImmediate(resolve))
    expect(made.inviter.state).toBe('waiting')
    await made.inviter.cancel()
  })

  test('switched off while the relay was logging in: it is closed once, and nothing shows', async () => {
    const r = relay()
    r.start.mockImplementation(async () => {
      setSharedConnectInviteEnabled(false) // the person flips the switch while the socket connects
    })
    expect(await createSharedConnectInvite(agent, { now: () => T0, deps: deps(r) })).toEqual({ kind: 'off' })
    expect(r.stop).toHaveBeenCalledTimes(1)
  })

  test('switched off before the relay was handed back: the relay that arrives late is closed, and nothing shows', async () => {
    const r = relay()
    const d = deps(r)
    d.openRelay.mockImplementation(async () => {
      setSharedConnectInviteEnabled(false) // the code ends while openRelay is still running: no handle to stop yet
      return r
    })
    expect(await createSharedConnectInvite(agent, { now: () => T0, deps: d })).toEqual({ kind: 'off' })
    expect(r.stop).toHaveBeenCalledTimes(1)
  })
})
