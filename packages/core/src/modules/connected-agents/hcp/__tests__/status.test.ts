/**
 * The status line of an HCP connection (C2), at the boundary instants: connected until `expiresAt`, expired from
 * `expiresAt` on, and revoked (with its notice line) whatever the time.
 */
import { hcpText } from '../copy'
import { hcpStatus } from '../status'
import type { HcpConnection } from '../types'
import { CLIENT_VID, GRANT, THREAD } from './fixtures/hcpApproval'

const EXPIRES = '2026-11-27T14:01:00.000Z'
const at = (ms: number) => new Date(Date.parse(EXPIRES) + ms)

const connection = (change: Partial<HcpConnection> = {}): HcpConnection => ({
  id: CLIENT_VID,
  name: 'My notes agent',
  grantId: GRANT,
  threadId: THREAD,
  approvedAt: '2026-11-27T10:01:00.000Z',
  expiresAt: EXPIRES,
  ...change,
})

describe('hcpStatus', () => {
  it('one millisecond before expiresAt: connected until expiresAt', () => {
    expect(hcpStatus(connection(), at(-1))).toEqual({ key: 'StatusConnectedUntil', params: { time: EXPIRES } })
  })

  // control: the instant after the case above reads the opposite.
  it('control: at expiresAt: expired', () => {
    expect(hcpStatus(connection(), at(0))).toEqual({ key: 'StatusExpired' })
    expect(hcpStatus(connection(), at(1))).toEqual({ key: 'StatusExpired' })
  })

  it('revoked before expiresAt reads revoked, telling, before and after expiresAt', () => {
    const revoked = connection({ revokedAt: '2026-11-27T11:00:00.000Z', notice: { state: 'telling' } })
    const telling = { key: 'StatusRevoked', notice: { key: 'RevokeTelling', params: { name: 'My notes agent' } } }
    expect(hcpStatus(revoked, at(-1))).toEqual(telling)
    expect(hcpStatus(revoked, at(0))).toEqual(telling)
  })

  it('a revoked record with no notice yet reads telling', () => {
    expect(hcpStatus(connection({ revokedAt: '2026-11-27T11:00:00.000Z' }), at(-1))).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeTelling', params: { name: 'My notes agent' } },
    })
  })

  it('told gives RevokeTold at the time of delivery; notTold gives RevokeNotTold at usableUntil', () => {
    const base = { revokedAt: '2026-11-27T11:00:00.000Z' }
    expect(
      hcpStatus(connection({ ...base, notice: { state: 'told', at: '2026-11-27T11:00:04.000Z' } }), at(-1))
    ).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeTold', params: { name: 'My notes agent', time: '2026-11-27T11:00:04.000Z' } },
    })
    expect(
      hcpStatus(connection({ ...base, notice: { state: 'notTold', usableUntil: '2026-11-27T14:15:00.000Z' } }), at(5))
    ).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeNotTold', params: { name: 'My notes agent', time: '2026-11-27T14:15:00.000Z' } },
    })
  })

  it('notTold at or after its usableUntil gives RevokeNotToldPast ("stopped being usable")', () => {
    const base = { revokedAt: '2026-11-27T11:00:00.000Z' }
    const notTold = connection({ ...base, notice: { state: 'notTold', usableUntil: EXPIRES } })
    const line = (now: Date) => hcpStatus(notTold, now)
    expect(line(at(0))).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeNotToldPast', params: { name: 'My notes agent', time: EXPIRES } },
    })
    // control: one millisecond before, the present tense.
    expect(line(at(-1))).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeNotTold', params: { name: 'My notes agent', time: EXPIRES } },
    })
    expect(hcpText('RevokeNotToldPast', 'en', { name: 'x', time: '11:15' })).toBe(
      'Revoked. We couldn\'t tell "x". Anything it read stopped being usable at 11:15.'
    )
  })

  it('ended and disconnected give RevokeAlreadyEnded and RevokeAlreadyDisconnected, with the name', () => {
    const base = { revokedAt: '2026-11-27T11:00:00.000Z' }
    expect(hcpStatus(connection({ ...base, notice: { state: 'ended' } }), at(-1))).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeAlreadyEnded', params: { name: 'My notes agent' } },
    })
    expect(hcpStatus(connection({ ...base, notice: { state: 'disconnected' } }), at(-1))).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeAlreadyDisconnected', params: { name: 'My notes agent' } },
    })
    expect(hcpText('RevokeAlreadyEnded', 'en', { name: 'x' })).toBe(
      'Access for "x" had already ended, so there was nothing to tell.'
    )
    expect(hcpText('RevokeAlreadyDisconnected', 'en', { name: 'x' })).toBe(
      '"x" had already disconnected, so there was nothing to tell.'
    )
  })

  it('nothingDisclosed gives RevokeNothingDisclosed ("Revoked." alone), with no name and no time', () => {
    const revoked = connection({ revokedAt: '2026-11-27T11:00:00.000Z', notice: { state: 'nothingDisclosed' } })
    expect(hcpStatus(revoked, at(-1))).toEqual({ key: 'StatusRevoked', notice: { key: 'RevokeNothingDisclosed' } })
    expect(hcpText('RevokeNothingDisclosed', 'en')).toBe('Revoked.')
  })

  // control: a notice still telling, on the same record, is not that line.
  it('control: the same record still telling reads RevokeTelling, not RevokeNothingDisclosed', () => {
    const revoked = connection({ revokedAt: '2026-11-27T11:00:00.000Z', notice: { state: 'telling' } })
    expect(hcpStatus(revoked, at(-1))).toEqual({
      key: 'StatusRevoked',
      notice: { key: 'RevokeTelling', params: { name: 'My notes agent' } },
    })
  })
})
