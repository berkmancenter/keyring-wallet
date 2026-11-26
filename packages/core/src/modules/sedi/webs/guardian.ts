/**
 * The Guardian check with its State roots' KELs fetched from their did:webs locations instead of taken from the
 * holder's presentation. The trust anchor does not move: a root is trusted only because its AID is on this phone's
 * list (`trustedRoots`), and a root's did:webs must name that same AID. What resolution adds is the state's own
 * published history, so a holder cannot show the root's KEL cut short.
 *
 * Fail closed: if any listed root's did:webs does not resolve, the check refuses with `stateNotResolved` (what the
 * screen says as "Couldn't reach the state"). It never falls back to the presented copy or to one held on the phone.
 *
 * @module sedi/webs/guardian
 */
import { verifyGuardian, type ChainMaterial, type CheckOptions } from '../guardian'

import { parseWebsDid } from './identifier'
import { resolveWebs, type WebsFetch, type WebsLimits, type WebsRefusalReason } from './resolve'

export interface WebsRoot {
  /** The root AID on this phone's list. */
  aid: string
  /** Where that root publishes its KEL. Its last label must be `aid`. */
  webs: string
}

export type StateNotResolved = { ok: false; reason: 'stateNotResolved'; webs: WebsRefusalReason; detail: string }

export async function verifyGuardianWithWebs(
  material: ChainMaterial,
  guardianSaid: string,
  expect: { holder: string; ward: string },
  options: CheckOptions & { roots: WebsRoot[]; fetch: WebsFetch; limits?: Partial<WebsLimits> }
): Promise<ReturnType<typeof verifyGuardian> | StateNotResolved> {
  const resolvedKels: Uint8Array[] = []
  for (const root of options.roots) {
    const notResolved = (webs: WebsRefusalReason, detail: string): StateNotResolved => ({
      ok: false,
      reason: 'stateNotResolved',
      webs,
      detail: `Couldn't reach the state (${root.webs}): ${detail}`,
    })
    if (!options.trustedRoots.includes(root.aid))
      return notResolved('aidMismatch', 'a did:webs for a root not on the list')
    const id = parseWebsDid(root.webs)
    if (!id.ok) return notResolved('notWebs', id.detail)
    if (id.value.aid !== root.aid)
      return notResolved('aidMismatch', `the did:webs names ${id.value.aid}, not ${root.aid}`)
    const r = await resolveWebs(root.webs, {
      fetch: options.fetch,
      ...(options.limits ? { limits: options.limits } : {}),
    })
    if (!r.ok)
      return r.reason === 'switchedOff'
        ? verifyGuardian(material, guardianSaid, expect, options)
        : notResolved(r.reason, r.detail)
    resolvedKels.push(r.kel)
  }
  return verifyGuardian(material, guardianSaid, expect, { ...options, resolvedKels })
}
