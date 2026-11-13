// Which member of C the p1 leg's own run added, for its cleanup (p1.sh, lib.sh c_members_remove). W5 of
// docs/plans/farm-test-footprint-plan.md, narrowed on ac's review of #873.
//
// p1 cannot name its applicant directly: the TUI vets it without printing the applicant's DID, Keyring's screen is not
// read for it, and the community's member record names no vetter (vtc-service routes/members/read.rs MemberResponse,
// external/verifiable-trust-infrastructure fc157f76f). The exact route would be the join request's vetting record,
// whose statements carry their `issuer` (routes/join_requests/read.rs JoinRequestVettingStatement) — the TUI persona —
// but vtc-admin has no command for GET /v1/join-requests/{id}/vetting yet. Until it does, the risk of taking someone
// else's member is bounded here: a member is named only when ALL of these hold, and otherwise none is:
//   - the run passed (the applicant became a member: what communityListsMember checked);
//   - it was not a member at the run's start (a snapshot), and joined in the run's window;
//   - no fixture names it (the TUI persona, the seated vetters);
//   - it is the ONLY member that is new in the window: two or more and none is named (a person or a vetter seated by
//     hand meanwhile would be among them), with the reason printed.
// So the worst case left is one other member joining in p1's window while p1's own applicant did not: p1 then passed
// on that member (communityListsMember's own false positive) and names it. The time window is the second filter.
export function p1OwnMember({ before, after, startedAt, endedAt, fixtures = [], green }) {
  if (!green) return { did: undefined, why: 'the run did not pass, so no member is known to be its own' };
  if (!before) return { did: undefined, why: "no snapshot of the members at the start, so a new one cannot be told from an old one" };
  const t0 = Date.parse(startedAt), t1 = Date.parse(endedAt ?? new Date().toISOString());
  const fixed = new Set(fixtures.filter(Boolean));
  const fresh = after.filter((m) => m.did && !before.has(m.did) && !fixed.has(m.did) && Date.parse(m.joinedAt ?? 0) >= t0 && Date.parse(m.joinedAt ?? 0) <= t1);
  if (fresh.length === 1) return { did: fresh[0].did, why: 'the one member new in the run' };
  return { did: undefined, why: fresh.length ? `${fresh.length} members new in the run's window: none is taken for p1's` : 'no member new in the run' };
}
