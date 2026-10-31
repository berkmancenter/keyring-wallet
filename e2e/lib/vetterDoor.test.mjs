import test from "node:test";
import assert from "node:assert/strict";
import { communityCardKey } from "./testIdKeys.js";
import { vetterDoors } from "./vetterDoor.js";

const A = "did:webvh:QmA:dids.example:community-a";
const B = "did:webvh:QmB:dids.example:community-b";
const doorA = `AgentOpenDesk_${communityCardKey(A)}`;
const doorB = `AgentOpenDesk_${communityCardKey(B)}`;

test("no community named: the order as before", () => {
  assert.deepEqual(vetterDoors([doorA, doorB], undefined), ["AgentOpenDesk", doorA, doorB, "AgentVetOthers", "AgentContinueVetting"]);
});

test("a vetter of two: only the named community's doors, even one below the fold", () => {
  const doors = vetterDoors([doorA], B);
  assert.equal(doors[0], doorB);
  assert.ok(!doors.includes(doorA));
  assert.ok(!doors.includes("AgentOpenDesk"));
});

test("a vetter of one: its plain door still opens", () => {
  assert.ok(vetterDoors([], A).includes("AgentOpenDesk"));
});
