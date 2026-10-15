import { test } from "node:test";
import assert from "node:assert/strict";
import { fromGrant, ownedBy } from "./aclCleanup.js";

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
