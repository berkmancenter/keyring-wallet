/**
 * Whether a VtaClient's connect goes on as soon as the mediator has answered the queue request its session's start
 * sent, instead of always waiting the whole drain time (`VtaClient.openAs`, `connectDrainMs`, 2 s). Two values a
 * release (an OTA included) sets, and nothing else:
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and every connect waits the whole drain time again, from the
 *   next start, whatever `on` says, until a release sets it back.
 *
 * Why: the wait is there so that what the mediator had queued for this DID (stale replies from earlier sessions) is
 * taken and discarded before the first ask is sent. It was a fixed 2000 ms at every launch, whatever the mediator
 * held, and was the largest single step of connecting to the agent (reports DDTB-QVVX and GH5F-WDE3, 11-17: socket
 * open, then 2.0 s of nothing, then the first ask). The mediator says when the queue has been handed over: a
 * `delivery` with what it held, or a `status` threaded to the request when it held nothing. The drain time stays as
 * the ceiling, so a mediator that does not answer, or does not thread its answer, costs exactly what it did before.
 *
 * What a reply taken after the wait ended does: nothing. It is threaded to an ask of an earlier session, no ask of
 * this one waits on that thread, and it is dropped as any unmatched reply is.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each connect. It fails
 * closed to the whole wait: anything but `on` true and `remoteOff` false reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST: branch from current main, set `CONNECT_DRAIN_EARLY.remoteOff` to
 * `true` in this file (packages/core/src/modules/trust-tasks/module/connectDrainSwitch.ts) and change nothing else;
 * merge, pin, cut, and Alberto publishes. Its proof is agentConnectDrain.test.ts's remoteOff row.
 *
 * Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/connectDrainSwitch
 */
export const CONNECT_DRAIN_EARLY: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

/** Whether a connect may end its drain wait at the mediator's answer, now. */
export function isConnectDrainEarlyOn(): boolean {
  return CONNECT_DRAIN_EARLY.on === true && CONNECT_DRAIN_EARLY.remoteOff === false
}
