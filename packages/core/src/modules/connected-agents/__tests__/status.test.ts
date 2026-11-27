import { agentContacts, isContactStatus, memoryDrift, statusOf, viewOf } from '../status'
import {
  agentRecord,
  FIXTURE_NOW,
  fixtureNames,
  RECORD_FOR_STATUS,
  SPECIAL_VIEWS,
  viewForStatus,
} from '../testing/fixtures'
import { AGENT_STATUSES, type AgentStatus } from '../types'

const HOUR = 60 * 60 * 1000

describe('statusOf: what a stored connection shows (§6)', () => {
  it.each(AGENT_STATUSES)('the fixture for %s shows %s', (status: AgentStatus) => {
    const { record, reachable } = RECORD_FOR_STATUS[status]
    expect(statusOf(record, FIXTURE_NOW, reachable === undefined ? undefined : { reachable })).toBe(status)
  })

  it('a pairing in progress is not a row', () => {
    expect(statusOf(agentRecord({ state: 'pairing' }), FIXTURE_NOW)).toBeUndefined()
  })

  it('an active temporary agent becomes Expired at its expiresAt, before Keyring writes the state', () => {
    const record = agentRecord({ expiresAt: new Date(FIXTURE_NOW).toISOString() })
    expect(statusOf(record, FIXTURE_NOW - 1)).toBe('connectedUntil')
    expect(statusOf(record, FIXTURE_NOW)).toBe('expired')
  })

  it('Expired wins over Not connected right now (§7 item 24, §3.10 "ACL entry expires")', () => {
    const record = agentRecord({ expiresAt: new Date(FIXTURE_NOW - HOUR).toISOString() })
    expect(statusOf(record, FIXTURE_NOW, { reachable: false })).toBe('expired')
  })

  it('a persistent agent never expires on the clock', () => {
    const record = agentRecord({ grantType: 'persistent', expiresAt: undefined })
    expect(statusOf(record, FIXTURE_NOW + 1000 * HOUR)).toBe('connected')
  })

  it('control: a reachable answer leaves a temporary agent Connected until', () => {
    expect(statusOf(agentRecord(), FIXTURE_NOW, { reachable: true })).toBe('connectedUntil')
  })
})

describe('which agents are contacts (#1060 finding 10)', () => {
  it('only the statuses with access, or possibly still with access', () => {
    expect(AGENT_STATUSES.filter(isContactStatus)).toEqual([
      'connected',
      'connectedUntil',
      'unreachable',
      'revokeNotConfirmed',
    ])
    expect(isContactStatus(undefined)).toBe(false)
  })

  it('agentContacts lists them by name, and leaves out expired, revoked, unfinished and pairing agents', () => {
    const records = [
      ...AGENT_STATUSES.map((s) => RECORD_FOR_STATUS[s].record),
      agentRecord({ id: 'did:key:z6MkPairing', name: 'A pairing', state: 'pairing' }),
    ]
    const reach = (id: string) => (id === RECORD_FOR_STATUS.unreachable.record.id ? { reachable: false } : undefined)
    expect(agentContacts(records, FIXTURE_NOW, reach).map((c) => c.name)).toEqual([
      'Inbox triage',
      'Not confirmed',
      'Notes helper',
      'Travel agent',
    ])
  })
})

describe('memoryDrift (§3.15 step 5)', () => {
  const record = { memoryContexts: ['a', 'b'], pendingContexts: [] as string[] }

  it('nothing when the entry holds exactly the bound memories', () => {
    expect(memoryDrift(record, ['b', 'a'])).toBeUndefined()
  })

  it('a context the owner did not bind is extra; a bound one the entry lost is missing', () => {
    expect(memoryDrift(record, ['a', 'x'])).toEqual({ extra: ['x'], missing: ['b'] })
  })

  it('a memory still pending from a one-context grant is not missing (§7.5)', () => {
    expect(memoryDrift({ memoryContexts: ['a', 'b'], pendingContexts: ['b'] }, ['a'])).toBeUndefined()
  })

  it("the agent's own empty context, passed as allowed, is not extra", () => {
    expect(memoryDrift({ memoryContexts: [], pendingContexts: [] }, ['own'], ['own'])).toBeUndefined()
    expect(memoryDrift({ memoryContexts: [], pendingContexts: [] }, ['own'])).toEqual({ extra: ['own'], missing: [] })
  })
})

describe('viewOf: what a screen draws', () => {
  it('names memories, never shows a context id as a name, and carries the purposes for Extend', () => {
    const view = viewForStatus('connectedUntil')
    expect(view.memories).toEqual([
      { id: 'keyring-memory-educat1on', name: 'Education' },
      { id: 'keyring-memory-hea1thcar', name: 'Healthcare' },
    ])
    expect(view.purposes).toEqual(['personalisation', 'taskExecution'])
    expect(view.expiresAt).toBe(FIXTURE_NOW + 2.5 * HOUR)
    const unknown = viewOf(agentRecord({ memoryContexts: ['keyring-memory-unknownxx'] }), {
      now: FIXTURE_NOW,
      names: fixtureNames,
    })
    expect(unknown?.memories[0]).toEqual({ id: 'keyring-memory-unknownxx', name: '' })
  })

  it('a persistent agent has no expiresAt', () => {
    expect(viewForStatus('connected').expiresAt).toBeUndefined()
  })

  it('drift, pending and a changed key each reach the view', () => {
    expect(SPECIAL_VIEWS.drift().drift).toEqual({
      extra: [{ id: 'keyring-memory-trave1abc', name: 'Travel' }],
      missing: [{ id: 'keyring-memory-hea1thcar', name: 'Healthcare' }],
    })
    const pending = SPECIAL_VIEWS.pending()
    expect(pending.pending).toEqual([{ id: 'keyring-memory-hea1thcar', name: 'Healthcare' }])
    expect(pending.memories).toEqual([{ id: 'keyring-memory-educat1on', name: 'Education' }])
    expect(pending.drift).toBeUndefined()
    expect(SPECIAL_VIEWS.keyChanged().keyChanged).toBe(true)
  })

  it('every status has a view', () => {
    for (const status of AGENT_STATUSES) expect(viewForStatus(status).status).toBe(status)
  })
})
