/**
 * A room host's HTTPS Trust Task door (`<TrustTaskHTTPS base>/trust-tasks`), for what cannot or need not go over the
 * phone's session: a host refuses a messaging document signed by anyone but its sender (vtc-service-v0.17.0
 * `trust_tasks/mod.rs` step 3a), so a document an upload key signed comes here. The door is found the way sign-in finds
 * it, by type in the host's verified DID document. Only HTTPS is used: the host sees sealed bytes either way, but what
 * else travels with them is nobody else's to read.
 */
import type { Agent } from '@credo-ts/core'

import { TRUST_TASK_HTTPS } from '../../../trust-tasks/module/oobSignIn'
import { serviceEndpointOfType } from '../../../trust-tasks/module/triggerLink'
import { resolveDidDocumentRetrying } from '../../../trust-tasks/module/VtiMediatorTransport'

/** One document's wait for the door. */
const DOOR_TIMEOUT_MS = 40_000
/** The host's `/health`, asked once per host for its version. */
const HEALTH_TIMEOUT_MS = 10_000

/** A host's HTTPS answer: its status, how long it asked to be left alone, and its JSON. */
export interface DoorAnswer {
  status: number
  retryAfterSeconds?: number
  body: unknown
}

export interface RoomDoors {
  /** The host's door, and its version from the public `/health` when it says. */
  hostDoor(hostDid: string): Promise<{ base: string; version?: string }>
  /** POST one signed document to the door. */
  postToDoor(base: string, document: Record<string, unknown>, signal?: AbortSignal): Promise<DoorAnswer>
}

/** A `fetch` that gives up after `ms`, or when `signal` aborts. */
async function fetchWithin(url: string, init: RequestInit, ms: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('the transfer was cancelled'), { name: 'AbortError' })
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

const isHttps = (base: string) => /^https:\/\/[^/]/i.test(base)

export function createRoomDoors(agent: Agent): RoomDoors {
  const doors = new Map<string, Promise<{ base: string; version?: string }>>()
  const findDoor = async (hostDid: string) => {
    const document = (await resolveDidDocumentRetrying(agent, hostDid)).toJSON() as Parameters<
      typeof serviceEndpointOfType
    >[0]
    const base = serviceEndpointOfType(document, TRUST_TASK_HTTPS)
    if (!base) throw new Error(`${hostDid} names no ${TRUST_TASK_HTTPS} service`)
    if (!isHttps(base)) throw new Error(`${hostDid} names a ${TRUST_TASK_HTTPS} service that is not HTTPS`)
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
    postToDoor: async (base, document, signal) => {
      if (!isHttps(base)) throw new Error('a room document goes only to an HTTPS door')
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
