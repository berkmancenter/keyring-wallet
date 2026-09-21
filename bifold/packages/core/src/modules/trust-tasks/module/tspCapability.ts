import type { Agent } from '@credo-ts/core'

import { resolveDidDocumentRetrying } from './VtiMediatorTransport'

/**
 * §4.2 — choose the envelope format from the peer's DID document.
 *
 * The plan's rule, and the reason for each half:
 *
 *   - **Prefer by DID-document capability.** A peer that can speak TSP says so
 *     with a service of type `TSPTransport` — the exact string, as vta-service
 *     writes it. Nothing else is evidence: a build flag of ours says what *we*
 *     can do, not what the peer will accept.
 *   - **Cache with bounded staleness, never until-rotation.** Upstream mutates
 *     DID documents at runtime *without* rotating keys — `vta services tsp
 *     enable` publishes a new version of an existing document, which is
 *     precisely how the lab's agents gained `#tsp`. A cache keyed on rotation
 *     would never notice. A short TTL does.
 *   - **Fall back loudly, at connect time.** Degradation is session-scoped and
 *     logged once, not decided per message — per-message selection turns one
 *     unreachable peer into silent flapping between two envelope formats.
 */
export const TSP_SERVICE_TYPE = 'TSPTransport'

export const LOG_PREFIX = '[TrustTasks:TspCapability]'

/** Five minutes: long enough to cost nothing per task, short enough that a
 * `services tsp enable` is picked up within a session rather than a reinstall. */
export const DEFAULT_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  advertises: boolean
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/** Test seam, and the thing to call after deliberately changing a peer's document. */
export function clearTspCapabilityCache(did?: string): void {
  if (did) cache.delete(did)
  else cache.clear()
}

/**
 * Does this document advertise TSP?
 *
 * `service.type` is a string **or an array of strings** — DID Core allows both,
 * and the Farm's mediator uses the array form for `DIDCommMessaging` while
 * vta-service writes `TSPTransport` as a bare string. Reading only one shape is
 * how a conformant document gets misread as incapable.
 */
export function documentAdvertisesTsp(doc: { service?: Array<{ type?: unknown }> } | undefined): boolean {
  for (const service of doc?.service ?? []) {
    const type = service?.type
    if (type === TSP_SERVICE_TYPE) return true
    if (Array.isArray(type) && type.some((t) => t === TSP_SERVICE_TYPE)) return true
  }
  return false
}

/**
 * Whether `did` advertises TSP, cached for `ttlMs`.
 *
 * A document that cannot be resolved is reported as **not** TSP-capable rather
 * than throwing: the caller's question is "which envelope", and the answer that
 * keeps a session working is DIDComm. The resolution failure itself surfaces on
 * the send that follows, where it belongs.
 */
export async function peerAdvertisesTsp(
  agent: Agent,
  did: string,
  options: { ttlMs?: number } = {}
): Promise<boolean> {
  const now = Date.now()
  const hit = cache.get(did)
  if (hit && hit.expiresAt > now) return hit.advertises

  let advertises = false
  try {
    const doc = await resolveDidDocumentRetrying(agent, did)
    advertises = documentAdvertisesTsp(doc as { service?: Array<{ type?: unknown }> })
  } catch (error) {
    agent.config.logger.debug(`${LOG_PREFIX} could not resolve ${did} to read its transports: ${error}`)
    advertises = false
  }
  cache.set(did, { advertises, expiresAt: now + (options.ttlMs ?? DEFAULT_TTL_MS) })
  return advertises
}

export type Carriage = 'tsp' | 'didcomm'

/**
 * The session-scoped decision, made once per peer and logged once.
 *
 * `canSpeakTsp` is ours — whether this session actually holds a TSP identity.
 * Keeping it separate from the peer's advertisement is what makes the fallback
 * legible: "it offers TSP and we cannot" is a different sentence from "it does
 * not offer TSP", and only the first is a gap on our side.
 */
export async function chooseCarriage(
  agent: Agent,
  peerDid: string,
  canSpeakTsp: boolean,
  options: { ttlMs?: number; decided?: Map<string, Carriage> } = {}
): Promise<Carriage> {
  const decided = options.decided
  const already = decided?.get(peerDid)
  if (already) return already

  const advertises = await peerAdvertisesTsp(agent, peerDid, options)
  let carriage: Carriage = 'didcomm'
  if (advertises && canSpeakTsp) {
    carriage = 'tsp'
    agent.config.logger.info(`${LOG_PREFIX} ${peerDid} advertises ${TSP_SERVICE_TYPE} — using TSP for this session`)
  } else if (advertises) {
    agent.config.logger.warn(
      `${LOG_PREFIX} ${peerDid} advertises ${TSP_SERVICE_TYPE} but this session holds no TSP identity — falling back to DIDComm`
    )
  } else {
    agent.config.logger.info(`${LOG_PREFIX} ${peerDid} does not advertise ${TSP_SERVICE_TYPE} — using DIDComm`)
  }
  decided?.set(peerDid, carriage)
  return carriage
}
