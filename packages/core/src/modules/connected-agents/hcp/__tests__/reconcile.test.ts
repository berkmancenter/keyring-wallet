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
import { beginHcpApproval, HcpConnectionStore, recordHcpApproval } from '../store'
import { HCP_GRANTS_REVOKE, type HcpApprovalInFlight, type HcpApprovalView, type HcpConnection } from '../types'
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

  describe('a second approval for the same client', () => {
    const SECOND_GRANT = 'urn:uuid:22222222-2222-4222-8222-222222222222'
    const SECOND_STARTED = STARTED + 2 * MINUTE
    const viewFor = (grantId: string): HcpApprovalView => ({
      title: { key: 'ApproveTitle', params: { name: 'My notes agent' } },
      rows: [],
      warning: { key: 'ApproveOwnTerminal' },
      approve: { key: 'Approve' },
      clientVid: CLIENT_VID,
      grantId,
      threadId: THREAD,
      expiresInSeconds: 14400,
    })
    const requestA = { id: 'consent-1', expiresAt: iso(REQUEST_ENDS) }
    const requestB = { id: 'consent-2', expiresAt: iso(SECOND_STARTED + 5 * MINUTE) }
    const approved = [
      hcpApproval({ status: 'approved' }),
      hcpApproval({ id: 'consent-2', status: 'approved', expiresAt: requestB.expiresAt }),
    ]

    // The review's case: A is approved at the VTA and its onApproved fails; the same client asks again and B
    // completes. A's grant must still be reachable by the reconcile, which revokes it and leaves B the connection.
    it('leaves the first grant reachable when onApproved failed for it, and the reconcile revokes it', async () => {
      const { deps, store, task } = await setup({ approvals: approved, now: SECOND_STARTED + MINUTE })
      await beginHcpApproval(store)(viewFor(GRANT), requestA, new Date(STARTED))
      // decide(A) resolves; onApproved(A) throws, so nothing more is written for A.
      await beginHcpApproval(store)(viewFor(SECOND_GRANT), requestB, new Date(SECOND_STARTED))
      await recordHcpApproval(store)(viewFor(SECOND_GRANT), new Date(SECOND_STARTED + 5000))

      expect((await store.listInFlight()).map((f) => f.grantId)).toEqual([GRANT])
      expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, grantId: GRANT, outcome: 'revoked' }])
      expect(task).toHaveBeenCalledTimes(1)
      expect(task.mock.calls[0][1]).toStrictEqual({ grantId: GRANT })
      expect((await store.get(CLIENT_VID))?.grantId).toBe(SECOND_GRANT)
      expect(await store.listInFlight()).toEqual([])
    })

    it('a completed connection replaced by a newer one is revoked by the reconcile, as retiring', async () => {
      const { deps, store, task } = await setup({ approvals: approved, now: SECOND_STARTED + MINUTE })
      await beginHcpApproval(store)(viewFor(GRANT), requestA, new Date(STARTED))
      await recordHcpApproval(store)(viewFor(GRANT), new Date(STARTED + 5000))
      await beginHcpApproval(store)(viewFor(SECOND_GRANT), requestB, new Date(SECOND_STARTED))
      await recordHcpApproval(store)(viewFor(SECOND_GRANT), new Date(SECOND_STARTED + 5000))

      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, grantId: GRANT, retiring: true, outcome: 'revoked' },
      ])
      expect(task.mock.calls.map((c) => c[1])).toStrictEqual([{ grantId: GRANT }])
      expect((await store.get(CLIENT_VID))?.grantId).toBe(SECOND_GRANT)
      expect(await store.listRetiring()).toEqual([])
    })

    it('two approved approvals in flight, listed oldest first: the newest is completed and the older revoked', async () => {
      const { deps, store, task } = await setup({
        flights: [
          inFlight(),
          inFlight({ grantId: SECOND_GRANT, approvalId: 'consent-2', startedAt: iso(SECOND_STARTED) }),
        ],
        approvals: approved,
        now: SECOND_STARTED + MINUTE,
      })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, grantId: SECOND_GRANT, outcome: 'completed' },
        { id: CLIENT_VID, grantId: GRANT, outcome: 'revoked' },
      ])
      expect(task.mock.calls.map((c) => c[1])).toStrictEqual([{ grantId: GRANT }])
      expect((await store.get(CLIENT_VID))?.grantId).toBe(SECOND_GRANT)
      expect(await store.listInFlight()).toEqual([])
      expect(await store.listRetiring()).toEqual([])
    })

    // control: the opposite of the case above: with the older connection approved before this approval started,
    // the approval in flight is completed over it (and the older grant is the one retired).
    it('control: an approval newer than the connection completes over it, and the older grant is retired', async () => {
      const earlier: HcpConnection = {
        id: CLIENT_VID,
        name: 'My notes agent',
        grantId: OLD_GRANT,
        threadId: THREAD,
        approvedAt: iso(HELD_AT - 60 * MINUTE),
        expiresAt: iso(HELD_AT + 3 * 60 * MINUTE),
      }
      const { deps, store, task } = await setup({
        flights: [inFlight()],
        connections: [earlier],
        approvals: [hcpApproval({ status: 'approved' })],
        now: STARTED + MINUTE,
      })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, grantId: GRANT, outcome: 'completed' },
        { id: CLIENT_VID, grantId: OLD_GRANT, retiring: true, outcome: 'revoked' },
      ])
      expect(task.mock.calls.map((c) => c[1])).toStrictEqual([{ grantId: OLD_GRANT }])
      expect((await store.get(CLIENT_VID))?.grantId).toBe(GRANT)
    })

    it('a retiring grant still named by the connection (a stop inside complete) is removed, and nothing is sent', async () => {
      const { deps, store, task } = await setup({ now: STARTED + MINUTE })
      const current: HcpConnection = {
        id: CLIENT_VID,
        name: 'My notes agent',
        grantId: GRANT,
        threadId: THREAD,
        approvedAt: iso(STARTED),
        expiresAt: iso(STARTED + 4 * 60 * MINUTE),
      }
      // complete(B) retired the connection's grant, then stopped before writing B.
      await store.put(current)
      await store.complete({ ...current, grantId: SECOND_GRANT, approvedAt: iso(STARTED + 1000) })
      await store.put(current)
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, grantId: GRANT, retiring: true, outcome: 'current' },
      ])
      expect(task).not.toHaveBeenCalled()
      expect(await store.listRetiring()).toEqual([])
    })

    it('a retiring grant whose revoke fails is kept for the next reconcile; notFound removes it', async () => {
      for (const [revoke, expected, left] of [
        [async () => Promise.reject(new Error('timeout')), { outcome: 'kept', unreachable: true }, 1],
        [async () => Promise.reject(refusal('notFound')), { outcome: 'absent' }, 0],
      ] as const) {
        const { deps, store } = await setup({ revoke, now: SECOND_STARTED + MINUTE })
        await recordHcpApproval(store)(viewFor(GRANT), new Date(STARTED))
        await recordHcpApproval(store)(viewFor(SECOND_GRANT), new Date(SECOND_STARTED))
        expect(await reconcileHcpApprovals(deps)).toEqual([
          { id: CLIENT_VID, grantId: GRANT, retiring: true, ...expected },
        ])
        expect(await store.listRetiring()).toHaveLength(left)
      }
    })
  })

  it('does nothing with the HCP flag off', async () => {
    setHcpEnabled(false)
    const { deps, store, task } = await setup({ flights: [inFlight()], now: REQUEST_ENDS })
    expect(await reconcileHcpApprovals(deps)).toEqual([])
    expect(await store.listInFlight()).toEqual([inFlight()])
    expect(task).not.toHaveBeenCalled()
  })
})
