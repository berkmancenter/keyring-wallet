/**
 * The ONE seam between the Guardian check and whatever resolves a State root's did:webs. The check and the screens
 * call only `resolveRootKel(did)`; they never import resolveWebs directly. Our verify-only resolver (./resolve) is
 * the default, an interim for the 2026-11-14 demo. The VTI maintainer's TypeScript did:webs resolver (Alberto said yes
 * to it, IN-665, for compatibility with the VTA/VTC work) replaces it through {@link setRootKelResolver}, touching
 * nothing else.
 *
 * A replacement must return the exact keri.cesr bytes it verified. The Guardian check replays them again with this
 * package's own reader (sedi/guardian, build()), so a resolver's answer is never the only check. That replay has its
 * own limits: notably, it refuses a KEL with witnesses (receipts are not read), whatever the resolver accepted.
 *
 * @module sedi/webs/rootKel
 */
import { resolveWebs, type WebsFetch } from './resolve'

export type RootKel = { ok: true; aid: string; kel: Uint8Array } | { ok: false; reason: string; detail: string }
export type RootKelResolver = (did: string) => Promise<RootKel>

/** The fetch the default resolver uses: the platform's. */
const platformFetch: WebsFetch = (url, init) => fetch(url, init) as unknown as ReturnType<WebsFetch>

/** Our verify-only resolver behind the seam. */
export function ourRootKelResolver(fetchFn: WebsFetch = platformFetch): RootKelResolver {
  return async (did) => {
    const r = await resolveWebs(did, { fetch: fetchFn })
    return r.ok ? { ok: true, aid: r.aid, kel: r.kel } : { ok: false, reason: r.reason, detail: r.detail }
  }
}

let override: RootKelResolver | null = null

/** Replace the resolver app-wide (null restores ours). The Guardian check reads it at each call, never at load. */
export function setRootKelResolver(resolver: RootKelResolver | null): void {
  override = resolver
}

/** Resolve a root's did:webs to the verified bytes of its KEL, or refuse. */
export function resolveRootKel(did: string): Promise<RootKel> {
  return (override ?? ourRootKelResolver())(did)
}
