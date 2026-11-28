/**
 * Finding the HCP grant's consent request: only the pending, unexpired one for the scanned link's client and thread
 * (VTI hcp.md §5.1: the thread is the document's `parentThreadId`); and reading its effects in any order, with exactly
 * one `hcpClient` and one `hcpGrantTerm`, an unknown kind kept as its row.
 */
import type { VtiApproval } from '../../../trust-tasks/module/vtaAgent'
import { findHcpApproval, hcpApprovalThread, readHcpEffects, vtaAgentApprovalSource } from '../approvals'
import { HCP_EFFECT_KINDS, HCP_ENTRIES_CREATE } from '../types'
import {
  CLIENT_VID,
  GRANT,
  GRANT_EXPIRES_AT,
  HELD_AT,
  hcpApproval,
  hcpEffects,
  LINK,
  OTHER_THREAD,
  OTHER_VID,
  ROWS,
  THREAD,
} from './fixtures/hcpApproval'

const mockAgent = {
  getState: jest.fn(() => ({ approvals: [] as VtiApproval[] })),
  subscribe: jest.fn((_listener: () => void) => jest.fn(() => true)),
  decide: jest.fn(async (_id: string, _decision: string, _reason?: string) => undefined),
}
jest.mock('../../../trust-tasks/module/vtaAgent', () => ({
  get vtaAgent() {
    return mockAgent
  },
}))

const NOW = new Date(HELD_AT + 60 * 1000)
const CLIENT = hcpEffects()[0].detail as Record<string, unknown>
const CHOOSE = {
  kind: 'hcpPurpose',
  summary: 'To help with research (you choose).',
  detail: { purpose: 'https://registry.trustoverip.org/dtg/purpose/research/1', description: 'research', choose: true },
}

/** The fixture with one effect's detail replaced. */
function withDetail(index: number, detail: unknown, change: Partial<VtiApproval> = {}): VtiApproval {
  const effects = hcpEffects()
  effects[index] = { ...effects[index], detail }
  return hcpApproval({ effects, ...change })
}

/** The fixture's effects with `kind`'s effect repeated, or removed. */
const repeated = (index: number) => [...hcpEffects(), hcpEffects()[index]]
const without = (index: number) => hcpEffects().filter((_, i) => i !== index)

describe('findHcpApproval', () => {
  const others: [string, VtiApproval][] = [
    ['another task type', hcpApproval({ id: 'type', taskType: HCP_ENTRIES_CREATE })],
    ['another requester', hcpApproval({ id: 'requester', requester: OTHER_VID })],
    ['another parentThreadId', hcpApproval({ id: 'parent', parentThreadId: OTHER_THREAD })],
    ['no thread at all', hcpApproval({ id: 'nothread', parentThreadId: undefined })],
    [
      'a parentThreadId and a detail threadId that disagree',
      withDetail(0, { ...CLIENT, threadId: OTHER_THREAD }, { id: 'disagree' }),
    ],
    ['a client detail naming another VID', withDetail(0, { ...CLIENT, clientId: OTHER_VID }, { id: 'vid' })],
    ['no hcpClient', hcpApproval({ id: 'noclient', effects: without(0) })],
    ['no hcpGrantTerm', hcpApproval({ id: 'noterm', effects: without(4) })],
    ['two hcpClient', hcpApproval({ id: 'twoclients', effects: repeated(0) })],
    ['two hcpGrantTerm', hcpApproval({ id: 'twoterms', effects: repeated(4) })],
    ['two hcpUseUntil', hcpApproval({ id: 'twouse', effects: repeated(3) })],
    ['two hcpDirectives', hcpApproval({ id: 'twodir', effects: repeated(5) })],
    ['a non-pending status', hcpApproval({ id: 'denied', status: 'denied' })],
    ['an expired one', hcpApproval({ id: 'expired', expiresAt: new Date(NOW.getTime()).toISOString() })],
    ['effects that are not a list', hcpApproval({ id: 'none', effects: undefined })],
  ]

  it.each(others)('does not take %s', (_what, approval) => {
    expect(findHcpApproval([approval], LINK, NOW)).toBeUndefined()
  })

  // control: the well-formed fixture is found, among all the others.
  it('finds the one matching approval among all the others', () => {
    const match = hcpApproval({ id: 'the-one' })
    const list = [...others.map(([, a]) => a), match]
    expect(findHcpApproval(list, LINK, NOW)?.id).toBe('the-one')
  })

  it('takes the effects in any order, an unknown kind among them', () => {
    const effects = [...hcpEffects()].reverse()
    effects.splice(2, 0, { kind: 'hcpSomethingNew', summary: 'Something new.' })
    expect(findHcpApproval([hcpApproval({ effects })], LINK, NOW)).toBeDefined()
  })

  it('matches on a detail threadId when the approval carries no parentThreadId, and on both when they agree', () => {
    expect(
      findHcpApproval([withDetail(0, { ...CLIENT, threadId: THREAD }, { parentThreadId: undefined })], LINK, NOW)
    ).toBeDefined()
    expect(findHcpApproval([withDetail(0, { ...CLIENT, threadId: THREAD })], LINK, NOW)).toBeDefined()
    // control: a detail threadId for another thread, alone, is not matched.
    expect(
      findHcpApproval([withDetail(0, { ...CLIENT, threadId: OTHER_THREAD }, { parentThreadId: undefined })], LINK, NOW)
    ).toBeUndefined()
  })

  it('takes it up to one millisecond before its expiresAt', () => {
    const approval = hcpApproval()
    expect(findHcpApproval([approval], LINK, new Date(Date.parse(approval.expiresAt) - 1))).toBe(approval)
    expect(findHcpApproval([approval], LINK, new Date(Date.parse(approval.expiresAt)))).toBeUndefined()
  })
})

describe('hcpApprovalThread', () => {
  it('is the parentThreadId, else the detail threadId; undefined when they disagree', () => {
    const read = (a: VtiApproval) => hcpApprovalThread(a, readHcpEffects(a)!)
    expect(read(hcpApproval())).toBe(THREAD)
    expect(read(withDetail(0, { ...CLIENT, threadId: OTHER_THREAD }, { parentThreadId: undefined }))).toBe(OTHER_THREAD)
    expect(read(withDetail(0, { ...CLIENT, threadId: OTHER_THREAD }))).toBeUndefined()
    expect(read(hcpApproval({ parentThreadId: undefined }))).toBeUndefined()
  })
})

describe('readHcpEffects', () => {
  // control: the well-formed effects are read, summaries verbatim and in order.
  it('reads the well-formed effects', () => {
    expect(hcpEffects().map((e) => e.kind)).toEqual([...HCP_EFFECT_KINDS])
    expect(readHcpEffects(hcpApproval())).toEqual({
      client: { clientId: CLIENT_VID, name: 'hcp-cli', operator: { id: 'did:web:labs.example', name: 'Example Labs' } },
      categories: [{ category: 'general_preferences', description: 'General preferences', actions: ['read'] }],
      purposes: [
        {
          purpose: 'https://registry.trustoverip.org/dtg/purpose/personalisation/1',
          description: 'tailor its answers',
        },
      ],
      choices: [],
      useUntil: { maxUseSeconds: 600 },
      term: { persistence: 'temporary', expiresAt: GRANT_EXPIRES_AT },
      directives: { followsDirectives: true },
      rows: ROWS,
    })
  })

  it('keeps the order sent for the rows, whatever it is', () => {
    const effects = [...hcpEffects()].reverse()
    expect(readHcpEffects(hcpApproval({ effects }))?.rows).toEqual([...ROWS].reverse())
  })

  it('keeps an unknown kind, or one with no kind, as its row only', () => {
    const effects = [
      ...hcpEffects(),
      { kind: 'hcpSomethingNew', summary: 'New.', detail: { x: 1 } },
      { summary: 'Bare.' },
    ]
    const read = readHcpEffects(hcpApproval({ effects }))
    expect(read?.rows).toEqual([...ROWS, 'New.', 'Bare.'])
    expect(read?.categories).toHaveLength(1)
  })

  it('reads any number of categories and purposes', () => {
    const second = {
      kind: 'hcpCategory',
      summary: 'Your diet.',
      detail: { category: 'diet', description: 'Diet', actions: ['read'] },
    }
    const read = readHcpEffects(hcpApproval({ effects: [...hcpEffects(), second, hcpEffects()[2]] }))
    expect(read?.categories.map((c) => c.category)).toEqual(['general_preferences', 'diet'])
    expect(read?.purposes).toHaveLength(2)
    expect(read?.rows).toHaveLength(8)
  })

  it('puts a choose:true purpose among the choices, with its summary, and not among the rows', () => {
    const read = readHcpEffects(hcpApproval({ effects: [...hcpEffects(), CHOOSE] }))
    expect(read?.rows).toEqual(ROWS)
    expect(read?.choices).toEqual([{ ...CHOOSE.detail, summary: CHOOSE.summary }])
    expect(read?.purposes).toHaveLength(2)
  })

  it('reads an operator given as text, and an opportunistic detail grantId', () => {
    const read = readHcpEffects(withDetail(0, { ...CLIENT, operator: 'Example Labs', grantId: GRANT }))
    expect(read?.client).toEqual({ clientId: CLIENT_VID, name: 'hcp-cli', operator: 'Example Labs', grantId: GRANT })
    // control: a grantId that is not a urn:uuid is ignored, not refused.
    expect(readHcpEffects(withDetail(0, { ...CLIENT, grantId: 'grant-1' }))?.client.grantId).toBeUndefined()
  })

  const malformed: [string, number, unknown][] = [
    ['client: no detail', 0, undefined],
    ['client: clientId not a string', 0, { ...CLIENT, clientId: 7 }],
    ['client: no name', 0, { ...CLIENT, name: undefined }],
    ['client: no operator', 0, { ...CLIENT, operator: undefined }],
    ['client: an operator with neither id nor name', 0, { ...CLIENT, operator: { other: 'x' } }],
    ['term: no expiresAt', 4, { persistence: 'temporary' }],
    ['term: expiresAt not RFC 3339', 4, { persistence: 'temporary', expiresAt: '2026-11-27 14:00' }],
    ['term: no persistence', 4, { expiresAt: GRANT_EXPIRES_AT }],
  ]

  it.each(malformed)('refuses %s', (_what, index, detail) => {
    expect(readHcpEffects(withDetail(index, detail))).toBeUndefined()
  })

  const optional: [string, number, unknown][] = [
    ['category: no actions', 1, { category: 'x', description: 'x' }],
    ['purpose: choose not a boolean', 2, { purpose: 'x', description: 'x', choose: 'yes' }],
    ['useUntil: not an integer', 3, { maxUseSeconds: 1.5 }],
    ['directives: not a boolean', 5, { followsDirectives: 'yes' }],
  ]

  it.each(optional)('keeps as its row only, unstructured, %s', (_what, index, detail) => {
    const read = readHcpEffects(withDetail(index, detail))
    expect(read?.rows).toEqual(ROWS)
  })

  it('refuses an empty or missing summary, on any kind', () => {
    for (const index of [0, 2, 5]) {
      for (const summary of ['', undefined, 3]) {
        const effects = hcpEffects()
        effects[index] = { ...effects[index], summary }
        expect(readHcpEffects(hcpApproval({ effects }))).toBeUndefined()
      }
    }
    expect(readHcpEffects(hcpApproval({ effects: [...hcpEffects(), { kind: 'new' }] }))).toBeUndefined()
  })
})

describe('vtaAgentApprovalSource', () => {
  it('binds to vtaAgent: its approvals, its listeners and its decide', async () => {
    const approval = hcpApproval()
    mockAgent.getState.mockReturnValue({ approvals: [approval] })
    const source = vtaAgentApprovalSource()
    expect(source.list()).toEqual([approval])

    const listener = jest.fn()
    const unsubscribe = source.subscribe(listener)
    expect(mockAgent.subscribe).toHaveBeenCalledWith(listener)
    const remove = mockAgent.subscribe.mock.results[0].value as jest.Mock
    expect(unsubscribe()).toBeUndefined()
    expect(remove).toHaveBeenCalledTimes(1)

    await source.decide('consent-1', 'deny', 'cancelled')
    expect(mockAgent.decide).toHaveBeenCalledWith('consent-1', 'deny', 'cancelled')
  })
})
