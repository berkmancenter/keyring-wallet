import { test } from "node:test";
import assert from "node:assert/strict";
import { fromGrant, grantAfter, grantEntries, linkedPhoneEntries, ownedBy } from "./aclCleanup.js";

const ADMIN = "did:key:zRunnerAdmin";
// 1015-1852's link-address-resume: this case granted its phone's temporary key; kk, beside it, linked its own phone to
// the same runner a few seconds later with the same kind of grant; both phones then rotated (acl/swap-key keeps the
// entry, changes the subject).
const grant = { subject: "did:peer:2.zTempCase", createdBy: ADMIN, createdAt: "2026-10-15T18:55:20.113Z", label: "keyring-admin" };
const after = [
  { subject: "did:key:zCi", createdBy: ADMIN, createdAt: "2026-10-01T00:00:00Z", label: "keyring-ci-gate" },
  { subject: "did:peer:2.zLongCase", createdBy: ADMIN, createdAt: "2026-10-15T18:55:20.113Z", label: "keyring-admin" },
  { subject: "did:peer:2.zLongKk", createdBy: ADMIN, createdAt: "2026-10-15T18:55:41.902Z", label: "keyring-admin" },
];

test("the case's own entry is found through its rotation; another leg's grant on the same runner is not", () => {
  assert.deepEqual(fromGrant(after, grant).map((e) => e.subject), ["did:peer:2.zLongCase"]);
});

test("before the rotation the grant itself is the one entry", () => {
  assert.deepEqual(fromGrant([...after.slice(0, 1), grant], grant).map((e) => e.subject), ["did:peer:2.zTempCase"]);
});

test("a manual grant's rotated key is not on its createdBy chain, which is why fromGrant exists", () => {
  assert.deepEqual(ownedBy(after, grant.subject).map((e) => e.subject), []);
});

test("an unknown grant matches nothing", () => {
  assert.deepEqual(fromGrant(after, undefined), []);
  assert.deepEqual(fromGrant(after, { createdBy: ADMIN, label: "keyring-admin" }), []);
});

const BEFORE = [after[0]];

test("grantAfter: by subject while the phone has not rotated", () => {
  const r = grantAfter(BEFORE, [after[0], grant], grant.subject);
  assert.equal(r.entry.subject, grant.subject);
  assert.equal(r.ambiguous, false);
});

test("grantAfter: rotated already (a live app's poll), the one new keyring-admin entry", () => {
  const r = grantAfter(BEFORE, [after[0], after[1]], grant.subject);
  assert.equal(r.entry.subject, "did:peer:2.zLongCase");
  assert.equal(r.ambiguous, false);
});

test("grantAfter: rotated and another leg granted in the same moment, the oldest, flagged ambiguous", () => {
  const r = grantAfter(BEFORE, after, grant.subject);
  assert.equal(r.entry.subject, "did:peer:2.zLongCase");
  assert.equal(r.ambiguous, true);
});

test("grantAfter: nothing new, no entry", () => {
  assert.equal(grantAfter(BEFORE, BEFORE, grant.subject).entry, undefined);
});

// 1021-0158's link-no-answer: the case granted its phone's key; smoke-ios, beside it, granted its own phone's key on the
// same runner 25 s later (same admin, same label), inside the case's window.
const caseGrant = { subject: "did:key:z6MknCase", createdBy: ADMIN, createdAt: "2026-10-21T02:15:24.000Z", label: "keyring-admin" };
const smoke = { subject: "did:key:z6MkfQKSmoke", createdBy: ADMIN, createdAt: "2026-10-21T02:15:49.000Z", label: "keyring-admin" };

test("grantEntries: another leg's grant inside the window is not the case's", () => {
  assert.deepEqual(grantEntries([caseGrant, smoke], caseGrant).map((e) => e.subject), ["did:key:z6MknCase"]);
});

test("grantEntries: the grant is followed through its rotation", () => {
  const rotated = { ...caseGrant, subject: "did:peer:2.zCaseLong" };
  assert.deepEqual(grantEntries([rotated, smoke], caseGrant).map((e) => e.subject), ["did:peer:2.zCaseLong"]);
});

test("grantEntries: a second key the phone made still counts, so the row still fails on it", () => {
  const second = { subject: "did:key:zCaseSecond", createdBy: caseGrant.subject, createdAt: "2026-10-21T02:16:30.000Z", label: "keyring-admin" };
  assert.deepEqual(grantEntries([caseGrant, smoke, second], caseGrant).map((e) => e.subject), ["did:key:z6MknCase", "did:key:zCaseSecond"]);
});

test("grantEntries: no grant read, nothing counted", () => {
  assert.deepEqual(grantEntries([smoke], undefined), []);
});

// The refused leg (IN-350): the phone's own grant, found from its link record, and nothing else on the runner.
const link = { before: ["did:key:zCi", "did:key:zOther"], tempDid: "did:key:zTemp", heirs: ["did:peer:2.zRotated"] };
const runner = [
  { subject: "did:key:zCi", createdBy: ADMIN, createdAt: "2026-10-01T00:00:00Z", label: "keyring-ci-gate" },
  { subject: "did:key:zOther", createdBy: ADMIN, createdAt: "2026-10-21T08:00:00Z", label: "keyring-admin" },
  { subject: "did:peer:2.zRotated", createdBy: ADMIN, createdAt: "2026-10-21T08:01:00Z", label: "keyring-admin" },
  { subject: "did:key:zLegBeside", createdBy: ADMIN, createdAt: "2026-10-21T08:01:30Z", label: "keyring-admin" },
];

test("linkedPhoneEntries: the phone's rotated grant, not what was there before nor another leg's new grant", () => {
  assert.deepEqual(linkedPhoneEntries(runner, link).map((e) => e.subject), ["did:peer:2.zRotated"]);
});

test("linkedPhoneEntries: a key the phone made from its grant is its own too", () => {
  const made = { subject: "did:key:zMade", createdBy: "did:peer:2.zRotated", createdAt: "2026-10-21T08:02:00Z", label: "keyring-admin" };
  assert.deepEqual(linkedPhoneEntries([...runner, made], link).map((e) => e.subject), ["did:peer:2.zRotated", "did:key:zMade"]);
});

test("linkedPhoneEntries: no link record, nothing selected", () => {
  assert.deepEqual(linkedPhoneEntries(runner, {}), []);
  assert.deepEqual(linkedPhoneEntries(runner, { before: [], heirs: ["did:peer:2.zRotated"] }), []);
});
