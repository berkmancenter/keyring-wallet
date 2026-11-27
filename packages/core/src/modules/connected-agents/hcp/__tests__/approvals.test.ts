/**
 * Finding the HCP grant's consent request: only the pending, unexpired one for the scanned link's client and thread,
 * with the five effects exactly; and reading those effects strictly.
 */
import type { VtiApproval } from '../../../trust-tasks/module/vtaAgent'
import { findHcpApproval, readHcpEffects, vtaAgentApprovalSource } from '../approvals'
import { HCP_EFFECT_KINDS, HCP_ENTRIES_CREATE } from '../types'
import {
  CLIENT_VID,
  GRANT,
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

/** The fixture with one effect's detail replaced. */
function withDetail(index: number, detail: unknown): VtiApproval {
  const effects = hcpEffects()
  effects[index] = { ...effects[index], detail }
  return hcpApproval({ effects })
}

describe('findHcpApproval', () => {
  const others: [string, VtiApproval][] = [
    ['another task type', hcpApproval({ id: 'type', taskType: HCP_ENTRIES_CREATE })],
    ['another requester', hcpApproval({ id: 'requester', requester: OTHER_VID })],
    ['another thread', withDetail(0, { ...(hcpEffects()[0].detail as object), threadId: OTHER_THREAD })],
    [
      'a client detail naming another VID',
      withDetail(0, { ...(hcpEffects()[0].detail as object), clientVid: OTHER_VID }),
    ],
    ['a missing kind', hcpApproval({ id: 'missing', effects: hcpEffects().slice(0, 4) })],
    ['a repeated kind', hcpApproval({ id: 'repeated', effects: [...hcpEffects().slice(0, 4), hcpEffects()[3]] })],
    [
      'kinds out of order',
      hcpApproval({ id: 'order', effects: [hcpEffects()[1], hcpEffects()[0], ...hcpEffects().slice(2)] }),
    ],
    ['a sixth effect', hcpApproval({ id: 'sixth', effects: [...hcpEffects(), { kind: 'other', summary: 'x' }] })],
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

  it('takes it up to one millisecond before its expiresAt', () => {
    const approval = hcpApproval()
    expect(findHcpApproval([approval], LINK, new Date(Date.parse(approval.expiresAt) - 1))).toBe(approval)
    expect(findHcpApproval([approval], LINK, new Date(Date.parse(approval.expiresAt)))).toBeUndefined()
  })
})

describe('readHcpEffects', () => {
  // control: the well-formed effects are read, summaries verbatim and in order.
  it('reads the well-formed effects', () => {
    const read = readHcpEffects(hcpApproval())
    expect(read).toEqual({
      client: {
        clientVid: CLIENT_VID,
        clientName: 'hcp-cli',
        operator: { id: 'did:web:labs.example', name: 'Example Labs' },
        threadId: THREAD,
        grantId: GRANT,
      },
      access: {
        access: [
          {
            actions: ['read'],
            categories: ['general_preferences'],
            purposes: [{ code: 'personalization', description: 'tailor its answers' }],
          },
        ],
      },
      useUntil: { maxUseSeconds: 600 },
      term: { grantType: 'temporary', expiresInSeconds: 14400 },
      rows: ROWS,
    })
  })

  const client = hcpEffects()[0].detail as Record<string, unknown>
  const access = (hcpEffects()[1].detail as { access: Record<string, unknown>[] }).access[0]
  const malformed: [string, number, unknown][] = [
    ['client: no detail', 0, undefined],
    ['client: clientVid not a string', 0, { ...client, clientVid: 7 }],
    ['client: no clientName', 0, { ...client, clientName: undefined }],
    ['client: operator not an object', 0, { ...client, operator: 'Example Labs' }],
    ['client: operator without a name', 0, { ...client, operator: { id: 'did:web:labs.example' } }],
    ['client: threadId not a urn:uuid', 0, { ...client, threadId: 'thread-1' }],
    ['client: grantId not a urn:uuid', 0, { ...client, grantId: 'grant-1' }],
    ['access: not a list', 1, { access: access }],
    ['access: empty', 1, { access: [] }],
    ['access: actions not strings', 1, { access: [{ ...access, actions: [1] }] }],
    ['access: no categories', 1, { access: [{ ...access, categories: [] }] }],
    ['access: a purpose without a description', 1, { access: [{ ...access, purposes: [{ code: 'x' }] }] }],
    ['useUntil: not an integer', 2, { maxUseSeconds: 1.5 }],
    ['useUntil: a string', 2, { maxUseSeconds: '600' }],
    ['term: persistent', 3, { grantType: 'persistent', expiresInSeconds: 14400 }],
    ['term: no expiresInSeconds', 3, { grantType: 'temporary' }],
    ['term: zero seconds', 3, { grantType: 'temporary', expiresInSeconds: 0 }],
    ['notSignIn: not empty', 4, { anything: true }],
    ['notSignIn: no detail', 4, undefined],
  ]

  it.each(malformed)('refuses %s', (_what, index, detail) => {
    expect(readHcpEffects(withDetail(index, detail))).toBeUndefined()
  })

  it('refuses an empty or missing summary', () => {
    for (const summary of ['', undefined, 3]) {
      const effects = hcpEffects()
      effects[2] = { ...effects[2], summary }
      expect(readHcpEffects(hcpApproval({ effects }))).toBeUndefined()
    }
  })

  it('reads the kinds in HCP_EFFECT_KINDS order only', () => {
    expect(hcpEffects().map((e) => e.kind)).toEqual([...HCP_EFFECT_KINDS])
    expect(readHcpEffects(hcpApproval({ effects: [...hcpEffects()].reverse() }))).toBeUndefined()
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
