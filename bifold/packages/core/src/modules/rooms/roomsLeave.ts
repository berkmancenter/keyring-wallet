/**
 * What follows leaving a community, whichever screen the person left from: the rooms it gave go from every list at
 * once, and what this phone kept of the community besides (its members' names, the photo sent to it) goes with
 * them. A community's own screen leaves without the rooms service, and My Agent kept "1 room" and the rooms read
 * before (11-03); both ways now end here.
 *
 * @module rooms/roomsLeave
 */
import { JsonTransformer, type Agent, type W3cCredentialRecord } from '@credo-ts/core'
import { DeviceEventEmitter } from 'react-native'

import { keepSentPhoto } from '../directory/myPhoto'
import { dropDirectoryNames } from '../directory/names'
import { isCommunityCard } from '../trust-tasks/module/vtiWalletCards'

import { failureCategory } from './roomsLogWords'
import type { RoomsService } from './types'
import { ROOMS_LEFT_EVENT } from './useMyRooms'
import { refreshRoomRows } from './useRoomRows'

/** Where the community's records are kept (VtiCommunityStore). */
const COMMUNITY_RECORDS = 'keyring/vti-community'

type Json = Record<string, unknown>

/** An identity in the log by the end of its DID only: enough to tell two apart, never the whole DID. */
const shortId = (did: unknown): string => (typeof did === 'string' && did ? `…${did.slice(-8)}` : '?')

const idOf = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? value
    : typeof (value as Json | undefined)?.id === 'string'
      ? ((value as Json).id as string)
      : undefined

const cardOf = (record: W3cCredentialRecord): Json | undefined => {
  const raw = record.credentialInstances?.[0]?.credential as unknown
  if (raw && typeof raw === 'object') return raw as Json
  try {
    return JsonTransformer.toJSON(record.firstCredential) as Json
  } catch {
    return undefined
  }
}

/** "2 (as …a1b2c3d4, …e5f6a7b8)", or "0". */
const counted = (owners: unknown[]): string =>
  owners.length ? `${owners.length} (as ${[...new Set(owners.map(shortId))].join(', ')})` : '0'

/**
 * The read-only line that says what the leave left of the community on this phone: the membership and card records
 * the community store still holds, and the Wallet's copies of the community's cards, each by the identity it is
 * held as. A card still in the Wallet after a leave (11-03) is either a record the leave failed to forget or one held
 * as another identity; this tells which. Nothing is deleted here.
 */
async function logWhatStays(agent: Agent, communityDid: string): Promise<void> {
  const records = async (kind: string) =>
    (await agent.genericRecords.findAllByQuery({ recordType: COMMUNITY_RECORDS, kind }))
      .map((r) => r.content as Json)
      .filter((c) => c.communityDid === communityDid)
  // One after another: a read that fails leaves none of the others unhandled.
  const departures = await records('departure')
  const memberships = await records('membership')
  const held = await records('credential')
  const wallet = await agent.w3cCredentials.getAll()
  const copies = wallet
    .map(cardOf)
    .filter((vc): vc is Json => !!vc && isCommunityCard(vc) && idOf(vc.issuer) === communityDid)
  agent.config.logger.warn(
    `[Rooms:leave] after leaving ${shortId(communityDid)} as ${counted(departures.map((d) => d.personaDid))}: ` +
      `membership records ${counted(memberships.map((m) => m.personaDid))}, ` +
      `card records ${counted(held.map((h) => h.subjectDid))}, ` +
      `Wallet card copies ${counted(copies.map((vc) => idOf(vc.credentialSubject)))}`
  )
}

/**
 * After the phone left `communityDid` (vtiJoin `leaveCommunity` resolved). The rooms go first, so no list shows
 * them while the rest is dropped. `service` is the screen's rooms service, when it has one; the service's own leave
 * drops its rooms itself once this resolves.
 */
export async function afterLeavingCommunity(agent: Agent, communityDid: string, service?: RoomsService): Promise<void> {
  service?.leftCommunity?.(communityDid)
  // Every rooms list drops its rooms, and what was remembered of them (useMyRooms).
  DeviceEventEmitter.emit(ROOMS_LEFT_EVENT, communityDid)
  refreshRoomRows()
  // The names its members wrote on their cards, kept for the rooms, go with it.
  await dropDirectoryNames(agent, communityDid).catch(() => undefined)
  // And what this phone remembers of the photo it put on the member's card there.
  await keepSentPhoto(agent, communityDid, undefined).catch(() => undefined)
  // Never fails the leave, which is done: a line that cannot be read or written is only missing.
  await logWhatStays(agent, communityDid).catch((e: unknown) =>
    agent.config?.logger?.warn?.(`[Rooms:leave] what the leave left was not read: ${failureCategory(e)}`)
  )
}
