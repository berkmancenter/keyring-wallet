/**
 * Whether a VtaClient keeps to one session: it stops the session it is replacing before it opens the next
 * (`VtaClient.openAs`), and a second `connect()` joins the one in flight instead of opening another. Two values a
 * release (an OTA included) sets, and nothing else:
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and both are as before this switch (a replaced session never
 *   stopped, every `connect()` its own), from the next start, whatever `on` says, until a release sets it back.
 *
 * Why: `connect()` opens a new session whenever the one it holds has no open socket (closed while the app was away,
 * or by the mediator). The old one was never stopped, so it kept its renewal timer and reopened its socket by itself,
 * minutes later, as the same DID. A mediator allows one socket per DID, so each of the two closed the other's at every
 * renewal (`w.websocket.duplicate-channel`), for as long as the app ran (report EFNN-34F9, 11-17: two sessions for the
 * agent channel renewing in the same millisecond). In that report the two came from two `connect()` calls side by
 * side as the app returned to the foreground, each finding no open socket.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each replacement. It
 * fails closed to the old path: anything but `on` true and `remoteOff` false reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST: branch from current main, set `REPLACED_SESSION_STOPS.remoteOff` to
 * `true` in this file (packages/core/src/modules/trust-tasks/module/replacedSessionSwitch.ts) and change nothing
 * else; merge, pin, cut, and Alberto publishes. Its proof is agentClientReplacedSession.test.ts's remoteOff row.
 *
 * Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/replacedSessionSwitch
 */
export const REPLACED_SESSION_STOPS: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

/** Whether a session being replaced is stopped first, now. */
export function isReplacedSessionStopsOn(): boolean {
  return REPLACED_SESSION_STOPS.on === true && REPLACED_SESSION_STOPS.remoteOff === false
}
