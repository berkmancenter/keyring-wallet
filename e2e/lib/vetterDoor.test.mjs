import test from "node:test";
import assert from "node:assert/strict";
import { communityCardKey } from "./testIdKeys.js";
import { vetterDoors } from "./vetterDoor.js";

const A = "did:webvh:QmA:dids.example:community-a";
const B = "did:webvh:QmB:dids.example:community-b";
const doorA = `AgentOpenDesk_${communityCardKey(A)}`;
const doorB = `AgentOpenDesk_${communityCardKey(B)}`;

const Bc = { did: B };
const heading = (x) => `<x label="You can now vet people for ${x}"/>`;

test("no community named: the order as before", () => {
  assert.deepEqual(vetterDoors([doorA, doorB], undefined), ["AgentOpenDesk", doorA, doorB, "AgentVetOthers", "AgentContinueVetting"]);
});

test("a vetter of two: only the named community's doors, even one below the fold", () => {
  const doors = vetterDoors([doorA], Bc);
  assert.equal(doors[0], doorB);
  assert.ok(!doors.includes(doorA));
  assert.ok(!doors.includes("AgentOpenDesk"));
});

test("the grant not taken yet: the plain door is the other community's, so it is not offered", () => {
  assert.ok(!vetterDoors([], Bc, heading("an unnamed community (dids.example/community-a)")).includes("AgentOpenDesk"));
});

test("a page with no heading yet: the plain door is not offered", () => {
  assert.ok(!vetterDoors([], Bc, "").includes("AgentOpenDesk"));
});

test("a vetter of one, unnamed: its heading carries the DID's path, so the plain door opens", () => {
  assert.ok(vetterDoors([], Bc, heading("an unnamed community (dids.example/community-b)")).includes("AgentOpenDesk"));
});

test("a vetter of one, named: the published name matches", () => {
  assert.ok(vetterDoors([], { did: B, names: ["Lab B"] }, heading("Lab B")).includes("AgentOpenDesk"));
  assert.ok(!vetterDoors([], { did: B, names: ["Lab B"] }, heading("Lab A")).includes("AgentOpenDesk"));
});
