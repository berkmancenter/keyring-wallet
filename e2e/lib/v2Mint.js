/**
 * What a runner does with the invitation its wallet A minted when it needed an
 * out-of-band/2.0 one. For 282 the product chose old-style invitations
 * (wallet #1018: DIDCOMM_V2_MINT_REMOTE_OFF ships `{ off: true }`, since chat's
 * reactions, timer and photos are off on a v2 contact), and the "Enable DIDComm
 * v2" developer setting does not lift that kill, by design. A v2 runner on such
 * a build is not failing: it cannot run, and says so as SKIPPED, with the
 * reason, instead of a red "expected an out-of-band/2.0 invitation". No setting
 * here lifts the kill either; it lifts by OTA when chat speaks over v2.
 * Pure, so node --test can hold it.
 */

/** The kill, as the skip banner says it. */
export const V2_MINT_KILL_REASON =
  "the build mints out-of-band/1.x invitations: DIDCOMM_V2_MINT_REMOTE_OFF is on for 282 (#1018), and the developer " +
  "setting does not lift it; this v2 run is skipped until the kill lifts";

/** A run that cannot proceed on this build, for a stated reason: reported SKIPPED, not failed. */
export class RunSkipped extends Error {
  constructor(reason) {
    super(reason);
    this.name = "RunSkipped";
  }
}

/** Which invitation wallet A minted: "v2" (`_oob=`, out-of-band/2.0), "v1" (`oob=`, 1.x), or "other". */
export function mintedInvitation(invitationUrl) {
  if (/[?&]_oob=/.test(invitationUrl)) return "v2";
  if (/[?&]oob=/.test(invitationUrl)) return "v1";
  return "other";
}

/**
 * The invitation a v2 runner needs, or the reason it cannot have one: a 1.x
 * invitation is the kill (RunSkipped); anything else is a failure as before.
 */
export function expectV2Invitation(invitationUrl) {
  const minted = mintedInvitation(invitationUrl);
  if (minted === "v2") return invitationUrl;
  if (minted === "v1") throw new RunSkipped(V2_MINT_KILL_REASON);
  throw new Error(`expected an out-of-band/2.0 invitation (_oob=), got: ${String(invitationUrl).slice(0, 80)}…`);
}
