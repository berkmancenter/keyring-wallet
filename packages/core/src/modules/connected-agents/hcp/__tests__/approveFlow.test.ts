/**
 * The HCP approve flow against a fake approval source, a fake clock and fake timers: the wait and its 5-minute
 * bound, the one try at the number with the shared lockout, Approve through `decide`, Cancel, and that the match
 * number never leaves the call that compares it.
 */
import type { VtiApproval } from '../../../trust-tasks/module/vtaAgent'
import { setAgentConnectEnabled } from '../../agentConnectFlag'
import { LOCKOUT_DURATION_MS, PairingLockout, type LockoutStore } from '../../lockout'
import type { HcpApprovalSource } from '../approvals'
import {
  createHcpApproveFlow,
  HCP_CANCEL_REASON,
  HCP_BAD_TERM_REASON,
  HCP_MAX_GRANT_TERM_MS,
  HCP_NOT_TEMPORARY_REASON,
  HCP_SCAN_WAIT_MS,
  HCP_WRONG_NUMBER_REASON,
  type HcpApproveState,
} from '../approveFlow'
import { setHcpEnabled } from '../hcpFlag'
import type { HcpApprovalView } from '../types'
import {
  CLIENT_VID,
  GRANT_EXPIRES_AT,
  HELD_AT,
  hcpApproval,
  hcpEffects,
  LINK,
  NUMBER,
  OTHER_VID,
  ROWS,
  THREAD,
} from './fixtures/hcpApproval'

jest.mock('../../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))

const WRONG = '1234'
const SCAN_AT = HELD_AT + 10 * 1000
const CANCELLED: HcpApproveState = { state: 'cancelled', message: { key: 'ApproveCancelled' } }

function fakeSource(initial: VtiApproval[] = []) {
  let approvals = initial
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())
  const decide = jest.fn(async (id: string, decision: 'approve' | 'deny', _reason?: string) => {
    approvals = approvals.map((a) =>
      a.id === id ? { ...a, status: decision === 'approve' ? 'approved' : 'denied' } : a
    )
    notify()
  })
  const source: HcpApprovalSource = {
    list: () => approvals,
    subscribe: (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    decide,
  }
  return {
    source,
    decide,
    listening: () => listeners.size,
    push(a: VtiApproval) {
      approvals = [...approvals, a]
      notify()
    },
    change(id: string, patch: Partial<VtiApproval>) {
      approvals = approvals.map((a) => (a.id === id ? { ...a, ...patch } : a))
      notify()
    },
  }
}

function setup(
  options: { approvals?: VtiApproval[]; wrongTimes?: number[]; threadInUse?: (t: string) => Promise<boolean> } = {}
) {
  let now = SCAN_AT
  const timers: { at: number; run: () => void; live: boolean }[] = []
  const clock = () => new Date(now)
  const setTimer = (run: () => void, ms: number) => {
    const t = { at: now + ms, run, live: true }
    timers.push(t)
    return () => {
      t.live = false
    }
  }
  /** Move the clock on, firing each timer that falls due, in order. */
  const advance = (ms: number) => {
    const until = now + ms
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      now = due.at
      due.live = false
      due.run()
    }
    now = until
  }

  let saved = options.wrongTimes ?? []
  const store: LockoutStore = { load: async () => saved, save: async (times) => void (saved = times) }
  const real = new PairingLockout(store, () => now)
  const lockout = {
    state: jest.fn(() => real.state()),
    recordWrongNumber: jest.fn(() => real.recordWrongNumber()),
  }
  const fake = fakeSource(options.approvals)
  const beforeApprove = jest.fn(
    async (_view: HcpApprovalView, _approval: { id: string; expiresAt: string }, _at: Date) => undefined
  )
  const onApproved = jest.fn(async (_view: HcpApprovalView, _at: Date) => undefined)
  const flow = createHcpApproveFlow({
    source: fake.source,
    lockout,
    clock,
    beforeApprove,
    onApproved,
    setTimer,
    ...(options.threadInUse ? { threadInUse: options.threadInUse } : {}),
  })
  const states: HcpApproveState[] = []
  flow.subscribe(() => states.push(flow.state()))
  return {
    flow,
    fake,
    lockout,
    beforeApprove,
    onApproved,
    advance,
    states,
    saved: () => saved,
    liveTimers: () => timers.filter((t) => t.live).length,
  }
}

const EXPECTED_VIEW: HcpApprovalView = {
  title: { key: 'ApproveTitle', params: { name: 'My helper' } },
  rows: ROWS,
  warning: { key: 'ApproveOwnTerminal' },
  notSignIn: { key: 'ApproveNotSignIn' },
  approve: { key: 'Approve' },
  clientVid: CLIENT_VID,
  threadId: THREAD,
  expiresAt: GRANT_EXPIRES_AT,
  operator: { id: 'did:web:labs.example', name: 'Example Labs' },
  persistence: 'temporary',
  maxUseSeconds: 600,
}

const RESEARCH = 'https://example.org/purpose/research'
const DIET = 'https://example.org/purpose/diet'
/** The fixture with its named purpose replaced by two `choose: true` ones: a request that names no purpose. */
const choosing = () =>
  hcpApproval({
    effects: [
      ...hcpEffects().filter((e) => e.kind !== 'hcpPurpose'),
      {
        kind: 'hcpPurpose',
        summary: 'For research.',
        detail: { purpose: RESEARCH, description: 'research', choose: true },
      },
      { kind: 'hcpPurpose', summary: 'For your diet.', detail: { purpose: DIET, description: 'diet', choose: true } },
    ],
  })

describe('createHcpApproveFlow', () => {
  beforeEach(() => {
    setAgentConnectEnabled(true)
    setHcpEnabled(true)
  })
  afterEach(() => {
    setHcpEnabled(false)
    setAgentConnectEnabled(false)
  })

  it('waits, then the approval arrives, then asks for the number', async () => {
    const t = setup()
    expect(t.flow.state()).toEqual({ state: 'idle' })
    await t.flow.start({ name: 'My helper', link: LINK })
    expect(t.flow.state()).toEqual({ state: 'waiting' })
    t.advance(30 * 1000)
    t.fake.push(hcpApproval())
    expect(t.flow.state()).toEqual({ state: 'numberEntry' })
    expect(t.fake.decide).not.toHaveBeenCalled()
  })

  it('asks for the number at once when the approval is already there', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    expect(t.flow.state()).toEqual({ state: 'numberEntry' })
  })

  it('leaves an approval for something else where it is, and keeps waiting', async () => {
    const t = setup({ approvals: [hcpApproval({ id: 'other', requester: OTHER_VID })] })
    await t.flow.start({ name: 'My helper', link: LINK })
    t.advance(60 * 1000)
    expect(t.flow.state()).toEqual({ state: 'waiting' })
    await t.flow.cancel()
    expect(t.fake.decide).not.toHaveBeenCalled()
  })

  it('gives expired after 5 minutes with nothing, and not a millisecond before', async () => {
    const t = setup()
    await t.flow.start({ name: 'My helper', link: LINK })
    t.advance(HCP_SCAN_WAIT_MS - 1)
    expect(t.flow.state()).toEqual({ state: 'waiting' })
    t.advance(1)
    expect(t.flow.state()).toEqual({ state: 'expired', message: { key: 'CodeExpired' } })
    // control: the wait is over, so a late approval changes nothing.
    t.fake.push(hcpApproval())
    expect(t.flow.state().state).toBe('expired')
    expect(t.fake.listening()).toBe(0)
    expect(t.liveTimers()).toBe(0)
  })

  it('gives expired when the approval it found passes its own expiresAt', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    expect(t.flow.state().state).toBe('numberEntry')
    t.advance(HELD_AT + 5 * 60 * 1000 - SCAN_AT)
    expect(t.flow.state().state).toBe('expired')
    await t.flow.typeNumber(NUMBER)
    expect(t.flow.state().state).toBe('expired')
    expect(t.fake.decide).not.toHaveBeenCalled()
  })

  it('gives expired at once when the matching approval has already expired', async () => {
    const t = setup({ approvals: [hcpApproval({ expiresAt: new Date(SCAN_AT).toISOString() })] })
    await t.flow.start({ name: 'My helper', link: LINK })
    expect(t.flow.state().state).toBe('expired')
  })

  it('gives the approve view for the right number', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    expect(t.flow.state()).toEqual({ state: 'approve', view: EXPECTED_VIEW })
    expect(t.fake.decide).not.toHaveBeenCalled()
    expect(t.lockout.recordWrongNumber).not.toHaveBeenCalled()
  })

  it('for a wrong number: denies once with the reason, records one wrong number, and takes no second try', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(WRONG)
    expect(t.flow.state()).toEqual({ state: 'wrongNumber', message: { key: 'WrongNumber' } })
    expect(t.fake.decide.mock.calls).toEqual([['consent-1', 'deny', HCP_WRONG_NUMBER_REASON]])
    expect(t.lockout.recordWrongNumber).toHaveBeenCalledTimes(1)
    expect(t.saved()).toEqual([SCAN_AT])

    // control: the right number after a wrong one does nothing.
    await t.flow.typeNumber(NUMBER)
    expect(t.flow.state().state).toBe('wrongNumber')
    expect(t.fake.decide).toHaveBeenCalledTimes(1)
    expect(t.lockout.recordWrongNumber).toHaveBeenCalledTimes(1)
  })

  it.each(['264', '26444', '26 4', '٢٦٤٤', ''])('sends nothing and keeps the try for %p', async (typed) => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(typed)
    expect(t.flow.state()).toEqual({ state: 'numberEntry' })
    expect(t.fake.decide).not.toHaveBeenCalled()
    expect(t.lockout.recordWrongNumber).not.toHaveBeenCalled()
  })

  it('while locked out, start gives locked with the minutes left and sends nothing', async () => {
    const t = setup({ approvals: [hcpApproval()], wrongTimes: [SCAN_AT - 3000, SCAN_AT - 2000, SCAN_AT - 60 * 1000] })
    await t.flow.start({ name: 'My helper', link: LINK })
    const minutes = Math.ceil((SCAN_AT - 2000 + LOCKOUT_DURATION_MS - SCAN_AT) / 60000)
    expect(t.flow.state()).toEqual({
      state: 'locked',
      minutes,
      message: { key: 'Locked', params: { n: String(minutes) } },
    })
    expect(t.fake.decide).not.toHaveBeenCalled()
    expect(t.fake.listening()).toBe(0)
  })

  // control: three wrong numbers through the flow lock the next start.
  it('locks the next start after three wrong numbers', async () => {
    let wrongTimes: number[] = []
    for (let i = 0; i < 3; i++) {
      const t = setup({ approvals: [hcpApproval()], wrongTimes })
      await t.flow.start({ name: 'My helper', link: LINK })
      expect(t.flow.state().state).toBe('numberEntry')
      await t.flow.typeNumber(WRONG)
      wrongTimes = t.saved()
    }
    const t = setup({ approvals: [hcpApproval()], wrongTimes })
    await t.flow.start({ name: 'My helper', link: LINK })
    expect(t.flow.state().state).toBe('locked')
  })

  it('approve calls decide once, and onApproved only after it resolves', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    let resolve: () => void = () => undefined
    const plain = t.fake.decide.getMockImplementation()
    t.fake.decide.mockImplementationOnce(
      (id, decision, reason) => new Promise<void>((r) => (resolve = () => r(plain?.(id, decision, reason) as never)))
    )
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    const approving = t.flow.approve()
    expect(t.flow.state()).toEqual({ state: 'approving', view: EXPECTED_VIEW })
    await Promise.resolve()
    expect(t.onApproved).not.toHaveBeenCalled()
    resolve()
    await approving
    expect(t.fake.decide.mock.calls).toEqual([['consent-1', 'approve']])
    // The approval in flight was written first, naming the request and its own expiry.
    expect(t.beforeApprove).toHaveBeenCalledTimes(1)
    expect(t.beforeApprove).toHaveBeenCalledWith(
      EXPECTED_VIEW,
      { id: 'consent-1', expiresAt: hcpApproval().expiresAt },
      new Date(SCAN_AT)
    )
    expect(t.beforeApprove.mock.invocationCallOrder[0]).toBeLessThan(t.fake.decide.mock.invocationCallOrder[0])
    expect(t.onApproved).toHaveBeenCalledTimes(1)
    expect(t.onApproved).toHaveBeenCalledWith(EXPECTED_VIEW, new Date(SCAN_AT))
    expect(t.flow.state()).toEqual({ state: 'approved', view: EXPECTED_VIEW })
    // A second Approve, or a Cancel after it, sends nothing.
    await t.flow.approve()
    await t.flow.cancel()
    expect(t.fake.decide).toHaveBeenCalledTimes(1)
  })

  it('B3: a request that names no purpose shows the purposes approving allows, with no picker, and approves', async () => {
    const t = setup({ approvals: [choosing()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    const shown = t.flow.state()
    expect(shown.state === 'approve' && shown.view.purposesAllowed).toEqual({
      key: 'ApproveAllowsPurposes',
      params: { name: 'My helper' },
      rows: ['For research.', 'For your diet.'],
    })
    expect(t.flow).not.toHaveProperty('choosePurpose')
    await t.flow.approve()
    expect(t.fake.decide.mock.calls).toEqual([['consent-1', 'approve']])
    expect(t.flow.state().state).toBe('approved')
  })

  const withTerm = (detail: Record<string, unknown>) =>
    hcpApproval({
      effects: hcpEffects().map((e) => (e.kind === 'hcpGrantTerm' ? { ...e, detail } : e)),
    })

  it('S5: Approve declines a request that is not temporary: denied with a reason, nothing recorded', async () => {
    const t = setup({ approvals: [withTerm({ persistence: 'persistent', expiresAt: GRANT_EXPIRES_AT })] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    expect(t.flow.state().state).toBe('approve')
    await t.flow.approve()
    expect(t.flow.state()).toEqual({
      state: 'failed',
      error: HCP_NOT_TEMPORARY_REASON,
      message: { key: 'ApproveNotTemporary', params: { name: 'My helper' } },
    })
    expect(t.fake.decide.mock.calls).toEqual([['consent-1', 'deny', HCP_NOT_TEMPORARY_REASON]])
    expect(t.beforeApprove).not.toHaveBeenCalled()
  })

  it.each([
    ['in the past', new Date(SCAN_AT - 1000).toISOString()],
    ['now', new Date(SCAN_AT).toISOString()],
    ['more than 24 h ahead', new Date(SCAN_AT + HCP_MAX_GRANT_TERM_MS + 1000).toISOString()],
  ])('S5: Approve declines a grant expiring %s', async (_what, expiresAt) => {
    const t = setup({ approvals: [withTerm({ persistence: 'temporary', expiresAt })] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.approve()
    expect(t.flow.state()).toMatchObject({ state: 'failed', message: { key: 'ApproveBadTerm' } })
    expect(t.fake.decide.mock.calls).toEqual([['consent-1', 'deny', HCP_BAD_TERM_REASON]])
    expect(t.beforeApprove).not.toHaveBeenCalled()
  })

  it('N5: a link whose thread Keyring already holds a record for is not approved again', async () => {
    const threadInUse = jest.fn(async (t: string) => t === LINK.threadId)
    const t = setup({ approvals: [hcpApproval()], threadInUse })
    expect(await t.flow.start({ name: 'My helper', link: LINK })).toEqual({
      state: 'expired',
      message: { key: 'CodeExpired' },
    })
    expect(threadInUse).toHaveBeenCalledWith(LINK.threadId)
    expect(t.fake.decide).not.toHaveBeenCalled()
  })

  it('does not approve when the approval in flight cannot be written', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    t.beforeApprove.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.approve()
    expect(t.flow.state()).toEqual({
      state: 'failed',
      error: 'not recorded, so not approved: disk full',
      message: { key: 'ApproveNotApproved' },
    })
    expect(t.fake.decide).not.toHaveBeenCalled()
    expect(t.onApproved).not.toHaveBeenCalled()
  })

  // control: the opposite of the case above: with the write in place, the same run approves.
  it('control: with the approval in flight written, the same run approves', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.approve()
    expect(t.flow.state().state).toBe('approved')
    expect(t.fake.decide).toHaveBeenCalledTimes(1)
  })

  it('leaves the approval in flight when onApproved fails after the VTA approved', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    t.onApproved.mockImplementationOnce(async () => {
      throw new Error('store closed')
    })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.approve()
    expect(t.beforeApprove).toHaveBeenCalledTimes(1)
    expect(t.flow.state()).toEqual({
      state: 'failed',
      error: 'approved, but not recorded: store closed',
      // The name the person gave, never the request's: the copy says it will show as connected, not to retry.
      message: { key: 'ApproveNotRecorded', params: { name: 'My helper' } },
    })
  })

  it("gives failed with the approval's error when decide fails, and records nothing", async () => {
    const t = setup({ approvals: [hcpApproval()] })
    t.fake.decide.mockImplementationOnce(async (id) => {
      t.fake.change(id, { status: 'failed', error: 'the VTA did not take the decision within 30 s' })
      throw new Error('the VTA did not take the decision within 30 s')
    })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.approve()
    expect(t.flow.state()).toEqual({
      state: 'failed',
      error: 'the VTA did not take the decision within 30 s',
      message: { key: 'ApproveDeclined' },
    })
    expect(t.onApproved).not.toHaveBeenCalled()
  })

  it('gives failed when decide resolves but the approval was not approved (the owner check was not passed)', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    t.fake.decide.mockImplementationOnce(async () => undefined)
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.approve()
    expect(t.flow.state()).toEqual({ state: 'failed', error: 'not approved', message: { key: 'ApproveDeclined' } })
    expect(t.onApproved).not.toHaveBeenCalled()
  })

  it('a blank name fails before anything is sent, as not approved (another try is safe)', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: '   ', link: LINK })
    expect(t.flow.state()).toEqual({ state: 'failed', error: 'invalid-name', message: { key: 'ApproveNotApproved' } })
    expect(t.lockout.state).not.toHaveBeenCalled()
  })

  it('a request answered elsewhere while the flow waits: approved there is not declined, denied there is', async () => {
    for (const [status, key] of [
      ['approved', 'ApproveAnsweredElsewhere'],
      ['denied', 'ApproveDeclined'],
    ] as const) {
      const t = setup({ approvals: [hcpApproval()] })
      await t.flow.start({ name: 'My helper', link: LINK })
      t.fake.change('consent-1', { status })
      expect(t.flow.state()).toEqual({ state: 'failed', error: status, message: { key } })
      expect(t.fake.decide).not.toHaveBeenCalled()
    }
  })

  it('no failed state carries the raw error in what it shows: the message is a key, never the error text', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    t.onApproved.mockImplementationOnce(async () => {
      throw new Error('store closed')
    })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.approve()
    const s = t.flow.state()
    if (s.state !== 'failed') throw new Error(`expected failed, got ${s.state}`)
    expect(JSON.stringify(s.message)).not.toContain('store closed')
    // control: the raw text is still there, for logs and tests.
    expect(s.error).toContain('store closed')
  })

  it('cancel before an approval arrives sends nothing', async () => {
    const t = setup()
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.cancel()
    expect(t.flow.state()).toEqual(CANCELLED)
    t.fake.push(hcpApproval())
    expect(t.flow.state()).toEqual(CANCELLED)
    expect(t.fake.decide).not.toHaveBeenCalled()
  })

  it('cancel after an approval arrives sends one deny', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.cancel()
    expect(t.flow.state()).toEqual(CANCELLED)
    expect(t.fake.decide.mock.calls).toEqual([['consent-1', 'deny', HCP_CANCEL_REASON]])
  })

  it('cancel on the approve view sends one deny', async () => {
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    await t.flow.typeNumber(NUMBER)
    await t.flow.cancel()
    expect(t.fake.decide.mock.calls).toEqual([['consent-1', 'deny', HCP_CANCEL_REASON]])
    expect(t.onApproved).not.toHaveBeenCalled()
  })

  it('does nothing with the flags off', async () => {
    setHcpEnabled(false)
    const t = setup({ approvals: [hcpApproval()] })
    await t.flow.start({ name: 'My helper', link: LINK })
    expect(t.flow.state()).toEqual({ state: 'idle' })
    expect(t.lockout.state).not.toHaveBeenCalled()
    expect(t.fake.listening()).toBe(0)
  })

  // control that bites: the number is in no state, view, or call argument, through a whole run of each ending.
  it('never puts the match number in a state, a view or a call', async () => {
    // The search is meaningful only if nothing in the fixture contains the digits by chance.
    expect(JSON.stringify(hcpApproval())).not.toContain(NUMBER)
    expect(JSON.stringify(EXPECTED_VIEW)).not.toContain(NUMBER)

    const runs = [
      async (t: ReturnType<typeof setup>) => {
        await t.flow.typeNumber(NUMBER)
        await t.flow.approve()
      },
      async (t: ReturnType<typeof setup>) => {
        await t.flow.typeNumber(NUMBER)
        await t.flow.cancel()
      },
      async (t: ReturnType<typeof setup>) => {
        await t.flow.typeNumber(WRONG)
        await t.flow.typeNumber(NUMBER)
      },
    ]
    for (const run of runs) {
      const t = setup({ approvals: [hcpApproval()] })
      await t.flow.start({ name: 'My helper', link: LINK })
      await run(t)
      const seen = JSON.stringify({
        states: t.states,
        final: t.flow.state(),
        decide: t.fake.decide.mock.calls,
        beforeApprove: t.beforeApprove.mock.calls,
        onApproved: t.onApproved.mock.calls,
        lockoutState: t.lockout.state.mock.calls,
        recordWrongNumber: t.lockout.recordWrongNumber.mock.calls,
      })
      expect(t.states.length).toBeGreaterThan(1)
      expect(seen).not.toContain(NUMBER)
    }
  })
})
