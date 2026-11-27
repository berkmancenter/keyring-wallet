/**
 * The reconcile of HCP approvals in flight, against the real `HcpConnectionStore` over memory records, a fake list of
 * consent requests and a fake VTA port: an approval in flight is completed when its request was approved (or its
 * connection was already written), waits while its request could still be approved, and otherwise has its grant
 * revoked by `grantId`, sent once. Every revoke request sent validates against the vendored schema.
 */
import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import type { VtiApproval } from '../../../trust-tasks/module/vtaAgent'
import { setAgentConnectEnabled } from '../../agentConnectFlag'
import { setHcpEnabled } from '../hcpFlag'
import { reconcileHcpApprovals, type HcpReconcileDeps } from '../reconcile'
import { HcpConnectionStore } from '../store'
import { HCP_GRANTS_REVOKE, type HcpApprovalInFlight, type HcpConnection } from '../types'
import type { HcpVtaPort } from '../vtaPort'
import { expectValid, hcpSchemas } from './fixtures/hcpSchemas'
import { CLIENT_VID, GRANT, HELD_AT, hcpApproval, OTHER_VID, THREAD } from './fixtures/hcpApproval'

const S = hcpSchemas()
const MINUTE = 60 * 1000
const STARTED = HELD_AT + 30 * 1000
/** The consent request's own expiry (the fixture's): 5 minutes after it was held. */
const REQUEST_ENDS = HELD_AT + 5 * MINUTE
const iso = (ms: number) => new Date(ms).toISOString()
const OLD_GRANT = 'urn:uuid:00000000-0000-4000-8000-000000000000'

const inFlight = (change: Partial<HcpApprovalInFlight> = {}): HcpApprovalInFlight => ({
  id: CLIENT_VID,
  name: 'My notes agent',
  grantId: GRANT,
  threadId: THREAD,
  approvalId: 'consent-1',
  approvalExpiresAt: iso(REQUEST_ENDS),
  expiresInSeconds: 14400,
  startedAt: iso(STARTED),
  ...change,
})

const refusal = (code: string) => Object.assign(new Error('refused'), { name: 'VtiRefusal', code })

async function setup(options: {
  flights?: HcpApprovalInFlight[]
  connections?: HcpConnection[]
  approvals?: VtiApproval[]
  revoke?: () => Promise<unknown>
  now: number
}) {
  const store = new HcpConnectionStore({ genericRecords: memoryGenericRecords() } as unknown as Agent)
  for (const c of options.connections ?? []) await store.put(c)
  for (const f of options.flights ?? []) await store.putInFlight(f)
  const task = jest.fn(async (type: string, payload: Record<string, unknown>) => {
    expectValid(S[type].request, payload)
    if (type !== HCP_GRANTS_REVOKE) throw new Error(`unexpected ${type}`)
    if (options.revoke) return options.revoke()
    const answer = {}
    expectValid(S[HCP_GRANTS_REVOKE].response, answer)
    return answer
  })
  const deps: HcpReconcileDeps = {
    store,
    source: { list: () => options.approvals ?? [] },
    port: { task } as HcpVtaPort,
    clock: () => new Date(options.now),
  }
  return { deps, store, task }
}

describe('reconcileHcpApprovals', () => {
  beforeEach(() => {
    setAgentConnectEnabled(true)
    setHcpEnabled(true)
  })

  it('completes an approval in flight whose request was approved, and sends nothing', async () => {
    const now = STARTED + 2 * MINUTE
    const { deps, store, task } = await setup({
      flights: [inFlight()],
      approvals: [hcpApproval({ status: 'approved' })],
      now,
    })
    expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, grantId: GRANT, outcome: 'completed' }])
    expect(await store.get(CLIENT_VID)).toEqual({
      id: CLIENT_VID,
      name: 'My notes agent',
      grantId: GRANT,
      threadId: THREAD,
      approvedAt: iso(now),
      expiresAt: iso(now + 4 * 60 * MINUTE),
    })
    expect(await store.listInFlight()).toEqual([])
    expect(task).not.toHaveBeenCalled()
  })

  it("an approval completed later than the request's own expiry is dated at that expiry, not later", async () => {
    const { deps, store } = await setup({
      flights: [inFlight()],
      approvals: [hcpApproval({ status: 'approved' })],
      now: REQUEST_ENDS + 3 * 60 * MINUTE,
    })
    await reconcileHcpApprovals(deps)
    expect((await store.get(CLIENT_VID))?.approvedAt).toBe(iso(REQUEST_ENDS))
  })

  it('removes an approval in flight whose connection was already written (a stop inside complete)', async () => {
    const written: HcpConnection = {
      id: CLIENT_VID,
      name: 'My notes agent',
      grantId: GRANT,
      threadId: THREAD,
      approvedAt: iso(STARTED + 5000),
      expiresAt: iso(STARTED + 5000 + 4 * 60 * MINUTE),
    }
    const { deps, store, task } = await setup({ flights: [inFlight()], connections: [written], now: STARTED + MINUTE })
    expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, grantId: GRANT, outcome: 'completed' }])
    expect(await store.get(CLIENT_VID)).toEqual(written)
    expect(await store.listInFlight()).toEqual([])
    expect(task).not.toHaveBeenCalled()
  })

  it('waits, sending nothing, while the request could still be approved (pending, or not listed yet)', async () => {
    for (const approvals of [[hcpApproval()], [], [hcpApproval({ status: 'failed' })]]) {
      const { deps, store, task } = await setup({ flights: [inFlight()], approvals, now: REQUEST_ENDS - 1 })
      expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, grantId: GRANT, outcome: 'waiting' }])
      expect(await store.listInFlight()).toEqual([inFlight()])
      expect(task).not.toHaveBeenCalled()
    }
  })

  it('revokes by grantId, once, a grant whose request can no longer be approved, and removes the record', async () => {
    const cases: { approvals: VtiApproval[]; now: number }[] = [
      { approvals: [], now: REQUEST_ENDS },
      { approvals: [hcpApproval()], now: REQUEST_ENDS },
      { approvals: [hcpApproval({ status: 'failed' })], now: REQUEST_ENDS + MINUTE },
      { approvals: [hcpApproval({ status: 'denied' })], now: STARTED + MINUTE },
      { approvals: [hcpApproval({ status: 'expired' })], now: STARTED + MINUTE },
    ]
    for (const { approvals, now } of cases) {
      const { deps, store, task } = await setup({ flights: [inFlight()], approvals, now })
      expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, grantId: GRANT, outcome: 'revoked' }])
      expect(task).toHaveBeenCalledTimes(1)
      expect(task.mock.calls[0][0]).toBe(HCP_GRANTS_REVOKE)
      expect(task.mock.calls[0][1]).toStrictEqual({ grantId: GRANT })
      expect(await store.listInFlight()).toEqual([])
      expect(await store.list()).toEqual([])
    }
  })

  it('a revoke refused notFound (no such grant) removes the record; it is absent', async () => {
    const { deps, store } = await setup({
      flights: [inFlight()],
      revoke: async () => {
        throw refusal('notFound')
      },
      now: REQUEST_ENDS,
    })
    expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, grantId: GRANT, outcome: 'absent' }])
    expect(await store.listInFlight()).toEqual([])
  })

  // control: the opposite of the two cases above: a revoke that did not happen keeps the record for next time.
  it('control: an unreachable VTA, or another refusal, keeps the record for the next reconcile', async () => {
    const answers: { revoke: () => Promise<unknown>; expected: Record<string, unknown> }[] = [
      {
        revoke: async () => {
          throw new Error('timeout')
        },
        expected: { outcome: 'kept', unreachable: true },
      },
      {
        revoke: async () => {
          throw refusal('permissionDenied')
        },
        expected: { outcome: 'kept', refused: 'permissionDenied' },
      },
    ]
    for (const { revoke, expected } of answers) {
      const { deps, store, task } = await setup({ flights: [inFlight()], revoke, now: REQUEST_ENDS })
      expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, grantId: GRANT, ...expected }])
      expect(task).toHaveBeenCalledTimes(1)
      expect(await store.listInFlight()).toEqual([inFlight()])
    }
  })

  it("revoking a failed approval's grant leaves the client's earlier connection as it is", async () => {
    const earlier: HcpConnection = {
      id: CLIENT_VID,
      name: 'My notes agent',
      grantId: OLD_GRANT,
      threadId: THREAD,
      approvedAt: iso(HELD_AT - 60 * MINUTE),
      expiresAt: iso(HELD_AT + 3 * 60 * MINUTE),
    }
    const { deps, store, task } = await setup({ flights: [inFlight()], connections: [earlier], now: REQUEST_ENDS })
    await reconcileHcpApprovals(deps)
    expect(task.mock.calls[0][1]).toStrictEqual({ grantId: GRANT })
    expect(await store.get(CLIENT_VID)).toEqual(earlier)
  })

  it('reconciles each client on its own', async () => {
    const { deps } = await setup({
      flights: [inFlight(), inFlight({ id: OTHER_VID, approvalId: 'consent-2', grantId: OLD_GRANT })],
      approvals: [hcpApproval({ status: 'approved' })],
      now: REQUEST_ENDS,
    })
    const results = await reconcileHcpApprovals(deps)
    expect(results).toHaveLength(2)
    expect(results).toEqual(
      expect.arrayContaining([
        { id: CLIENT_VID, grantId: GRANT, outcome: 'completed' },
        { id: OTHER_VID, grantId: OLD_GRANT, outcome: 'revoked' },
      ])
    )
  })

  it('does nothing with the HCP flag off', async () => {
    setHcpEnabled(false)
    const { deps, store, task } = await setup({ flights: [inFlight()], now: REQUEST_ENDS })
    expect(await reconcileHcpApprovals(deps)).toEqual([])
    expect(await store.listInFlight()).toEqual([inFlight()])
    expect(task).not.toHaveBeenCalled()
  })
})
