/**
 * The developer switches for the shared-connect flow (relationship over TSP,
 * docs/plans/relationship-over-tsp-plan.md). The flow is a draft proposed in
 * dtgwg-vti-spec#86 and is not in the VTI links specification yet, so it is
 * off unless a developer turns it on: with it off, a shared-connect link is
 * answered exactly as any flow this build does not know ("This code needs a
 * newer version of the app.").
 *
 * A module-level pair of switches, like `setTspCarriageEnabled` in
 * `ceremony.ts`: the app sets them from its developer settings at start-up.
 *
 * @module trust-tasks/module/sharedConnectFlag
 */

let sharedConnectEnabled = false
let sharedConnectLabelEnabled = false
let sharedConnectInviteEnabled = false

/** Turn the shared-connect flow on or off (developer setting). */
export function setSharedConnectEnabled(enabled: boolean): void {
  const before = isSharedConnectInviteEnabled()
  sharedConnectEnabled = enabled
  if (before && !isSharedConnectInviteEnabled()) inviteTurnedOff()
}

/** Whether a shared-connect link is read and carried to its confirm screen. */
export function isSharedConnectEnabled(): boolean {
  return sharedConnectEnabled
}

/**
 * Read `_label` from a shared-connect link. A separate switch because `_label`
 * is a proposed fifth reserved name that VTI-LNK-011 does not list yet (plan
 * D6): reading it before the specification adopts it is a deliberate choice.
 * Only meaningful while the flow itself is on.
 */
export function setSharedConnectLabelEnabled(enabled: boolean): void {
  sharedConnectLabelEnabled = enabled
}

export function isSharedConnectLabelEnabled(): boolean {
  return isSharedConnectEnabled() && sharedConnectLabelEnabled
}

/**
 * Keyring as the inviter: showing a code another wallet scans (plan WP9). Its own switch, off by default, turned
 * on in an update once the live run against an independent scanner passes (Alberto, 2026-11-07).
 */
export function setSharedConnectInviteEnabled(enabled: boolean): void {
  const before = isSharedConnectInviteEnabled()
  sharedConnectInviteEnabled = enabled
  if (before && !isSharedConnectInviteEnabled()) inviteTurnedOff()
}

const offListeners = new Set<() => void>()

/**
 * Be told the moment the inviter goes from on to off (its own switch, or the shared-connect switch under it), so
 * every code still showing ends at once. Returns the way to stop listening.
 */
export function onSharedConnectInviteTurnedOff(listener: () => void): () => void {
  offListeners.add(listener)
  return () => void offListeners.delete(listener)
}

function inviteTurnedOff() {
  for (const listener of [...offListeners]) {
    try {
      listener()
    } catch {
      // one listener's failure does not keep the others on
    }
  }
}

/**
 * Whether "Show a code" is offered. Needs the shared-connect flow itself on too, read through
 * {@link isSharedConnectEnabled} so that whatever turns the flow off (its switch, or a remote off) turns this off.
 */
export function isSharedConnectInviteEnabled(): boolean {
  return isSharedConnectEnabled() && sharedConnectInviteEnabled
}
