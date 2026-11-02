/**
 * The rooms backend on the app's existing legs: the person's own agent through `vtaAgent`, and each
 * community through `vtiAgent`, connected as the persona the phone joined it with. Nothing new is
 * opened: these are the clients joining and leaving a community already use.
 */
import { TypedArrayEncoder, utils, type Agent } from '@credo-ts/core'
import RNFS from 'react-native-fs'

import { keepSentPhoto } from '../../directory/myPhoto'
import { dropDirectoryNames } from '../../directory/names'
import { listKeyed, putKeyed } from '../../trust-tasks/module/keyedRecords'
import { vtaAgent } from '../../trust-tasks/module/vtaAgent'
import { GenericRecordsCommunityStore } from '../../trust-tasks/module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../../trust-tasks/module/VtiIdentityStore'
import { leaveCommunity } from '../../trust-tasks/module/vtiJoin'
import { GenericRecordsVettingStore } from '../../trust-tasks/module/vtiVetting'
import { vtiAgent } from '../../trust-tasks/module/vtiAgent'
import { GenericRecordsTspPeerRevisionStore } from '../../trust-tasks/module/vtiTsp'

import type { RoomsBackend, RoomsCommunity, RoomsUploadBackend } from './agentRoomsService'
import { createRoomDoors } from './files/door'
import { senderResolver } from './files/senderDocuments'
import { createOpenedCopy, releaseOpenedCopy } from './files/openedCopy'

/** A rooms listing (`vtc/rooms/memberships/list`, `vtc/rooms/offers/list`, any version): what the rooms screens poll. */
export const isRoomsListing = (type: string): boolean => /\/vtc\/rooms\/[a-z-]+\/list\/[\d.]+$/.test(type)

/**
 * vtiAgent's `VtiSessionHeld`, read by its name as the persona inbox reads it; the literal must match the one its
 * constructor sets (pinned in sharedSessionHolds.test.ts).
 */
const isSessionKept = (e: unknown): boolean => e instanceof Error && e.name === 'VtiSessionHeld'

/** This phone's own rooms records: today only the offers the person hid, which no community is told of. */
const RECORD_TYPE = 'keyring/rooms'

/** An upload's legs off the session: the picked file on disk, and the room host's HTTPS Trust Task door. */
function createUploadBackend(agent: Agent): RoomsUploadBackend {
  return {
    // All at once: `RNFS.read` takes a position, but on iOS its NSInteger arguments cannot cross the bridge in this
    // React Native ("Objective C type NSInteger is unsupported"). A file is within `FILE_BYTES`, and sealed in memory.
    readFile: async (uri) =>
      TypedArrayEncoder.fromBase64(await RNFS.readFile(decodeURIComponent(uri.replace(/^file:\/\//, '')), 'base64')),
    ...createRoomDoors(agent),
  }
}

export function createAgentRoomsBackend(agent: Agent, options: { mediatorDid?: string } = {}): RoomsBackend {
  const identityStore = new GenericRecordsIdentityStore(agent)
  const communityStore = new GenericRecordsCommunityStore(agent)
  // The session to a community is the persona the phone joined it with, held while the task runs. A listing is a poll:
  // it never takes the session from a step holding it as another identity (VtiSessionHeld, nothing disconnected), and
  // one persona's listings run together, so a phone in two communities switches once per persona, not once per task
  // (two communities' polls flipped it every 4 s and stopped each other's asks, 10-31). An accept is the person's own
  // act, and holds the session as an ordinary caller does.
  const asPersona = async <T>(communityDid: string, poll: boolean, fn: () => Promise<T>): Promise<T> => {
    const persona = await identityStore.getPersona(communityDid)
    if (!persona) throw new Error('rooms: this phone holds no identity for that community')
    return vtiAgent.holding(agent, options.mediatorDid, persona, fn, {
      peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
      reason: poll ? 'rooms listing' : 'rooms',
      background: poll,
    })
  }
  const client = async () => {
    const c = await vtaAgent.roomsClient(agent)
    if (!c) throw new Error('rooms: no agent is linked to this phone')
    return c
  }

  return {
    runsOn: agent,
    agentLinked: () => vtaAgent.agentAddress() !== undefined,
    agentServedTypes: async () => (await vtaAgent.roomsClient(agent))?.supportedTypes(),
    agentTask: async (type, payload) => (await client()).task(type, payload),

    // The communities this phone holds a membership in under the agent it acts with now, as the
    // persona that holds it. A membership the community has ended (its removal notice) is left out.
    communities: async () => {
      const out: RoomsCommunity[] = []
      for (const membership of await communityStore.listMemberships()) {
        if (membership.removal) continue
        const persona = await identityStore.getPersona(membership.communityDid)
        if (persona?.did === membership.personaDid)
          out.push({ did: membership.communityDid, personaDid: membership.personaDid })
      }
      return out
    },

    communityTask: (communityDid, type, payload) =>
      asPersona(communityDid, isRoomsListing(type), () => vtiAgent.communityTask(communityDid, type, payload)),

    sendCompleted: (communityDid, recipientDid, document) =>
      asPersona(communityDid, false, () => vtiAgent.sendCompleted(recipientDid, document)),

    newId: () => utils.uuid(),

    fileCopies: { create: createOpenedCopy, release: releaseOpenedCopy },

    leaveCommunity: async (communityDid) => {
      await leaveCommunity(
        {
          agent,
          identityStore,
          communityStore,
          vettingStore: new GenericRecordsVettingStore(agent),
          mediatorDid: options.mediatorDid,
        },
        communityDid
      )
      // The names its members wrote on their cards go with it.
      await dropDirectoryNames(agent, communityDid).catch(() => undefined)
      await keepSentPhoto(agent, communityDid, undefined).catch(() => undefined)
    },

    decodeBase64Url: (value) => TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64Url(value)),
    encodeBase64Url: (text) => TypedArrayEncoder.toBase64Url(TypedArrayEncoder.fromUtf8String(text)),

    hiddenOffers: async () =>
      (await listKeyed<{ offerId?: unknown }>(agent, RECORD_TYPE, 'hiddenOffer')).flatMap((r) =>
        typeof r.offerId === 'string' ? [r.offerId] : []
      ),
    hideOffer: (offerId) => putKeyed(agent, RECORD_TYPE, 'hiddenOffer', offerId, { offerId }),

    warn: (message) => agent.config.logger.warn(message),

    uploads: createUploadBackend(agent),
    resolveSender: senderResolver(agent),
    sessionKept: isSessionKept,
    sessionFree: async (communityDid) => {
      const persona = await identityStore.getPersona(communityDid)
      if (persona) await vtiAgent.whenFree(persona.did)
    },
  }
}
