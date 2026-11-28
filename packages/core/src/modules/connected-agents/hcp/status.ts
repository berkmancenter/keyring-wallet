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
  /** Nothing was disclosed to the client under the grant: "Revoked." alone. */
  | { key: 'RevokeNothingDisclosed' }

export type HcpStatus =
  | { key: 'StatusRevoked'; notice: HcpNoticeLine }
  | { key: 'StatusExpired' }
  | { key: 'StatusConnectedUntil'; params: { time: string } }

/** The notice line of a revoked record. A revoked record with no notice yet reads as `telling`. */
export function hcpNoticeLine(c: HcpConnection): HcpNoticeLine {
  const name = c.name
  const notice = c.notice
  if (notice?.state === 'told') return { key: 'RevokeTold', params: { name, time: notice.at } }
  if (notice?.state === 'notTold') return { key: 'RevokeNotTold', params: { name, time: notice.usableUntil } }
  if (notice?.state === 'nothingDisclosed') return { key: 'RevokeNothingDisclosed' }
  return { key: 'RevokeTelling', params: { name } }
}

/** Revoked first (whatever the time), else expired at or after `expiresAt`, else connected until `expiresAt`. */
export function hcpStatus(c: HcpConnection, now: Date): HcpStatus {
  if (c.revokedAt) return { key: 'StatusRevoked', notice: hcpNoticeLine(c) }
  if (now.getTime() >= Date.parse(c.expiresAt)) return { key: 'StatusExpired' }
  return { key: 'StatusConnectedUntil', params: { time: c.expiresAt } }
}
