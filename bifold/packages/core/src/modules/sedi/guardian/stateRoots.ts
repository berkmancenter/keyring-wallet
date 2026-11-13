/**
 * The State roots this phone trusts for a Guardian card (trusted-approver plan, stage 2, S1), each with the name Who
 * approves shows. A card is shown as from a state only when its chain ends at one of these, and the name shown is
 * ours, never the sender's.
 *
 * A release trusts no K0 root: nothing from the kit verifies and every such card reads "Couldn't verify the state
 * card", unless the Developer setting "Trust the test state (K0)" is on (trustTestStateFlag.ts, which holds only while
 * trusted approvers and state-verified approvers are both on). A Developer build (`__DEV__`) trusts the K0 test root
 * without it. Either way it is the K0 test root only, the keripy kit the tests check against
 * (sedi/__tests__/fixtures/k0-utah-v2). It is named "State of Utah" and marked `demo`, so Who approves shows a "Demo"
 * pill beside the name, never a pill inferred from the name. The kit is SEDI's Utah test material (k0-utah-v2), not anything Utah issued: the Demo pill and the
 * holder card's "not issued by the State of Utah" say so. Real State roots come from did:webs (IN-619), not from this
 * list, and are never marked demo.
 *
 * K1, the demo state a local state office issues from, is trusted with trusted approvers and state-verified approvers
 * on, once its root AID is filled in, and marked demo too: it is a test issuer, not a government. Where it is fetched
 * from is {@link K1_WEBS_HOST}. Trust rests on the root AID (self-certifying: no host can forge its KEL); a host can
 * only withhold, by failing to answer or serving an older KEL that leaves out a revocation's anchor.
 *
 * @module sedi/guardian/stateRoots
 */

import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'
import { isTrustTestStateEnabled } from '../../trust-tasks/module/trustTestStateFlag'

export interface StateRoot {
  /** The root's KERI AID. */
  aid: string
  /** What Who approves calls it: "Has a Guardian card from <name>". */
  name: string
  /**
   * Where the root publishes its KEL (did:webs; sedi/webs). With it, a card's check reads the root's history from
   * there, fetched on each open, and refuses as `stateNotResolved` when it cannot (never falls back to the card's own
   * copy). Its last label must be `aid`. Without it, the card's copy is read, as before.
   */
  webs?: string
  /**
   * A test root for demos and testing, not a state's own root (even when named after one): Who approves shows a
   * "Demo" pill beside the name. Set on the entry here, never read from the card or inferred from the name.
   */
  demo?: true
  /**
   * Whether the Developer "Demo state host" may put another host in place of this root's (sedi/webs/demoStateHost): a
   * temporary tunnel for the K0 kit, which has no host of its own. Set on the K0 entry only. A root without it is
   * always fetched at its own did:webs, host and path as written here (K1's with a fixed K1_WEBS_HOST).
   */
  demoHost?: true
  /**
   * K1 in 'fromCard' mode (K1_WEBS_HOST): its did:webs host is a placeholder, filled at each check with the host the
   * card itself came with (from the state office's QR, kept with the held card and sent with it). Never the Developer
   * "Demo state host" field. With no host from the card, nothing is fetched.
   */
  hostFromCard?: true
}

/**
 * The K0 kit's State root ("roy"): a test root, trusted in Developer builds or with "Trust the test state (K0)" on.
 * Marked demo: Who approves reads "Has a Guardian card from State of Utah" with a "Demo" pill beside the name. It was
 * the made-up "State of Example" (Alberto, 2026-11-11); Alberto chose "State of Utah" on 2026-11-12, after his hand
 * run of 278.16, since the kit is SEDI's Utah test material. The Demo pill stays, and the holder card says it was not
 * issued by the State of Utah.
 */
export const K0_TEST_ROOT: StateRoot = {
  aid: 'IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6',
  name: 'State of Utah',
  demo: true,
  demoHost: true,
  // Where the demo state is fetched from: the host is a placeholder, replaced by the Developer "Demo state host"
  // (sedi/webs/demoStateHost); with none set, the card's own copy is checked instead.
  webs: 'did:webs:example.org:keyring-demo-state:IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6',
}

/**
 * The K0 kit's ward ("sam"): what a Developer sets as this phone's ward to check K0 cards. Not a binding to the
 * person: a real ward is the person's own KERI AID, which waits for stage 3 (KH-P3).
 */
export const K0_TEST_WARD = 'IFDf7z58Wp19EQ-EjCviVU2sgmFnjecWqCEaNsAz8lq6'

/**
 * The roots for a build: the K0 test root in a Developer build or with the test-state setting on, otherwise none.
 * Both are required, so a caller cannot leave the setting out by omission.
 */
export function stateRootsFor(developerBuild: boolean, trustTestState: boolean): StateRoot[] {
  return developerBuild || trustTestState ? [K0_TEST_ROOT] : []
}

/**
 * Whether `aid` is a root this phone's own list marks as demo, so a screen (Who approves, the holder's state card)
 * shows the "Demo" pill from the entry, never from a card's word or the name. False for any root not on the list.
 */
export function isDemoStateRoot(aid: string): boolean {
  return [K0_TEST_ROOT, k1Root()].some((root) => !!root && root.aid === aid && root.demo === true)
}

/**
 * Whether `aid` is a root whose host the Developer "Demo state host" may replace: the K0 entry's only, and never K1's
 * (an AID K1 holds is refused here even if it were the same as K0's, so the field can never reach K1).
 */
export function takesDemoStateHost(aid: string): boolean {
  if (aid === k1Root()?.aid) return false
  return [K0_TEST_ROOT].some((root) => root.aid === aid && root.demoHost === true)
}

// ---------------------------------------------------------------------------------------------------------------
// K1: the demo state a local state office issues from (Alberto, 2026-11-13)

/** Where K1 is fetched from: a fixed host, the host the scanned card's link named, or nowhere. */
export type K1WebsHost = string | 'fromCard' | null

/**
 * Where K1 publishes, for this build. The Developer "Demo state host" field never applies to K1, in any mode.
 * - a host (e.g. "state.example.org"): K1's did:webs and its cards are fetched there ("Fetched live from <host>");
 * - 'fromCard': the host the state office's QR named. On receiving, the card's link (https://<host>/cards/<id>.json)
 *   names it; it is kept with the held card and sent with it, and each check of that card fetches K1 from that host
 *   only. The holder's line reads "Fetched live from <host>, the host the state's QR named", the person's "Fetched
 *   from the host <name>'s card names"; never "the state's record". A card that comes with no host is checked
 *   against its own copy, labelled as such;
 * - null: K1 fetches nothing, a K1 card link is refused ("This build doesn't name the state's host"), and a K1 card
 *   already held is checked against its own copy, labelled as such.
 *
 * Trust rests on K1's root AID, never on the host: the AID is self-certifying, so no host can forge its KEL. A host
 * can only withhold, by not answering or by serving an older KEL that leaves out a revocation's anchor.
 *
 * TODO(infra): 'fromCard' is for the local state office (Alberto, 2026-11-13: the website runs locally first; scanning
 * is the whole step). The infra's fixed hostname replaces it here when the office moves onto the infra: one line.
 */
export const K1_WEBS_HOST: K1WebsHost = 'fromCard'

/**
 * K1's root AID: the state office's own root, made by Alberto's K1 keystore (2026-11-13), and the only K1 identifier on
 * the trust list. Its org unit (IEuyaxT7vB8IXBmEp_bfzYfDVxTU538eduNypwgANIwd) and issuing agent
 * (IJNKxQupOLWNLwsIgCkAfSi9UPE1q7xHyFXZqBlU_O-T) are trusted only as the chain below it; they are never roots.
 */
export const K1_ROOT_AID = 'IIOfwtkpq00RMwoUH8346kzNKq877GJXQStI6Dyg66Bs'

/** What K1 is called on this phone (Alberto, 2026-11-13), with its Demo pill: a test issuer, not the State of Utah. */
export const K1_NAME = 'State of Utah'

/** The path K1's identifiers are published under, after the host: did:webs:<host>:keyring-demo-state:<AID>. */
export const K1_PATH = 'keyring-demo-state'

/** The host in K1's did:webs in 'fromCard' mode: a placeholder, never fetched. */
export const K1_PLACEHOLDER_HOST = 'card-names-the-host.invalid'

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:\d{1,5})?$/

let k1Settings: { aid: string; host: K1WebsHost } = { aid: K1_ROOT_AID, host: K1_WEBS_HOST }

/** Tests only: set K1's root AID and host as a build would, and put the build's own back. */
export const k1SettingsForTests = {
  set(settings: { aid?: string; host?: K1WebsHost }): void {
    k1Settings = { ...k1Settings, ...settings }
  },
  reset(): void {
    k1Settings = { aid: K1_ROOT_AID, host: K1_WEBS_HOST }
  },
}

/** How K1 is fetched on this build: 'fixed' (a host here), 'fromCard' (the card's link names it), or 'none'. */
export function k1HostMode(): 'fixed' | 'fromCard' | 'none' {
  const { host } = k1Settings
  if (host === 'fromCard') return 'fromCard'
  return typeof host === 'string' && HOST.test(host) ? 'fixed' : 'none'
}

/** K1's fixed host, when this build names one (mode 'fixed'); otherwise undefined. */
export function k1FixedHost(): string | undefined {
  return k1HostMode() === 'fixed' ? (k1Settings.host as string) : undefined
}

/**
 * K1's entry, or undefined while its root AID is a placeholder. With a fixed host its did:webs is built from it; in
 * 'fromCard' its did:webs is a placeholder whose host each check fills from the card's own host (hostFromCard); with
 * no host at all it has none, so nothing is fetched and its cards are checked against their own copy.
 */
export function k1Root(): StateRoot | undefined {
  const { aid } = k1Settings
  if (!aid) return undefined
  const mode = k1HostMode()
  const base = { aid, name: K1_NAME, demo: true as const }
  if (mode === 'fixed')
    return { ...base, webs: ['did:webs', (k1Settings.host as string).replace(':', '%3A'), K1_PATH, aid].join(':') }
  if (mode === 'fromCard')
    // The placeholder host is never fetched (websDidToFetch answers none for it): each check puts the card's own host
    // in its place. '.invalid' is reserved (RFC 2606), so even a fetch by mistake could reach nothing.
    return { ...base, webs: ['did:webs', K1_PLACEHOLDER_HOST, K1_PATH, aid].join(':'), hostFromCard: true }
  return base
}

/**
 * K1 when its root AID is set and both trusted approvers and state-verified approvers are on (each of which the
 * SEDI/KERI kill turns off). It needs no Developer test-state setting: its card is issued by an office to this phone's
 * own code, not loaded from the kit. Read at each call.
 */
export function k1StateRoots(): StateRoot[] {
  const k1 = k1Root()
  return k1 && isTrustedApproversEnabled() && isStateVerifiedApproversEnabled() ? [k1] : []
}

/** The roots this build trusts (read at each check, never at load): the K0 test root as before, and K1 when on. */
export function trustedStateRoots(): StateRoot[] {
  return [
    ...stateRootsFor(typeof __DEV__ !== 'undefined' && __DEV__ === true, isTrustTestStateEnabled()),
    ...k1StateRoots(),
  ]
}
