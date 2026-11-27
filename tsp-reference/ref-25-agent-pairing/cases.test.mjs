// The recorded case `pairing-readback` (step 7.5), read with no VTA running: what the README says of it is
// asserted here on the recorded values. Values that differ on every run are recorded under names, and the same
// value always has the same name, so two recorded entries are equal exactly when the VTA's two answers were.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const recordings = readdirSync(new URL("./fixtures/", import.meta.url))
  .filter((name) => /^vta-cases-.*\.json$/.test(name))
  .map((name) => ({ name, ...JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) }));
const ran = recordings.filter((recording) => !recording.cases["pairing-readback"]?.notRunnable);

test("pairing-readback is recorded for every VTA version, and at least two ran it", () => {
  assert.ok(recordings.length >= 3);
  for (const recording of recordings) assert.ok(recording.cases["pairing-readback"], recording.name);
  assert.ok(ran.length >= 2, "the case ran on fewer than two versions");
  // The pinned 0.79.0 serves no acl/grant 0.3, so the case cannot run there, and the recording says why.
  const pinned = recordings.find((recording) => recording.source.version === "0.79.0");
  assert.match(pinned.cases["pairing-readback"].notRunnable.join(" "), /acl\/grant\/0\.3 is not served/);
});

for (const recording of ran) {
  const recorded = recording.cases["pairing-readback"];
  const { entrySent, readBack, widening } = recorded;

  test(`${recording.name}: the entry read back is the entry granted, under the agent's own key`, () => {
    assert.equal(recorded.grant, "ok");
    assert.deepEqual(recorded.theAgent, { register: "ok", swap: "ok", theNewKeySignsIn: true });
    const entry = readBack.entryFromAclList;
    assert.equal(entrySent.subject, "<the throwaway key>");
    assert.equal(entry.subject, "<the agent's key>");
    assert.equal(readBack.anEntryUnderTheThrowawayKey, false);
    for (const member of ["role", "act", "keys", "capabilities", "purposes", "label", "expiresAt"]) {
      assert.deepEqual(entry[member], entrySent[member], member);
    }
    assert.equal(entry.expiresAt, "<the expiry sent>");
    assert.deepEqual(entry.act.contexts, ["<first memory>", "<second memory>"]);
    assert.deepEqual(Object.keys(entry).filter((member) => !(member in entrySent)).sort(), ["approve", "createdAt", "createdBy", "delegatedBy"]);
    assert.deepEqual(entry.approve, { scope: "none" });
    assert.equal(entry.createdBy, "<the administrator>");
    assert.equal(entry.delegatedBy, "<the administrator>");
  });

  test(`${recording.name}: acl/show gives the entry acl/list gives`, () => {
    assert.deepEqual(readBack.entryFromAclShow, readBack.entryFromAclList);
  });

  test(`${recording.name}: the kind is on the device, under the agent's key, and the entry has none`, () => {
    assert.equal(readBack.device.deviceId, "<the device>");
    assert.equal(readBack.device.consumerDid, "<the agent's key>");
    assert.deepEqual(readBack.device.consumerKind, { kind: "service", serviceKind: "aiAgent" });
    assert.deepEqual(readBack.device.capabilities, ["memoryRead", "memoryWrite"]);
    assert.deepEqual(readBack.entryFromAclList.capabilities.grants, [{ capability: "memory-read" }, { capability: "memory-write" }]);
    assert.equal("kind" in readBack.entryFromAclList || "consumerKind" in readBack.entryFromAclList, false);
  });

  test(`${recording.name}: the widening changes act and nothing else, and sending it again changes nothing`, () => {
    assert.equal(widening.grantWithOne, "ok");
    assert.equal(widening.update, "ok");
    assert.equal(widening.theSameUpdateAgain, "ok");
    assert.deepEqual(widening.entryBefore.act.contexts, ["<first memory>"]);
    assert.deepEqual(widening.entryAfter.act.contexts, ["<first memory>", "<second memory>"]);
    assert.deepEqual({ ...widening.entryBefore, act: widening.entryAfter.act }, widening.entryAfter, "a member other than act changed");
    assert.deepEqual(widening.entryInTheUpdatesAnswer, widening.entryAfter);
    assert.deepEqual(widening.entryAfterTheSecond, widening.entryAfter);
    assert.deepEqual(widening.onANewSession, { first: "ok", second: "ok" });
  });
}

// The recorded case `own-entry` (Brendan's Q7): what the README's "can an agent read its own entry?" table says,
// asserted on the recorded values, the control with it. A broken probe also records permissionDenied everywhere;
// the administrator's answer naming the creator in `createdBy` is what says the VTA refused this caller.
const ownEntryRan = recordings.filter((recording) => !recording.cases["own-entry"]?.notRunnable);

test("own-entry is recorded for every VTA version, ran on 0.84.0 and 0.87.0, and says why not on 0.79.0", () => {
  for (const recording of recordings) assert.ok(recording.cases["own-entry"], recording.name);
  assert.deepEqual(ownEntryRan.map((recording) => recording.source.version).sort(), ["0.84.0", "0.87.0"]);
  const pinned = recordings.find((recording) => recording.source.version === "0.79.0");
  assert.match(pinned.cases["own-entry"].notRunnable.join(" "), /acl\/show\/0\.3 is not served/);
  assert.match(pinned.cases["own-entry"].notRunnable.join(" "), /acl\/list\/0\.4 is not served/);
});

for (const recording of ownEntryRan) {
  const recorded = recording.cases["own-entry"];

  test(`${recording.name}: the agent cannot read its own entry, or learn its creator, through a task it is allowed`, () => {
    assert.equal(recorded.grant, "ok");
    assert.deepEqual(recorded.asTheAgent, {
      aclShowOwn: "permissionDenied",
      aclShowOwnCreatedBy: "<not answered>",
      aclListOwn: "permissionDenied",
      aclListOwnCreatedBy: "<not answered>",
      whoami: "ok",
      whoamiMembers: ["capabilities", "roles", "scopes", "session"],
      whoamiMentionsCreator: false,
    });
  });

  test(`${recording.name}: the control: the administrator's acl/show of the same entry answers, with createdBy`, () => {
    assert.deepEqual(recorded.control, { aclShowAsAdministrator: "ok", createdBy: "<the administrator>" });
  });
}
