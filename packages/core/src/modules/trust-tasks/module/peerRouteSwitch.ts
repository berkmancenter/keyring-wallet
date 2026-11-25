/**
 * Whether a peer's route through another mediator (VtiMediatorTransport `peerMediatorRoute`) is read once for every
 * send that needs it, and what a send to a `did:webs` peer does when that route cannot be read. Two values a release
 * (an OTA included) sets, and nothing else:
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and every send reads the route for itself again, once, and a
 *   peer whose route could not be read is forwarded through our mediator alone, whatever `on` says, from the next
 *   start, until a release sets it back.
 *
 * Why: a rooms list took 74 s on 279.4 (report BC46-XSQD, 11-18). Nine asks went to the SEDI community, a `did:webs`,
 * in the same millisecond after the session connected. Each send that reached the forward before the first one had
 * stored the route read it for itself: a burst of resolutions of the community's mediator, the kind a host answers
 * with 421 or 429 (`resolveDidDocumentRetrying`), each cut off at {@link ROUTE_LOOKUP_TIMEOUT_MS}. A send whose read
 * failed was forwarded through our mediator alone, with no line saying so. For a `did:webs` peer that cannot arrive:
 * our mediator has no route to a `did:webs`. Two of the nine were never answered, on any session, and the app waited
 * out its clock for each. Which of them failed that way the report cannot say (the failure wrote nothing); the code
 * allows it and nothing else found does.
 *
 * What changes when it is on:
 * - sends to one peer that start while its route is being read wait for that one read, and take its outcome;
 * - for a `did:webs` peer the read is tried {@link PEER_ROUTE_TRIES_FOR_WEBS} times before it is given up;
 * - a send to a `did:webs` peer whose route still could not be read is not sent through our mediator alone. It fails
 *   with {@link VtiPeerRouteUnread}, so the ask behind it ends at once with a reason instead of waiting for an answer
 *   that cannot come. Nothing is stored for it, and the next send reads the route again.
 *
 * What does not change: a peer whose route was read is forwarded exactly as before, one layer or two. A peer that is
 * not a `did:webs` and whose route could not be read is forwarded through our mediator alone after one try, never held
 * longer, as before: for those the single forward is the right one. The line that says a route could not be read is
 * written whether this is on or off.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each send. It fails
 * closed to each send reading for itself: anything but `on` true and `remoteOff` false reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST: branch from current main, set `PEER_ROUTE_READ_ONCE.remoteOff` to
 * `true` in this file (packages/core/src/modules/trust-tasks/module/peerRouteSwitch.ts) and change nothing else;
 * merge, pin, cut, and Alberto publishes. Its proof is vtiMediatorTspOnlyRoute.test.ts's remoteOff rows.
 *
 * Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/peerRouteSwitch
 */
export const PEER_ROUTE_READ_ONCE: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

/** Whether a peer's route is read once for all the sends that need it, now. */
export function isPeerRouteReadOnceOn(): boolean {
  return PEER_ROUTE_READ_ONCE.on === true && PEER_ROUTE_READ_ONCE.remoteOff === false
}

/** How many times the route of a `did:webs` peer is read before a send to it is given up. */
export const PEER_ROUTE_TRIES_FOR_WEBS = 2

/** A send to a `did:webs` peer was not made: the mediator it must go through could not be read. */
export class VtiPeerRouteUnread extends Error {
  readonly code = 'peerRouteUnread'
  constructor(peer: string) {
    super(`the route to ${peer} could not be read, so nothing was sent: through our mediator alone it cannot arrive`)
    this.name = 'VtiPeerRouteUnread'
  }
}
