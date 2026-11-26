import assert from "node:assert/strict";
import { test } from "node:test";
import { postState, roomHandles, troubleOn } from "./rooms.js";

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

test("a post is sent only on a readable room with nothing pending", () => {
  const room = `${page}<x name="RoomComposerInput"/>`;
  assert.equal(postState(room), "sent");
  assert.equal(postState(`${room}<x name="RoomPostSending"/>`), "sending");
  assert.equal(postState(`${room}<x name="RoomComposerFile"/>`), "sending");
  assert.equal(postState(`${room}<x name="RoomPostNotSent"/>`), "failed");
  assert.equal(postState(`${page}<x name="RoomComposerUnavailable"/>`), "failed");
  assert.equal(postState(""), "unread");
  assert.equal(postState("<x name=\"Message\"/>"), "unread");
});
