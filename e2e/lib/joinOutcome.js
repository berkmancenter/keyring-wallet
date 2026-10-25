/**
 * What a join ended as, on the phone and at the community — and whether the
 * two agree. The phone's screen alone is not evidence: until 220, "I was
 * invited" said "You're a member" for ANY answer that was not an error, and a
 * community that requires vetting defers an invitation join by design, so the
 * harness passed runs that admitted no one (2026-09-24; run-vti-invite since
 * #127, 219's gate included).
 *
 * Pure: the runner reads the screen and the community's admin API and hands
 * both here.
 */

/** The outcome screens after "Join", by testID (keyring-bifold, 220). */
export const OUTCOME_SCREENS = {
  InvitedJoined: "member",
  InvitedDeferred: "deferred",
  InvitedPending: "pending",
  InvitedError: "error",
};

/** The outcomes a run may expect: EXPECT_JOIN. */
export const JOIN_OUTCOMES = ["member", "deferred", "pending", "rejected"];

/**
 * The community's own answer for one applicant, from the admin API:
 * `members` (the member list's items) and `requests` (join requests of every
 * status, as `join-list <status>` returns them). A member is a member; else
 * the applicant's newest request says where it stands.
 */
export function communityOutcome(applicantDid, members, requests) {
  if (members.some((m) => m.did === applicantDid)) return { outcome: "member" };
  const mine = requests
    .filter((r) => r.applicantDid === applicantDid)
    .sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")))[0];
  if (!mine) return { outcome: "none" };
  const needs = mine.policyDecision?.with?.needs ?? [];
  switch (mine.status) {
    case "deferred":
      return { outcome: "deferred", requestId: mine.id, needs };
    case "pending":
      return { outcome: "pending", requestId: mine.id };
    case "rejected":
      return { outcome: "rejected", requestId: mine.id };
    case "approved":
      // Approved but not on the member list yet: the card is still on its way.
      return { outcome: "approved", requestId: mine.id };
    default:
      return { outcome: String(mine.status ?? "unknown"), requestId: mine.id };
  }
}

/**
 * Whether the screen, the community and the run's expectation agree. Returns
 * the reason they do not, or undefined. A screen error is accepted only for a
 * community that rejected the request, and only when the run expects that.
 */
export function disagreement({ expected, screen, community }) {
  if (!JOIN_OUTCOMES.includes(expected)) return `unknown EXPECT_JOIN=${expected}`;
  const screenSays = screen === "error" && community.outcome === "rejected" ? "rejected" : screen;
  if (screenSays !== community.outcome) {
    return `the screen says ${screen}, but the community says ${community.outcome}${
      community.needs?.length ? ` (needs ${community.needs.join(", ")})` : ""
    }`;
  }
  if (community.outcome !== expected) return `expected ${expected}, and both the screen and the community say ${community.outcome}`;
  return undefined;
}
