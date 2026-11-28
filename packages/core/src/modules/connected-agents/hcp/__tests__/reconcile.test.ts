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
import { HcpOffError, type HcpVtaPort } from '../vtaPort'
import { HCP_AUDIT_READ } from '../whatItSaw/audit'
import { auditEvent } from '../whatItSaw/__tests__/fixtures/fakeVta'
import { whatItSawSchemas } from '../whatItSaw/__tests__/fixtures/whatItSawSchemas'
import { expectValid, hcpSchemas } from './fixtures/hcpSchemas'
import {
  CLIENT_VID,
  GRANT,
  GRANT_EXPIRES_AT,
  HELD_AT,
  hcpApproval,
  OTHER_THREAD,
  OTHER_VID,
  THREAD,
} from './fixtures/hcpApproval'

const S = { ...hcpSchemas(), ...whatItSawSchemas() }
const MINUTE = 60 * 1000
const STARTED = HELD_AT + 30 * 1000
/** The consent request's own expiry (the fixture's): 5 minutes after it was held. */
const REQUEST_ENDS = HELD_AT + 5 * MINUTE
const iso = (ms: number) => new Date(ms).toISOString()
const OLD_GRANT = 'urn:uuid:00000000-0000-4000-8000-000000000000'
const OLD_THREAD = 'urn:uuid:00000000-0000-4000-8000-0000000000a1'
const SECOND_THREAD = OTHER_THREAD
const SECOND_GRANT_ID = 'urn:uuid:22222222-2222-4222-8222-222222222222'

const inFlight = (change: Partial<HcpApprovalInFlight> = {}): HcpApprovalInFlight => ({
  id: CLIENT_VID,
  name: 'My notes agent',
  grantId: GRANT,
  threadId: THREAD,
  approvalId: 'consent-1',
  approvalExpiresAt: iso(REQUEST_ENDS),
  expiresAt: GRANT_EXPIRES_AT,
  startedAt: iso(STARTED),
  ...change,
})

const refusal = (code: string) => Object.assign(new Error('refused'), { name: 'VtiRefusal', code })

async function setup(options: {
  flights?: HcpApprovalInFlight[]
  connections?: HcpConnection[]
  approvals?: VtiApproval[]
  revoke?: () => Promise<unknown>
  /** The `hcp/audit/read` answer (the `grant.issued` lookup); by default no events. */
  audit?: () => Promise<unknown>
  now: number
}) {
  const store = new HcpConnectionStore({ genericRecords: memoryGenericRecords() } as unknown as Agent)
  for (const c of options.connections ?? []) await store.put(c)
  for (const f of options.flights ?? []) await store.putInFlight(f)
  const task = jest.fn(async (type: string, payload: Record<string, unknown>) => {
    expectValid(S[type].request, payload)
    if (type === HCP_AUDIT_READ) {
      const answer = options.audit ? await options.audit() : { events: [] }
      expectValid(S[HCP_AUDIT_READ].response, answer)
      return answer
    }
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
    expect(await reconcileHcpApprovals(deps)).toEqual([
      { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'completed' },
    ])
    expect(await store.get(CLIENT_VID)).toEqual({
      id: CLIENT_VID,
      name: 'My notes agent',
      grantId: GRANT,
      threadId: THREAD,
      approvedAt: iso(now),
      expiresAt: GRANT_EXPIRES_AT,
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
    expect(await reconcileHcpApprovals(deps)).toEqual([
      { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'completed' },
    ])
    expect(await store.get(CLIENT_VID)).toEqual(written)
    expect(await store.listInFlight()).toEqual([])
    expect(task).not.toHaveBeenCalled()
  })

  it('waits, sending nothing, while the request could still be approved (pending, or not listed yet)', async () => {
    for (const approvals of [[hcpApproval()], [], [hcpApproval({ status: 'failed' })]]) {
      const { deps, store, task } = await setup({ flights: [inFlight()], approvals, now: REQUEST_ENDS - 1 })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'waiting' },
      ])
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
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'revoked' },
      ])
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
    expect(await reconcileHcpApprovals(deps)).toEqual([
      { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'absent' },
    ])
    expect(await store.listInFlight()).toEqual([])
  })

  // TT hcp/grants/revoke refuses an unknown grantId with permissionDenied, not notFound: also no such grant.
  it('a revoke refused permissionDenied (TT grants/revoke’s "no such grant") removes the record; it is absent', async () => {
    const { deps, store, task } = await setup({
      flights: [inFlight()],
      revoke: async () => {
        throw refusal('permissionDenied')
      },
      now: REQUEST_ENDS,
    })
    expect(await reconcileHcpApprovals(deps)).toEqual([
      { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'absent' },
    ])
    expect(task).toHaveBeenCalledTimes(1)
    expect(await store.listInFlight()).toEqual([])
    // Terminal: the next reconcile has nothing left to send.
    expect(await reconcileHcpApprovals(deps)).toEqual([])
    expect(task).toHaveBeenCalledTimes(1)
  })

  // control: the opposite of the cases above: a revoke that did not happen keeps the record for next time.
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
          throw refusal('internalError')
        },
        expected: { outcome: 'kept', refused: 'internalError' },
      },
    ]
    for (const { revoke, expected } of answers) {
      const { deps, store, task } = await setup({ flights: [inFlight()], revoke, now: REQUEST_ENDS })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, ...expected },
      ])
      expect(task).toHaveBeenCalledTimes(1)
      expect(await store.listInFlight()).toEqual([inFlight()])
    }
  })

  it("revoking a failed approval's grant leaves the client's earlier connection as it is", async () => {
    const earlier: HcpConnection = {
      id: CLIENT_VID,
      name: 'My notes agent',
      grantId: OLD_GRANT,
      threadId: OLD_THREAD,
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
      flights: [
        inFlight(),
        inFlight({ id: OTHER_VID, approvalId: 'consent-2', grantId: OLD_GRANT, threadId: OLD_THREAD }),
      ],
      approvals: [hcpApproval({ status: 'approved' })],
      now: REQUEST_ENDS,
    })
    const results = await reconcileHcpApprovals(deps)
    expect(results).toHaveLength(2)
    expect(results).toEqual(
      expect.arrayContaining([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'completed' },
        { id: OTHER_VID, threadId: OLD_THREAD, grantId: OLD_GRANT, outcome: 'revoked' },
      ])
    )
  })

  describe('a second approval for the same client', () => {
    const SECOND_GRANT = 'urn:uuid:22222222-2222-4222-8222-222222222222'
    const SECOND_STARTED = STARTED + 2 * MINUTE
    const viewFor = (grantId: string, threadId = grantId === GRANT ? THREAD : SECOND_THREAD): HcpApprovalView => ({
      title: { key: 'ApproveTitle', params: { name: 'My notes agent' } },
      rows: [],
      warning: { key: 'ApproveOwnTerminal' },
      approve: { key: 'Approve' },
      clientVid: CLIENT_VID,
      grantId,
      threadId,
      expiresAt: GRANT_EXPIRES_AT,
      operator: 'Example Labs',
      persistence: 'temporary',
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
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'revoked' },
      ])
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
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, retiring: true, outcome: 'revoked' },
      ])
      expect(task.mock.calls.map((c) => c[1])).toStrictEqual([{ grantId: GRANT }])
      expect((await store.get(CLIENT_VID))?.grantId).toBe(SECOND_GRANT)
      expect(await store.listRetiring()).toEqual([])
    })

    it('two approved approvals in flight, listed oldest first: the newest is completed and the older revoked', async () => {
      const { deps, store, task } = await setup({
        flights: [
          inFlight(),
          inFlight({
            grantId: SECOND_GRANT,
            threadId: SECOND_THREAD,
            approvalId: 'consent-2',
            startedAt: iso(SECOND_STARTED),
          }),
        ],
        approvals: approved,
        now: SECOND_STARTED + MINUTE,
      })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: SECOND_THREAD, grantId: SECOND_GRANT, outcome: 'completed' },
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'revoked' },
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
        threadId: OLD_THREAD,
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
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'completed' },
        { id: CLIENT_VID, threadId: OLD_THREAD, grantId: OLD_GRANT, retiring: true, outcome: 'revoked' },
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
      await store.complete({
        ...current,
        grantId: SECOND_GRANT,
        threadId: SECOND_THREAD,
        approvedAt: iso(STARTED + 1000),
      })
      await store.put(current)
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, retiring: true, outcome: 'current' },
      ])
      expect(task).not.toHaveBeenCalled()
      expect(await store.listRetiring()).toEqual([])
    })

    // The review's case: the reconcile reads the connection as still naming the retiring grant, then a complete(B)
    // retires that grant again and writes B before the reconcile removes the record. Decided under the lock, the
    // record of a live grant is never removed: the grant is revoked instead.
    it('a complete between the reading and the removing of a current retiring grant cannot leave it unnamed', async () => {
      const { deps, store, task } = await setup({ now: STARTED + MINUTE })
      const current: HcpConnection = {
        id: CLIENT_VID,
        name: 'My notes agent',
        grantId: GRANT,
        threadId: THREAD,
        approvedAt: iso(STARTED),
        expiresAt: iso(STARTED + 4 * 60 * MINUTE),
      }
      await store.put(current)
      await store.complete({
        ...current,
        grantId: SECOND_GRANT,
        threadId: SECOND_THREAD,
        approvedAt: iso(STARTED + 1000),
      })
      await store.put(current)
      // complete(B) starts as soon as the reconcile has listed the retiring grants, before it decides on any.
      let completing: Promise<void> | undefined
      deps.store = Object.assign(Object.create(store) as HcpConnectionStore, {
        listRetiring: async () => {
          const listed = await store.listRetiring()
          completing = store.complete({
            ...current,
            grantId: SECOND_GRANT,
            threadId: SECOND_THREAD,
            approvedAt: iso(STARTED + 2000),
          })
          return listed
        },
      })
      const results = await reconcileHcpApprovals(deps)
      await completing

      expect((await store.get(CLIENT_VID))?.grantId).toBe(SECOND_GRANT)
      // Grant A is revoked, or still named by a retiring record: never neither.
      const revoked = task.mock.calls.some((c) => c[1].grantId === GRANT)
      const named = (await store.listRetiring()).some((r) => r.grantId === GRANT)
      expect(revoked || named).toBe(true)
      expect(results).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, retiring: true, outcome: 'revoked' },
      ])
    })

    it('a retiring grant whose revoke fails is kept for the next reconcile; notFound or permissionDenied removes it', async () => {
      for (const [revoke, expected, left] of [
        [async () => Promise.reject(new Error('timeout')), { outcome: 'kept', unreachable: true }, 1],
        [async () => Promise.reject(refusal('notFound')), { outcome: 'absent' }, 0],
        [async () => Promise.reject(refusal('permissionDenied')), { outcome: 'absent' }, 0],
      ] as const) {
        const { deps, store } = await setup({ revoke, now: SECOND_STARTED + MINUTE })
        await recordHcpApproval(store)(viewFor(GRANT), new Date(STARTED))
        await recordHcpApproval(store)(viewFor(SECOND_GRANT), new Date(SECOND_STARTED))
        expect(await reconcileHcpApprovals(deps)).toEqual([
          { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, retiring: true, ...expected },
        ])
        expect(await store.listRetiring()).toHaveLength(left)
      }
    })
  })

  // The flags turned off during a reconcile: the port answers `off`, which is not a failed revoke (`kept`,
  // `unreachable`), whose premise of a later retry cannot hold with the flags off.
  it('a revoke answered off keeps the record, is not counted as kept or unreachable, and stops the reconcile', async () => {
    const { deps, store, task } = await setup({
      flights: [
        inFlight(),
        inFlight({ grantId: OLD_GRANT, threadId: OLD_THREAD, approvalId: 'consent-0', startedAt: iso(STARTED - 1000) }),
      ],
      revoke: async () => Promise.reject(new HcpOffError()),
      now: REQUEST_ENDS + MINUTE,
    })
    expect(await reconcileHcpApprovals(deps)).toEqual([
      { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'off' },
    ])
    expect(task).toHaveBeenCalledTimes(1)
    expect((await store.listInFlight()).map((f) => f.grantId).sort()).toEqual([GRANT, OLD_GRANT].sort())
  })

  describe('a record with no grantId (VTI hcp.md §5.1 pre-assigns none)', () => {
    const { grantId: _none, ...noId } = inFlight()
    const issued = (grantId: string, at: number) => auditEvent('grant.issued', iso(at), { grantId })

    it('learns the grantId from the earliest grant.issued since the approval started, then revokes it', async () => {
      const { deps, store, task } = await setup({
        flights: [noId],
        approvals: [hcpApproval({ status: 'denied' })],
        audit: async () => ({
          events: [
            issued(OLD_GRANT, STARTED - 2 * MINUTE),
            issued(GRANT, STARTED + 5000),
            issued(OLD_GRANT, STARTED + 9000),
          ],
        }),
        now: STARTED + MINUTE,
      })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, outcome: 'revoked' },
      ])
      expect(task.mock.calls[0]).toEqual([
        HCP_AUDIT_READ,
        expect.objectContaining({ client: CLIENT_VID, eventType: 'grant.issued' }),
      ])
      expect(task.mock.calls[1]).toEqual([HCP_GRANTS_REVOKE, { grantId: GRANT }])
      expect(await store.listInFlight()).toEqual([])
    })

    it('with no grant.issued yet: absent once the grant has expired or the request was denied or expired', async () => {
      const cases: { approvals: VtiApproval[]; now: number }[] = [
        { approvals: [hcpApproval({ status: 'denied' })], now: STARTED + MINUTE },
        { approvals: [hcpApproval({ status: 'expired' })], now: STARTED + MINUTE },
        { approvals: [], now: Date.parse(GRANT_EXPIRES_AT) },
      ]
      for (const { approvals, now } of cases) {
        const { deps, store, task } = await setup({ flights: [noId], approvals, now })
        expect(await reconcileHcpApprovals(deps)).toEqual([{ id: CLIENT_VID, threadId: THREAD, outcome: 'absent' }])
        expect(task.mock.calls.map((c) => c[0])).toEqual([HCP_AUDIT_READ])
        expect(await store.listInFlight()).toEqual([])
      }
    })

    // control: the opposite of the case above: a grant that may still be issued keeps the record.
    it('control: with no grant.issued yet and the grant unexpired, the record is kept, grantNotIssued', async () => {
      const { deps, store, task } = await setup({ flights: [noId], approvals: [], now: REQUEST_ENDS + MINUTE })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, outcome: 'kept', refused: 'grantNotIssued' },
      ])
      expect(task.mock.calls.map((c) => c[0])).toEqual([HCP_AUDIT_READ])
      expect(await store.listInFlight()).toEqual([noId])
    })

    it('a retiring grant with no grantId excludes the current connection’s grant when it learns its own', async () => {
      const { deps, store, task } = await setup({
        audit: async () => ({ events: [issued(SECOND_GRANT_ID, STARTED + 1000), issued(GRANT, STARTED + 2000)] }),
        now: STARTED + 10 * MINUTE,
      })
      await store.putRetiring({
        id: CLIENT_VID,
        name: 'My notes agent',
        threadId: THREAD,
        expiresAt: GRANT_EXPIRES_AT,
        approvedAt: iso(STARTED),
        retiredAt: iso(STARTED + 5 * MINUTE),
      })
      await store.put({
        id: CLIENT_VID,
        name: 'My notes agent',
        grantId: SECOND_GRANT_ID,
        threadId: SECOND_THREAD,
        approvedAt: iso(STARTED + 5 * MINUTE),
        expiresAt: GRANT_EXPIRES_AT,
      })
      expect(await reconcileHcpApprovals(deps)).toEqual([
        { id: CLIENT_VID, threadId: THREAD, grantId: GRANT, retiring: true, outcome: 'revoked' },
      ])
      expect(task.mock.calls[1]).toEqual([HCP_GRANTS_REVOKE, { grantId: GRANT }])
      expect(await store.listRetiring()).toEqual([])
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
