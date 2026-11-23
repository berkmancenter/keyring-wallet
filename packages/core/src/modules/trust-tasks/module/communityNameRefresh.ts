/**
 * A community's published name, read again when the one on record is missing
 * or over a day old (IN-340): a community that published a name after the
 * person joined, or renamed itself, otherwise read as unnamed, or by its old
 * name, for good. One rule for every screen that shows a community's name —
 * sign-in (`signInSteps`) and My Agent (`VtaAgentHome`).
 *
 * Only for a community the person belongs to: the caller decides that, and
 * for any other community nothing is resolved (VTI-LNK-050, 051).
 *
 * @module trust-tasks/module/communityNameRefresh
 */
import type { Agent } from '@credo-ts/core'

import { readPublicProfileName } from './vtiAgent'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { communityTarget } from './vtiCommunityLink'

/** How long a community's name on record is taken as it is, before it is read again (IN-340). */
export const COMMUNITY_NAME_TTL_MS = 24 * 60 * 60 * 1000

/** After a read from a screen, how long before the same community is read again from one. */
export const COMMUNITY_NAME_RETRY_MS = 10 * 60 * 1000

/** Whether the name on record, if any, is missing or old enough to read again. */
export function communityNameIsStale(kept: { at?: string } | undefined, now = Date.now()): boolean {
  const keptAt = kept?.at ? Date.parse(kept.at) : NaN
  return !kept || !(now - keptAt < COMMUNITY_NAME_TTL_MS)
}

/** The name a community's public profile gives it, or undefined (unreachable, unnamed, not answered in 3 s). */
export async function publishedName(agent: Agent, vtcDid: string): Promise<string | undefined> {
  try {
    const doc = await agent.dids.resolveDidDocument(vtcDid)
    const service = doc.service?.find((s) => s.type === 'VTCRest')
    const base = typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint : undefined
    return base ? await readPublicProfileName(base, vtcDid) : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the community's published name and keep it: shown at once
 * (`communityTarget`) and stored with today's date. A read that finds nothing
 * keeps the name on record. Returns the name read, if any.
 */
export async function refreshPublishedName(agent: Agent, vtcDid: string): Promise<string | undefined> {
  const fresh = await publishedName(agent, vtcDid)
  if (fresh) {
    communityTarget.publishedName(vtcDid, fresh)
    await new GenericRecordsCommunityStore(agent).saveCommunityName(vtcDid, fresh).catch(() => undefined)
  }
  return fresh
}

const inFlight = new Map<string, Promise<string | undefined>>()
const lastReadAt = new Map<string, number>()

/**
 * The same read for a screen that reloads often (on focus, on every store
 * change, on a timer): one read at a time per community, and none for ten
 * minutes after the last one, whatever it found. A read that found a name and
 * stored it is covered by the day-old rule from then on; one that found
 * nothing, or found a name it could not store (the record still reads old),
 * would otherwise be asked again on every reload. Kept apart per `scope` (the
 * linked agent), so one agent's reads never hold back another's. Never
 * rejects: anything that fails counts as a read that found nothing.
 */
export function refreshPublishedNameThrottled(
  agent: Agent,
  vtcDid: string,
  { scope = '', now = Date.now() }: { scope?: string; now?: number } = {}
): Promise<string | undefined> {
  const key = `${scope}|${vtcDid}`
  const running = inFlight.get(key)
  if (running) return running
  const last = lastReadAt.get(key)
  if (last !== undefined && now - last < COMMUNITY_NAME_RETRY_MS) return Promise.resolve(undefined)
  lastReadAt.set(key, now)
  const read = refreshPublishedName(agent, vtcDid)
    .catch(() => undefined)
    .finally(() => inFlight.delete(key))
  inFlight.set(key, read)
  return read
}

/** For tests: forget the reads under way and when each was last made. */
export function forgetCommunityNameReads(): void {
  inFlight.clear()
  lastReadAt.clear()
}
