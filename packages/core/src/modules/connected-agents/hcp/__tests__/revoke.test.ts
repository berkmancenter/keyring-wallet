/**
 * Revoke and the notice state (C6), against a fake VTA port, a fake clock and the real `HcpConnectionStore` over
 * memory records: revoke sends exactly `{ grantId }` and sets `telling`; a refusal or an unreachable VTA changes
 * nothing; each `notification` value; the schedule's boundaries; `told` never overwritten; the 24-hour stop; and the
 * hook that polls while mounted. Every request sent and every answer given validates against the vendored schemas.
 */
import type { Agent } from '@credo-ts/core'
import { act, renderHook } from '@testing-library/react-native'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { setAgentConnectEnabled } from '../../agentConnectFlag'
import { setHcpEnabled } from '../hcpFlag'
import {
  HCP_POLL_FAST_MS,
  HCP_POLL_SLOW_MS,
  nextHcpPoll,
  pollHcpNotice,
  revokeHcpGrant,
  useHcpNotice,
  type HcpRevokeDeps,
} from '../revoke'
import { HcpConnectionStore } from '../store'
import { HCP_DISCLOSURES_SUMMARY, HCP_GRANTS_REVOKE, type HcpConnection } from '../types'
import type { HcpVtaPort } from '../vtaPort'
import { expectValid, hcpSchemas } from './fixtures/hcpSchemas'
import { CLIENT_VID, GRANT, OTHER_VID, THREAD } from './fixtures/hcpApproval'

const S = hcpSchemas()
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

/** A `disclosures/summary` answer, checked against the vendored response schema. */
function summary(entries: { client?: string; notification: Notification; usableUntil: string | null }[]) {
  const answer = {
    clients: entries.map((e) => ({
      client: { id: e.client ?? CLIENT_VID, name: 'hcp-demo', operator: { id: 'did:web:example.org', name: 'Ex' } },
      grants: [{ grantId: GRANT, status: 'revoked' }],
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

/**
 * A fake VTA: answers `grants/revoke` with `{}` (or `revoke()` if given) and `disclosures/summary` with the next of
 * `summaries` (or the last, once they run out). Every request it is sent is checked against the vendored schema.
 */
function fakeVta(options: { revoke?: () => Promise<unknown>; summaries?: (() => Promise<unknown>)[] } = {}) {
  let polls = 0
  const task = jest.fn(async (type: string, payload: Record<string, unknown>) => {
    expectValid(S[type].request, payload)
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

  it('a refusal changes nothing and names its code', async () => {
    const vta = fakeVta({
      revoke: async () => {
        throw refusal('notFound')
      },
    })
    const { deps, store } = await setup(connection(), vta)
    expect(await revokeHcpGrant(deps, CLIENT_VID)).toEqual({ ok: false, refused: 'notFound' })
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
    expect(task.mock.calls[0][1]).toStrictEqual({ client: CLIENT_VID })
  })

  it('delivered: told, at usableUntil (the time of delivery)', async () => {
    const vta = fakeVta({
      summaries: [async () => summary([{ notification: 'delivered', usableUntil: iso(REVOKED_AT + 4 * SECOND) }])],
    })
    const { deps, store } = await setup(revoked(), vta, at)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 4 * SECOND) })
  })

  it('abandoned: notTold, with usableUntil', async () => {
    const vta = fakeVta({
      summaries: [async () => summary([{ notification: 'abandoned', usableUntil: iso(REVOKED_AT + 15 * MINUTE) }])],
    })
    const { deps, store } = await setup(revoked(), vta, at)
    await pollHcpNotice(deps, CLIENT_VID)
    expect((await store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 15 * MINUTE),
    })
  })

  it('none, no entry, an entry for another client only, a refusal or no answer: telling, lastPolledAt set', async () => {
    const answers: (() => Promise<unknown>)[] = [
      async () => summary([{ notification: 'none', usableUntil: null }]),
      async () => summary([]),
      async () => summary([{ client: OTHER_VID, notification: 'delivered', usableUntil: iso(REVOKED_AT) }]),
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
    expect(task).toHaveBeenCalledTimes(1)
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

describe('nextHcpPoll: the schedule', () => {
  const after = (ms: number) => nextHcpPoll(new Date(REVOKED_AT), new Date(REVOKED_AT + ms))

  it('every 5 s up to 1:59.999 after the revoke', () => {
    expect(after(0)).toBe(HCP_POLL_FAST_MS)
    expect(HCP_POLL_FAST_MS).toBe(5000)
    expect(after(2 * MINUTE - 1)).toBe(5000)
  })

  // control: the millisecond after the case above.
  it('control: every minute from 2:00 to 23:59:59.999', () => {
    expect(HCP_POLL_SLOW_MS).toBe(60000)
    expect(after(2 * MINUTE)).toBe(60000)
    expect(after(24 * HOUR - 1)).toBe(60000)
  })

  it('stops at 24:00', () => {
    expect(after(24 * HOUR)).toBeUndefined()
    expect(after(30 * HOUR)).toBeUndefined()
  })
})

describe('the 24-hour stop', () => {
  const STOP = REVOKED_AT + 24 * HOUR
  const none = (usableUntil: string | null = null) =>
    fakeVta({ summaries: [async () => summary([{ notification: 'none', usableUntil }])] })

  it('a poll at the stop still telling becomes notTold with the last usableUntil read', async () => {
    const { deps, store } = await setup(revoked(), none(), STOP)
    await pollHcpNotice(deps, CLIENT_VID, { lastUsableUntil: iso(REVOKED_AT + 20 * MINUTE) })
    expect((await store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 20 * MINUTE),
    })
  })

  it("the stop poll's own usableUntil wins over an earlier one", async () => {
    const { deps, store } = await setup(revoked(), none(iso(REVOKED_AT + 30 * MINUTE)), STOP)
    await pollHcpNotice(deps, CLIENT_VID, { lastUsableUntil: iso(REVOKED_AT + 20 * MINUTE) })
    expect((await store.get(CLIENT_VID))?.notice).toEqual({
      state: 'notTold',
      usableUntil: iso(REVOKED_AT + 30 * MINUTE),
    })
  })

  it('with no usableUntil ever read (or the VTA unreachable), notTold at revokedAt', async () => {
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

  // control: one millisecond before the stop, the same answer keeps telling.
  it('control: at 23:59:59.999 the notice stays telling', async () => {
    const { deps, store } = await setup(revoked(), none(), STOP - 1)
    await pollHcpNotice(deps, CLIENT_VID, { lastUsableUntil: iso(REVOKED_AT + 20 * MINUTE) })
    expect((await store.get(CLIENT_VID))?.notice).toEqual({ state: 'telling', lastPolledAt: iso(STOP - 1) })
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
    expect(task).toHaveBeenCalledTimes(1)
    expect(result.current?.notice).toEqual({ state: 'telling', lastPolledAt: iso(REVOKED_AT + 5 * SECOND) })
    await advance(HCP_POLL_FAST_MS)
    expect(task).toHaveBeenCalledTimes(2)
    expect(result.current?.notice).toEqual({ state: 'told', at: iso(REVOKED_AT + 7 * SECOND) })
    await advance(10 * MINUTE)
    expect(task).toHaveBeenCalledTimes(2)
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
