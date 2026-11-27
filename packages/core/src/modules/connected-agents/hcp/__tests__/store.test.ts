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
import { CLIENT_VID, GRANT, OTHER_VID, THREAD } from './fixtures/hcpApproval'

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
  expiresAt: '2026-11-27T14:01:00.000Z',
  ...change,
})

const view = (): HcpApprovalView => ({
  title: { key: 'ApproveTitle', params: { name: 'My notes agent' } },
  rows: [],
  warning: { key: 'ApproveOwnTerminal' },
  approve: { key: 'Approve' },
  clientVid: CLIENT_VID,
  grantId: GRANT,
  threadId: THREAD,
  expiresInSeconds: 14400,
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
  it('approvedAt is the instant decide resolved, expiresAt that plus expiresInSeconds, the name the person gave', () => {
    const at = new Date('2026-11-27T10:01:02.345Z')
    expect(hcpConnectionFromApproval(view(), at)).toEqual({
      id: CLIENT_VID,
      name: 'My notes agent',
      grantId: GRANT,
      threadId: THREAD,
      approvedAt: '2026-11-27T10:01:02.345Z',
      expiresAt: '2026-11-27T14:01:02.345Z',
    })
  })

  it('recordHcpApproval puts that record', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await recordHcpApproval(store)(view(), new Date('2026-11-27T10:01:00.000Z'))
    expect(await store.list()).toEqual([connection()])
  })
})

describe('the approval in flight', () => {
  const APPROVAL = { id: 'consent-1', expiresAt: '2026-11-27T10:05:00.000Z' }
  const STARTED = new Date('2026-11-27T10:00:30.000Z')
  const inFlight = (): HcpApprovalInFlight => ({
    id: CLIENT_VID,
    name: 'My notes agent',
    grantId: GRANT,
    threadId: THREAD,
    approvalId: 'consent-1',
    approvalExpiresAt: '2026-11-27T10:05:00.000Z',
    expiresInSeconds: 14400,
    startedAt: '2026-11-27T10:00:30.000Z',
  })

  it('beginHcpApproval writes it under its own kind, naming the grant, and lists no connection', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await beginHcpApproval(store)(view(), APPROVAL, STARTED)
    expect(hcpApprovalInFlight(view(), APPROVAL, STARTED)).toEqual(inFlight())
    expect(await store.listInFlight()).toEqual([inFlight()])
    expect(await store.getInFlight(CLIENT_VID)).toEqual(inFlight())
    expect(genericRecords.records[0].tags).toEqual({
      recordType: 'keyring/hcp-connection',
      kind: 'approving',
      key: CLIENT_VID,
    })
    expect(await store.list()).toEqual([])
  })

  it('leaves an existing connection for the client as it is until the new approval completes', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    const earlier = connection({ grantId: 'urn:uuid:00000000-0000-4000-8000-000000000000' })
    await store.put(earlier)
    await beginHcpApproval(store)(view(), APPROVAL, STARTED)
    expect(await store.get(CLIENT_VID)).toEqual(earlier)
  })

  it('recordHcpApproval makes it the connection and removes it, as one step', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await beginHcpApproval(store)(view(), APPROVAL, STARTED)
    await recordHcpApproval(store)(view(), new Date('2026-11-27T10:01:00.000Z'))
    expect(await store.list()).toEqual([connection()])
    expect(await store.listInFlight()).toEqual([])
  })

  // control: completing another grant for the same client does not remove this one.
  it('control: removeInFlight and complete keep an approval in flight for another grant', async () => {
    const { agent } = fakeAgent()
    const store = new HcpConnectionStore(agent)
    await store.putInFlight(inFlight())
    expect(await store.removeInFlight(CLIENT_VID, 'urn:uuid:00000000-0000-4000-8000-000000000000')).toBe(false)
    await store.complete(connection({ grantId: 'urn:uuid:00000000-0000-4000-8000-000000000000' }))
    expect(await store.listInFlight()).toEqual([inFlight()])
    expect(await store.removeInFlight(CLIENT_VID, GRANT)).toBe(true)
    expect(await store.listInFlight()).toEqual([])
  })
})
