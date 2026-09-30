// node --test e2e/lib/joinOutcome.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { communityOutcome, disagreement } from "./joinOutcome.js";

const P = "did:webvh:Qm:dids.example:grain-garage";
const deferred = {
  id: "r1",
  applicantDid: P,
  status: "deferred",
  submittedAt: "2026-09-24T19:24:57Z",
  policyDecision: { effect: "request_more", with: { needs: ["vetting:statements:1"] } },
};

test("reads the community's answer: a member, else the newest request", () => {
  assert.deepEqual(communityOutcome(P, [{ did: P }], [deferred]), { outcome: "member" });
  assert.deepEqual(communityOutcome(P, [], [deferred]), { outcome: "deferred", requestId: "r1", needs: ["vetting:statements:1"] });
  assert.deepEqual(communityOutcome(P, [], []), { outcome: "none" });
  const older = { ...deferred, id: "r0", status: "withdrawn", submittedAt: "2026-09-23T00:00:00Z" };
  assert.equal(communityOutcome(P, [], [older, deferred]).requestId, "r1");
});

test("fails the run that 219 passed: 'You're a member' on a deferred join", () => {
  const community = communityOutcome(P, [], [deferred]);
  assert.match(disagreement({ expected: "member", screen: "member", community }), /screen says member, but the community says deferred \(needs vetting:statements:1\)/);
});

test("passes only when screen, community and expectation agree", () => {
  const community = communityOutcome(P, [], [deferred]);
  assert.equal(disagreement({ expected: "deferred", screen: "deferred", community }), undefined);
  assert.equal(disagreement({ expected: "member", screen: "member", community: { outcome: "member" } }), undefined);
  assert.match(disagreement({ expected: "member", screen: "deferred", community }), /expected member/);
  assert.match(disagreement({ expected: "bogus", screen: "member", community }), /unknown EXPECT_JOIN/);
});

test("accepts a screen error only as the community's rejection", () => {
  const rejected = { outcome: "rejected", requestId: "r2" };
  assert.equal(disagreement({ expected: "rejected", screen: "error", community: rejected }), undefined);
  assert.match(disagreement({ expected: "member", screen: "error", community: { outcome: "member" } }), /screen says error/);
});
