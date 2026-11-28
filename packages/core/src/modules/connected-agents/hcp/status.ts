/**
 * The status line of an HCP connection (step 7.27 track C, part 3, "The record (C2)"): copy keys and parameters,
 * with times as ISO-8601 instants. Formatting a time is the screen's job.
 *
 * @module connected-agents/hcp/status
 */
import type { HcpConnection } from './types'

/** Whether the client has been told of the revoke. */
export type HcpNoticeLine =
  | { key: 'RevokeTelling'; params: { name: string } }
  | { key: 'RevokeTold'; params: { name: string; time: string } }
  | { key: 'RevokeNotTold'; params: { name: string; time: string } }
  /** Not told, and the time anything it read stays usable has already passed. */
  | { key: 'RevokeNotToldPast'; params: { name: string; time: string } }
  /** Nothing was disclosed to the client under the grant: "Revoked." alone. */
  | { key: 'RevokeNothingDisclosed' }
  /** The grant had already expired: nothing to tell. */
  | { key: 'RevokeAlreadyEnded'; params: { name: string } }
  /** The client had already relinquished the grant: nothing to tell. */
  | { key: 'RevokeAlreadyDisconnected'; params: { name: string } }

export type HcpStatus =
  | { key: 'StatusRevoked'; notice: HcpNoticeLine }
  | { key: 'StatusExpired' }
  | { key: 'StatusConnectedUntil'; params: { time: string } }

/**
 * The notice line of a revoked record. A revoked record with no notice yet reads as `telling`. Given `now`, a
 * `notTold` whose time is at or before it reads in the past tense.
 */
export function hcpNoticeLine(c: HcpConnection, now?: Date): HcpNoticeLine {
  const name = c.name
  const notice = c.notice
  if (notice?.state === 'told') return { key: 'RevokeTold', params: { name, time: notice.at } }
  if (notice?.state === 'notTold') {
    const past = now !== undefined && Date.parse(notice.usableUntil) <= now.getTime()
    return { key: past ? 'RevokeNotToldPast' : 'RevokeNotTold', params: { name, time: notice.usableUntil } }
  }
  if (notice?.state === 'nothingDisclosed') return { key: 'RevokeNothingDisclosed' }
  if (notice?.state === 'ended') return { key: 'RevokeAlreadyEnded', params: { name } }
  if (notice?.state === 'disconnected') return { key: 'RevokeAlreadyDisconnected', params: { name } }
  return { key: 'RevokeTelling', params: { name } }
}

/** Revoked first (whatever the time), else expired at or after `expiresAt`, else connected until `expiresAt`. */
export function hcpStatus(c: HcpConnection, now: Date): HcpStatus {
  if (c.revokedAt) return { key: 'StatusRevoked', notice: hcpNoticeLine(c, now) }
  if (now.getTime() >= Date.parse(c.expiresAt)) return { key: 'StatusExpired' }
  return { key: 'StatusConnectedUntil', params: { time: c.expiresAt } }
}
