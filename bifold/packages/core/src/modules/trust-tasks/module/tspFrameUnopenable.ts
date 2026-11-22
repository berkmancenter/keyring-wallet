/**
 * A TSP frame that can never be opened by the identity it reached, so the
 * session acknowledges it and drops it instead of leaving it queued for ever.
 *
 * A frame left queued comes back on every delivery-request and only the
 * mediator's expiry clears it. Enough of them fill the queue from a peer to
 * this phone; the mediator then refuses the peer's next replies
 * (`limits.queue.peer`) and the peer marks the phone as not collecting its
 * inbox for five minutes (vti-common `UncollectedPeers`). Read as "your agent
 * isn't answering" (report D7FG-2Y9J, 2026-10-21).
 *
 * Only a lasting reason is one. A frame whose receiver's key is not in memory
 * yet (just after a launch or a resume, or while a key is being fetched) is not:
 * it is left queued and opened once the key is there. Acknowledging drops a
 * frame for good, and such a frame may be a real request.
 *
 * @module trust-tasks/module/tspFrameUnopenable
 */

/** Why a frame can never be opened here; the reason class a log line names. */
export type TspFrameDropReason =
  /** The receiver's key was used and the frame still did not open: sealed to another key or relationship, or tampered. */
  | 'unsealFailed'
  /** Not a frame the codec can read, before any key was needed. */
  | 'malformed'
  /** Opened, but addressed to another identity than the one this session collects for. */
  | 'otherReceiver'
  /** Opened, but its document names another issuer or recipient than TSP authenticated (binding §3). */
  | 'identityMismatch'
  /** Its version marker names a TSP MAJOR this build does not read (it reads Rev 2,
   *  Rev 3 and 1.0). Lasting: the frame will never open here, whatever key arrives. */
  | 'versionMismatch'

export class TspFrameUnopenable extends Error {
  constructor(
    readonly reason: TspFrameDropReason,
    message: string
  ) {
    super(message)
    this.name = 'TspFrameUnopenable'
  }
}

/** Read by shape, so the class from another bundle copy counts too. */
export function isTspFrameUnopenable(error: unknown): error is TspFrameUnopenable {
  return (error as { name?: unknown } | null)?.name === 'TspFrameUnopenable'
}
