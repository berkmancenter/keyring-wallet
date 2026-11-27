/**
 * One read of each agent's entry (backlog fb-2): `listed` by deviceId first, then by subject; `notListed` only from a
 * complete, empty listing for a record with a deviceId; everything else `unknown`. Only `active` and `expired` records
 * are read, and `entryContexts` gives drift a value only from a listed entry stating `contexts` or `none`.
 */
import type { AccessEntry, AgentAccessPort } from '../carriage'
import { entryContexts, readAgentEntries, readAgentEntry, type EntryRead } from '../entryRead'
import { agentRecord } from '../testing/fixtures'
import type { AgentConnection } from '../types'

const K_A = 'did:key:z6MkAgentFirstKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const K_B = 'did:key:z6MkAgentSecondKeyBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const DEVICE = 'device-notes-helper'

const entry = (subject: string, contexts: string[] = ['keyring-memory-educat1on']): AccessEntry => ({
  subject,
  role: 'application',
  act: { stated: 'contexts', contexts },
})

type Found = Awaited<ReturnType<AgentAccessPort['findAgentEntries']>>
type Query = Parameters<AgentAccessPort['findAgentEntries']>[0]

/** A port answering `answer` (or throwing it), recording every query. */
function port(answer: Found | Error) {
  const queries: Query[] = []
  const access: Pick<AgentAccessPort, 'findAgentEntries'> = {
    async findAgentEntries(query) {
      queries.push(query)
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return { access, queries }
}

describe('readAgentEntry', () => {
  it('asks by deviceId and subject, and a deviceId match beats a subject match', async () => {
    const byDevice = entry(K_B, ['keyring-memory-hea1thcar'])
    const { access, queries } = port({
      complete: true,
      matches: [{ entry: entry(K_A) }, { entry: byDevice, deviceId: DEVICE }],
    })
    const read = await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })
    expect(read).toEqual({ kind: 'listed', entry: byDevice })
    expect(queries).toEqual([{ deviceId: DEVICE, subject: K_A }])
  })

  it('a rotated entry (the deviceId under another subject) is listed', async () => {
    const rotated = entry(K_B)
    const { access } = port({ complete: true, matches: [{ entry: rotated, deviceId: DEVICE }] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })).toEqual({
      kind: 'listed',
      entry: rotated,
    })
  })

  it('with no deviceId, matches by subject and leaves deviceId out of the query', async () => {
    const mine = entry(K_A)
    const { access, queries } = port({ complete: true, matches: [{ entry: mine }] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: '' })).toEqual({ kind: 'listed', entry: mine })
    expect(queries).toEqual([{ subject: K_A }])
  })

  it('a complete listing with a row it cannot place (a new key, no deviceId echoed) is unknown', async () => {
    const { access } = port({ complete: true, matches: [{ entry: entry(K_B) }] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })).toEqual({ kind: 'unknown' })
  })

  it("a complete listing with a row echoing another device's deviceId under a new key is unknown", async () => {
    // two devices sharing a key can make the port echo the other one's deviceId: the row is no proof of absence
    const { access } = port({ complete: true, matches: [{ entry: entry(K_B), deviceId: 'device-other' }] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })).toEqual({ kind: 'unknown' })
  })

  it('with no deviceId, a complete miss is unknown: a rotated entry is invisible by key alone', async () => {
    const { access } = port({ complete: true, matches: [] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: '' })).toEqual({ kind: 'unknown' })
  })

  it('a partial listing with no match is unknown', async () => {
    const { access } = port({ complete: false, matches: [] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })).toEqual({ kind: 'unknown' })
  })

  it('a partial listing that holds the entry is still listed', async () => {
    const mine = entry(K_A)
    const { access } = port({ complete: false, matches: [{ entry: mine, deviceId: DEVICE }] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })).toEqual({ kind: 'listed', entry: mine })
  })

  it('a throw is unknown', async () => {
    const { access } = port(new Error('VTA not answering'))
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })).toEqual({ kind: 'unknown' })
  })

  it('control: a complete, empty listing for a record with a deviceId is notListed', async () => {
    // control: an empty listing and the deviceId are what make this miss proof of absence; the no-deviceId miss and
    // the unplaced rows above are unknown
    const { access } = port({ complete: true, matches: [] })
    expect(await readAgentEntry(access, { agentDid: K_A, deviceId: DEVICE })).toEqual({ kind: 'notListed' })
  })
})

describe('readAgentEntries', () => {
  const states: AgentConnection['state'][] = ['pairing', 'active', 'expired', 'revoking', 'revoked', 'notFinished']
  const records = states.map((state) =>
    agentRecord({ id: `did:key:z6Mk-${state}`, agentDid: `did:key:z6Mk-${state}`, deviceId: `device-${state}`, state })
  )

  it('reads only active and expired records, one at a time, keyed by record id', async () => {
    let inFlight = 0
    let most = 0
    const queries: Query[] = []
    const access: Pick<AgentAccessPort, 'findAgentEntries'> = {
      async findAgentEntries(query) {
        queries.push(query)
        inFlight += 1
        most = Math.max(most, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 0))
        inFlight -= 1
        return { complete: true, matches: [{ entry: entry(query.subject as string), deviceId: query.deviceId }] }
      },
    }
    const reads = await readAgentEntries(access, records)
    expect([...reads.keys()]).toEqual(['did:key:z6Mk-active', 'did:key:z6Mk-expired'])
    expect(reads.get('did:key:z6Mk-active')).toEqual({ kind: 'listed', entry: entry('did:key:z6Mk-active') })
    expect(queries.map((q) => q.deviceId)).toEqual(['device-active', 'device-expired'])
    expect(most).toBe(1)
  })

  it('revoking, pairing and notFinished are not read', async () => {
    const { access, queries } = port({ complete: true, matches: [] })
    const unread = records.filter((r) => ['revoking', 'pairing', 'notFinished'].includes(r.state))
    expect((await readAgentEntries(access, unread)).size).toBe(0)
    expect(queries).toEqual([])
  })

  it('keys by record id even after the agent key changed', async () => {
    const record = agentRecord({ id: K_A, agentDid: K_B, deviceId: DEVICE })
    const { access } = port({ complete: true, matches: [{ entry: entry(K_B), deviceId: DEVICE }] })
    const reads = await readAgentEntries(access, [record])
    expect(reads.get(K_A)).toEqual({ kind: 'listed', entry: entry(K_B) })
  })
})

describe('entryContexts', () => {
  it('a listed entry stating contexts gives its contexts', () => {
    expect(entryContexts({ kind: 'listed', entry: entry(K_A, ['keyring-memory-a', 'keyring-memory-b']) })).toEqual([
      'keyring-memory-a',
      'keyring-memory-b',
    ])
  })

  it('a listed entry with contexts stated but none given gives []', () => {
    expect(
      entryContexts({ kind: 'listed', entry: { subject: K_A, role: 'application', act: { stated: 'contexts' } } })
    ).toEqual([])
  })

  it('a listed entry stating none gives []', () => {
    expect(
      entryContexts({ kind: 'listed', entry: { subject: K_A, role: 'application', act: { stated: 'none' } } })
    ).toEqual([])
  })

  it('a listed entry stating all or byShape, or with no act, gives undefined', () => {
    for (const stated of ['all', 'byShape']) {
      const read: EntryRead = { kind: 'listed', entry: { subject: K_A, role: 'application', act: { stated } } }
      expect(entryContexts(read)).toBeUndefined()
    }
    expect(entryContexts({ kind: 'listed', entry: { subject: K_A, role: 'application' } })).toBeUndefined()
  })

  it('notListed, unknown and no read give undefined', () => {
    const none: (EntryRead | undefined)[] = [{ kind: 'notListed' }, { kind: 'unknown' }, undefined]
    for (const read of none) expect(entryContexts(read)).toBeUndefined()
  })

  it('the result is a copy, so changing it leaves the entry alone', () => {
    const listed = entry(K_A, ['keyring-memory-a'])
    const contexts = entryContexts({ kind: 'listed', entry: listed }) as string[]
    contexts.push('keyring-memory-b')
    expect(listed.act?.contexts).toEqual(['keyring-memory-a'])
  })
})
