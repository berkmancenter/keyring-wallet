import type { Agent } from '@credo-ts/core'

import { resolveDidDocumentRetrying } from './VtiMediatorTransport'
import { didPrefix } from './didPrefix'
import { releaseWarn } from './releaseLog'

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

/**
 * The TSP version a document's `TSPTransport` service names, if it names one:
 * `'1.0'` for TSP 1.0, `'other'` for any version this build does not send to an
 * upstream service. Absent when the service names none, which is every
 * document today: whether upstream will publish a version, and in which
 * property, is open (TSP 1.0 cutover plan §5, question 2), so a `version` or
 * `tspVersion` property is read, and anything unrecognised there is `'other'`.
 */
export type AdvertisedTspVersion = '1.0' | 'other'

/** What a document says about TSP. */
export interface TspServiceInfo {
  advertises: boolean
  /** The `TSPTransport` service's id, when it has one. */
  serviceId?: string
  version?: AdvertisedTspVersion
}

interface CacheEntry extends TspServiceInfo {
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
  return documentTspService(doc).advertises
}

const isTspService = (type: unknown) =>
  type === TSP_SERVICE_TYPE || (Array.isArray(type) && type.some((t) => t === TSP_SERVICE_TYPE))

/** A service's stated TSP version, read leniently: `1`, `1.0`, `v1` and `YTSP-BAA` are TSP 1.0. */
export function parseAdvertisedTspVersion(value: unknown): AdvertisedTspVersion | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = String(value).trim()
  return /^(v?1(\.0)?|YTSP-BAA)$/i.test(text) ? '1.0' : 'other'
}

/** The first `TSPTransport` service in a document: whether there is one, its id, and any version it states. */
export function documentTspService(doc: { service?: Array<Record<string, unknown>> } | undefined): TspServiceInfo {
  for (const service of doc?.service ?? []) {
    if (!isTspService(service?.type)) continue
    const version = parseAdvertisedTspVersion(service.version ?? service.tspVersion)
    return {
      advertises: true,
      ...(typeof service.id === 'string' ? { serviceId: service.id } : {}),
      ...(version ? { version } : {}),
    }
  }
  return { advertises: false }
}

/**
 * Whether `did` advertises TSP, cached for `ttlMs`.
 *
 * A document that cannot be resolved is reported as **not** TSP-capable rather
 * than throwing: the caller's question is "which envelope", and the answer that
 * keeps a session working is DIDComm. The resolution failure itself surfaces on
 * the send that follows, where it belongs.
 */
export async function peerAdvertisesTsp(agent: Agent, did: string, options: { ttlMs?: number } = {}): Promise<boolean> {
  return (await peerTspService(agent, did, options)).advertises
}

/** What `did`'s document says about TSP, cached for `ttlMs` like {@link peerAdvertisesTsp}. */
export async function peerTspService(
  agent: Agent,
  did: string,
  options: { ttlMs?: number } = {}
): Promise<TspServiceInfo> {
  const now = Date.now()
  const hit = cache.get(did)
  if (hit && hit.expiresAt > now) return hit

  let info: TspServiceInfo = { advertises: false }
  try {
    const doc = await resolveDidDocumentRetrying(agent, did)
    info = documentTspService(doc as { service?: Array<Record<string, unknown>> })
  } catch (error) {
    agent.config.logger.debug(`${LOG_PREFIX} could not resolve ${did} to read its transports: ${error}`)
  }
  const entry: CacheEntry = { ...info, expiresAt: now + (options.ttlMs ?? DEFAULT_TTL_MS) }
  cache.set(did, entry)
  return entry
}

export type Carriage = 'tsp' | 'didcomm'

/**
 * Stopgap for the TSP 1.0 cutover (upstream, 2026-10-22): every upstream
 * service (VTA, VTC) moves to TSP 1.0 (YTSP-BAA), which this build's Rev 3
 * codec refuses both ways — a 1.0 reply is dropped as malformed, and a Rev 3
 * ask is refused upstream, so the agent reads as "not answering". Until the
 * 1.0 codec ships, a peer that advertises TSPTransport in its document is
 * spoken to over DIDComm v2, which those services keep supporting. Wallet
 * peers (Keyring↔Keyring) are not decided here: their did:peer documents
 * advertise no transports, and they reach TSP through the peer-leg setting.
 * Tests that exercise the TSP path turn it off with {@link setPreferDidcommForUpstream}.
 */
let preferDidcommForUpstream = true

export function setPreferDidcommForUpstream(prefer: boolean): void {
  preferDidcommForUpstream = prefer
}

/**
 * The session-scoped decision, made once per peer and logged once.
 *
 * `canSpeakTsp` is ours — whether this session actually holds a TSP identity.
 * Keeping it separate from the peer's advertisement is what makes the fallback
 * legible: "it offers TSP and we cannot" is a different sentence from "it does
 * not offer TSP", and only the first is a gap on our side.
 *
 * TSP here means TSP 1.0 (cutover plan §6.2). For a peer that advertises
 * `TSPTransport`, with the stopgap's switch off and a TSP identity at hand:
 *  - the document names TSP 1.0: TSP; it names another version: DIDComm;
 *  - it names none, and `freshV1` says the peer wrote TSP 1.0 to us within the
 *    record's own expiry: TSP;
 *  - otherwise DIDComm, and `onProbeWanted` is told, so the leg can probe in
 *    the background (`tspProbe.ts`). The decision stays DIDComm until the leg
 *    changes it on the probe's answer.
 * With the switch on, nothing here probes or says anything about probing.
 *
 * Each of these decisions is said in Release (`releaseWarn`), once a peer a
 * session, by DID prefix only: a tester's report shows which carriage a
 * session used for each service, and why.
 */
export async function chooseCarriage(
  agent: Agent,
  peerDid: string,
  canSpeakTsp: boolean,
  options: {
    ttlMs?: number
    decided?: Map<string, Carriage>
    /** Whether the peer's TSP 1.0 record is fresh (`isFreshV1` over the peer-revision store). */
    freshV1?: (peerDid: string) => Promise<boolean>
    /** Called when the decision is DIDComm only for want of evidence, so a probe may run. */
    onProbeWanted?: (peerDid: string, serviceId?: string) => void
  } = {}
): Promise<Carriage> {
  const decided = options.decided
  const already = decided?.get(peerDid)
  if (already) return already

  const service = await peerTspService(agent, peerDid, options)
  const advertises = service.advertises
  let carriage: Carriage = 'didcomm'
  if (advertises && preferDidcommForUpstream) {
    // Said in Release, once a peer a session: a report shows the stopgap is what chose DIDComm.
    releaseWarn(
      `${LOG_PREFIX} ${peerDid} advertises ${TSP_SERVICE_TYPE} — using DIDComm v2 until this build speaks TSP 1.0`
    )
  } else if (advertises && canSpeakTsp && service.version === '1.0') {
    carriage = 'tsp'
    releaseWarn(`${LOG_PREFIX} ${didPrefix(peerDid)} advertises TSP 1.0 — using TSP 1.0 for this session`)
  } else if (advertises && canSpeakTsp && service.version === 'other') {
    releaseWarn(
      `${LOG_PREFIX} ${didPrefix(peerDid)} advertises a TSP version this build does not send — using DIDComm for this session`
    )
  } else if (advertises && canSpeakTsp && (await options.freshV1?.(peerDid).catch(() => false))) {
    carriage = 'tsp'
    releaseWarn(
      `${LOG_PREFIX} ${didPrefix(peerDid)} wrote TSP 1.0 to this phone within its record's expiry — using TSP 1.0 for this session`
    )
  } else if (advertises && canSpeakTsp) {
    releaseWarn(
      `${LOG_PREFIX} ${didPrefix(peerDid)} advertises ${TSP_SERVICE_TYPE} with no version — using DIDComm, and probing TSP 1.0 in the background`
    )
    options.onProbeWanted?.(peerDid, service.serviceId)
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
