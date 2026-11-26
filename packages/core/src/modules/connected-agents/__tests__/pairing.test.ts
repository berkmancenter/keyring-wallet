/**
 * The pairing machine (plan §3.2, §3.10, §7.2) with every dependency faked: the clock, the resolver, the
 * `auth/oob` transport (a fake until VTI serves `deviceEnrol`, ledger AC-36; the real one is step 7.5), the
 * VTA's listing, the spent-request store and the lockout's store.
 */
import { LockoutStore, PairingLockout } from '../lockout'
import {
  AgentAclScope,
  AgentConnectChoice,
  ClaimOutcome,
  EntryReader,
  GrantOutcome,
  ListedEntry,
  MATCH_NUMBER_DIGITS,
  NOT_FINISHED_AFTER_MS,
  PAIRING_FAILURE_COPY,
  PairingLink,
  PairingMachine,
  PairingState,
  PairingTransport,
  ProveOutcome,
  SpentRequestStore,
  TEMPORARY_GRANT_MS,
  lockedCopy,
} from '../pairing'
import { handleWithSuffix } from '../handle'

const VTA = 'did:webvh:QmVtaScid:vta.example.org'
const OTHER_VTA = 'did:webvh:QmOtherScid:vta.other.example'
const PERSONA = 'did:webvh:QmPersona:persona.example.org'
const K_T = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const K_A = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const ID = 'q3Vn7Zk2Xo9Rt1LwPb4HdA'
const MIN = 60 * 1000
const T0 = Date.parse('2026-11-25T12:00:00Z')
/** What the fakes put where a careless machine would copy it: it must never reach a state. */
const NUMBER_SENTINEL = '7391'

const choice = (over: Partial<AgentConnectChoice> = {}): AgentConnectChoice => ({
  name: 'Notes helper',
  ownerPersonaDid: PERSONA,
  memoryContexts: ['keyring-memory-abcdefghij'],
  purposes: ['personalisation', 'taskExecution'],
  ...over,
})

const oobLink = (over: Partial<Extract<PairingLink, { kind: 'oob' }>> = {}): PairingLink => ({
  kind: 'oob',
  vtaDid: VTA,
  requestId: ID,
  exp: Math.floor(T0 / 1000) + 300,
  ...over,
})

const fallbackLink = (): PairingLink => ({
  kind: 'fallback',
  agentDid: K_T,
  requestId: ID,
  exp: Math.floor(T0 / 1000) + 300,
})

class FakeTransport implements PairingTransport {
  public calls: string[] = []
  public grants: AgentAclScope[] = []
  public claimAnswer: ClaimOutcome = {
    ok: true,
    vtaDid: VTA,
    purpose: 'deviceEnrol',
    decisionDeadline: T0 + 5 * MIN,
    // a member the specification does not give the approver: must be ignored
    ...({ matchNumber: NUMBER_SENTINEL } as object),
  } as ClaimOutcome
  public proveAnswer: ProveOutcome = {
    ok: true,
    disclosure: {
      requester: 'Claude Code on laptop',
      sameNetwork: true,
      starterDid: K_T,
      ...({ number: NUMBER_SENTINEL } as object),
    },
  }
  public grantAnswer: GrantOutcome = { ok: true }
  public async claim(vtaDid: string, requestId: string) {
    this.calls.push(`claim ${vtaDid} ${requestId}`)
    return this.claimAnswer
  }
  public async prove(_v: string, _r: string, digits: string) {
    this.calls.push(`prove ${digits}`)
    return this.proveAnswer
  }
  public async grant(_v: string, _r: string, scope: AgentAclScope) {
    this.calls.push('grant')
    this.grants.push(scope)
    return this.grantAnswer
  }
  public async decline(_v: string, requestId: string) {
    this.calls.push(`decline ${requestId}`)
  }
  public async grantFallback(_v: string, subject: string, scope: AgentAclScope) {
    this.calls.push(`grantFallback ${subject}`)
    this.grants.push(scope)
    return this.grantAnswer
  }
}

class FakeEntries implements EntryReader {
  public entry?: ListedEntry
  public reachable = true
  public async find() {
    return this.reachable ? { reachable: true as const, entry: this.entry } : { reachable: false as const }
  }
}

class MemorySpent implements SpentRequestStore {
  public ids = new Set<string>()
  public async has(id: string) {
    return this.ids.has(id)
  }
  public async add(id: string) {
    this.ids.add(id)
  }
}

class MemoryLockoutStore implements LockoutStore {
  public times: number[] = []
  public async load() {
    return [...this.times]
  }
  public async save(t: number[]) {
    this.times = [...t]
  }
}

function setup(over: { administers?: string[]; taken?: string[]; ownVta?: string | undefined } = {}) {
  let now = T0
  const clock = () => now
  const transport = new FakeTransport()
  const entries = new FakeEntries()
  const spent = new MemorySpent()
  const lockoutStore = new MemoryLockoutStore()
  const history: PairingState[] = []
  const administered = over.administers ?? [VTA]
  const build = () =>
    new PairingMachine({
      clock,
      resolver: {
        administers: (did) => administered.includes(did),
        ownVta: () => ('ownVta' in over ? over.ownVta : VTA),
      },
      transport,
      entries,
      spent,
      lockout: new PairingLockout(lockoutStore, clock),
      takenHandles: () => over.taken ?? [],
      onTransition: (s) => history.push(s),
    })
  return {
    machine: build(),
    rebuild: build,
    transport,
    entries,
    spent,
    lockoutStore,
    history,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
  }
}

/** The entry as the VTA lists it after a clean rotation to K_a, for the grant the machine sent. */
const rotated = (scope: AgentAclScope, over: Partial<ListedEntry> = {}): ListedEntry => ({
  subject: K_A,
  deviceId: 'dev-1',
  consumerKind: 'ai-agent',
  role: scope.role,
  contexts: [...scope.contexts],
  capabilities: scope.capabilities,
  keys: { scope: 'none' },
  purposes: [...scope.purposes],
  expiresAt: scope.expiresAt,
  ...over,
})

async function toApproval(t: ReturnType<typeof setup>, link: PairingLink = oobLink()) {
  await t.machine.start(choice())
  await t.machine.scan(link)
  if (link.kind === 'oob') await t.machine.enterNumber('42')
  expect(t.machine.state.phase).toBe('awaitingApproval')
}

describe('the auth/oob path, step by step', () => {
  it('start → scan (claim) → number (prove) → approve (grant) → enrolment confirmed', async () => {
    const t = setup()
    expect((await t.machine.start(choice())).phase).toBe('awaitingScan')
    expect((await t.machine.scan(oobLink())).phase).toBe('awaitingNumber')
    expect(t.transport.calls).toEqual([`claim ${VTA} ${ID}`])
    expect(await t.machine.enterNumber('42')).toEqual({ sent: true })
    expect(t.machine.state).toMatchObject({
      phase: 'awaitingApproval',
      disclosure: { requester: 'Claude Code on laptop', sameNetwork: true, starterDid: K_T },
    })
    expect((await t.machine.approve()).phase).toBe('awaitingEnrolment')

    // the entry of §3.3, temporary for 4 hours from the approval
    expect(t.transport.grants).toEqual([
      {
        role: 'application',
        contexts: ['keyring-memory-abcdefghij'],
        capabilities: { scope: 'listed', listed: ['memory-read', 'memory-write'] },
        keys: { scope: 'none' },
        purposes: ['personalisation', 'taskExecution'],
        expiresAt: new Date(T0 + TEMPORARY_GRANT_MS).toISOString(),
        label: 'Notes helper',
        consumerKind: 'ai-agent',
      },
    ])

    // step 10: still under K_t: waiting, and the deviceId is kept once listed
    t.entries.entry = { ...rotated(t.transport.grants[0]), subject: K_T }
    expect(await t.machine.checkEnrolment()).toMatchObject({ phase: 'awaitingEnrolment', deviceId: 'dev-1' })
    // rotated to K_a with every limit kept: confirmed, with the handle fixed now
    t.entries.entry = rotated(t.transport.grants[0])
    expect(await t.machine.checkEnrolment()).toEqual({
      phase: 'confirmed',
      agent: {
        name: 'Notes helper',
        handle: handleWithSuffix('Notes helper', K_A, 4),
        agentDid: K_A,
        deviceId: 'dev-1',
        vtaDid: VTA,
        ownerPersonaDid: PERSONA,
        contexts: ['keyring-memory-abcdefghij'],
        memoryContexts: ['keyring-memory-abcdefghij'],
        capabilities: { scope: 'listed', listed: ['memory-read', 'memory-write'] },
        purposes: ['personalisation', 'taskExecution'],
        expiresAt: new Date(T0 + TEMPORARY_GRANT_MS).toISOString(),
        grantType: 'temporary',
        contextsToAdd: [],
      },
    })
  })

  it('never holds the match number: nothing the VTA sends beyond the disclosure reaches any state', async () => {
    const t = setup()
    await toApproval(t)
    expect(JSON.stringify(t.history)).not.toContain(NUMBER_SENTINEL)
    // control: the sentinel is in what the fakes answered
    expect(JSON.stringify([t.transport.claimAnswer, t.transport.proveAnswer])).toContain(NUMBER_SENTINEL)
  })

  it('with no memory chosen: the agent context alone, and no capabilities', async () => {
    const t = setup()
    await t.machine.start(choice({ memoryContexts: [], agentContext: 'keyring-memory-zzzzzzzzzz' }))
    await t.machine.scan(oobLink())
    await t.machine.enterNumber('42')
    await t.machine.approve()
    expect(t.transport.grants[0]).toMatchObject({
      contexts: ['keyring-memory-zzzzzzzzzz'],
      capabilities: { scope: 'none' },
    })
  })
})

describe('the number: typed, exactly MATCH_NUMBER_DIGITS digits, one attempt', () => {
  it(`is ${MATCH_NUMBER_DIGITS} digits today (auth/oob MatchNumber)`, () => {
    expect(MATCH_NUMBER_DIGITS).toBe(2)
  })

  it.each(['4', '423', '4a', ' 42', ''])('%j is not sent and uses no attempt', async (digits) => {
    const t = setup()
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    expect(await t.machine.enterNumber(digits)).toEqual({ sent: false, reason: 'needs-digits', digits: 2 })
    expect(t.transport.calls.filter((c) => c.startsWith('prove'))).toEqual([])
    expect(t.machine.state.phase).toBe('awaitingNumber')
    // control: the right length is sent
    await t.machine.enterNumber('07')
    expect(t.transport.calls).toContain('prove 07')
  })

  it('a wrong number ends the pairing, counts toward the lockout, spends the request, and allows no second try', async () => {
    const t = setup()
    t.transport.proveAnswer = { ok: false, refused: 'numberMismatch' }
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    await t.machine.enterNumber('42')
    expect(t.machine.state).toMatchObject({ phase: 'failed', reason: 'wrong-number', lockout: { locked: false } })
    expect(t.lockoutStore.times).toHaveLength(1)
    expect(t.spent.ids.has(ID)).toBe(true)
    await expect(t.machine.enterNumber('43')).rejects.toThrow('enterNumber in phase failed')
  })
})

describe('the lockout', () => {
  async function wrongOnce(t: ReturnType<typeof setup>, id: string) {
    const machine = t.rebuild()
    await machine.start(choice())
    await machine.scan(oobLink({ requestId: id }))
    await machine.enterNumber('42')
    return machine
  }
  const ids = ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBA', 'CCCCCCCCCCCCCCCCCCCCCA', 'DDDDDDDDDDDDDDDDDDDDDA']

  it('three wrong numbers within 60 minutes lock "Connect an agent" for 15 minutes, across a restart', async () => {
    const t = setup()
    t.transport.proveAnswer = { ok: false, refused: 'numberMismatch' }
    await wrongOnce(t, ids[0])
    t.advance(MIN)
    await wrongOnce(t, ids[1])
    t.advance(MIN)
    const third = await wrongOnce(t, ids[2])
    expect(third.state).toMatchObject({ phase: 'failed', lockout: { locked: true, minutesLeft: 15 } })
    // a fresh machine (a restart) over the same store is locked at start
    const after = t.rebuild()
    expect(await after.start(choice())).toMatchObject({ phase: 'locked', lockout: { minutesLeft: 15 } })
    expect(lockedCopy(15)).toBe('Too many wrong numbers. Try again in 15 minutes.')
    // and free once the 15 minutes are over
    t.advance(15 * MIN)
    expect((await t.rebuild().start(choice())).phase).toBe('awaitingScan')
  })

  it('a cancel, a decline and a foreign VTA do not count', async () => {
    const t = setup()
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    await t.machine.cancel()
    const foreign = t.rebuild()
    await foreign.start(choice())
    await foreign.scan(oobLink({ vtaDid: OTHER_VTA, requestId: ids[3] }))
    expect(t.lockoutStore.times).toEqual([])
  })
})

describe('the VTA must be one this Keyring administers', () => {
  it('a link whose _from is another VTA is refused and not claimed', async () => {
    const t = setup()
    await t.machine.start(choice())
    expect(await t.machine.scan(oobLink({ vtaDid: OTHER_VTA }))).toMatchObject({
      phase: 'failed',
      reason: 'foreign-vta',
    })
    expect(t.transport.calls).toEqual([])
    expect(PAIRING_FAILURE_COPY['foreign-vta']).toBe("This code is for a VTA you don't manage. Nothing was connected.")
  })

  it('a claim that names another VTA stops after the claim, with the decline sent', async () => {
    const t = setup({ administers: [VTA, OTHER_VTA] })
    t.transport.claimAnswer = { ok: true, vtaDid: OTHER_VTA, purpose: 'deviceEnrol', decisionDeadline: T0 + 5 * MIN }
    await t.machine.start(choice())
    expect(await t.machine.scan(oobLink())).toMatchObject({ phase: 'failed', reason: 'foreign-vta' })
    expect(t.transport.calls).toEqual([`claim ${VTA} ${ID}`, `decline ${ID}`])
  })

  it('a request for another purpose (a sign-in) is never approved as an enrolment', async () => {
    const t = setup()
    t.transport.claimAnswer = { ok: true, vtaDid: VTA, purpose: 'login', decisionDeadline: T0 + 5 * MIN }
    await t.machine.start(choice())
    expect(await t.machine.scan(oobLink())).toMatchObject({ phase: 'failed', reason: 'not-a-pairing-code' })
    expect(t.transport.calls).toContain(`decline ${ID}`)
  })
})

describe('a request is spent on first claim, cancel, wrong number and expiry, and never claimed twice', () => {
  it.each([
    ['first claim', async (t: ReturnType<typeof setup>) => t.machine.scan(oobLink())],
    [
      'cancel',
      async (t: ReturnType<typeof setup>) => {
        await t.machine.scan(oobLink())
        await t.machine.cancel()
      },
    ],
    [
      'expiry before the claim',
      async (t: ReturnType<typeof setup>) => {
        t.advance(10 * MIN)
        await t.machine.scan(oobLink())
      },
    ],
  ])('%s', async (_, act) => {
    const t = setup()
    await t.machine.start(choice())
    await act(t)
    expect(t.spent.ids.has(ID)).toBe(true)
    const again = t.rebuild()
    await again.start(choice())
    const claimsBefore = t.transport.calls.filter((c) => c.startsWith('claim')).length
    const result = await again.scan(oobLink({ exp: Math.floor(t.now() / 1000) + 300 }))
    expect(result).toMatchObject({ phase: 'failed', reason: 'spent' })
    expect(t.transport.calls.filter((c) => c.startsWith('claim'))).toHaveLength(claimsBefore)
  })

  it('control: an unused request is claimed', async () => {
    const t = setup()
    await t.machine.start(choice())
    expect((await t.machine.scan(oobLink())).phase).toBe('awaitingNumber')
  })
})

describe('expiry', () => {
  it('an unclaimed code past its deadline has expired, and is not claimed', async () => {
    const t = setup()
    await t.machine.start(choice())
    t.advance(5 * MIN)
    expect(await t.machine.scan(oobLink())).toEqual({ phase: 'expired' })
    expect(t.transport.calls).toEqual([])
    expect(PAIRING_FAILURE_COPY.expired).toBe('This code has expired. Run the command again.')
  })

  it('a claimed code past the decision window expires: the number is not sent', async () => {
    const t = setup()
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    t.advance(5 * MIN)
    await t.machine.enterNumber('42')
    expect(t.machine.state).toEqual({ phase: 'expired' })
    expect(t.transport.calls.some((c) => c.startsWith('prove'))).toBe(false)
  })

  it('tick ends a pairing whose window passed on Approve', async () => {
    const t = setup()
    await toApproval(t)
    t.advance(4 * MIN)
    expect((await t.machine.tick()).phase).toBe('awaitingApproval')
    t.advance(MIN)
    expect(await t.machine.tick()).toEqual({ phase: 'expired' })
  })
})

describe('refusals from the VTA (§3.10)', () => {
  it.each([
    ['expired', { phase: 'expired' }],
    ['spent', { phase: 'failed', reason: 'spent' }],
    ['unsupported', { phase: 'failed', reason: 'unsupported' }],
    ['unreachable', { phase: 'failed', reason: 'vta-unreachable' }],
  ] as const)('claim refused %s', async (refused, expected) => {
    const t = setup()
    t.transport.claimAnswer = { ok: false, refused }
    await t.machine.start(choice())
    expect(await t.machine.scan(oobLink())).toEqual(expected)
  })

  it.each([
    ['outsideScope', 'grant-refused'],
    ['notAdministrator', 'grant-refused'],
    ['unreachable', 'vta-unreachable'],
  ] as const)('grant refused %s: no entry, "nothing changed"', async (refused, reason) => {
    const t = setup()
    await toApproval(t)
    t.transport.grantAnswer = { ok: false, refused }
    expect(await t.machine.approve()).toEqual({ phase: 'failed', reason })
    expect(PAIRING_FAILURE_COPY[reason]).toBe("We couldn't reach your VTA, so nothing changed.")
  })

  it('prove unreachable', async () => {
    const t = setup()
    t.transport.proveAnswer = { ok: false, refused: 'unreachable' }
    await t.machine.start(choice())
    await t.machine.scan(oobLink())
    await t.machine.enterNumber('42')
    expect(t.machine.state).toEqual({ phase: 'failed', reason: 'vta-unreachable' })
  })
})

describe('cancel and decline', () => {
  it('after the claim: the decline is sent and nothing is granted', async () => {
    const t = setup()
    await toApproval(t)
    expect(await t.machine.cancel()).toEqual({ phase: 'cancelled' })
    expect(t.transport.calls).toContain(`decline ${ID}`)
    expect(t.transport.grants).toEqual([])
  })

  it('after the grant: the entry made is named for removal', async () => {
    const t = setup()
    await toApproval(t)
    await t.machine.approve()
    expect(await t.machine.cancel()).toEqual({ phase: 'cancelled', cleanup: { vtaDid: VTA, subject: K_T } })
  })
})

describe('the P0 fallback: scan the agent did:key, then acl/grant', () => {
  it('needs no claim and no number, grants for K_t, and confirms as the auth/oob path does', async () => {
    const t = setup()
    await toApproval(t, fallbackLink())
    expect(t.transport.calls).toEqual([])
    await t.machine.approve()
    expect(t.transport.calls).toEqual([`grantFallback ${K_T}`])
    expect(t.spent.ids.has(ID)).toBe(true)
    t.entries.entry = rotated(t.transport.grants[0])
    expect((await t.machine.checkEnrolment()).phase).toBe('confirmed')
  })

  it('with no VTA administered, it cannot grant', async () => {
    const t = setup({ ownVta: undefined })
    await t.machine.start(choice())
    expect(await t.machine.scan(fallbackLink())).toEqual({ phase: 'failed', reason: 'vta-unreachable' })
  })
})

describe('a grant that reports contexts the owner did not choose', () => {
  it('is refused, with the entry named for removal', async () => {
    const t = setup()
    await toApproval(t)
    t.transport.grantAnswer = { ok: true, subject: K_T, grantedContexts: ['keyring-memory-zzzzzzzzzz'] }
    expect(await t.machine.approve()).toEqual({
      phase: 'failed',
      reason: 'grant-refused',
      cleanup: { vtaDid: VTA, subject: K_T },
    })
  })

  it('an empty list of granted contexts is refused too, here and not later at step 10', async () => {
    const t = setup()
    await toApproval(t)
    t.transport.grantAnswer = { ok: true, subject: K_T, grantedContexts: [] }
    expect(await t.machine.approve()).toEqual({
      phase: 'failed',
      reason: 'grant-refused',
      cleanup: { vtaDid: VTA, subject: K_T },
    })
  })

  it('control: a subset of the choice is taken', async () => {
    const t = setup()
    await toApproval(t)
    t.transport.grantAnswer = { ok: true, subject: K_T, grantedContexts: ['keyring-memory-abcdefghij'] }
    expect((await t.machine.approve()).phase).toBe('awaitingEnrolment')
  })
})

describe('step 10: the entry as the VTA lists it', () => {
  async function granted() {
    const t = setup()
    await toApproval(t)
    await t.machine.approve()
    return t
  }

  it.each([
    ['lost its expiry', { expiresAt: undefined }],
    ['a later expiry', { expiresAt: new Date(T0 + 2 * TEMPORARY_GRANT_MS).toISOString() }],
    [
      'a wider capability',
      { capabilities: { scope: 'listed' as const, listed: ['memory-read', 'memory-write', 'room-present'] } },
    ],
    ['no consumer kind', { consumerKind: undefined }],
    ['another consumer kind', { consumerKind: 'application' }],
    ['another context', { contexts: ['keyring'] }],
    ['a signing scope', { keys: { scope: 'all' } }],
    ['another purpose', { purposes: ['personalisation', 'modelTraining'] }],
    ['no deviceId', { deviceId: undefined }],
  ])('a rotated entry that %s is failed and named for removal', async (_, over) => {
    const t = await granted()
    t.entries.entry = rotated(t.transport.grants[0], over as Partial<ListedEntry>)
    const s = await t.machine.checkEnrolment()
    expect(s).toMatchObject({ phase: 'failed', reason: 'rotation-lost-limits', cleanup: { vtaDid: VTA, subject: K_A } })
  })

  it('control: the same entry with every limit kept is confirmed', async () => {
    const t = await granted()
    t.entries.entry = rotated(t.transport.grants[0])
    expect((await t.machine.checkEnrolment()).phase).toBe('confirmed')
  })

  it('still under K_t after 10 minutes: Not finished, with the entry to remove', async () => {
    const t = await granted()
    t.entries.entry = { ...rotated(t.transport.grants[0]), subject: K_T }
    t.advance(NOT_FINISHED_AFTER_MS - 1)
    expect((await t.machine.checkEnrolment()).phase).toBe('awaitingEnrolment')
    t.advance(1)
    expect(await t.machine.checkEnrolment()).toEqual({
      phase: 'notFinished',
      cleanup: { vtaDid: VTA, subject: K_T, deviceId: 'dev-1' },
    })
  })

  it('the VTA unreachable: keep waiting, never confirm', async () => {
    const t = await granted()
    t.entries.reachable = false
    expect((await t.machine.checkEnrolment()).phase).toBe('awaitingEnrolment')
  })

  it('a handle collision at six characters fails the pairing with the entry to remove', async () => {
    const taken = [handleWithSuffix('Notes helper', K_A, 4), handleWithSuffix('Notes helper', K_A, 6)]
    const t = setup({ taken })
    await toApproval(t)
    await t.machine.approve()
    t.entries.entry = rotated(t.transport.grants[0])
    expect(await t.machine.checkEnrolment()).toMatchObject({
      phase: 'failed',
      reason: 'handle-collision',
      cleanup: { subject: K_A },
    })
  })
})

describe('the choice', () => {
  it.each([
    ['an empty name', { name: '  ' }],
    ['no purposes', { purposes: [] }],
    ['modelTraining', { purposes: ['modelTraining' as never] }],
    ['no context at all', { memoryContexts: [], agentContext: undefined }],
  ])('%s is refused before anything starts', async (_, over) => {
    const t = setup()
    expect(await t.machine.start(choice(over))).toEqual({ phase: 'failed', reason: 'invalid-choice' })
  })
})
