// The two links: their text, their size against the 251-byte producer limit,
// and their QR code at level M.

import { test } from "node:test";
import assert from "node:assert/strict";
import { identityFromSeed } from "./identity.mjs";
import {
  AGENT_CONNECT_FLOW,
  MAX_LINK_BYTES_LEVEL_M,
  REQUEST_ID_LENGTH,
  agentConnectLink,
  byteLength,
  decodeScope,
  encodeFrom,
  encodeScope,
  longestServiceDid,
  measureLink,
  oobLink,
  qrAtLevelM,
} from "./links.mjs";

const REQUEST_ID = "q3Vn7Zk2Xo9Rt1LwPb4HdA";
const DEADLINE = 1_760_000_000;
// The DID in the pinned producer's own test (vti-oob-server/src/util.rs).
const PRODUCER_TEST_DID = "did:webvh:QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG:members.example.org";

test("the auth/oob link is the pinned producer's text, member for member", () => {
  const link = oobLink({ serviceDid: PRODUCER_TEST_DID, requestId: REQUEST_ID, deadline: DEADLINE });
  assert.equal(
    link,
    `https://link.trustoverip.org/t#_from=${PRODUCER_TEST_DID}&_id=${REQUEST_ID}&_exp=1760000000&_type=/vti/flow/sign-in/0.1`,
  );
  assert.equal(REQUEST_ID.length, REQUEST_ID_LENGTH);
  assert.ok(byteLength(link) <= MAX_LINK_BYTES_LEVEL_M);
});

test("only the four characters the producer encodes are encoded", () => {
  assert.equal(encodeFrom("a&b=c#d%e"), "a%26b%3Dc%23d%25e");
  assert.equal(encodeFrom("did:webvh:Qm:host.example:path"), "did:webvh:Qm:host.example:path");
});

test("the limit is the byte capacity of a version 11 code at level M", () => {
  assert.equal(qrAtLevelM("x".repeat(251)).version, 11);
  assert.equal(qrAtLevelM("x".repeat(252)).version, 12);
});

test("the longest VTA DID an auth/oob link can carry is 143 bytes", () => {
  assert.equal(longestServiceDid(), 143);
  const at = oobLink({ serviceDid: "d".repeat(143), requestId: REQUEST_ID, deadline: DEADLINE });
  const over = oobLink({ serviceDid: "d".repeat(144), requestId: REQUEST_ID, deadline: DEADLINE });
  assert.equal(measureLink(at).fits, true);
  assert.equal(measureLink(at).spare, 0);
  assert.equal(measureLink(over).fits, false);
  // The limit counts bytes. A drawn code may still be version 11 one byte over, because an encoder may
  // pack runs of digits more tightly than bytes; the producer's rule is the byte count, so that is the test.
  assert.equal(byteLength(over), 252);
});

test("an auth/oob link draws as a code a decoder reads back", () => {
  const link = oobLink({ serviceDid: PRODUCER_TEST_DID, requestId: REQUEST_ID, deadline: DEADLINE });
  const measured = measureLink(link);
  assert.equal(measured.qrDecodes, true);
  assert.ok(measured.qrVersion <= 11);
});

test("the fallback link names the agent's did:key and its scope, and fits", () => {
  const agent = identityFromSeed(new Uint8Array(32).fill(9));
  const scope = { capabilities: ["memory-read", "memory-write"], purposes: ["assist", "recall"] };
  const link = agentConnectLink({ agentDid: agent.did, requestId: REQUEST_ID, deadline: DEADLINE, scope });
  assert.ok(link.includes(`_from=${agent.did}&`));
  assert.ok(link.includes(`&_type=${AGENT_CONNECT_FLOW}`));
  assert.ok(link.endsWith("&_scope=rw~assist.recall"));
  const measured = measureLink(link);
  assert.equal(measured.fits, true);
  assert.equal(measured.qrDecodes, true);
});

test("a scope round-trips, and an unknown capability is refused both ways", () => {
  const scope = { capabilities: ["memory-read", "room-present", "room-open"], purposes: ["assist"] };
  assert.equal(encodeScope(scope), "rpo~assist");
  assert.deepEqual(decodeScope("rpo~assist"), scope);
  assert.deepEqual(decodeScope("rw"), { capabilities: ["memory-read", "memory-write"], purposes: [] });
  assert.throws(() => encodeScope({ capabilities: ["admin"] }), /unknown capability/);
  assert.throws(() => decodeScope("rx"), /unknown capability letter/);
});

test("the fallback link without a scope is the base link, and the scope's cost is its own length plus 8", () => {
  const agent = identityFromSeed(new Uint8Array(32).fill(9));
  const bare = agentConnectLink({ agentDid: agent.did, requestId: REQUEST_ID, deadline: DEADLINE });
  const scoped = agentConnectLink({
    agentDid: agent.did,
    requestId: REQUEST_ID,
    deadline: DEADLINE,
    scope: { capabilities: ["memory-read"], purposes: [] },
  });
  assert.equal(byteLength(bare), 170);
  assert.equal(byteLength(scoped) - byteLength(bare), "&_scope=".length + 1);
});
