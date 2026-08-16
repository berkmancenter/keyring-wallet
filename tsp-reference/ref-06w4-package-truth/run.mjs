// ref-06w4 — the witnessed exchange, rebuilt on the PUBLISHED package.
//
// ref-06w proved the flow against OUR hand-authored draft specs, because the
// real ones did not exist upstream yet. They do now: #213 merged the four
// specifications (revised — bilateral sessions, receipt digest REQUIRED,
// witnessed answered on the response) and @openvtc/trust-tasks 0.7.0 ships
// their generated modules. This rung re-runs the exchange consuming ONLY the
// published package — the moment "our proposal" becomes "their spec, and we
// are a conforming consumer."
//
// It also verifies the #213 design calls behave as specified, probes the
// TS Payload-alias generator bug Glenn disclosed (fixed by #215 — confirmed),
// and — since 0.9.0 — verifies that #237 closed the schema-validation gap
// this rung originally found (#230): SPEC objects now carry payloadSchema,
// consumeInbound requires an explicit payloadPolicy, and REQUIRED members
// are enforced. The original gap checks are kept, inverted: what was
// accepted is now rejected.
//
// No Credo here: transport identity is stubbed (StaticTransport), because the
// carriage was proven separately (ref-06v1, v1b, v1d). This rung is about the
// task layer against the published artifact.

import { deepStrictEqual, ok } from "node:assert";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { consumeInbound, respondWith, StaticTransport } from "@openvtc/trust-tasks";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as propose from "@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload";
import * as issue from "@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload";
import * as session from "@openvtc/trust-tasks/witness/session/0.1/payload";
import * as submit from "@openvtc/trust-tasks/witness/session/submit/0.1/payload";

const QUIET = process.argv.includes("--quiet");
const log = (...a) => QUIET || console.log(...a);

let checks = 0, failures = 0;
function check(name, fn) {
  try { fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const NOW = () => "2026-08-15T12:00:00Z";
let errSeq = 0;
const newErrorId = () => `err-${++errSeq}`;
const BINDING_URI = "https://trusttasks.org/binding/didcomm-v1/0.2";

const STUB_PROOF = {
  type: "DataIntegrityProof",
  cryptosuite: "eddsa-jcs-2022",
  verificationMethod: "did:example:stub#key-1",
  created: NOW(),
  proofPurpose: "assertionMethod",
  proofValue: "z3StubProofValueForPipelineShapeOnly",
};

// DigestMultibase over JCS, as the specs require (same helper as ref-06w3).
function jcs(v) {
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58btc(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  return out;
}
const digestMultibase = (doc) =>
  "z" + base58btc(Buffer.concat([Buffer.from([0x12, 0x20]),
    createHash("sha256").update(Buffer.from(jcs(doc), "utf8")).digest()]));

// The cast: connection DIDs (transport identity), relationship DIDs (payload).
const DID = { alice: "did:peer:4alice", bob: "did:peer:4bob", wendy: "did:peer:4wendy" };
const REL = { alice: "did:peer:alice-rel", bob: "did:peer:bob-rel" };

// consume(at=myVid, from=senderVid, spec, doc, handler)
// (The undefined-handler crash this rung found in ≤0.7.0 was fixed by #237.)
const ajv = new Ajv2020({ strict: false });
const VALIDATOR = {
  validate(schema, payload) {
    const ok = ajv.validate(schema, payload);
    return ok ? true : { ok: false, errors: (ajv.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
  },
};

async function consume(myVid, senderVid, spec, doc, handler = (d) => d) {
  return consumeInbound({
    transport: new StaticTransport({ issuer: senderVid, recipient: myVid }, BINDING_URI),
    spec,
    proofPolicy: { kind: "acceptUnverified" },
    payloadPolicy: { kind: "validate", validate: VALIDATOR },
    doc,
    myVid,
    now: Date.parse(NOW()),
    newErrorId,
    handler,
  });
}

const T = {
  propose: propose.TYPE_URI, issue: issue.TYPE_URI,
  session: session.TYPE_URI, submit: submit.TYPE_URI,
};
log("ref-06w4 — the witnessed exchange on @openvtc/trust-tasks (published)\n");
log(`package version: ${JSON.parse(readFileSync("node_modules/@openvtc/trust-tasks/package.json")).version}`);

// ---- act 1: the relationship proposal (witnessed asked AND answered) -------
log("\n— act 1: vrc/relationships/propose — witnessed is answered on the response —");

const proposeDoc = {
  id: "aaaa1111-1111-4111-8111-111111111111",
  type: T.propose,
  threadId: "aaaa1111-1111-4111-8111-111111111111",
  issuer: DID.bob,
  recipient: DID.alice,
  issuedAt: NOW(),
  payload: { relationshipDid: REL.bob, witnessed: true },
};
let proposeResponse;
{
  const outcome = await consume(DID.alice, DID.bob, propose.SPEC, proposeDoc, (doc) =>
    respondWith(doc, "aaaa1111-0000-4000-8000-00000000000a",
      { accept: true, relationshipDid: REL.alice, witnessed: true }, NOW));
  check("alice consumes the propose and accepts", () => deepStrictEqual(outcome.kind, "handled"));
  proposeResponse = outcome.response;
  proposeResponse.proof = STUB_PROOF;
  const back = await consume(DID.bob, DID.alice, propose.RESPONSE_SPEC, proposeResponse);
  check("bob consumes the #response — witnessed: true is the counterparty's ANSWER (design call 3)", () => {
    deepStrictEqual(back.kind, "handled");
    deepStrictEqual(proposeResponse.payload.witnessed, true);
  });
}

// ---- act 2: TWO sessions, one witness, same parties pair (design call 1) ---
log("\n— act 2: bilateral witness sessions — one per party, distinct challenges —");

const PARTIES = [REL.alice, REL.bob];
async function openSession(partyDid, sessionId, challenge) {
  const doc = {
    id: sessionId, type: T.session, threadId: sessionId,
    parentThreadId: proposeDoc.id,
    issuer: partyDid,
    recipient: DID.wendy,
    issuedAt: NOW(),
    payload: { parties: PARTIES },
  };
  // NOTE: no proof on the request — witness/session declares request proof OPTIONAL.
  const outcome = await consume(DID.wendy, partyDid, session.SPEC, doc, (d) =>
    respondWith(d, sessionId.replace(/^..../, "cccc"), { challenge, domain: "wendy.example" }, NOW));
  const response = outcome.response;
  response.proof = STUB_PROOF; // response proof REQUIRED
  const atParty = await consume(partyDid, DID.wendy, session.RESPONSE_SPEC, response);
  return { doc, outcome, atParty, challenge };
}
const bobSession = await openSession(DID.bob, "bbbb2222-2222-4222-8222-222222222222", "nonce-for-bob-001");
const aliceSession = await openSession(DID.alice, "bbbb3333-3333-4333-8333-333333333333", "nonce-for-alice-001");

check("an UNPROOFED session request is accepted (request proof is OPTIONAL)", () =>
  deepStrictEqual(bobSession.outcome.kind, "handled"));
check("both parties' sessions handled — same parties pair, per the bilateral rule", () =>
  ok(bobSession.atParty.kind === "handled" && aliceSession.atParty.kind === "handled"));
check("the two sessions carry DISTINCT challenges (replay across sessions impossible)", () =>
  ok(bobSession.challenge !== aliceSession.challenge));

// ---- act 3: submit — request proof REQUIRED, response = vwc + digest -------
log("\n— act 3: witness/session/submit — the profile has teeth, the response binds —");

function makeSubmit(sessionDoc, id, extra = {}) {
  return {
    id, type: T.submit, threadId: sessionDoc.id, parentThreadId: proposeDoc.id,
    issuer: sessionDoc.issuer,
    recipient: DID.wendy,
    issuedAt: NOW(),
    payload: { vp: { holder: "stub", challengeBound: true } },
    ...extra,
  };
}
{
  const bare = makeSubmit(bobSession.doc, "dddd4444-4444-4444-8444-444444444401");
  const outcome = await consume(DID.wendy, DID.bob, submit.SPEC, bare, () => {
    throw new Error("handler must not run for an unproofed submit");
  });
  check("an UNPROOFED submit is rejected before the handler (request proof REQUIRED)", () => {
    deepStrictEqual(outcome.kind, "rejected");
    deepStrictEqual(outcome.error.payload.code, "proofRequired");
  });
}
let submitResponse;
{
  const proofed = makeSubmit(bobSession.doc, "dddd4444-4444-4444-8444-444444444402", { proof: STUB_PROOF });
  const vwc = {
    issuer: "did:web:wendy.example",
    taskContext: bobSession.doc.id,
    credentialSubject: { id: REL.bob, digestMultibase: "zStubVrcDigest1111111111" },
  };
  const outcome = await consume(DID.wendy, DID.bob, submit.SPEC, proofed, (d) =>
    respondWith(d, "eeee5555-5555-4555-8555-555555555555",
      { vwc, vwcDigestMultibase: digestMultibase(vwc) }, NOW));
  check("a proofed submit is handled", () => deepStrictEqual(outcome.kind, "handled"));
  submitResponse = outcome.response;

  // The receipt-shape rule, negatively: a response WITHOUT the digest must not validate.
  const stripped = structuredClone(submitResponse);
  delete stripped.payload.vwcDigestMultibase;
  stripped.proof = STUB_PROOF;
  const rejected = await consume(DID.bob, DID.wendy, submit.RESPONSE_SPEC, stripped);
  check("FIXED by #237 (was #230's finding): a response missing REQUIRED vwcDigestMultibase is now REJECTED", () =>
    deepStrictEqual(rejected.kind, "rejected"));

  submitResponse.proof = STUB_PROOF;
  const accepted = await consume(DID.bob, DID.wendy, submit.RESPONSE_SPEC, submitResponse);
  check("the full response (vwc + digest, proofed) is consumed by the party — Lever D as merged", () =>
    deepStrictEqual(accepted.kind, "handled"));
}

// ---- act 4: issue ×2 — the receipt names what was stored (design call 2) ---
log("\n— act 4: vrc/relationships/issue — the receipt digest is the correlator —");
{
  const vrc = { issuer: REL.bob, credentialSubject: { id: REL.alice }, proof: STUB_PROOF };
  const issueDoc = {
    id: "ffff6666-6666-4666-8666-666666666666", type: T.issue, threadId: proposeDoc.id,
    issuer: DID.bob,
    recipient: DID.alice,
    issuedAt: NOW(),
    payload: { vrc },
    proof: STUB_PROOF,
  };
  const outcome = await consume(DID.alice, DID.bob, issue.SPEC, issueDoc, (d) =>
    respondWith(d, "ffff6666-0000-4000-8000-00000000000f",
      { vrcDigestMultibase: digestMultibase(vrc) }, NOW));
  check("alice consumes the issue and receipts it", () => deepStrictEqual(outcome.kind, "handled"));

  const receipt = outcome.response;
  const strippedReceipt = structuredClone(receipt);
  delete strippedReceipt.payload.vrcDigestMultibase;
  strippedReceipt.proof = STUB_PROOF;
  const rejected = await consume(DID.bob, DID.alice, issue.RESPONSE_SPEC, strippedReceipt);
  check("FIXED by #237: a receipt missing REQUIRED vrcDigestMultibase is now REJECTED", () =>
    deepStrictEqual(rejected.kind, "rejected"));

  receipt.proof = STUB_PROOF;
  const accepted = await consume(DID.bob, DID.alice, issue.RESPONSE_SPEC, receipt);
  check("the digest-bearing receipt is consumed — the receiver-computed digest is the correlator", () =>
    deepStrictEqual(accepted.kind, "handled"));
}

// ---- act 4b: the schema-validation gap, closed (#230 → #237, 0.9.0) --------
log("\n— act 4b: the gap this rung found is CLOSED — §7.2 item 2 runs, and skipping must be stated —");
{
  const bogus = {
    id: "9999aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: T.propose,
    threadId: "9999aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    issuer: DID.bob, recipient: DID.alice, issuedAt: NOW(),
    payload: { wrongMember: true },
  };
  const outcome = await consume(DID.alice, DID.bob, propose.SPEC, bogus);
  check("FIXED by #237: a nonsense payload is rejected with malformedRequest", () => {
    deepStrictEqual(outcome.kind, "rejected");
    deepStrictEqual(outcome.error.payload.code, "malformedRequest");
  });
  // The "says so when it does not" half: omitting payloadPolicy is a hard error,
  // so a consumer can no longer skip §7.2 item 2 silently.
  let threw = null;
  try {
    await consumeInbound({
      transport: new StaticTransport({ issuer: DID.bob, recipient: DID.alice }, BINDING_URI),
      spec: propose.SPEC, proofPolicy: { kind: "acceptUnverified" },
      doc: bogus, myVid: DID.alice, now: Date.parse(NOW()), newErrorId, handler: (d) => d,
    });
  } catch (e) { threw = e; }
  check("omitting payloadPolicy throws — skipping validation must now be an explicit statement", () =>
    ok(threw !== null && /payloadPolicy/.test(String(threw))));
}

// ---- act 5: the generator-bug probe (Glenn's disclosure, #215's fix) -------
log("\n— act 5: the TS Payload-alias bug — status in the published artifact —");
{
  const bad = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "payload.d.ts" &&
        /export type Payload = (DigestMultibase|Ext)\b/.test(readFileSync(p, "utf8"))) bad.push(p);
    }
  };
  walk("node_modules/@openvtc/trust-tasks/dist");
  check("the Payload-alias bug (14 specs aliased to a shared $def type) is FIXED in this release", () =>
    deepStrictEqual(bad, []));
  check("our four modules export their real request payload aliases", () => {
    ok(/WitnessSessionPayload/.test(readFileSync("node_modules/@openvtc/trust-tasks/dist/witness/session/0.1/payload.d.ts", "utf8")));
    ok(/WitnessSessionSubmitPayload/.test(readFileSync("node_modules/@openvtc/trust-tasks/dist/witness/session/submit/0.1/payload.d.ts", "utf8")));
    ok(/VRCRelationshipsProposePayload/.test(readFileSync("node_modules/@openvtc/trust-tasks/dist/vrc/relationships/propose/0.1/payload.d.ts", "utf8")));
    ok(/VRCRelationshipsIssuePayload/.test(readFileSync("node_modules/@openvtc/trust-tasks/dist/vrc/relationships/issue/0.1/payload.d.ts", "utf8")));
  });
}

log(`\n${checks} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
