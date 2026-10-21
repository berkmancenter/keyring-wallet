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

/** After a read that found nothing, how long before the same community is read again from a screen. */
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
const failedAt = new Map<string, number>()

/**
 * The same read for a screen that reloads often (on focus, on every store
 * change, on a timer): one read at a time per community, and none for ten
 * minutes after one that found nothing, so a community that does not answer
 * is not asked again on every reload. A read that finds a name stores it with
 * today's date, so the day-old rule covers it from then on.
 */
export function refreshPublishedNameThrottled(
  agent: Agent,
  vtcDid: string,
  now = Date.now()
): Promise<string | undefined> {
  const running = inFlight.get(vtcDid)
  if (running) return running
  const failed = failedAt.get(vtcDid)
  if (failed !== undefined && now - failed < COMMUNITY_NAME_RETRY_MS) return Promise.resolve(undefined)
  const read = refreshPublishedName(agent, vtcDid)
    .then((name) => {
      if (name) failedAt.delete(vtcDid)
      else failedAt.set(vtcDid, now)
      return name
    })
    .finally(() => inFlight.delete(vtcDid))
  inFlight.set(vtcDid, read)
  return read
}

/** For tests: forget the reads under way and the ones that failed. */
export function forgetCommunityNameReads(): void {
  inFlight.clear()
  failedAt.clear()
}
