/**
 * Revoke and the notice state (C6), against a fake VTA port, a fake clock and the real `HcpConnectionStore` over
 * memory records: revoke sends exactly `{ grantId }` and sets `telling`; a refusal or an unreachable VTA changes
 * nothing; the "Telling…" rule over the audit log, one test per row of its state table; the summary fallback (each
 * `notification` value, read by our grant); the schedule's boundaries; `told` never overwritten; the stops; and the
 * hook that polls while mounted. Every request sent and every answer given validates against the vendored schemas.
 * Unless a test gives an audit log, the audit read is refused, as an older VTA's would be, so the summary is read.
 */
import type { Agent } from '@credo-ts/core'
import { act, renderHook } from '@testing-library/react-native'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { setAgentConnectEnabled } from '../../agentConnectFlag'
import { setHcpEnabled } from '../hcpFlag'
import {
  HCP_POLL_FAST_MS,
  HCP_POLL_SLOW_MS,
  HCP_ENDED_MARGIN_MS,
  HCP_POLL_STOP_AFTER_MS,
  nextHcpPoll,
  pollHcpNotice,
  revokeHcpGrant,
  useHcpNotice,
  type HcpRevokeDeps,
} from '../revoke'
import { HcpConnectionStore } from '../store'
import { HCP_DISCLOSURES_SUMMARY, HCP_GRANTS_REVOKE, type HcpConnection } from '../types'
import { HcpOffError, type HcpVtaPort } from '../vtaPort'
import { HCP_AUDIT_READ } from '../whatItSaw/audit'
import { hcpStatus } from '../status'
import { auditEvent } from '../whatItSaw/__tests__/fixtures/fakeVta'
import { whatItSawSchemas } from '../whatItSaw/__tests__/fixtures/whatItSawSchemas'
import { expectValid, hcpSchemas } from './fixtures/hcpSchemas'
import { CLIENT_VID, GRANT, OTHER_VID, THREAD } from './fixtures/hcpApproval'

const S = { ...hcpSchemas(), ...whatItSawSchemas() }
const REVOKED_AT = Date.parse('2026-11-27T11:00:00.000Z')
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const iso = (ms: number) => new Date(ms).toISOString()

const connection = (change: Partial<HcpConnection> = {}): HcpConnection => ({
  id: CLIENT_VID,
  name: 'My notes agent',
  grantId: GRANT,
  threadId: THREAD,
  approvedAt: '2026-11-27T10:01:00.000Z',
  expiresAt: '2026-11-27T14:01:00.000Z',
  ...change,
})

const revoked = (notice: HcpConnection['notice'] = { state: 'telling' }) =>
  connection({ revokedAt: iso(REVOKED_AT), notice })

type Notification = 'delivered' | 'abandoned' | 'none'
type GrantStatus = { grantId: string; status: 'active' | 'revoked' | 'expired' }

/** A grant of the same client's before ours: the summary's `grants` may list it beside ours, or instead of it. */
const RETIRED_GRANT = 'urn:uuid:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

/**
 * A `disclosures/summary` answer, checked against the vendored response schema. Each entry lists our grant as
 * revoked unless `grants` says otherwise.
 */
function summary(
  entries: { client?: string; notification: Notification; usableUntil: string | null; grants?: GrantStatus[] }[],
  nextCursor?: string
) {
  const answer = {
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    clients: entries.map((e) => ({
      client: { id: e.client ?? CLIENT_VID, name: 'hcp-demo', operator: { id: 'did:web:example.org', name: 'Ex' } },
      grants: e.grants ?? [{ grantId: GRANT, status: 'revoked' }],
      categories: ['general_preferences'],
      purposes: ['https://hcp.example/purposes/personalization'],
      entries: 1,
      retrievals: 2,
      firstAt: '2026-11-27T10:05:00.000Z',
      lastAt: '2026-11-27T10:06:00.000Z',
      usableUntil: e.usableUntil,
      notification: e.notification,
    })),
  }
  expectValid(S[HCP_DISCLOSURES_SUMMARY].response, answer)
  return answer
}

const refusal = (code: string) => Object.assign(new Error('refused'), { name: 'VtiRefusal', code })

/** How many times `type` was sent. */
const sent = (task: jest.Mock, type: string) => task.mock.calls.filter((c) => c[0] === type).length

/**
 * A fake VTA: answers `grants/revoke` with `{}` (or `revoke()` if given) and `disclosures/summary` with the next of
 * `summaries` (or the last, once they run out). Every request it is sent is checked against the vendored schema.
 */
function fakeVta(
  options: {
    revoke?: () => Promise<unknown>
    summaries?: (() => Promise<unknown>)[]
    /** The `hcp/audit/read` answer, given the request; by default a refusal (an older VTA). */
    audit?: (payload: Record<string, unknown>) => Promise<unknown>
    /** Send the audit answer unchecked: for a malformed one. */
    auditUnchecked?: boolean
  } = {}
) {
  let polls = 0
  const task = jest.fn(async (type: string, payload: Record<string, unknown>) => {
    expectValid(S[type].request, payload)
    if (type === HCP_AUDIT_READ) {
      if (!options.audit) throw refusal('notSupported')
      const answer = await options.audit(payload)
      if (!options.auditUnchecked) expectValid(S[HCP_AUDIT_READ].response, answer)
      return answer
    }
    if (type === HCP_GRANTS_REVOKE) {
      if (options.revoke) return options.revoke()
      const answer = {}
      expectValid(S[HCP_GRANTS_REVOKE].response, answer)
      return answer
    }
    if (type === HCP_DISCLOSURES_SUMMARY) {
      const list = options.summaries ?? [async () => summary([])]
      return list[Math.min(polls++, list.length - 1)]()
    }
    throw new Error(`unexpected ${type}`)
  })
  return { port: { task } as HcpVtaPort, task }
}

async function setup(record: HcpConnection | undefined, vta = fakeVta(), now = REVOKED_AT) {
  const genericRecords = memoryGenericRecords()
  const store = new HcpConnectionStore({ genericRecords } as unknown as Agent)
  if (record) await store.put(record)
  const clock = { now }
  const deps: HcpRevokeDeps = { port: vta.port, store, clock: () => new Date(clock.now) }
  return { deps, store, task: vta.task, clock, genericRecords }
}

describe('revokeHcpGrant', () => {
  it('sends grants/revoke with exactly { grantId } once, then reads revoked with the notice telling', async () => {
    const { deps, store, task } = await setup(connection())
    const result = await revokeHcpGrant(deps, CLIENT_VID)
    expect(task).toHaveBeenCalledTimes(1)
    expect(task.mock.calls[0][0]).toBe(HCP_GRANTS_REVOKE)
    expect(task.mock.calls[0][1]).toStrictEqual({ grantId: GRANT })
    const after = revoked()
    expect(result).toEqual({ ok: true, connection: after })
    expect(await store.get(CLIENT_VID)).toEqual(after)
  })

  it('a record with no grantId learns it from grant.issued, keeps it, then revokes it', async () => {
    const { grantId: _none, ...noId } = connection()
    const vta = fakeVta({
      audit: async () => ({
        events: [auditEvent('grant.issued', '2026-11-27T10:01:01.000Z', { grantId: GRANT })],
      }),
    })
    const { deps, store, task } = await setup(noId, vta)
    const result = await revokeHcpGrant(deps, CLIENT_VID)
    expect(task.mock.calls.map((c) => c[0])).toEqual([HCP_AUDIT_READ, HCP_GRANTS_REVOKE])
    expect(task.mock.calls[0][1]).toMatchObject({ client: CLIENT_VID, eventType: 'grant.issued' })
    expect(task.mock.calls[1][1]).toStrictEqual({ grantId: GRANT })
    const learnt = { ...revoked(), grantIssuedAt: '2026-11-27T10:01:01.000Z' }
    expect(result).toEqual({ ok: true, connection: learnt })
    expect(await store.get(CLIENT_VID)).toEqual(learnt)
  })

  it('B1: learns from the approval start, not a late approvedAt (a connection the reconcile completed)', async () => {
    const { grantId: _none, ...noId } = connection()
    const late = { ...noId, approvalStartedAt: '2026-11-27T10:00:30.000Z', approvedAt: '2026-11-27T10:05:00.000Z' }
    const vta = fakeVta({
      audit: async () => ({ events: [auditEvent('grant.issued', '2026-11-27T10:00:40.000Z', { grantId: GRANT })] }),
    })
    const { deps, task } = await setup(late, vta)
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toMatchObject({ ok: true })
    expect(task.mock.calls[0][1]).toMatchObject({ from: '2026-11-27T09:59:30.000Z' })
    expect(task.mock.calls[1][1]).toStrictEqual({ grantId: GRANT })
  })

  it('B2: refuses to guess, sending nothing, while another unlearnt approval of the client overlaps', async () => {
    const { grantId: _none, ...noId } = connection()
    const vta = fakeVta({ audit: async () => ({ events: [] }) })
    const { deps, store, task } = await setup(noId, vta)
    await store.putInFlight({
      id: CLIENT_VID,
      name: 'My notes agent',
      threadId: 'urn:uuid:00000000-0000-4000-8000-0000000000a1',
      approvalId: 'consent-2',
      approvalExpiresAt: '2026-11-27T10:06:00.000Z',
      expiresAt: '2026-11-27T11:01:00.000Z',
      startedAt: '2026-11-27T10:01:30.000Z',
    })
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toEqual({
      ok: false,
      refused: 'grantAmbiguous',
      message: { key: 'RevokeGrantAmbiguous', params: { name: 'My notes agent' } },
    })
    expect(task).not.toHaveBeenCalled()
    expect(await store.get(CLIENT_VID)).toEqual(noId)
  })

  it("B2: never learns a grant another of the client's records holds", async () => {
    const { grantId: _none, ...noId } = connection()
    const OTHER = 'urn:uuid:22222222-2222-4222-8222-222222222222'
    const vta = fakeVta({
      audit: async () => ({
        events: [
          auditEvent('grant.issued', '2026-11-27T10:00:50.000Z', { grantId: OTHER }),
          auditEvent('grant.issued', '2026-11-27T10:01:01.000Z', { grantId: GRANT }),
        ],
      }),
    })
    const { deps, store, task } = await setup(noId, vta)
    await store.putInFlight({
      id: CLIENT_VID,
      name: 'My notes agent',
      grantId: OTHER,
      threadId: 'urn:uuid:00000000-0000-4000-8000-0000000000a1',
      approvalId: 'consent-2',
      approvalExpiresAt: '2026-11-27T10:06:00.000Z',
      expiresAt: '2026-11-27T11:01:00.000Z',
      startedAt: '2026-11-27T10:00:20.000Z',
    })
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toMatchObject({ ok: true })
    expect(task.mock.calls[1][1]).toStrictEqual({ grantId: GRANT })
  })

  it('a record with no grantId and no grant.issued yet is refused grantNotIssued, and nothing is revoked', async () => {
    const { grantId: _none, ...noId } = connection()
    const { deps, store, task } = await setup(noId, fakeVta({ audit: async () => ({ events: [] }) }))
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toEqual({
      ok: false,
      refused: 'grantNotIssued',
      message: { key: 'RevokeNotYetIssued', params: { name: 'My notes agent' } },
    })
    expect(task.mock.calls.map((c) => c[0])).toEqual([HCP_AUDIT_READ])
    expect(await store.get(CLIENT_VID)).toEqual(noId)
  })

  // control: the opposite of the case above: the record stays as it was.
  it('control: unreachable changes nothing, sends once, and gives RevokeUnreachable with the name', async () => {
    const vta = fakeVta({
      revoke: async () => {
        throw new Error('timeout')
      },
    })
    const { deps, store, task } = await setup(connection(), vta)
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toEqual({
      ok: false,
      unreachable: true,
      message: { key: 'RevokeUnreachable', params: { name: 'My notes agent' } },
    })
    expect(task).toHaveBeenCalledTimes(1)
    expect(await store.get(CLIENT_VID)).toEqual(connection())
  })

  it('the HCP flags off changes nothing and gives off, with no message: not RevokeUnreachable', async () => {
    const vta = fakeVta({ revoke: async () => Promise.reject(new HcpOffError()) })
    const { deps, store, task } = await setup(connection(), vta)
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toEqual({ ok: false, off: true })
    expect(task).toHaveBeenCalledTimes(1)
    expect(await store.get(CLIENT_VID)).toEqual(connection())
  })

  it('a refusal changes nothing, names its code and gives RevokeRefused with the name', async () => {
    const vta = fakeVta({
      revoke: async () => {
        throw refusal('notFound')
      },
    })
    const { deps, store } = await setup(connection(), vta)
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toEqual({
      ok: false,
      refused: 'notFound',
      message: { key: 'RevokeRefused', params: { name: 'My notes agent' } },
    })
    expect(await store.get(CLIENT_VID)).toEqual(connection())
  })

  it('sends nothing for a record already revoked, or no record', async () => {
    const { deps, task } = await setup(revoked({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) }))
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toEqual({
      ok: true,
      connection: revoked({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) }),
    })
    expect(await revokeHcpGrant(deps, OTHER_VID)).toEqual({ ok: false, missing: true })
    expect(task).not.toHaveBeenCalled()
  })
})

describe('pollHcpNotice', () => {
  const at = REVOKED_AT + 10 * SECOND

  it('sends disclosures/summary with exactly { client }', async () => {
    const { deps, task } = await setup(revoked(), undefined, at)
    await pollHcpNotice(deps, CLIENT_VID)
    expect(task).toHaveBeenCalledWith(HCP_DISCLOSURES_SUMMARY, { client: CLIENT_VID })
    expect(task.mock.calls.find((c) => c[0] === HCP_DISCLOSURES_SUMMARY)?.[1]).toStrictEqual({ client: CLIENT_VID })
  })

  it('delivered: told, at usableUntil (the time of delivery)', async () => {
    const vta = fakeVta({
      summaries: [async () => summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT + 4 * SECOND) }])],
    })
    const { deps, store } = await setup(revoked(), vta, at)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) })
  })

  it('abandoned, changed since the first answer after the revoke: notTold, with usableUntil', async () => {
    const vta = fakeVta({
      summaries: [
        async () => summary([{ notification: 'none', usableUntil: null }]),
        async () => summary([{ notification: 'abandoned', usableUntil: iso(REVOKED_AT + 15 * MINUTE) }]),
      ],
    })
    const { deps, store, clock } = await setup(revoked(), vta, at)
    await pollHcpNotice(deps, CLIENT_VID)
    clock.now += 5 * SECOND
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 15 * MINUTE),
    })
  })

  it('none, a refusal or no answer: telling, lastPolledAt set', async () => {
    const answers: (() => Promise<unknown>)[] = [
      async () => summary([{ notification: 'none', usableUntil: null }]),
      async () => {
        throw refusal('permissionDenied')
      },
      async () => {
        throw new Error('unreachable')
      },
    ]
    for (const answer of answers) {
      const { deps, store } = await setup(revoked(), fakeVta({ summaries: [answer] }), at)
      await pollHcpNotice(deps, CLIENT_VID)
      expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'telling', lastPolledAt: iso(at) })
    }
  })

  it('told is never overwritten by a later none, and a settled notice sends nothing more', async () => {
    const vta = fakeVta({
      summaries: [
        async () => summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT + 4 * SECOND) }]),
        async () => summary([{ notification: 'none', usableUntil: null }]),
      ],
    })
    const { deps, store, task, clock } = await setup(revoked(), vta, at)
    await pollHcpNotice(deps, CLIENT_VID)
    clock.now += 5 * SECOND
    await pollHcpNotice(deps, CLIENT_VID)
    // One poll: the refused audit read, then the summary.
    expect(task).toHaveBeenCalledTimes(2)
    expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(1)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) })
  })

  it('told is not overwritten by a poll that was already in flight when it was set', async () => {
    let release: () => void = () => undefined
    const late = new Promise<void>((resolve) => {
      release = resolve
    })
    const vta = fakeVta({
      summaries: [
        async () => {
          await late
          return summary([{ notification: 'none', usableUntil: null }])
        },
      ],
    })
    const { deps, store } = await setup(revoked(), vta, at)
    const inFlight = pollHcpNotice(deps, CLIENT_VID)
    await new Promise((resolve) => setImmediate(resolve))
    await store.update(CLIENT_VID, (c) => ({ ...c, notice: { state: 'told', at: iso(REVOKED_AT + 4 * SECOND) } }))
    release()
    await inFlight
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) })
  })

  // control: a notice still telling IS updated by a later none (only told and notTold are final).
  it('control: telling is updated by a later none', async () => {
    const vta = fakeVta({ summaries: [async () => summary([{ notification: 'none', usableUntil: null }])] })
    const { deps, store, clock } = await setup(revoked({ state: 'telling', lastPolledAt: iso(at) }), vta, at)
    clock.now += 5 * SECOND
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'telling', lastPolledAt: iso(at + 5 * SECOND) })
  })

  it('sends nothing for a record that is not revoked', async () => {
    const { deps, task } = await setup(connection(), undefined, at)
    expect(await pollHcpNotice(deps, CLIENT_VID)).toEqual({ connection: connection() })
    expect(task).not.toHaveBeenCalled()
  })
})

/** Backlog 2, track 5: the summary read by our grant, one rule per case, each with its control. */
describe('pollHcpNotice: the summary read by our grant', () => {
  const at = REVOKED_AT + 10 * SECOND
  const answer = (value: unknown) => fakeVta({ summaries: [async () => value] })
  const noticeAfter = async (value: unknown, record = revoked(), now = at) => {
    const { deps, store } = await setup(record, answer(value), now)
    await pollHcpNotice(deps, CLIENT_VID)
    return store.get(CLIENT_VID)
  }
  const TELLING = { state: 'telling', lastPolledAt: iso(at) }
  /** The log's 60 s delay past the revoke: a summary with nothing for our grant settles from here. */
  const settledAt = REVOKED_AT + MINUTE

  it('an OK answer with no entry for the client (none, or another client only): nothingDisclosed', async () => {
    expect((await noticeAfter(summary([]), revoked(), settledAt))?.notice).toEqual({ state: 'nothingDisclosed' })
    const other = summary([{ client: OTHER_VID, notification: 'delivered', usableUntil: iso(REVOKED_AT) }])
    expect((await noticeAfter(other, revoked(), settledAt))?.notice).toEqual({ state: 'nothingDisclosed' })
  })

  // S2: a read acknowledged just before the revoke may reach the summary up to the log's 60 s delay later.
  it('S2: no entry for the client within 60 s of the revoke: telling, not yet nothingDisclosed', async () => {
    expect((await noticeAfter(summary([])))?.notice).toEqual(TELLING)
    expect((await noticeAfter(summary([]), revoked(), settledAt - 1))?.notice).toEqual({
      state: 'telling',
      lastPolledAt: iso(settledAt - 1),
    })
  })

  // control: the same answer with an entry for the client (notification none) keeps telling.
  it('control: an entry for the client, none: telling', async () => {
    expect((await noticeAfter(summary([{ notification: 'none', usableUntil: null }])))?.notice).toEqual(TELLING)
  })

  // control: a page with no entry for the client but a nextCursor does not show nothing was disclosed.
  it('control: no entry on this page and a nextCursor: telling, not nothingDisclosed', async () => {
    expect((await noticeAfter(summary([], 'page-2')))?.notice).toEqual(TELLING)
  })

  it('our grantId not in the client’s grants: nothingDisclosed, whatever the notification', async () => {
    const grants: GrantStatus[] = [{ grantId: RETIRED_GRANT, status: 'revoked' }]
    for (const notification of ['delivered', 'abandoned', 'none'] as const) {
      const value = summary([{ notification, usableUntil: iso(REVOKED_AT + 4 * SECOND), grants }])
      const after = await noticeAfter(value, revoked(), settledAt)
      expect(after?.notice).toEqual({ state: 'nothingDisclosed' })
      // Another grant's usableUntil is not kept for ours.
      expect(after?.lastUsableUntil).toBeUndefined()
    }
  })

  // control: the same answer with our grant listed beside the retired one reads by its notification.
  it('control: our grantId listed beside a retired one: delivered after the revoke is told', async () => {
    const grants: GrantStatus[] = [
      { grantId: RETIRED_GRANT, status: 'revoked' },
      { grantId: GRANT, status: 'revoked' },
    ]
    const value = summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT + 4 * SECOND), grants }])
    expect((await noticeAfter(value))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) })
  })

  it('delivered more than 60 s before our revokedAt is a retired grant’s notice: telling, its time not kept', async () => {
    const value = summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT - MINUTE - 1) }])
    const after = await noticeAfter(value)
    expect(after?.notice).toEqual(TELLING)
    expect(after?.lastUsableUntil).toBeUndefined()
  })

  // control: delivered at exactly our revokedAt counts as told.
  it('control: delivered at our revokedAt: told at that time', async () => {
    const value = summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT) }])
    expect((await noticeAfter(value))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT) })
  })

  // S9: the phone's clock 30 s ahead of the VTA's: a delivery 10 s "before" revokedAt is ours.
  it('S9: the phone clock ahead by 30 s, a delivery 10 s before revokedAt reads as told', async () => {
    const value = summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT - 10 * SECOND) }])
    expect((await noticeAfter(value))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT - 10 * SECOND) })
    // control: at exactly revokedAt less 60 s it still counts (a millisecond earlier does not: the test above).
    const edge = summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT - MINUTE) }])
    expect((await noticeAfter(edge))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT - MINUTE) })
  })

  it('delivered with no usableUntil cannot be shown to be ours: telling', async () => {
    expect((await noticeAfter(summary([{ notification: 'delivered', usableUntil: null }])))?.notice).toEqual(TELLING)
  })

  it('abandoned while our grant is listed active or expired is not ours: telling', async () => {
    for (const status of ['active', 'expired'] as const) {
      const value = summary([
        { notification: 'abandoned', usableUntil: iso(REVOKED_AT + 15 * MINUTE), grants: [{ grantId: GRANT, status }] },
      ])
      expect((await noticeAfter(value))?.notice).toEqual(TELLING)
    }
  })

  // control: the same answer with our grant listed revoked is notTold, once it differs from the first answer.
  it('control: abandoned while our grant is listed revoked, changed since the revoke: notTold', async () => {
    const value = summary([
      {
        notification: 'abandoned',
        usableUntil: iso(REVOKED_AT + 15 * MINUTE),
        grants: [{ grantId: GRANT, status: 'revoked' }],
      },
    ])
    const record = { ...revoked(), summaryAtRevoke: { notification: 'none' as const, usableUntil: null } }
    expect((await noticeAfter(value, record))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 15 * MINUTE),
    })
  })

  it('a stale abandoned (the same as the first answer after the revoke) keeps telling, until it changes', async () => {
    const stale = async () => summary([{ notification: 'abandoned', usableUntil: iso(REVOKED_AT - HOUR) }])
    const vta = fakeVta({
      summaries: [
        stale,
        stale,
        async () => summary([{ notification: 'abandoned', usableUntil: iso(REVOKED_AT + HOUR) }]),
      ],
    })
    const { deps, store, clock } = await setup(revoked(), vta, at)
    await pollHcpNotice(deps, CLIENT_VID)
    const first = await store.get(CLIENT_VID)
    expect(first?.notice).toEqual(TELLING)
    expect(first?.summaryAtRevoke).toEqual({ notification: 'abandoned', usableUntil: iso(REVOKED_AT - HOUR) })
    clock.now += 5 * SECOND
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'telling', lastPolledAt: iso(at + 5 * SECOND) })
    // A value changed after the revoke: now it is ours.
    clock.now += 5 * SECOND
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'notTold', usableUntil: iso(REVOKED_AT + HOUR) })
  })

  it('a stale abandoned still unchanged at 25 hours settles notTold (one stop for both paths)', async () => {
    const value = summary([{ notification: 'abandoned', usableUntil: iso(REVOKED_AT + 15 * MINUTE) }])
    const record = {
      ...revoked(),
      summaryAtRevoke: { notification: 'abandoned' as const, usableUntil: iso(REVOKED_AT + 15 * MINUTE) },
    }
    expect((await noticeAfter(value, record, REVOKED_AT + 25 * HOUR - 1))?.notice).toEqual({
      state: 'telling',
      lastPolledAt: iso(REVOKED_AT + 25 * HOUR - 1),
    })
    expect((await noticeAfter(value, record, REVOKED_AT + 25 * HOUR))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 15 * MINUTE),
    })
  })

  it('a refusal or an unreachable VTA is no answer, not nothing disclosed: telling', async () => {
    const answers = [
      async () => Promise.reject(refusal('permissionDenied')),
      async () => Promise.reject(new Error('unreachable')),
    ]
    for (const a of answers) {
      const { deps, store } = await setup(revoked(), fakeVta({ summaries: [a] }), at)
      await pollHcpNotice(deps, CLIENT_VID)
      expect((await store.get(CLIENT_VID))?.notice).toEqual(TELLING)
    }
  })

  // control: the HCP flags off is not nothing disclosed either: the record is left as it is.
  it('control: the HCP flags off leaves the record as it is', async () => {
    const { deps, store } = await setup(
      revoked(),
      fakeVta({ summaries: [async () => Promise.reject(new HcpOffError())] }),
      at
    )
    await pollHcpNotice(deps, CLIENT_VID)
    expect(await store.get(CLIENT_VID)).toEqual(revoked())
  })

  it('nothingDisclosed at the 25-hour stop wins over notTold', async () => {
    expect((await noticeAfter(summary([]), revoked(), REVOKED_AT + 25 * HOUR))?.notice).toEqual({
      state: 'nothingDisclosed',
    })
  })

  it('nothingDisclosed is final: no later poll is sent and the record stays as it is', async () => {
    const vta = fakeVta({
      summaries: [async () => summary([]), async () => summary([{ notification: 'none', usableUntil: null }])],
    })
    const { deps, store, task, clock } = await setup(revoked(), vta, settledAt)
    await pollHcpNotice(deps, CLIENT_VID)
    clock.now += 5 * SECOND
    await pollHcpNotice(deps, CLIENT_VID)
    expect(task).toHaveBeenCalledTimes(2)
    expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(1)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'nothingDisclosed' })
  })
})

/**
 * The "Telling…" rule (prep note §1): the notice read from the audit log by our grant. One test per row of its state
 * table (rows 1–13), each with its control. The fake log answers like a VTA: it filters by `eventType` and `from`, and
 * leaves the grant to Keyring.
 */
describe('pollHcpNotice: the audit log by grant (the "Telling…" rule)', () => {
  const at = REVOKED_AT + 10 * SECOND
  const APPROVED_AT = '2026-11-27T10:01:00.000Z'
  const ENTRY = (n: number) => `urn:uuid:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const TELLING = (now = at) => ({ state: 'telling', lastPolledAt: iso(now) })

  /** `grant.revoked` for `grantId` at `ms`, initiated by the management client unless `role` says otherwise. */
  const revokedEvent = (ms: number, role = 'management-client', grantId = GRANT) =>
    auditEvent('grant.revoked', iso(ms), {
      grantId,
      participants: { initiator: { role, id: 'did:key:manager' }, provider: { id: 'did:web:vta.example' } },
    })
  /** `context.read` under `grantId` at `ms`, disclosing one entry per `useUntil` given. */
  const contextRead = (ms: number, useUntils: number[], grantId = GRANT) =>
    auditEvent('context.read', iso(ms), {
      grantId,
      categories: ['general_preferences'],
      disclosed: useUntils.map((u, i) => ({ entryId: ENTRY(i + 1), version: 1, useUntil: iso(u) })),
    })
  /** `revocation.notified` for `grantId` at `ms` with `data`. */
  const notified = (ms: number, data: Record<string, unknown>, grantId = GRANT) =>
    auditEvent('revocation.notified', iso(ms), { grantId, data: { attempts: 1, ...data } })

  /** A VTA audit log of `events`: answers each read with those of its `eventType` at or after its `from`. */
  const auditLog = (events: Record<string, unknown>[]) =>
    fakeVta({
      // Read when asked, so a test can append to `events` between polls.
      audit: async (payload) => ({
        events: events.filter(
          (e) =>
            (payload.eventType === undefined || e.eventType === payload.eventType) &&
            (payload.from === undefined || Date.parse(e.timestamp as string) >= Date.parse(payload.from as string))
        ),
      }),
    })

  const DISCLOSED = contextRead(REVOKED_AT - 30 * MINUTE, [REVOKED_AT + 20 * MINUTE])
  const REVOKE = revokedEvent(REVOKED_AT - SECOND)
  /** The log's 60 s delay past the revoke: nothing read under the grant settles from here (S2). */
  const SETTLED = REVOKED_AT + MINUTE
  /** `grant.expired` for `grantId` at `ms`, appended by the provider. */
  const expiredEvent = (ms: number, grantId = GRANT) =>
    auditEvent('grant.expired', iso(ms), {
      grantId,
      participants: {
        initiator: { role: 'hcp-provider', id: 'did:web:vta.example' },
        provider: { id: 'did:web:vta.example' },
      },
    })

  const pollWith = async (events: Record<string, unknown>[], record = revoked(), now = at) => {
    const vta = auditLog(events)
    const { deps, store, task } = await setup(record, vta, now)
    await pollHcpNotice(deps, CLIENT_VID)
    return { after: await store.get(CLIENT_VID), task }
  }

  it('row 1: revocation.notified delivered for our grant: told at the event’s timestamp; no summary read', async () => {
    const { after, task } = await pollWith([
      DISCLOSED,
      REVOKE,
      notified(REVOKED_AT + 3 * SECOND, { outcome: 'delivered' }),
    ])
    expect(after?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 3 * SECOND) })
    expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(0)
    // Each read is filtered by eventType and from: grant.revoked and context.read since the approval (less 60 s),
    // revocation.notified since R (the provider's grant.revoked) less 60 s.
    const reads = task.mock.calls.filter((c) => c[0] === HCP_AUDIT_READ).map((c) => c[1])
    expect(reads).toEqual([
      { client: CLIENT_VID, limit: 100, eventType: 'grant.revoked', from: iso(Date.parse(APPROVED_AT) - MINUTE) },
      { client: CLIENT_VID, limit: 100, eventType: 'revocation.notified', from: iso(REVOKED_AT - SECOND - MINUTE) },
    ])
  })

  it('row 2: no revocation.notified for our grant yet: telling, with the largest useUntil kept', async () => {
    const { after } = await pollWith([DISCLOSED, REVOKE])
    expect(after?.notice).toEqual(TELLING())
    expect(after?.lastUsableUntil).toBe(iso(REVOKED_AT + 20 * MINUTE))
  })

  it('row 3: no context.read for our grant: nothingDisclosed (another grant’s reads do not count)', async () => {
    const other = contextRead(REVOKED_AT - 30 * MINUTE, [REVOKED_AT + 20 * MINUTE], RETIRED_GRANT)
    expect((await pollWith([REVOKE], revoked(), SETTLED)).after?.notice).toEqual({ state: 'nothingDisclosed' })
    expect((await pollWith([other, REVOKE], revoked(), SETTLED)).after?.notice).toEqual({ state: 'nothingDisclosed' })
  })

  it('row 4: context.read for our grant with every disclosed empty: nothingDisclosed', async () => {
    const empty = contextRead(REVOKED_AT - 30 * MINUTE, [])
    expect((await pollWith([empty, empty, REVOKE], revoked(), SETTLED)).after?.notice).toEqual({
      state: 'nothingDisclosed',
    })
  })

  // S2: HCP 8.4 lets a read be acknowledged before it is durable, so nothing read is not final until 60 s have passed.
  it('S2: a context.read that appears on the second poll: telling first, never nothingDisclosed', async () => {
    const log: Record<string, unknown>[] = [REVOKE]
    const { deps, store, clock } = await setup(revoked(), auditLog(log), at)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual(TELLING())
    // The read, acknowledged just before the revoke, is durable by the next poll.
    log.push(contextRead(REVOKED_AT - SECOND, [REVOKED_AT + 30 * MINUTE]))
    clock.now = SETTLED
    await pollHcpNotice(deps, CLIENT_VID)
    const after = await store.get(CLIENT_VID)
    expect(after?.notice).toEqual(TELLING(SETTLED))
    expect(after?.lastUsableUntil).toBe(iso(REVOKED_AT + 30 * MINUTE))
  })

  // control: S2: a millisecond before the 60 s, an empty log still keeps telling.
  it('control: S2: an empty log at 59.999 s keeps telling', async () => {
    expect((await pollWith([REVOKE], revoked(), SETTLED - 1)).after?.notice).toEqual(TELLING(SETTLED - 1))
  })

  // control: one non-empty disclosed among the empty ones means a notice is due.
  it('control: rows 3–4: one context.read with a disclosed entry keeps telling', async () => {
    const empty = contextRead(REVOKED_AT - 30 * MINUTE, [])
    expect((await pollWith([empty, DISCLOSED, REVOKE])).after?.notice).toEqual(TELLING())
  })

  it('row 5: an earlier grant’s delivered notice is ignored: telling, then our own outcome', async () => {
    const earlier = notified(REVOKED_AT + 2 * SECOND, { outcome: 'delivered' }, RETIRED_GRANT)
    expect((await pollWith([DISCLOSED, REVOKE, earlier])).after?.notice).toEqual(TELLING())
    // control: the same event for our grant is told.
    const ours = notified(REVOKED_AT + 2 * SECOND, { outcome: 'delivered' })
    expect((await pollWith([DISCLOSED, REVOKE, earlier, ours])).after?.notice).toEqual({
      state: 'told',
      at: iso(REVOKED_AT + 2 * SECOND),
    })
  })

  it('row 5: a notice from before R (less 60 s) is not read, whatever its grant', async () => {
    const before = notified(REVOKED_AT - SECOND - MINUTE - 1, { outcome: 'delivered' })
    expect((await pollWith([DISCLOSED, REVOKE, before])).after?.notice).toEqual(TELLING())
  })

  it('row 6: abandoned for our grant: notTold with data.lastUseUntil', async () => {
    const event = notified(REVOKED_AT + HOUR, {
      outcome: 'abandoned',
      attempts: 9,
      lastUseUntil: iso(REVOKED_AT + 45 * MINUTE),
    })
    expect((await pollWith([DISCLOSED, REVOKE, event])).after?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 45 * MINUTE),
    })
  })

  // control: with no lastUseUntil, the largest useUntil disclosed under the grant.
  it('control: row 6: abandoned with no lastUseUntil: notTold at the largest disclosed useUntil', async () => {
    const event = notified(REVOKED_AT + HOUR, { outcome: 'abandoned' })
    expect((await pollWith([DISCLOSED, REVOKE, event])).after?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 20 * MINUTE),
    })
  })

  it('a revocation.notified with no known outcome is not an outcome: telling', async () => {
    const event = notified(REVOKED_AT + HOUR, { outcome: 'pending' })
    expect((await pollWith([DISCLOSED, REVOKE, event])).after?.notice).toEqual(TELLING())
  })

  it('row 7: no final event by the stop (25 h): notTold at the largest useUntil, in the past tense', async () => {
    const stop = REVOKED_AT + 25 * HOUR
    const { after } = await pollWith([DISCLOSED, REVOKE], revoked(), stop)
    expect(after?.notice).toEqual({ state: 'notTold', usableUntil: iso(REVOKED_AT + 20 * MINUTE) })
    expect(after && hcpStatus(after, new Date(stop))).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeNotToldPast', params: { name: 'My notes agent', time: iso(REVOKED_AT + 20 * MINUTE) } },
    })
  })

  // control: a millisecond before the stop the same log keeps telling; nothing stops at 24 hours.
  it('control: row 7: at 24:59:59.999, and at 24:00, the notice stays telling', async () => {
    for (const now of [REVOKED_AT + 25 * HOUR - 1, REVOKED_AT + 24 * HOUR]) {
      expect((await pollWith([DISCLOSED, REVOKE], revoked(), now)).after?.notice).toEqual(TELLING(now))
    }
  })

  // S1: `ended` only on evidence. (a) The provider's grant.expired for our grant.
  it('row 8: no grant.revoked for our grant and a grant.expired for it: ended', async () => {
    const expiry = expiredEvent(REVOKED_AT - MINUTE)
    expect((await pollWith([DISCLOSED, expiry])).after?.notice).toEqual({ state: 'ended' })
  })

  // (b) The issued grant's own expiry (grant.issued's data.expiresAt) at or before the revoke, 5 minutes on.
  it('row 8: the issued grant’s expiry at or before the revoke, no grant.revoked after 5 minutes: ended', async () => {
    const issuedExpired = connection({
      grantExpiresAt: iso(REVOKED_AT),
      revokedAt: iso(REVOKED_AT),
      notice: { state: 'telling' },
    })
    expect(HCP_ENDED_MARGIN_MS).toBe(5 * MINUTE)
    expect((await pollWith([DISCLOSED], issuedExpired, REVOKED_AT + 5 * MINUTE)).after?.notice).toEqual({
      state: 'ended',
    })
  })

  // control: (a) another grant's grant.expired says nothing of ours; ours with a grant.revoked was revoked in time.
  it('control: row 8: grant.expired for another grant, or with a grant.revoked for ours, is not ended', async () => {
    expect((await pollWith([DISCLOSED, expiredEvent(REVOKED_AT - MINUTE, RETIRED_GRANT)])).after?.notice).toEqual(
      TELLING()
    )
    expect((await pollWith([DISCLOSED, REVOKE, expiredEvent(REVOKED_AT - MINUTE)])).after?.notice).toEqual(TELLING())
  })

  // S1: the log's 60 s delay is the provider's maximum on its own clock; the phone may see the event later.
  it('S1: a grant.revoked appended at VTA +59 s and visible at +61 s is never read as ended', async () => {
    const issuedExpired = connection({
      grantExpiresAt: iso(REVOKED_AT),
      revokedAt: iso(REVOKED_AT),
      notice: { state: 'telling' },
    })
    const log: Record<string, unknown>[] = [DISCLOSED]
    const { deps, store, clock } = await setup(issuedExpired, auditLog(log), REVOKED_AT + 61 * SECOND)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual(TELLING(REVOKED_AT + 61 * SECOND))
    log.push(revokedEvent(REVOKED_AT + 59 * SECOND))
    clock.now = REVOKED_AT + 5 * MINUTE
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual(TELLING(REVOKED_AT + 5 * MINUTE))
  })

  // S1: the effect's expiresAt is not the issued grant's: the grant is made at resubmission and can outlive it.
  it('S1: the effect’s expiresAt before the revoke, the issued grant’s later: not ended', async () => {
    const effectExpired = connection({
      expiresAt: iso(REVOKED_AT - MINUTE),
      grantExpiresAt: iso(REVOKED_AT + 10 * MINUTE),
      revokedAt: iso(REVOKED_AT),
      notice: { state: 'telling' },
    })
    expect((await pollWith([DISCLOSED], effectExpired, REVOKED_AT + 10 * MINUTE)).after?.notice).toEqual(
      TELLING(REVOKED_AT + 10 * MINUTE)
    )
    // With no grantExpiresAt known (the VTA gave none), the effect alone is no evidence either.
    const noIssuedExpiry = connection({
      expiresAt: iso(REVOKED_AT - MINUTE),
      revokedAt: iso(REVOKED_AT),
      notice: { state: 'telling' },
    })
    expect((await pollWith([DISCLOSED], noIssuedExpiry, REVOKED_AT + 10 * MINUTE)).after?.notice).toEqual(
      TELLING(REVOKED_AT + 10 * MINUTE)
    )
  })

  // control: (b) within the 5 minutes, or with the issued grant live at the revoke, it is not ended.
  it('control: row 8: within 5 minutes, or revoked before the issued expiry, it is not ended', async () => {
    const issuedExpired = connection({
      grantExpiresAt: iso(REVOKED_AT),
      revokedAt: iso(REVOKED_AT),
      notice: { state: 'telling' },
    })
    const early = REVOKED_AT + 5 * MINUTE - 1
    expect((await pollWith([DISCLOSED], issuedExpired, early)).after?.notice).toEqual(TELLING(early))
    const live = connection({
      grantExpiresAt: iso(REVOKED_AT + 1),
      revokedAt: iso(REVOKED_AT),
      notice: { state: 'telling' },
    })
    expect((await pollWith([DISCLOSED], live, REVOKED_AT + 5 * MINUTE)).after?.notice).toEqual(
      TELLING(REVOKED_AT + 5 * MINUTE)
    )
  })

  it('row 9: grant.revoked for our grant initiated by the context client: disconnected', async () => {
    const relinquished = revokedEvent(REVOKED_AT - HOUR, 'context-client')
    expect((await pollWith([DISCLOSED, relinquished])).after?.notice).toEqual({ state: 'disconnected' })
  })

  // control: the client relinquishing another grant of its own says nothing of ours.
  it('control: row 9: a context-client grant.revoked for another grant: not disconnected', async () => {
    const other = revokedEvent(REVOKED_AT - HOUR, 'context-client', RETIRED_GRANT)
    expect((await pollWith([DISCLOSED, other, REVOKE])).after?.notice).toEqual(TELLING())
  })

  it('row 10: a retried revoke: R is the first grant.revoked for the grant', async () => {
    const first = revokedEvent(REVOKED_AT - 10 * MINUTE)
    const { task } = await pollWith([DISCLOSED, first, REVOKE])
    const notifiedRead = task.mock.calls.find(
      (c) => c[0] === HCP_AUDIT_READ && c[1].eventType === 'revocation.notified'
    )
    expect(notifiedRead?.[1].from).toBe(iso(REVOKED_AT - 10 * MINUTE - MINUTE))
  })

  it('row 11: several reads (tokens) under the grant: one notice, usable until the largest useUntil', async () => {
    const later = contextRead(REVOKED_AT - 10 * MINUTE, [REVOKED_AT + 5 * MINUTE, REVOKED_AT + 50 * MINUTE])
    const { after } = await pollWith([DISCLOSED, later, REVOKE])
    expect(after?.lastUsableUntil).toBe(iso(REVOKED_AT + 50 * MINUTE))
    const event = notified(REVOKED_AT + HOUR, { outcome: 'abandoned' })
    expect((await pollWith([DISCLOSED, later, REVOKE, event])).after?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 50 * MINUTE),
    })
  })

  it('row 12: after a restart the log is read again and gives the same answer', async () => {
    const events = [DISCLOSED, REVOKE, notified(REVOKED_AT + 3 * SECOND, { outcome: 'delivered' })]
    const { deps, genericRecords, clock } = await setup(revoked(), auditLog(events), at)
    const restarted = new HcpConnectionStore({ genericRecords } as unknown as Agent)
    clock.now = at + HOUR
    await pollHcpNotice({ ...deps, store: restarted }, CLIENT_VID)
    expect((await restarted.get(CLIENT_VID))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 3 * SECOND) })
  })

  it('row 13: an audit read refused or malformed: the summary is read instead', async () => {
    const delivered = async () => summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT + 4 * SECOND) }])
    const refused = fakeVta({ audit: async () => Promise.reject(refusal('permissionDenied')), summaries: [delivered] })
    const malformed = fakeVta({ audit: async () => ({ items: [] }), auditUnchecked: true, summaries: [delivered] })
    for (const vta of [refused, malformed]) {
      const { deps, store, task } = await setup(revoked(), vta, at)
      await pollHcpNotice(deps, CLIENT_VID)
      expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(1)
      expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) })
    }
  })

  // control: an unreachable VTA is no answer: no summary, telling, and at the stop notTold at the last useUntil kept.
  it('control: row 13: an unreachable audit read reads no summary and keeps telling; the stop settles it', async () => {
    const unreachable = () => fakeVta({ audit: async () => Promise.reject(new Error('timeout')) })
    const first = await setup(revoked(), unreachable(), at)
    await pollHcpNotice(first.deps, CLIENT_VID)
    expect(sent(first.task, HCP_DISCLOSURES_SUMMARY)).toBe(0)
    expect((await first.store.get(CLIENT_VID))?.notice).toEqual(TELLING())
    const kept = { ...revoked(), lastUsableUntil: iso(REVOKED_AT + 20 * MINUTE) }
    const stop = await setup(kept, unreachable(), REVOKED_AT + 25 * HOUR)
    await pollHcpNotice(stop.deps, CLIENT_VID)
    expect((await stop.store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 20 * MINUTE),
    })
  })

  it('the HCP flags off on the audit read leaves the record as it is', async () => {
    const off = fakeVta({ audit: async () => Promise.reject(new HcpOffError()) })
    const { deps, store, task } = await setup(revoked(), off, at)
    expect(await pollHcpNotice(deps, CLIENT_VID)).toEqual({ connection: revoked() })
    expect(await store.get(CLIENT_VID)).toEqual(revoked())
    expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(0)
  })

  // S6: with maxUseSeconds known, "stops being usable at" is never earlier than revokedAt + maxUseSeconds.
  it('S6: abandoned with no lastUseUntil: notTold at revokedAt + maxUseSeconds when later than any useUntil', async () => {
    const event = notified(REVOKED_AT + HOUR, { outcome: 'abandoned' })
    const record = { ...revoked(), maxUseSeconds: 3600 }
    expect((await pollWith([DISCLOSED, REVOKE, event], record)).after?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + HOUR),
    })
    // control: the abandoned event's own lastUseUntil still wins.
    const told = notified(REVOKED_AT + HOUR, { outcome: 'abandoned', lastUseUntil: iso(REVOKED_AT + 45 * MINUTE) })
    expect((await pollWith([DISCLOSED, REVOKE, told], record)).after?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 45 * MINUTE),
    })
  })

  // control: S6: a useUntil read later than the bound is kept (the bound only ever moves the time later).
  it('control: S6: a useUntil read after revokedAt + maxUseSeconds wins at the stop', async () => {
    const record = { ...revoked(), maxUseSeconds: 600 }
    const { after } = await pollWith([DISCLOSED, REVOKE], record, REVOKED_AT + 25 * HOUR)
    expect(after?.notice).toEqual({ state: 'notTold', usableUntil: iso(REVOKED_AT + 20 * MINUTE) })
  })

  it('S6: an unreachable VTA at the stop, nothing kept: notTold at revokedAt + maxUseSeconds, not revokedAt', async () => {
    const unreachable = fakeVta({ audit: async () => Promise.reject(new Error('timeout')) })
    const { deps, store } = await setup({ ...revoked(), maxUseSeconds: 3600 }, unreachable, REVOKED_AT + 25 * HOUR)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'notTold', usableUntil: iso(REVOKED_AT + HOUR) })
  })

  /**
   * A log whose `context.read` answer runs to more pages than the reader reads (it is cut at 500 events): each page
   * holds 100 reads disclosing one entry usable until `REVOKED_AT + 5 min`; the latest useUntil is never read.
   */
  const longLog = (events: Record<string, unknown>[]) =>
    fakeVta({
      audit: async (payload) => {
        if (payload.eventType !== 'context.read') {
          return {
            events: events.filter(
              (e) =>
                e.eventType === payload.eventType &&
                Date.parse(e.timestamp as string) >= Date.parse(payload.from as string)
            ),
          }
        }
        const page = payload.cursor === undefined ? 0 : Number(payload.cursor)
        const reads = Array.from({ length: 100 }, (_, i) =>
          contextRead(REVOKED_AT - 50 * MINUTE + page * 100 + i, [REVOKED_AT + 5 * MINUTE])
        )
        return { events: reads, nextCursor: String(page + 1) }
      },
    })

  it('S7: a cut context.read read relies on revokedAt + maxUseSeconds, so it cannot understate', async () => {
    const event = notified(REVOKED_AT + HOUR, { outcome: 'abandoned' })
    const { deps, store, task } = await setup({ ...revoked(), maxUseSeconds: 3600 }, longLog([REVOKE, event]), at)
    await pollHcpNotice(deps, CLIENT_VID)
    expect(task.mock.calls.filter((c) => c[0] === HCP_AUDIT_READ && c[1].eventType === 'context.read')).toHaveLength(5)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'notTold', usableUntil: iso(REVOKED_AT + HOUR) })
  })

  // control: S7: with no maxUseSeconds there is no bound: the largest useUntil the cut read saw (documented).
  it('control: S7: a cut read with no maxUseSeconds settles at the largest useUntil it saw', async () => {
    const event = notified(REVOKED_AT + HOUR, { outcome: 'abandoned' })
    const { deps, store } = await setup(revoked(), longLog([REVOKE, event]), at)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 5 * MINUTE),
    })
  })

  // S8: once the revoke is 5 minutes old, step 1 is kept and later polls read only revocation.notified.
  it('S8: after 5 minutes, step 1 is kept on the record and later polls read only revocation.notified', async () => {
    const log: Record<string, unknown>[] = [DISCLOSED, REVOKE]
    const { deps, store, task, clock, genericRecords } = await setup(revoked(), auditLog(log), REVOKED_AT + 5 * MINUTE)
    const audits = () => task.mock.calls.filter((c) => c[0] === HCP_AUDIT_READ).map((c) => c[1].eventType)
    await pollHcpNotice(deps, CLIENT_VID)
    expect(audits()).toEqual(['grant.revoked', 'revocation.notified', 'context.read'])
    expect((await store.get(CLIENT_VID))?.auditStep1).toEqual({
      revokedEventAt: iso(REVOKED_AT - SECOND),
      maxUseUntil: iso(REVOKED_AT + 20 * MINUTE),
      cut: false,
    })
    task.mockClear()
    clock.now += MINUTE
    // Across a restart too: the kept step 1 is on the stored record.
    const restarted = new HcpConnectionStore({ genericRecords } as unknown as Agent)
    await pollHcpNotice({ ...deps, store: restarted }, CLIENT_VID)
    expect(task.mock.calls.map((c) => c[1])).toEqual([
      { client: CLIENT_VID, limit: 100, eventType: 'revocation.notified', from: iso(REVOKED_AT - SECOND - MINUTE) },
    ])
    expect((await restarted.get(CLIENT_VID))?.notice).toEqual(TELLING(REVOKED_AT + 6 * MINUTE))
    // The outcome still settles from the one read, with the kept useUntil.
    log.push(notified(REVOKED_AT + 7 * MINUTE, { outcome: 'abandoned' }))
    clock.now += MINUTE
    await pollHcpNotice({ ...deps, store: restarted }, CLIENT_VID)
    expect(task).toHaveBeenCalledTimes(2)
    expect((await restarted.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 20 * MINUTE),
    })
  })

  // control: S8: before 5 minutes nothing is kept, and each poll reads step 1 again.
  it('control: S8: before 5 minutes each poll reads all three, and nothing is kept', async () => {
    const early = REVOKED_AT + 5 * MINUTE - 1
    const { deps, store, task, clock } = await setup(revoked(), auditLog([DISCLOSED, REVOKE]), at)
    await pollHcpNotice(deps, CLIENT_VID)
    clock.now = early
    await pollHcpNotice(deps, CLIENT_VID)
    expect(sent(task, HCP_AUDIT_READ)).toBe(6)
    expect((await store.get(CLIENT_VID))?.auditStep1).toBeUndefined()
  })

  it('ended, disconnected and nothingDisclosed are final: a later poll sends nothing', async () => {
    for (const notice of [{ state: 'ended' }, { state: 'disconnected' }, { state: 'nothingDisclosed' }] as const) {
      const { after, task } = await pollWith(
        [DISCLOSED, REVOKE, notified(at, { outcome: 'delivered' })],
        revoked(notice)
      )
      expect(task).not.toHaveBeenCalled()
      expect(after?.notice).toEqual(notice)
    }
  })
})

describe('nextHcpPoll: the schedule', () => {
  const after = (ms: number) => nextHcpPoll(new Date(REVOKED_AT), new Date(REVOKED_AT + ms))

  it('every 5 s up to 1:59.999 after the revoke', () => {
    expect(after(0)).toBe(HCP_POLL_FAST_MS)
    expect(HCP_POLL_FAST_MS).toBe(5000)
    expect(after(2 * MINUTE - 1)).toBe(5000)
  })

  // control: the millisecond after the case above.
  it('control: every minute from 2:00 to 24:59:59.999', () => {
    expect(HCP_POLL_SLOW_MS).toBe(60000)
    expect(after(2 * MINUTE)).toBe(60000)
    expect(after(25 * HOUR - 1)).toBe(60000)
  })

  it('stops at 25:00 (the carriage’s 24 hours of attempts, and a margin)', () => {
    expect(HCP_POLL_STOP_AFTER_MS).toBe(25 * HOUR)
    expect(after(25 * HOUR)).toBeUndefined()
    expect(after(30 * HOUR)).toBeUndefined()
  })
})

describe('the summary fallback’s stop: 25 hours, as the audit rule’s', () => {
  const STOP = REVOKED_AT + 25 * HOUR
  const none = (usableUntil: string | null = null) =>
    fakeVta({ summaries: [async () => summary([{ notification: 'none', usableUntil }])] })

  const withLastRead = () => ({ ...revoked(), lastUsableUntil: iso(REVOKED_AT + 20 * MINUTE) })

  it('a poll at the stop still telling becomes notTold with the last usableUntil read', async () => {
    const { deps, store } = await setup(withLastRead(), none(), STOP)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 20 * MINUTE),
    })
  })

  it("the stop poll's own usableUntil wins over an earlier one", async () => {
    const { deps, store } = await setup(withLastRead(), none(iso(REVOKED_AT + 30 * MINUTE)), STOP)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 30 * MINUTE),
    })
  })

  it('with no usableUntil ever read (or the VTA unreachable) and no maxUseSeconds, notTold at revokedAt', async () => {
    const unreachable = fakeVta({
      summaries: [
        async () => {
          throw new Error('unreachable')
        },
      ],
    })
    for (const vta of [none(), unreachable]) {
      const { deps, store } = await setup(revoked(), vta, STOP)
      await pollHcpNotice(deps, CLIENT_VID)
      expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'notTold', usableUntil: iso(REVOKED_AT) })
    }
  })

  // S6: with maxUseSeconds known, never revokedAt alone: revokedAt + maxUseSeconds, or a later usableUntil read.
  it('S6: with no usableUntil ever read and maxUseSeconds known, notTold at revokedAt + maxUseSeconds', async () => {
    const { deps, store } = await setup({ ...revoked(), maxUseSeconds: 3600 }, none(), STOP)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'notTold', usableUntil: iso(REVOKED_AT + HOUR) })
    // control: an earlier kept usableUntil does not pull it back; a later one is kept.
    const earlier = await setup({ ...withLastRead(), maxUseSeconds: 3600 }, none(), STOP)
    await pollHcpNotice(earlier.deps, CLIENT_VID)
    expect((await earlier.store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + HOUR),
    })
    const later = await setup({ ...withLastRead(), maxUseSeconds: 600 }, none(), STOP)
    await pollHcpNotice(later.deps, CLIENT_VID)
    expect((await later.store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 20 * MINUTE),
    })
  })

  // The opposite of the unreachable case above: the HCP flags off is no answer, so even the stop poll settles nothing.
  it('the HCP flags off at the stop leaves the record as it is, not notTold', async () => {
    const off = fakeVta({ summaries: [async () => Promise.reject(new HcpOffError())] })
    const { deps, store } = await setup(revoked(), off, STOP)
    expect(await pollHcpNotice(deps, CLIENT_VID)).toEqual({ connection: revoked() })
    expect(await store.get(CLIENT_VID)).toEqual(revoked())
  })

  // control: one millisecond before the stop, the same answer keeps telling (and at 24:00, the old stop).
  it('control: at 24:59:59.999, and at 24:00, the notice stays telling', async () => {
    const old = await setup(withLastRead(), none(), REVOKED_AT + 24 * HOUR)
    await pollHcpNotice(old.deps, CLIENT_VID)
    expect((await old.store.get(CLIENT_VID))?.notice).toEqual({
      state: 'telling',
      lastPolledAt: iso(REVOKED_AT + 24 * HOUR),
    })
    const { deps, store } = await setup(withLastRead(), none(), STOP - 1)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'telling', lastPolledAt: iso(STOP - 1) })
  })

  it('a usableUntil read is kept on the record, so the stop settles the same across a restart', async () => {
    const vta = fakeVta({
      summaries: [
        async () => summary([{ notification: 'none', usableUntil: iso(REVOKED_AT + 20 * MINUTE) }]),
        async () => summary([{ notification: 'none', usableUntil: null }]),
      ],
    })
    const { deps, store, genericRecords, clock } = await setup(revoked(), vta, REVOKED_AT + 20 * MINUTE)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.lastUsableUntil).toBe(iso(REVOKED_AT + 20 * MINUTE))
    // The app restarts: a new store over the same records, and no memory of the earlier poll.
    const restarted = new HcpConnectionStore({ genericRecords } as unknown as Agent)
    clock.now = STOP
    await pollHcpNotice({ ...deps, store: restarted }, CLIENT_VID)
    expect((await restarted.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 20 * MINUTE),
    })
  })

  // control: an answer without usableUntil leaves the kept one as it is (it is not cleared).
  it('control: a later poll with no usableUntil does not clear the kept one', async () => {
    const { deps, store } = await setup(withLastRead(), none(), REVOKED_AT + 30 * MINUTE)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.lastUsableUntil).toBe(iso(REVOKED_AT + 20 * MINUTE))
  })
})

describe('useHcpNotice', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: REVOKED_AT })
    setAgentConnectEnabled(true)
    setHcpEnabled(true)
  })
  afterEach(() => {
    setHcpEnabled(false)
    setAgentConnectEnabled(false)
    jest.useRealTimers()
  })

  it('polls every 5 s while telling, and stops once told', async () => {
    const vta = fakeVta({
      summaries: [
        async () => summary([{ notification: 'none', usableUntil: null }]),
        async () => summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT + 7 * SECOND) }]),
      ],
    })
    const { deps, task, clock } = await setup(revoked(), vta)
    const advance = async (ms: number) => {
      clock.now += ms
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms)
      })
    }
    const { result } = renderHook(() => useHcpNotice(deps, CLIENT_VID))
    await advance(0)
    expect(result.current).toEqual(revoked())
    expect(task).not.toHaveBeenCalled()
    await advance(HCP_POLL_FAST_MS)
    expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(1)
    expect(result.current?.notice).toEqual({ state: 'telling', lastPolledAt: iso(REVOKED_AT + 5 * SECOND) })
    await advance(HCP_POLL_FAST_MS)
    expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(2)
    expect(result.current?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 7 * SECOND) })
    await advance(10 * MINUTE)
    expect(task).toHaveBeenCalledTimes(4)
  })

  it('stops polling once the summary shows nothing disclosed', async () => {
    // From the log's 60 s delay past the revoke, when an answer with nothing for our grant settles the notice.
    const vta = fakeVta({ summaries: [async () => summary([])] })
    const { deps, task, clock } = await setup(revoked(), vta, REVOKED_AT + MINUTE)
    const { result } = renderHook(() => useHcpNotice(deps, CLIENT_VID))
    for (const ms of [0, HCP_POLL_FAST_MS, 10 * MINUTE]) {
      clock.now += ms
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms)
      })
    }
    expect(task).toHaveBeenCalledTimes(2)
    expect(sent(task, HCP_DISCLOSURES_SUMMARY)).toBe(1)
    expect(result.current?.notice).toEqual({ state: 'nothingDisclosed' })
  })

  it('stops polling when unmounted', async () => {
    const { deps, task, clock } = await setup(revoked())
    const { unmount } = renderHook(() => useHcpNotice(deps, CLIENT_VID))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    unmount()
    clock.now += MINUTE
    await act(async () => {
      await jest.advanceTimersByTimeAsync(MINUTE)
    })
    expect(task).not.toHaveBeenCalled()
  })

  // control: the opposite of the first case: with the HCP flag off, nothing is read or sent.
  it('control: with the HCP flag off, it reads nothing and sends nothing', async () => {
    setHcpEnabled(false)
    const { deps, task, clock, genericRecords } = await setup(revoked())
    genericRecords.findAllByQuery.mockClear()
    const { result } = renderHook(() => useHcpNotice(deps, CLIENT_VID))
    clock.now += MINUTE
    await act(async () => {
      await jest.advanceTimersByTimeAsync(MINUTE)
    })
    expect(result.current).toBeUndefined()
    expect(task).not.toHaveBeenCalled()
    expect(genericRecords.findAllByQuery).not.toHaveBeenCalled()
  })
})
