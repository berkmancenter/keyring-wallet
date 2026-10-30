/**
 * The rooms backend on the app's existing legs: the person's own agent through `vtaAgent`, and each
 * community through `vtiAgent`, connected as the persona the phone joined it with. Nothing new is
 * opened: these are the clients joining and leaving a community already use.
 */
import { TypedArrayEncoder, utils, type Agent } from '@credo-ts/core'
import RNFS from 'react-native-fs'

import { listKeyed, putKeyed } from '../../trust-tasks/module/keyedRecords'
import { vtaAgent } from '../../trust-tasks/module/vtaAgent'
import { GenericRecordsCommunityStore } from '../../trust-tasks/module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../../trust-tasks/module/VtiIdentityStore'
import { leaveCommunity } from '../../trust-tasks/module/vtiJoin'
import { GenericRecordsVettingStore } from '../../trust-tasks/module/vtiVetting'
import { vtiAgent } from '../../trust-tasks/module/vtiAgent'
import { GenericRecordsTspPeerRevisionStore } from '../../trust-tasks/module/vtiTsp'
import { TRUST_TASK_HTTPS } from '../../trust-tasks/module/oobSignIn'
import { serviceEndpointOfType } from '../../trust-tasks/module/triggerLink'
import { resolveDidDocumentRetrying } from '../../trust-tasks/module/VtiMediatorTransport'

import type { RoomsBackend, RoomsCommunity, RoomsUploadBackend } from './agentRoomsService'
import type { DoorAnswer } from './files/upload'

/** This phone's own rooms records: today only the offers the person hid, which no community is told of. */
const RECORD_TYPE = 'keyring/rooms'

/** One upload document's wait for the host's door. */
const DOOR_TIMEOUT_MS = 40_000
/** The host's `/health`, asked once per host for its version. */
const HEALTH_TIMEOUT_MS = 10_000

/** A `fetch` that gives up after `ms`, or when `signal` aborts. */
async function fetchWithin(url: string, init: RequestInit, ms: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('the upload was cancelled'), { name: 'AbortError' })
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * An upload's legs off the session: the picked file on disk, and the room host's HTTPS Trust Task door. The door is
 * found the way sign-in finds it, by type in the host's verified DID document; the host's version, from the public
 * `/health` at that origin, decides how large a file it takes.
 */
function createUploadBackend(agent: Agent): RoomsUploadBackend {
  const doors = new Map<string, Promise<{ base: string; version?: string }>>()
  const findDoor = async (hostDid: string) => {
    const document = (await resolveDidDocumentRetrying(agent, hostDid)).toJSON() as Parameters<
      typeof serviceEndpointOfType
    >[0]
    const base = serviceEndpointOfType(document, TRUST_TASK_HTTPS)
    if (!base) throw new Error(`${hostDid} names no ${TRUST_TASK_HTTPS} service`)
    let version: string | undefined
    try {
      const health = await fetchWithin(`${new URL(base).origin}/health`, {}, HEALTH_TIMEOUT_MS)
      const body = (await health.json()) as { version?: unknown }
      version = typeof body.version === 'string' ? body.version : undefined
    } catch {
      version = undefined
    }
    return { base, version }
  }
  return {
    readFile: async (uri, position, length) => {
      const path = decodeURIComponent(uri.replace(/^file:\/\//, ''))
      return TypedArrayEncoder.fromBase64(await RNFS.read(path, length, position, 'base64'))
    },
    hostDoor: (hostDid) => {
      let door = doors.get(hostDid)
      if (!door) {
        door = findDoor(hostDid)
        doors.set(hostDid, door)
        // A host that could not be reached is asked again next time.
        door.catch(() => doors.delete(hostDid))
      }
      return door
    },
    postToDoor: async (base, document, signal): Promise<DoorAnswer> => {
      const response = await fetchWithin(
        `${base.replace(/\/+$/, '')}/trust-tasks`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(document) },
        DOOR_TIMEOUT_MS,
        signal
      )
      // Seconds only: a date form, or none, leaves the wait to the caller's default.
      const header = response.headers.get('retry-after')
      const retryAfter = header !== null && /^\d+$/.test(header.trim()) ? Number(header) : NaN
      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      return {
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfterSeconds: retryAfter } : {}),
        body,
      }
    },
  }
}

export function createAgentRoomsBackend(agent: Agent, options: { mediatorDid?: string } = {}): RoomsBackend {
  const identityStore = new GenericRecordsIdentityStore(agent)
  const communityStore = new GenericRecordsCommunityStore(agent)
  // The session to a community is the persona the phone joined it with.
  const connectAs = async (communityDid: string) => {
    const persona = await identityStore.getPersona(communityDid)
    if (!persona) throw new Error('rooms: this phone holds no identity for that community')
    await vtiAgent.connect(agent, options.mediatorDid, {
      persona,
      peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
    })
  }
  const client = async () => {
    const c = await vtaAgent.roomsClient(agent)
    if (!c) throw new Error('rooms: no agent is linked to this phone')
    return c
  }

  return {
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

    communityTask: async (communityDid, type, payload) => {
      await connectAs(communityDid)
      return vtiAgent.communityTask(communityDid, type, payload)
    },

    sendCompleted: async (communityDid, recipientDid, document) => {
      await connectAs(communityDid)
      return vtiAgent.sendCompleted(recipientDid, document)
    },

    newId: () => utils.uuid(),

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
  }
}
