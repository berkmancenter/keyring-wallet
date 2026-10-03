/**
 * What the Requests screen shows. Requests arrive only as messages over the
 * live agent connection, so the screen cannot ask "is anything waiting?": it
 * says so only after the connection has been up and quiet for a while.
 */
import type { VtiApproval } from '../module/vtaAgent'
import type { VtaLinkState } from '../module/vtaLinkMachine'
import { QUIET_MS, requestsView } from '../screens/requestsView'

const NOW = Date.parse('2026-10-02T12:00:00Z')
const request = (id: string, over: Partial<VtiApproval> = {}): VtiApproval =>
  ({
    id,
    requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    taskType: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
    receivedAt: '2026-10-02T11:59:00Z',
    expiresAt: '2026-10-02T12:05:00Z',
    status: 'pending',
    ...over,
  }) as VtiApproval

const linked = (connection: unknown): VtaLinkState =>
  ({ kind: 'linked', vtaDid: 'did:webvh:example:vta', linkedAt: '2026-10-01T00:00:00Z', connection }) as VtaLinkState
const online = linked({ kind: 'online' })
const view = (over: Partial<Parameters<typeof requestsView>[0]> = {}) =>
  requestsView({ link: online, approvals: [], now: NOW, onlineSince: NOW - QUIET_MS, ...over })

describe('what waits', () => {
  it('a waiting request is shown, whatever the connection is doing', () => {
    const a = request('a')
    for (const link of [online, linked({ kind: 'connecting', since: NOW }), linked({ kind: 'offline', since: NOW })]) {
      expect(view({ link, approvals: [a] })).toMatchObject({ mode: 'waiting', waiting: [a] })
    }
  })

  it('lists only what waits: decided requests are "earlier", a request past its expiry is "expired"', () => {
    const waits = request('waits')
    const late = request('late', { expiresAt: '2026-10-02T11:59:59Z' })
    const yes = request('yes', { status: 'approved' })
    const no = request('no', { status: 'denied' })
    const lost = request('lost', { status: 'failed', error: 'could not send' })
    const shown = view({ approvals: [waits, late, yes, no, lost] })
    expect(shown.mode).toBe('waiting')
    expect(shown.waiting).toEqual([waits])
    expect(shown.expired).toEqual([late])
    expect(shown.earlier).toEqual([yes, no, lost])
  })
})

describe('after deciding', () => {
  it('says what was decided when nothing else waits', () => {
    expect(view({ approvals: [request('a', { status: 'approved' })], decided: 'approved' })).toMatchObject({
      mode: 'done',
      decided: 'approved',
    })
    expect(view({ approvals: [request('a', { status: 'denied' })], decided: 'denied' })).toMatchObject({
      mode: 'done',
      decided: 'denied',
    })
  })

  it('and still shows what waits, with the decision said above it', () => {
    const b = request('b')
    expect(view({ approvals: [request('a', { status: 'approved' }), b], decided: 'approved' })).toMatchObject({
      mode: 'waiting',
      decided: 'approved',
      waiting: [b],
    })
  })
})

describe('nothing waiting', () => {
  it('is said only once the connection has been up and quiet long enough', () => {
    expect(view({ onlineSince: NOW - QUIET_MS }).mode).toBe('empty')
    expect(view({ onlineSince: NOW - QUIET_MS + 1 }).mode).toBe('loading')
    // Up, but this screen has not seen it up yet.
    expect(view({ onlineSince: undefined }).mode).toBe('loading')
  })

  it('while the connection comes up, the screen says it is getting the requests', () => {
    expect(view({ link: linked({ kind: 'connecting', since: NOW }), onlineSince: undefined }).mode).toBe('loading')
    expect(
      view({
        link: linked({ kind: 'reconnecting', attempt: 1, nextRetryAt: NOW + 1000, since: NOW }),
        onlineSince: undefined,
      }).mode
    ).toBe('loading')
  })

  it('an agent that cannot be reached is said, not an endless wait', () => {
    expect(view({ link: linked({ kind: 'offline', since: NOW }), onlineSince: undefined }).mode).toBe('unreachable')
    expect(
      view({
        link: linked({ kind: 'reconnecting', attempt: 9, nextRetryAt: NOW, since: NOW }),
        reconnectGaveUp: true,
        onlineSince: undefined,
      }).mode
    ).toBe('unreachable')
  })

  it('a request that reached the phone and expired is shown as expired, not as "nothing is waiting"', () => {
    const late = request('late', { expiresAt: '2026-10-02T11:00:00Z' })
    expect(view({ approvals: [late] })).toMatchObject({ mode: 'expired', expired: [late], waiting: [] })
  })

  it('a phone not linked to an agent has nothing to show', () => {
    expect(view({ link: { kind: 'notLinked' } as VtaLinkState }).mode).toBe('notLinked')
  })

  it('before the saved link is read, "not linked" is not known yet: still loading', () => {
    expect(view({ link: { kind: 'notLinked' } as VtaLinkState, linkRestored: false }).mode).toBe('loading')
    expect(view({ link: { kind: 'notLinked' } as VtaLinkState, linkRestored: true }).mode).toBe('notLinked')
  })
})
