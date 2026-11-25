/**
 * The remote off for the shared-connect flows: a value a release (an OTA
 * included) sets to `true` to turn a flow off for everyone, whatever each
 * person saved in Developer settings.
 *
 * It only ever turns a flow off. It never turns one on, and it never touches
 * what anyone saved: while it is set, a saved "on" reads as off; once a release
 * sets it back to `false`, everyone is back to their own choice, and a person's
 * own "off" wins throughout. That is why it is a separate value read by the
 * switches' `is…Enabled()` functions, and not a change of default or a reset of
 * what is stored (a reset would turn a flow back on for someone who had turned
 * it off).
 *
 * Every layer reads a flow's switch through those functions (the scanner's
 * router, the inbound credential check, the inviter's core and its screens), so
 * this one value turns the whole flow off, not only its buttons.
 *
 * To turn a flow off in a release, set its entry to `true` here. Tests flip the
 * entries and must put them back.
 *
 * @module trust-tasks/module/sharedConnectRemoteOff
 */
export const SHARED_CONNECT_REMOTE_OFF: {
  /** Connecting from a code someone shared (the scanner, "Connect from a shared code"). */
  connect: boolean
  /** Showing a code for someone else to scan (the inviter, "Show a code"). */
  invite: boolean
} = {
  connect: false,
  invite: false,
}
