// Track C's three interfaces (the HCP connect link, the match number and the consent request), held offline to
// Keyring's TypeScript, in both directions: this side's implementation against Keyring's vectors and declarations,
// read from the repository, and Keyring's `hcp/__tests__/rungConsent.test.ts` against this side's fixture.
//
// A Keyring file that cannot be found, or a declaration that cannot be read from it, fails the test: never a skip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { HCP_LINK_MAX_BYTES, hcpConnectLink, readHcpConnectLink } from "./link.mjs";
import { hcpMatchNumber } from "./number.mjs";
import {
  HCP_EFFECT_KINDS,
  HCP_GRANTS_REQUEST,
  RECORD_INPUTS,
  hcpConsentRequest,
  recordFixture,
} from "./consent.mjs";

const KEYRING_HCP = new URL("../../../packages/core/src/modules/connected-agents/hcp/", import.meta.url);
const KEYRING_VECTORS = new URL("__tests__/vectors/match-number.json", KEYRING_HCP);
const KEYRING_TYPES = new URL("types.ts", KEYRING_HCP);

const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));
const vectors = readJson(new URL("../fixtures/hcp-match-number.json", import.meta.url));
const consentFixture = readJson(new URL("../fixtures/hcp-consent-request.json", import.meta.url));
const bytes = (text) => Buffer.byteLength(text, "utf8");

function keyringVectors() {
  assert.ok(existsSync(KEYRING_VECTORS), `Keyring's match-number vectors are not at ${KEYRING_VECTORS.pathname}`);
  return readJson(KEYRING_VECTORS);
}

/** `HCP_EFFECT_KINDS` as Keyring declares it in `hcp/types.ts`, read by a regular expression. */
function keyringEffectKinds() {
  assert.ok(existsSync(KEYRING_TYPES), `Keyring's hcp/types.ts is not at ${KEYRING_TYPES.pathname}`);
  const source = readFileSync(KEYRING_TYPES, "utf8");
  const declaration = source.match(/export const HCP_EFFECT_KINDS = \[([^\]]*)\] as const/);
  assert.ok(declaration, "hcp/types.ts no longer declares `export const HCP_EFFECT_KINDS = [...] as const`");
  const kinds = [...declaration[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(kinds.length > 0, "the HCP_EFFECT_KINDS declaration lists no kinds");
  return kinds;
}

/** Every vector's number, computed here, against the vector's own. */
function vectorsHold(cases) {
  return cases.every(({ threadId, clientVid, number }) => hcpMatchNumber(threadId, clientVid) === number);
}

const first = vectors.cases[0];
const CLIENT = first.clientVid;
const UUID = first.threadId.slice("urn:uuid:".length);
const BASE = "https://link.trustoverip.org/t#";
const LINK = `${BASE}_from=${CLIENT}&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`;

// The match number

test("every match-number vector gives its number here", () => {
  for (const { threadId, clientVid, number } of vectors.cases) {
    assert.equal(hcpMatchNumber(threadId, clientVid), number, `${threadId} ${clientVid}`);
  }
  assert.equal(vectors.cases.length, 5);
});

test("the rung's vectors are Keyring's vectors file, member for member", () => {
  assert.deepEqual(vectors, keyringVectors());
});

test("control: one changed vector does not hold, and is not Keyring's", () => {
  const changed = structuredClone(vectors);
  changed.cases[2].number = changed.cases[2].number === "0000" ? "0001" : "0000";
  assert.equal(vectorsHold(changed.cases), false);
  assert.notDeepEqual(changed, keyringVectors());
  assert.equal(vectorsHold(vectors.cases), true);
});

// The connect link

test("the link of the vectors' first case is 166 bytes and reads back to its parts", () => {
  const link = hcpConnectLink({ clientVid: CLIENT, uuid: UUID });
  assert.equal(link, LINK);
  assert.equal(bytes(link), 166);
  assert.ok(bytes(link) <= HCP_LINK_MAX_BYTES);
  assert.deepEqual(readHcpConnectLink(link), { clientVid: CLIENT, uuid: UUID, threadId: first.threadId });
});

test("every vector's link round-trips", () => {
  for (const { threadId, clientVid } of vectors.cases) {
    const uuid = threadId.slice("urn:uuid:".length);
    assert.deepEqual(readHcpConnectLink(hcpConnectLink({ clientVid, uuid })), { clientVid, uuid, threadId });
  }
});

test("the link is read with the absolute _type, the members in any order, and percent-encoded values", () => {
  const parts = { clientVid: CLIENT, uuid: UUID, threadId: first.threadId };
  const absolute = "https://link.trustoverip.org/vti/flow/hcp-connect/0.1";
  assert.deepEqual(readHcpConnectLink(`${BASE}_from=${CLIENT}&_id=${UUID}&_type=${absolute}`), parts);
  assert.deepEqual(readHcpConnectLink(`${BASE}_type=/vti/flow/hcp-connect/0.1&_id=${UUID}&_from=${CLIENT}`), parts);
  assert.deepEqual(
    readHcpConnectLink(`${BASE}_from=${CLIENT.replace(/:/g, "%3A")}&_id=${UUID}&_type=%2Fvti%2Fflow%2Fhcp-connect%2F0.1`),
    parts,
  );
});

const ok = `_from=${CLIENT}&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`;
const refusals = [
  ["another host", `https://link.example.org/t#${ok}`],
  ["another scheme", `http://link.trustoverip.org/t#${ok}`],
  ["another path", `https://link.trustoverip.org/c#${ok}`],
  ["a query instead of a fragment", `https://link.trustoverip.org/t?${ok}`],
  ["a missing _from", `${BASE}_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`],
  ["a missing _id", `${BASE}_from=${CLIENT}&_type=/vti/flow/hcp-connect/0.1`],
  ["a missing _type", `${BASE}_from=${CLIENT}&_id=${UUID}`],
  ["_id twice", `${BASE}${ok}&_id=${UUID}`],
  ["_from twice", `${BASE}_from=${CLIENT}&${ok}`],
  ["_type twice", `${BASE}${ok}&_type=/vti/flow/hcp-connect/0.1`],
  ["an empty member", `${BASE}${ok}&`],
  ["a member without a value", `${BASE}${ok}&_x`],
  ["another flow", `${BASE}_from=${CLIENT}&_id=${UUID}&_type=/vti/flow/agent-connect/0.1`],
  [
    "a did:key that is not Ed25519",
    `${BASE}_from=did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`,
  ],
  ["a did:web", `${BASE}_from=did:web:example.org&_id=${UUID}&_type=/vti/flow/hcp-connect/0.1`],
  ["an upper-case UUID", `${BASE}_from=${CLIENT}&_id=${UUID.toUpperCase()}&_type=/vti/flow/hcp-connect/0.1`],
  ["a v1 UUID", `${BASE}_from=${CLIENT}&_id=7c2a9e41-5b3d-1f6a-8e1c-0a9b8d7c6e51&_type=/vti/flow/hcp-connect/0.1`],
  ["a urn:uuid _id", `${BASE}_from=${CLIENT}&_id=urn:uuid:${UUID}&_type=/vti/flow/hcp-connect/0.1`],
  ["a malformed percent-escape", `${BASE}${ok}`.replace("_id=", "_id=%E0%A4%A")],
];

for (const [name, link] of refusals) {
  test(`the link is refused: ${name}`, () => {
    assert.equal(readHcpConnectLink(link), undefined);
  });
}

test("the length limit is on bytes: 250 is read, 252 is refused, the parts being the same", () => {
  const type = "https://link.trustoverip.org/vti/flow/hcp-connect/0.1";
  // Each escaped character adds two bytes; the absolute form is 194 bytes, so 28 escapes make 250 and 29 make 252.
  const padded = (n) =>
    `${BASE}_from=${CLIENT}&_id=${UUID}&_type=${[...type.slice(0, n)].map((c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`).join("")}${type.slice(n)}`;
  assert.equal(bytes(padded(0)), 194);
  assert.equal(bytes(padded(28)), 250);
  assert.deepEqual(readHcpConnectLink(padded(28)), { clientVid: CLIENT, uuid: UUID, threadId: first.threadId });
  assert.equal(bytes(padded(29)), 252);
  assert.equal(readHcpConnectLink(padded(29)), undefined);
});

test("the writer refuses what the reader would refuse", () => {
  assert.throws(() => hcpConnectLink({ clientVid: "did:web:example.org", uuid: UUID }));
  assert.throws(() => hcpConnectLink({ clientVid: CLIENT, uuid: UUID.toUpperCase() }));
});

test("control: one extra link member makes the link unreadable", () => {
  assert.ok(readHcpConnectLink(LINK));
  assert.equal(readHcpConnectLink(`${LINK}&_vta=did:web:example.org`), undefined);
});

// The consent request

test("the five effect kinds are Keyring's HCP_EFFECT_KINDS, in order", () => {
  assert.deepEqual(HCP_EFFECT_KINDS, keyringEffectKinds());
  assert.deepEqual(
    hcpConsentRequest(RECORD_INPUTS).effects.map((e) => e.kind),
    keyringEffectKinds(),
  );
});

test("control: one reordered kind is not Keyring's", () => {
  const reordered = [...HCP_EFFECT_KINDS];
  [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
  assert.notDeepEqual(reordered, keyringEffectKinds());
});

test("the consent fixture is what hcpConsentRequest gives for its inputs", () => {
  assert.deepEqual(consentFixture, recordFixture());
  assert.deepEqual(consentFixture.payload, hcpConsentRequest(consentFixture.inputs));
});

test("the consent request carries the task type, the requester, the framework members and a 5-minute expiry", () => {
  const payload = hcpConsentRequest(RECORD_INPUTS);
  assert.equal(payload.taskType, HCP_GRANTS_REQUEST);
  assert.equal(payload.requester, RECORD_INPUTS.clientVid);
  assert.equal(payload.sideEffects, "mutating");
  assert.deepEqual(payload.exposure, { discloses: "secret", actsAsSubject: false });
  assert.equal(payload.approverSet, "owner");
  assert.equal(payload.minApprovals, 1);
  assert.equal(payload.excludeRequester, true);
  assert.equal(payload.expiresAt, "2026-11-27T10:05:00.000Z");
  assert.deepEqual(
    payload.effects.map((e) => e.summary),
    [
      "Run by Example Labs.",
      "It can read general preferences to tailor its answers.",
      "It can keep what it reads for up to 10 minutes after reading it.",
      "For 4 hours from when you approve.",
      "Approving gives access. It is not signing in.",
    ],
  );
  assert.deepEqual(payload.effects[0].detail, {
    clientVid: RECORD_INPUTS.clientVid,
    clientName: "hcp-cli",
    operator: { id: "did:web:labs.example", name: "Example Labs" },
    threadId: RECORD_INPUTS.threadId,
    grantId: RECORD_INPUTS.grantId,
  });
  assert.deepEqual(payload.effects[3].detail, { grantType: "temporary", expiresInSeconds: 14400 });
  assert.deepEqual(payload.effects[4].detail, {});
});

test("the consent request's thread and client are the link's and the number's", () => {
  const link = readHcpConnectLink(hcpConnectLink({ clientVid: CLIENT, uuid: UUID }));
  const detail = hcpConsentRequest(RECORD_INPUTS).effects[0].detail;
  assert.equal(detail.threadId, link.threadId);
  assert.equal(detail.clientVid, link.clientVid);
  assert.equal(hcpMatchNumber(detail.threadId, detail.clientVid), first.number);
});

test("the access summary lists several categories and purposes, and one minute is singular", () => {
  const payload = hcpConsentRequest({
    ...RECORD_INPUTS,
    access: [
      {
        actions: ["read"],
        categories: ["general_preferences", "dietary_needs", "language"],
        purposes: [
          { code: "personalization", description: "tailor its answers" },
          { code: "assist", description: "plan meals" },
        ],
      },
    ],
    maxUseSeconds: 60,
  });
  assert.equal(
    payload.effects[1].summary,
    "It can read general preferences, dietary needs and language to tailor its answers and plan meals.",
  );
  assert.equal(payload.effects[2].summary, "It can keep what it reads for up to 1 minute after reading it.");
});

test("the consent request refuses inputs it cannot describe", () => {
  assert.throws(() => hcpConsentRequest({ ...RECORD_INPUTS, maxUseSeconds: 90 }));
  assert.throws(() => hcpConsentRequest({ ...RECORD_INPUTS, threadId: "7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51" }));
  assert.throws(() => hcpConsentRequest({ ...RECORD_INPUTS, access: [] }));
  assert.throws(() => hcpConsentRequest({ ...RECORD_INPUTS, heldAt: "not a time" }));
});
