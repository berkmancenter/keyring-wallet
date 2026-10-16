/**
 * The challenge a hidden-vetting proof is bound to.
 *
 * `vtc/vetting/pcs-challenge/0.1`: the applicant asks, the community issues,
 * keeps it, and accepts it exactly once. Without one, a proof verifies as often
 * as it is submitted and the second submission of the same bytes counts as
 * readily as the first.
 *
 * Two properties of the task shape the client, and both are the community's
 * rules rather than ours:
 *
 * - **it is mutating.** The community *replaces* any challenge it had open for
 *   this applicant, so asking twice invalidates the first — which is why the
 *   task must never be in `VTI_READ_TASKS` and must not be retried blindly.
 * - **it expires.** An applicant that misses the window asks for another and
 *   builds another proof; a proof is not reusable across challenges.
 *
 * The reading is here, apart from the transport, so it can be tested without a
 * connected agent. The sending is `vtiAgent.fetchChallenge`, which asks the
 * community (the same path as the join submit) and never takes a challenge
 * from the agent's answer hold: a held one may already be spent.
 *
 * @module trust-tasks/module/pcsChallenge
 */

/** `vtc/vetting/pcs-challenge/0.1`. */
export const PCS_CHALLENGE_TYPE = 'https://trusttasks.org/spec/vtc/vetting/pcs-challenge/0.1'

/**
 * The community publishes no criterion that accepts a hidden-vetting proof, so
 * there is no challenge to issue. The task's own error code.
 */
export const PCS_CHALLENGE_NOT_HIDDEN = 'vtc/vetting/pcs-challenge:notHiddenVetting'

/** A challenge, as the community issued it. */
export interface PcsChallenge {
  /**
   * 16 bytes as lowercase hex. Compared for equality and never parsed — by the
   * community, and here. Passed to `vta/pcs/prove` as it came.
   */
  challenge: string
  /** When the community stops accepting it. */
  expiresAt: string
}

/** Why no usable challenge came back. */
export type PcsChallengeProblem =
  /** The community says it runs no hidden-vetting criterion. */
  | 'notHiddenVetting'
  /** It answered, but not with something this client can use. */
  | 'unreadable'

export type PcsChallengeRead = { challenge: PcsChallenge } | { problem: PcsChallengeProblem; detail: string }

/** The published shape: 16 bytes, lowercase hex, exactly. */
const CHALLENGE = /^[0-9a-f]{32}$/

/**
 * Read a `#response` payload.
 *
 * Strict on purpose. A challenge is compared byte for byte by the community, so
 * a value this client "fixed" — trimmed, lower-cased, re-encoded — would
 * produce a proof bound to something the community never issued, and the
 * refusal would arrive at submission with nothing to point at. Better to refuse
 * here, where the cause is still visible.
 */
export function readPcsChallenge(payload: unknown): PcsChallengeRead {
  if (typeof payload !== 'object' || payload === null) {
    return { problem: 'unreadable', detail: 'the answer carries no payload' }
  }
  const { challenge, expiresAt } = payload as { challenge?: unknown; expiresAt?: unknown }

  if (typeof challenge !== 'string' || !CHALLENGE.test(challenge)) {
    return {
      problem: 'unreadable',
      detail:
        typeof challenge === 'string'
          ? `the challenge is not 16 bytes of lowercase hex (${challenge.length} characters)`
          : 'the answer names no challenge',
    }
  }
  if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) {
    // A challenge whose expiry cannot be read is one we cannot tell a person
    // anything about, and cannot decide to rebuild before.
    return { problem: 'unreadable', detail: 'the answer gives no readable expiry' }
  }

  return { challenge: { challenge, expiresAt } }
}

/**
 * The request payload.
 *
 * Every member is optional — the applicant is identified by the envelope's
 * `issuer`, and that is the whole input the community needs. `criterionId` is
 * sent when one has been chosen, so a community running several criteria may
 * refuse here rather than at submit; it is **not** a commitment, and the
 * submission names its own criterion.
 */
export const pcsChallengeRequest = (criterionId?: string): Record<string, unknown> =>
  criterionId ? { criterionId } : {}
