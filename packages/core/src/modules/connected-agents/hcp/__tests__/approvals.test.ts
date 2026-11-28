/**
 * Finding the HCP grant's consent request: only the pending, unexpired one for the scanned link's client and thread
 * (VTI hcp.md §5.1: the thread is the document's `parentThreadId`); and reading its effects in any order, with exactly
 * one `hcpClient` and one `hcpGrantTerm`, an unknown kind kept as its row.
 */
import type { VtiApproval } from '../../../trust-tasks/module/vtaAgent'
import { findHcpApproval, hcpApprovalThread, hcpOperatorId, readHcpEffects, vtaAgentApprovalSource } from '../approvals'
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
    [
      "one from another person's agent (forAgent)",
      hcpApproval({ id: 'foreign', forAgent: { agentDid: 'did:web:other.example', asker: 'Sam' } }),
    ],
    [
      'a detail threadId alone, with no parentThreadId',
      withDetail(0, { ...CLIENT, threadId: THREAD }, { id: 'detailonly', parentThreadId: undefined }),
    ],
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

  it('matches on the parentThreadId, with a detail threadId only as a value that must agree', () => {
    expect(findHcpApproval([withDetail(0, { ...CLIENT, threadId: THREAD })], LINK, NOW)).toBeDefined()
    // control: a detail threadId alone is never a source, even for the scanned thread.
    expect(
      findHcpApproval([withDetail(0, { ...CLIENT, threadId: THREAD }, { parentThreadId: undefined })], LINK, NOW)
    ).toBeUndefined()
  })

  it('takes it up to one millisecond before its expiresAt', () => {
    const approval = hcpApproval()
    expect(findHcpApproval([approval], LINK, new Date(Date.parse(approval.expiresAt) - 1))).toBe(approval)
    expect(findHcpApproval([approval], LINK, new Date(Date.parse(approval.expiresAt)))).toBeUndefined()
  })
})

describe('hcpApprovalThread', () => {
  it('is the parentThreadId, required; undefined when a detail threadId disagrees or stands alone', () => {
    const read = (a: VtiApproval) => hcpApprovalThread(a, readHcpEffects(a)!)
    expect(read(hcpApproval())).toBe(THREAD)
    expect(read(withDetail(0, { ...CLIENT, threadId: OTHER_THREAD }, { parentThreadId: undefined }))).toBeUndefined()
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

  /** The fixture with its named purpose replaced by `choose: true` ones. */
  const choosing = (...choices: unknown[]) => hcpEffects().flatMap((e, i) => (i === 2 ? choices : [e]))
  const ROWS_BUT_PURPOSE = ROWS.filter((_, i) => i !== 2)

  it('puts a choose:true purpose among the choices, by its summary, and not among the rows or purposes', () => {
    const read = readHcpEffects(hcpApproval({ effects: choosing(CHOOSE) }))
    expect(read?.rows).toEqual(ROWS_BUT_PURPOSE)
    expect(read?.choices).toEqual([
      { summary: CHOOSE.summary, purpose: CHOOSE.detail.purpose, description: CHOOSE.detail.description },
    ])
    expect(read?.purposes).toEqual([])
  })

  it('B3: a choose:true purpose whose detail is otherwise malformed is still a choice, never a row', () => {
    const bad = { ...CHOOSE, detail: { choose: true } }
    const read = readHcpEffects(hcpApproval({ effects: choosing(bad) }))
    expect(read?.rows).toEqual(ROWS_BUT_PURPOSE)
    expect(read?.choices).toEqual([{ summary: CHOOSE.summary }])
  })

  it('N6: refuses named and choose:true purposes mixed, and a request with no hcpCategory', () => {
    expect(readHcpEffects(hcpApproval({ effects: [...hcpEffects(), CHOOSE] }))).toBeUndefined()
    expect(readHcpEffects(hcpApproval({ effects: without(1) }))).toBeUndefined()
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

describe('hcpOperatorId', () => {
  it('S12: text gives itself, an object its id, and an object with only a name gives none', () => {
    expect(hcpOperatorId('did:web:labs.example')).toBe('did:web:labs.example')
    expect(hcpOperatorId({ id: 'did:web:labs.example', name: 'Example Labs' })).toBe('did:web:labs.example')
    expect(hcpOperatorId({ name: 'Example Labs' })).toBeUndefined()
    expect(hcpOperatorId(undefined)).toBeUndefined()
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
