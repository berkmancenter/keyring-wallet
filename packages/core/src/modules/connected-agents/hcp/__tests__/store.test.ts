/**
 * The HCP connection record (C2): put, get, list and update over the module's keyed generic records, one record per
 * client VID, apart from the base path's `AgentConnectionStore`; and the record part 2's `onApproved` writes.
 */
import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { AgentConnectionStore } from '../../store'
import { agentRecord } from '../../testing/fixtures'
import {
  beginHcpApproval,
  hcpApprovalInFlight,
  hcpConnectionFromApproval,
  HcpConnectionStore,
  recordHcpApproval,
} from '../store'
import type { HcpApprovalInFlight, HcpApprovalView, HcpConnection } from '../types'
import { CLIENT_VID, GRANT, GRANT_EXPIRES_AT, OTHER_THREAD, OTHER_VID, THREAD } from './fixtures/hcpApproval'

const SECOND_THREAD = OTHER_THREAD
const RESEARCH = 'https://example.org/purpose/research'

function fakeAgent() {
  const genericRecords = memoryGenericRecords()
  return { agent: { genericRecords } as unknown as Agent, genericRecords }
}

const connection = (change: Partial<HcpConnection> = {}): HcpConnection => ({
  id: CLIENT_VID,
  name: 'My notes agent',
  grantId: GRANT,
  threadId: THREAD,
  approvedAt: '2026-11-27T10:01:00.000Z',
  expiresAt: GRANT_EXPIRES_AT,
  ...change,
})

/** The record written for {@link view}: no grantId, since a §5.1 request names none. */
const { grantId: _noGrant, ...approved } = connection()

const view = (change: Partial<HcpApprovalView> = {}): HcpApprovalView => ({
  title: { key: 'ApproveTitle', params: { name: 'My notes agent' } },
  rows: [],
  warning: { key: 'ApproveOwnTerminal' },
  approve: { key: 'Approve' },
  clientVid: CLIENT_VID,
  threadId: THREAD,
  expiresAt: GRANT_EXPIRES_AT,
  operator: 'Example Labs',
  persistence: 'temporary',
  ...change,
})

describe('HcpConnectionStore', () => {
  it('puts, gets and lists one record per client VID: a second put replaces the first', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.put(connection())
    await store.put(connection({ name: 'Renamed' }))
    await store.put(connection({ id: OTHER_VID, name: 'Other' }))
    expect(genericRecords.records).toHaveLength(2)
    expect(genericRecords.records[0].tags).toEqual({
      recordType: 'keyring/hcp-connection',
      kind: 'connection',
      key: CLIENT_VID,
    })
    expect(await store.get(CLIENT_VID)).toEqual(connection({ name: 'Renamed' }))
    expect((await store.list()).map((c) => c.name).sort()).toEqual(['Other', 'Renamed'])
    expect(await store.get('did:key:z6MkNeverThere')).toBeUndefined()
  })

  it('update changes one record under its lock, and two concurrent updates keep both changes', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.put(connection())
    await Promise.all([
      store.update(CLIENT_VID, (c) => ({ ...c, revokedAt: '2026-11-27T11:00:00.000Z' })),
      store.update(CLIENT_VID, (c) => ({ ...c, notice: { state: 'telling' } })),
    ])
    expect(await store.get(CLIENT_VID)).toEqual(
      connection({ revokedAt: '2026-11-27T11:00:00.000Z', notice: { state: 'telling' } })
    )
  })

  it('update of an absent record writes nothing and gives undefined; a change of id throws', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    expect(await store.update(CLIENT_VID, (c) => ({ ...c, name: 'x' }))).toBeUndefined()
    expect(genericRecords.records).toHaveLength(0)
    await store.put(connection())
    await expect(store.update(CLIENT_VID, (c) => ({ ...c, id: OTHER_VID }))).rejects.toThrow('cannot change')
    expect(await store.get(CLIENT_VID)).toEqual(connection())
  })

  it('an update that returns the record it was given writes nothing', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.put(connection())
    genericRecords.update.mockClear()
    await store.update(CLIENT_VID, (c) => c)
    expect(genericRecords.update).not.toHaveBeenCalled()
  })

  it("does not list an AgentConnectionStore record, and AgentConnectionStore does not list this store's", async () => {
    const { agent } = fakeAgent()
    const hcp = new HcpConnectionStore(agent)
    const base = new AgentConnectionStore(agent)
    await hcp.put(connection({ id: agentRecord().id }))
    await base.put(agentRecord())
    expect((await hcp.list()).map((c) => c.name)).toEqual(['My notes agent'])
    expect((await base.list()).map((c) => c.name)).toEqual([agentRecord().name])
    expect((await hcp.get(agentRecord().id))?.grantId).toBe(GRANT)
  })

  // control: the same two stores over one record type would see each other's records.
  it('control: a record under the base store type is not an HCP record', async () => {
    const { agent, genericRecords } = fakeAgent()
    await new AgentConnectionStore(agent).put(agentRecord())
    expect(genericRecords.records).toHaveLength(1)
    expect(await new HcpConnectionStore(agent).list()).toEqual([])
  })
})

describe('the record written on approval', () => {
  it('approvedAt is the instant decide resolved, expiresAt the grant term’s, the name the person gave', () => {
    const at = new Date('2026-11-27T10:01:02.345Z')
    expect(hcpConnectionFromApproval(view(), at)).toEqual({ ...approved, approvedAt: '2026-11-27T10:01:02.345Z' })
  })

  it('carries a grantId and the chosen purpose when the view has them', () => {
    const at = new Date('2026-11-27T10:01:00.000Z')
    expect(hcpConnectionFromApproval(view({ grantId: GRANT, chosenPurpose: RESEARCH }), at)).toEqual({
      ...connection(),
      chosenPurpose: RESEARCH,
    })
  })

  it('recordHcpApproval puts that record', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await recordHcpApproval(store)(view(), new Date('2026-11-27T10:01:00.000Z'))
    expect(await store.list()).toEqual([approved])
  })
})

describe('the approval in flight', () => {
  const APPROVAL = { id: 'consent-1', expiresAt: '2026-11-27T10:05:00.000Z' }
  const STARTED = new Date('2026-11-27T10:00:30.000Z')
  const inFlight = (): HcpApprovalInFlight => inFlightFor(THREAD)

  it('beginHcpApproval writes it under its own kind, keyed by thread, and lists no connection', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await beginHcpApproval(store)(view(), APPROVAL, STARTED)
    expect(hcpApprovalInFlight(view(), APPROVAL, STARTED)).toEqual(inFlight())
    expect(await store.listInFlight()).toEqual([inFlight()])
    expect(await store.getInFlight(THREAD)).toEqual(inFlight())
    expect(genericRecords.records[0].tags).toEqual({
      recordType: 'keyring/hcp-connection',
      kind: 'approving',
      key: THREAD,
    })
    expect(await store.list()).toEqual([])
  })

  it('records the chosen purpose, and a grantId the request named', () => {
    expect(hcpApprovalInFlight(view({ grantId: GRANT, chosenPurpose: RESEARCH }), APPROVAL, STARTED)).toEqual({
      ...inFlight(),
      grantId: GRANT,
      chosenPurpose: RESEARCH,
    })
  })

  it('leaves an existing connection for the client as it is until the new approval completes', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    const earlier = connection({ threadId: SECOND_THREAD })
    await store.put(earlier)
    await beginHcpApproval(store)(view(), APPROVAL, STARTED)
    expect(await store.get(CLIENT_VID)).toEqual(earlier)
  })

  it('recordHcpApproval makes it the connection and removes it, as one step', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await beginHcpApproval(store)(view(), APPROVAL, STARTED)
    await recordHcpApproval(store)(view(), new Date('2026-11-27T10:01:00.000Z'))
    expect(await store.list()).toEqual([approved])
    expect(await store.listInFlight()).toEqual([])
  })

  // control: completing another thread's grant for the same client does not remove this one.
  it('control: removeInFlight and complete keep an approval in flight for another thread', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.putInFlight(inFlight())
    expect(await store.removeInFlight(CLIENT_VID, SECOND_THREAD)).toBe(false)
    await store.complete(connection({ threadId: SECOND_THREAD }))
    expect(await store.listInFlight()).toEqual([inFlight()])
    expect(await store.removeInFlight(CLIENT_VID, THREAD)).toBe(true)
    expect(await store.listInFlight()).toEqual([])
  })

  it("a second approval for the same client is written beside the first, never over it; each is its thread's", async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    const second = { ...inFlightFor(SECOND_THREAD), approvalId: 'consent-2' }
    await store.putInFlight(inFlight())
    await store.putInFlight(second)
    expect(await store.listInFlight()).toEqual(expect.arrayContaining([inFlight(), second]))
    expect(await store.listInFlight()).toHaveLength(2)
    expect(await store.getInFlight(THREAD)).toEqual(inFlight())
    expect(await store.getInFlight(SECOND_THREAD)).toEqual(second)
    // Removing one, or completing one, leaves the other.
    expect(await store.removeInFlight(OTHER_VID, THREAD)).toBe(false)
    await store.complete(connection({ threadId: SECOND_THREAD }))
    expect(await store.listInFlight()).toEqual([inFlight()])
  })
})

describe('a connection replaced while its grant may be live', () => {
  const NOW = new Date('2026-11-27T12:00:00.000Z')
  const retired = {
    id: CLIENT_VID,
    name: 'My notes agent',
    grantId: GRANT,
    threadId: THREAD,
    expiresAt: GRANT_EXPIRES_AT,
    approvedAt: '2026-11-27T10:01:00.000Z',
    retiredAt: NOW.toISOString(),
  }

  it('complete over a live connection for another thread keeps that grant as retiring, in the same step', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.put(connection())
    const newer = connection({ grantId: undefined, threadId: SECOND_THREAD, approvedAt: '2026-11-27T11:00:00.000Z' })
    await store.complete(newer, NOW)
    expect(await store.get(CLIENT_VID)).toEqual(newer)
    expect(await store.listRetiring()).toEqual([retired])
    expect(await store.removeRetiring(OTHER_VID, THREAD)).toBe(false)
    expect(await store.removeRetiring(CLIENT_VID, THREAD)).toBe(true)
    expect(await store.listRetiring()).toEqual([])
  })

  it('a retired grant whose id was never learnt is kept without one, keyed by its thread', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.put(approved)
    await store.complete(connection({ threadId: SECOND_THREAD, approvedAt: '2026-11-27T11:00:00.000Z' }), NOW)
    const { grantId: _none, ...withoutId } = retired
    expect(await store.listRetiring()).toEqual([withoutId])
  })

  it('putRetiring writes a retiring grant by its thread; removeRetiringIfCurrent removes it only while named', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.putRetiring(retired)
    await store.put(connection({ threadId: SECOND_THREAD }))
    expect(await store.removeRetiringIfCurrent(CLIENT_VID, THREAD)).toBe(false)
    await store.put(connection())
    expect(await store.removeRetiringIfCurrent(CLIENT_VID, THREAD)).toBe(true)
    expect(await store.listRetiring()).toEqual([])
  })

  // control: a revoked grant is not live, and completing the same thread again replaces nothing.
  it('control: nothing is retired over a revoked connection, nor by completing the same thread', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.put(connection({ revokedAt: '2026-11-27T10:30:00.000Z' }))
    await store.complete(connection({ threadId: SECOND_THREAD, approvedAt: '2026-11-27T11:00:00.000Z' }), NOW)
    await store.complete(connection({ threadId: SECOND_THREAD, approvedAt: '2026-11-27T11:00:00.000Z' }), NOW)
    expect(await store.listRetiring()).toEqual([])
    expect((await store.get(CLIENT_VID))?.threadId).toBe(SECOND_THREAD)
  })

  it('an approval older than the connection does not replace it: its own grant is the one kept as retiring', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    const newer = connection({ threadId: SECOND_THREAD, approvedAt: '2026-11-27T11:00:00.000Z' })
    await store.put(newer)
    await store.putInFlight(inFlightFor(THREAD))
    await store.complete(connection(), NOW)
    expect(await store.get(CLIENT_VID)).toEqual(newer)
    expect((await store.listRetiring()).map((r) => r.threadId)).toEqual([THREAD])
    expect(await store.listInFlight()).toEqual([])
  })
})

function inFlightFor(threadId: string): HcpApprovalInFlight {
  return {
    id: CLIENT_VID,
    name: 'My notes agent',
    threadId,
    approvalId: 'consent-1',
    approvalExpiresAt: '2026-11-27T10:05:00.000Z',
    expiresAt: GRANT_EXPIRES_AT,
    startedAt: '2026-11-27T10:00:30.000Z',
  }
}
