// node --test e2e/lib/testIdKeys.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { cardPrimaryIds, communityCardKey, communityCardKeys, deviceKey, deviceKeys, didHashKey, VETTING_DOOR_WORDS } from "./testIdKeys.js";

test("hashes as the app does (keyring-bifold testIdKeys.test.ts pinned vectors)", () => {
  assert.equal(didHashKey(""), "0ztntfp");
  assert.equal(didHashKey("a"), "1r9wi7g");
  assert.equal(didHashKey("foobar"), "1h5yxyg");
  assert.equal(didHashKey("did:webvh:QmCommunity:vtc.example.org"), "0gfh0vg");
});

test("two phones on one mediator get two device handles; an older build's tail is the fallback", () => {
  const service = ".SeyJ0IjoiZG0iLCJzIjp7InVyaSI6Imh0dHBzOi8vbWVkaWF0b3IuZXhhbXBsZSJ9fQ";
  const a = `did:peer:2.Ez6LSaaaa.Vz6Mkaaaa${service}`;
  const b = `did:peer:2.Ez6LSbbbb.Vz6Mkbbbb${service}`;
  assert.equal(a.slice(-8), b.slice(-8));
  assert.notEqual(deviceKey(a), deviceKey(b));
  assert.deepEqual(deviceKeys(a), [deviceKey(a), a.slice(-8)]);
});

test("a community card's handle reads as its last segment, then the hash", () => {
  const did = "did:webvh:QmScidAlpha:farm.example.org:alpha:keyring-test-vtc";
  assert.equal(communityCardKey(did), `keyring-test-vtc-${didHashKey(did)}`);
  assert.equal(communityCardKey("did:example:"), didHashKey("did:example:"));
  assert.deepEqual(communityCardKeys(did), [communityCardKey(did), did.slice(-8)]);
});

test("finds each card's button once, on either platform's source", () => {
  const ios = '<XCUIElementTypeButton name="AgentCommunityPrimary_keyring-test-vtc-0gfh0vg" label="Open the vetting desk"/>';
  const android =
    '<node resource-id="com.ariesbifold:id/AgentCommunityPrimary_abc-1r9wi7g" text="Continue your vetting"/>' +
    '<node resource-id="com.ariesbifold:id/AgentCommunityPrimary_abc-1r9wi7g" text="Continue your vetting"/>';
  assert.deepEqual(cardPrimaryIds(ios), ["AgentCommunityPrimary_keyring-test-vtc-0gfh0vg"]);
  assert.deepEqual(cardPrimaryIds(android), ["AgentCommunityPrimary_abc-1r9wi7g"]);
  // A card whose button is below the fold (left out of Android's page source)
  // names its button from the card's handle, for the caller to scroll to (54bfbaf).
  assert.deepEqual(cardPrimaryIds('<node resource-id="AgentCommunityCard_x"/>'), ["AgentCommunityPrimary_x"]);
  // A card whose button is in the source is named once, not twice.
  assert.deepEqual(
    cardPrimaryIds('<node resource-id="AgentCommunityCard_x"/><node resource-id="AgentCommunityPrimary_x"/>'),
    ["AgentCommunityPrimary_x"]
  );
  assert.deepEqual(cardPrimaryIds('<node resource-id="AgentCommunityHeader_x"/>'), []);
});

test("only the desk and continuing a vetting are doors into Vetting", () => {
  assert.match("Open the vetting desk", VETTING_DOOR_WORDS);
  assert.match("Continue your vetting", VETTING_DOOR_WORDS);
  assert.doesNotMatch("Accept the invitation", VETTING_DOOR_WORDS);
});
