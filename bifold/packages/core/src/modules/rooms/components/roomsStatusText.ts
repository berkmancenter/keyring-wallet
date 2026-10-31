/**
 * The words a screen shows for an operation that is not available, chosen from the service's reason and
 * never guessed by the screen. Three gaps are told apart so a person (and a reviewer) can see whose gap it
 * is: Keyring has not built it ("Coming soon"), nothing upstream serves it ("Not available yet"), or this
 * person's agent is too old ("Your agent needs an update"). A community too old for it has its own line.
 * In a room, a custody-only room says "Details not loaded", and a missing right is worded for the
 * operation the row is for ("You can't post here", "Only curators can do this").
 *
 * @module rooms/components/roomsStatusText
 */
import type { TFunction } from 'i18next'

import type { OperationStatus, RoomsOperation, RoomsReason } from '../types'

const KEY: Record<Exclude<RoomsReason, 'ok' | 'sample' | 'noRight'>, string> = {
  clientNotBuilt: 'Rooms.ComingSoon',
  notBuiltUpstream: 'Rooms.NotAvailableYet',
  agentDoesNotServe: 'Rooms.AgentNeedsUpdate',
  communityDoesNotServe: 'Rooms.CommunityNeedsUpdate',
  adminOnly: 'Rooms.AdminOnly',
  noAgentLinked: 'Rooms.NoAgentLinked',
  agentUnknown: 'Rooms.AgentUnknown',
  detailsNotLoaded: 'Rooms.DetailsNotLoaded',
  communityUnreachable: 'Rooms.CommunityUnreachable',
  tierNotYet: 'Rooms.TierNotYet',
  notOnThisTier: 'Rooms.FilesNotOnOpenRooms',
}

/** A missing right, in the words of what the row would have done. */
function noRightKey(operation?: RoomsOperation): string {
  if (operation === 'write') return 'Rooms.NoRightWrite'
  if (operation === 'curate') return 'Rooms.NoRightCurate'
  return 'Rooms.NoRightRead'
}

/** The status line for an operation; undefined when it is available (on real or sample data). */
export function roomsStatusText(t: TFunction, status: OperationStatus, operation?: RoomsOperation): string | undefined {
  if (status.status === 'available') return undefined
  if (status.reason === 'ok' || status.reason === 'sample') return undefined
  if (status.reason === 'noRight') return t(noRightKey(operation)) as string
  return t(KEY[status.reason]) as string
}

/** Why reading the member's rooms failed: the service's reason when it gave one, else that the agent was not reached. */
export function roomsReadFailedText(t: TFunction, failure?: OperationStatus): string {
  return (failure && roomsStatusText(t, failure, 'listMyRooms')) ?? (t('Rooms.AgentUnknown') as string)
}
