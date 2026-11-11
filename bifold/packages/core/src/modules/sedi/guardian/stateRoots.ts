/**
 * The State roots this phone trusts for a Guardian card (trusted-approver plan, stage 2, S1), each with the name Who
 * approves shows. A card is shown as from a state only when its chain ends at one of these, and the name shown is
 * ours, never the sender's.
 *
 * A release trusts none: empty, so nothing verifies and every card reads "Couldn't verify the state card", unless the
 * Developer setting "Trust the test state (K0)" is on (trustTestStateFlag.ts, which holds only while trusted approvers
 * and state-verified approvers are both on). A Developer build (`__DEV__`) trusts the K0 test root without it. Either
 * way it is the K0 test root only, the keripy kit the tests check against (sedi/__tests__/fixtures/k0-utah-v2). It is
 * named "State of Example", a made-up state, and marked `demo`, so Who approves shows a "Demo" pill beside the name:
 * never a real state's name, and never a pill inferred from the name. Real State roots come from did:webs (IN-619),
 * not from this list, and are never marked demo.
 *
 * @module sedi/guardian/stateRoots
 */

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
   * A made-up state for demos and testing: Who approves shows a "Demo" pill beside the name. Set on the entry here,
   * never read from the card or inferred from the name.
   */
  demo?: true
}

/**
 * The K0 kit's State root ("roy"): a test root, trusted in Developer builds or with "Trust the test state (K0)" on.
 * Named as a made-up state, never a real one's, and marked demo: Who approves reads "Has a Guardian card from State of
 * Example" with a "Demo" pill beside the name (Alberto, 2026-11-11).
 */
export const K0_TEST_ROOT: StateRoot = {
  aid: 'IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6',
  name: 'State of Example',
  demo: true,
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
  return [K0_TEST_ROOT].some((root) => root.aid === aid && root.demo === true)
}

/** The roots this build trusts (read at each check, never at load). */
export function trustedStateRoots(): StateRoot[] {
  return stateRootsFor(typeof __DEV__ !== 'undefined' && __DEV__ === true, isTrustTestStateEnabled())
}
