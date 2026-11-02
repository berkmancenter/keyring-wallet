import assert from "node:assert/strict";
import { test } from "node:test";
import { roomHandles, troubleOn } from "./rooms.js";

const page = `<x name="com.ariesbifold:id/RoomName_abc-1"/><x name="com.ariesbifold:id/RoomRow_abc-1"/>
<x name="com.ariesbifold:id/RoomName_abc-1"/><x name="com.ariesbifold:id/RoomName_d_2"/>`;

test("each handle once, in page order, for its own prefix", () => {
  assert.deepEqual(roomHandles(page, "RoomName_"), ["abc-1", "d_2"]);
  assert.deepEqual(roomHandles(page, "RoomOfferRow_"), []);
});

test("a clean room shows no trouble; a failure state is named", () => {
  assert.deepEqual(troubleOn(page), []);
  assert.deepEqual(troubleOn(`${page}<x name="RoomPollFailed"/><x name="RoomPostNotSent"/>`), ["RoomPollFailed", "RoomPostNotSent"]);
});
