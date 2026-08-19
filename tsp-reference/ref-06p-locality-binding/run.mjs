// ref-06p — the locality binding and evidence algebra, with no radios.
//
// The witnessed exchange (ref-06w4, ref-06x) proves a witness can attest that
// it ran a ceremony. This rung proves the machinery by which that witness can
// also attest WHERE it ran: a co-presence observation the witness makes itself,
// bound to the session so tightly that it cannot be moved, copied, replayed, or
// claimed by a party that did not earn it.
//
// Design under test: docs/plans/locality-plan.md §5–§7. Two values with two
// jobs — the advertised rendezvous EID LOCATES a device, the signed GATT
// transcript BINDS it — which is the same locator/binder split ref-06w3 forced
// at the document layer, applied one layer down at the radio.
//
// No radios here on purpose. Radios are ref-06p2 (real BLE, measured RTT) and
// ref-06p4 (a staged relay, measured detection threshold). What is provable
// without hardware is the algebra, and the algebra is where forgeries live.
//
// Run: npm install && npm start   (npm run check for quiet)
//      node run.mjs --freeze      to re-cut the frozen fixtures

import { deepStrictEqual, notDeepStrictEqual, ok } from "node:assert";
import {
  createHash, createPrivateKey, createPublicKey, hkdfSync,
  sign as edSign, verify as edVerify,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { consumeInbound, respondWith, StaticTransport } from "@openvtc/trust-tasks";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as session from "@openvtc/trust-tasks/witness/session/0.1/payload";
import * as submit from "@openvtc/trust-tasks/witness/session/submit/0.1/payload";
import jsonldModule from "jsonld";

const jsonld = jsonldModule.default ?? jsonldModule;
const QUIET = process.argv.includes("--quiet");
const FREEZE = process.argv.includes("--freeze");
const log = (...a) => QUIET || console.log(...a);

let checks = 0, failures = 0;
function check(name, fn) {
  try { fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---------------------------------------------------------------- primitives

// RFC 8785 JCS, the corpus's shared helper (identical to ref-06w3/06w4).
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
// SPEC.md §4.9.3: digest over the JCS form with the top-level proof removed.
function taskDigest(doc) {
  const { proof, ...unproofed } = doc;
  return "z" + base58btc(Buffer.concat([Buffer.from([0x12, 0x20]),
    createHash("sha256").update(Buffer.from(jcs(unproofed), "utf8")).digest()]));
}
const digestMultibase = (v) =>
  "z" + base58btc(Buffer.concat([Buffer.from([0x12, 0x20]),
    createHash("sha256").update(Buffer.from(jcs(v), "utf8")).digest()]));

// Deterministic Ed25519 from a seed, so signatures are freezable fixtures.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function keyFromSeed(hexSeed) {
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hexSeed, "hex")]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey, publicKey, keyId: "z" + base58btc(Buffer.concat([Buffer.from([0xed, 0x01]), raw])) };
}
const sign = (key, bytes) => edSign(null, Buffer.from(bytes, "utf8"), key.privateKey).toString("base64url");
const verify = (key, bytes, sig) =>
  edVerify(null, Buffer.from(bytes, "utf8"), key.publicKey, Buffer.from(sig, "base64url"));

// ------------------------------------------------------------- the namespace

// Reverse DNS of atl.seas.harvard.edu — the Applied Technology Lab at Harvard
// SEAS, the party that controls the semantics under it (plan §6).
const NS = "edu.harvard.seas.atl.keyring";
// The framework's own grammar for an ext immediate key (SPEC.md §4.5.1).
const EXT_KEY_GRAMMAR = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

// --------------------------------------------------------------- the fixtures

const FIXTURES = join(import.meta.dirname, "fixtures");
function frozen(name, computed) {
  const path = join(FIXTURES, name);
  if (FREEZE || !existsSync(path)) {
    writeFileSync(path, JSON.stringify(computed, null, 2) + "\n");
    return computed;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// ------------------------------------------------------------------ the cast

const DID = {
  alice: "did:peer:4alice", bob: "did:peer:4bob", wendy: "did:peer:4wendy",
  mallory: "did:peer:4mallory",
};
const REL = { alice: "did:peer:alice-rel", bob: "did:peer:bob-rel" };
// The witness is its own sensor in phase 1 (plan §4.2, §5.6) — but the
// observation names a sensor DID from the first implementation, so a second
// sensor is a deployment change and not a schema change.
const SENSOR_DID = DID.wendy;
const VENUE = "Applied Technology Lab, Cambridge MA — Room 2";

// alice's hardware-attestation key: the SAME Secure Enclave / StrongBox key
// that signs her VRC evidence today (plan §5.3). Signing the radio challenge
// with it is what upgrades "a device was in range" to "THIS credential's
// device was in range".
const aliceHw = keyFromSeed("11".repeat(32));
const bobHw = keyFromSeed("22".repeat(32));
const malloryHw = keyFromSeed("ee".repeat(32));

const NOW = "2026-08-18T15:04:05Z";
const BINDING_URI = "https://trusttasks.org/binding/didcomm-v1/0.2";
const STUB_PROOF = {
  type: "DataIntegrityProof",
  cryptosuite: "eddsa-jcs-2022",   // the TASK-layer suite (plan §6.1)
  verificationMethod: "did:example:stub#key-1",
  created: NOW,
  proofPurpose: "assertionMethod",
  proofValue: "z3StubProofValueForPipelineShapeOnly",
};

log("ref-06p — the locality binding, no radios\n");
log(`package version: ${JSON.parse(readFileSync(join(import.meta.dirname, "node_modules/@openvtc/trust-tasks/package.json"))).version}`);
log(`ext namespace:   ${NS}`);

// =========================================================== act 0: sessions
// Two bilateral sessions, one per party, as witness/session 0.1 requires —
// and therefore TWO challenges, because the spec forbids reusing one across
// the sessions of a single witnessed exchange.

const EXCHANGE_THREAD = "aaaa1111-1111-4111-8111-111111111111";
function sessionDoc(id, issuer) {
  return {
    id, type: session.TYPE_URI, threadId: id, parentThreadId: EXCHANGE_THREAD,
    issuer, recipient: DID.wendy, issuedAt: NOW,
    payload: {
      parties: [REL.alice, REL.bob],
      ext: { [NS]: { locality: { offered: true, methods: ["ble-challenge-response/0.1"] } } },
    },
  };
}
const sessionA = sessionDoc("bbbb2222-2222-4222-8222-222222222222", DID.alice);
const sessionB = sessionDoc("cccc3333-3333-4333-8333-333333333333", DID.bob);
const CHALLENGE = {
  A: "9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  B: "0e1d2c3b4a59687776859403f2e1d0c9b8a7968554433221100ffeeddccbbaa9",
};
const DOMAIN = "witness.atl.seas.harvard.edu";

// ======================================================= act 1: the rendezvous
log("\n— act 1: the rendezvous EID — it LOCATES, it does not prove —");

const EID_SALT = "keyring-locality-eid-v1";
const EID_BYTES = 12;
const UUID_PREFIX = "4b524c31"; // "KRL1" — leaves 12 bytes of EID in a 128-bit UUID
function deriveEid(challenge, sessionTaskDigest) {
  return Buffer.from(hkdfSync("sha256",
    Buffer.from(challenge, "utf8"),        // ikm: the witness's per-session challenge
    Buffer.from(EID_SALT, "utf8"),         // salt: domain separation
    Buffer.from(sessionTaskDigest, "utf8"), // info: §4.9.3 digest of the session doc
    EID_BYTES)).toString("hex");
}
function serviceUuid(eidHex) {
  const h = UUID_PREFIX + eidHex;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const digestA = taskDigest(sessionA), digestB = taskDigest(sessionB);
const eidA = deriveEid(CHALLENGE.A, digestA), eidB = deriveEid(CHALLENGE.B, digestB);

const eidVectors = frozen("eid-vectors.json", {
  note: "Frozen inputs → expected EIDs. HKDF-SHA256(ikm=challenge, salt=EID_SALT, info=taskDigest(sessionDoc), L=12).",
  salt: EID_SALT, prefix: UUID_PREFIX,
  sessions: {
    A: { challenge: CHALLENGE.A, taskDigest: digestA, eid: eidA, serviceUuid: serviceUuid(eidA) },
    B: { challenge: CHALLENGE.B, taskDigest: digestB, eid: eidB, serviceUuid: serviceUuid(eidB) },
  },
});

check("EID derivation is deterministic — matches the frozen vector", () => {
  deepStrictEqual(eidA, eidVectors.sessions.A.eid);
  deepStrictEqual(digestA, eidVectors.sessions.A.taskDigest);
});
check("the two sessions of one exchange derive DIFFERENT EIDs (distinct challenges, per witness/session 0.1)", () =>
  notDeepStrictEqual(eidA, eidB));
check("a party without the challenge cannot compute the EID — only witness + that one party can", () =>
  notDeepStrictEqual(deriveEid("f".repeat(64), digestA), eidA));
check("the EID rides the one advert field iOS lets an app control: a 128-bit service UUID", () => {
  const uuid = serviceUuid(eidA);
  ok(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(uuid), `not a UUID: ${uuid}`);
  deepStrictEqual(uuid.replace(/-/g, "").length, 32);
  ok(uuid.startsWith("4b524c31"), "the scan prefix must survive formatting");
});

// ========================================================= act 2: the binder
log("\n— act 2: the GATT transcript — this is the part that binds —");

// The sensor mints this on the radio link. It never travels the task channel,
// which is what stops a session claiming an observation it did not earn.
const NONCE = { A: "5a6b7c8d9e0f1a2b3c4d5e6f70819200", B: "0192837465afbecd0192837465afbecd" };

function bindingFor({ taskDigestMultibase, challenge, sensorNonce, sensorDid }) {
  return jcs({ context: "keyring-locality-v1", taskDigestMultibase, challenge, sensorNonce, sensorDid });
}
function makeTranscript(hwKey, { taskDigestMultibase, challenge, sensorNonce, sensorDid }) {
  const bytes = bindingFor({ taskDigestMultibase, challenge, sensorNonce, sensorDid });
  return {
    method: "ble-challenge-response/0.1",
    taskDigestMultibase, challenge, sensorNonce, sensorDid,
    keyId: hwKey.keyId,
    signature: sign(hwKey, bytes),
    hardwareAttestation: "verified",   // absent | present-unverified | verified
  };
}
// The sensor's verification. Every rejection below names the check that fired.
function verifyTranscript(t, expected, keyLookup) {
  if (t.taskDigestMultibase !== expected.taskDigestMultibase) return { ok: false, reason: "taskDigestMismatch" };
  if (t.challenge !== expected.challenge) return { ok: false, reason: "challengeMismatch" };
  if (t.sensorNonce !== expected.sensorNonce) return { ok: false, reason: "sensorNonceMismatch" };
  if (t.sensorDid !== expected.sensorDid) return { ok: false, reason: "sensorMismatch" };
  const key = keyLookup(t.keyId);
  if (!key) return { ok: false, reason: "unknownKey" };
  if (!verify(key, bindingFor(t), t.signature)) return { ok: false, reason: "signatureInvalid" };
  return { ok: true };
}

const expectedA = {
  taskDigestMultibase: digestA, challenge: CHALLENGE.A,
  sensorNonce: NONCE.A, sensorDid: SENSOR_DID,
};
const expectedB = {
  taskDigestMultibase: digestB, challenge: CHALLENGE.B,
  sensorNonce: NONCE.B, sensorDid: SENSOR_DID,
};
const transcriptA = makeTranscript(aliceHw, expectedA);
const transcriptB = makeTranscript(bobHw, expectedB);

// Keys the sensor can resolve: the parties'. Mallory's is a stranger.
const KEYS = { [aliceHw.keyId]: aliceHw, [bobHw.keyId]: bobHw };
const lookup = (id) => KEYS[id];

const frozenTranscript = frozen("transcript-a.json", transcriptA);
check("the honest transcript verifies at the sensor", () =>
  deepStrictEqual(verifyTranscript(transcriptA, expectedA, lookup), { ok: true }));
check("Ed25519 over the JCS binding is reproducible — matches the frozen transcript byte for byte", () =>
  deepStrictEqual(transcriptA, frozenTranscript));
check("the transcript covers the session digest AND the challenge — mutating either breaks the signature", () => {
  for (const field of ["taskDigestMultibase", "challenge"]) {
    const tampered = { ...transcriptA, [field]: field === "challenge" ? CHALLENGE.B : digestB };
    ok(!verify(aliceHw, bindingFor(tampered), tampered.signature), `${field} is not covered`);
  }
});

// ======================================================== act 3: the forgeries
log("\n— act 3: four forgeries, each rejected by a named check —");

check("A · replay across sessions — alice's session-A transcript submitted into session B", () => {
  const r = verifyTranscript(transcriptA, expectedB, lookup);
  deepStrictEqual(r, { ok: false, reason: "taskDigestMismatch" });
});
check("B · EID copy — a passive listener rebroadcasts the advert but cannot answer the GATT challenge", () => {
  // Mallory heard the advert, so she knows the EID. She cannot produce a
  // signature over the sensor's nonce under a key the sensor will resolve.
  const copied = makeTranscript(malloryHw, expectedA);
  deepStrictEqual(verifyTranscript(copied, expectedA, lookup), { ok: false, reason: "unknownKey" });
  // ...and even if her key were resolvable, it is not the credential's signer.
  const withStolenKeyId = { ...copied, keyId: aliceHw.keyId };
  deepStrictEqual(verifyTranscript(withStolenKeyId, expectedA, lookup), { ok: false, reason: "signatureInvalid" });
});
check("C · counterfeit session document reusing a genuine id — ref-06w3's forgery, one layer down", () => {
  const counterfeit = { ...sessionA, payload: { ...sessionA.payload, parties: [REL.alice, DID.mallory] } };
  deepStrictEqual(counterfeit.id, sessionA.id, "the forgery reuses the id — that is the point");
  notDeepStrictEqual(taskDigest(counterfeit), digestA);
  // The transcript pairs with the genuine document only.
  const r = verifyTranscript(transcriptA, { ...expectedA, taskDigestMultibase: taskDigest(counterfeit) }, lookup);
  deepStrictEqual(r, { ok: false, reason: "taskDigestMismatch" });
});
check("D · transcript lifted from another exchange — bob's, presented as alice's", () =>
  deepStrictEqual(verifyTranscript(transcriptB, expectedA, lookup), { ok: false, reason: "taskDigestMismatch" }));
check("the witness cross-checks the SUBMITTED transcript against what its own sensor recorded", () => {
  // Task → physical binding: a session cannot claim an observation it did not earn.
  const claimed = { ...transcriptA, sensorNonce: "00".repeat(16) };
  deepStrictEqual(verifyTranscript(claimed, expectedA, lookup), { ok: false, reason: "sensorNonceMismatch" });
});

// ====================================================== act 4: through the wire
log("\n— act 4: the ext payloads through the published §7.2 pipeline —");

const ajv = new Ajv2020({ strict: false });
const VALIDATOR = {
  validate(schema, payload) {
    const valid = ajv.validate(schema, payload);
    return valid ? true : { ok: false, errors: (ajv.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
  },
};
let errSeq = 0;
async function consume(myVid, senderVid, spec, doc, handler = (d) => d) {
  return consumeInbound({
    transport: new StaticTransport({ issuer: senderVid, recipient: myVid }, BINDING_URI),
    spec, proofPolicy: { kind: "acceptUnverified" },
    payloadPolicy: { kind: "validate", validate: VALIDATOR },
    doc, myVid, now: Date.parse(NOW), newErrorId: () => `err-${++errSeq}`, handler,
  });
}

// 1 · witness/session — the party offers locality.
const sessionExtBefore = jcs(sessionA.payload.ext);
let sessionResponse;
await checkAsync("witness/session carrying the locality offer is accepted by the pipeline", async () => {
  const outcome = await consume(DID.wendy, DID.alice, session.SPEC, sessionA, (doc) =>
    respondWith(doc, "dddd4444-4444-4444-8444-444444444444", {
      challenge: CHALLENGE.A, domain: DOMAIN,
      // 2 · the sensor directive rides the response.
      ext: { [NS]: { locality: {
        policy: "offered",                 // off | offered | required (plan §8.2)
        method: "ble-challenge-response/0.1",
        sensorDid: SENSOR_DID,
        serviceUuidPrefix: UUID_PREFIX,
        eidSalt: EID_SALT, eidBytes: EID_BYTES,
        windowSeconds: 120,
      } } },
    }, () => NOW));
  deepStrictEqual(outcome.kind, "handled");
  sessionResponse = outcome.response;
  sessionResponse.proof = STUB_PROOF;
});
check("ext survives the pipeline byte-identically — it is payload, not decoration", () =>
  deepStrictEqual(jcs(sessionA.payload.ext), sessionExtBefore));

// 3 · witness/session/submit — the device's half of the transcript.
const submitDoc = {
  id: "eeee5555-5555-4555-8555-555555555555", type: submit.TYPE_URI,
  threadId: sessionA.id, parentThreadId: EXCHANGE_THREAD,
  issuer: DID.alice, recipient: DID.wendy, issuedAt: NOW,
  payload: {
    vp: { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"] },
    ext: { [NS]: { locality: { transcript: transcriptA } } },
  },
  proof: STUB_PROOF,
};

// The witness's own observation record — the artifact the VWC summarizes.
const observation = {
  method: "ble-challenge-response/0.1",
  sensorDid: SENSOR_DID, venueClaim: VENUE,
  observedAt: NOW, windowSeconds: 120,
  confirmed: true,
  deviceKeyId: aliceHw.keyId,
  transcriptDigestMultibase: digestMultibase(transcriptA),
  corroboration: { rttMs: 62, rssiDbm: -58, rttBoundMs: 400 },
  residuals: ["rf-relay", "venue-scale-range"],
};

let submitResponse;
await checkAsync("witness/session/submit carrying the transcript is accepted, and the #response carries the observation", async () => {
  const outcome = await consume(DID.wendy, DID.alice, submit.SPEC, submitDoc, (doc) => {
    const t = doc.payload.ext[NS].locality.transcript;
    const v = verifyTranscript(t, expectedA, lookup);
    ok(v.ok, `witness rejected an honest transcript: ${v.reason}`);
    return respondWith(doc, "ffff6666-0000-4000-8000-00000000000f", {
      vwc: { type: ["VerifiableCredential", "DTGCredential", "WitnessCredential"] },
      vwcDigestMultibase: digestMultibase({ stub: "vwc" }),
      ext: { [NS]: { locality: { observation } } },
    }, () => NOW);
  });
  deepStrictEqual(outcome.kind, "handled");
  submitResponse = outcome.response;
  submitResponse.proof = STUB_PROOF;
});

await checkAsync("a peer that does not recognize the namespace still accepts the document (SPEC.md §7.2 — MUST ignore)", async () => {
  const blind = await consume(DID.wendy, DID.alice, session.SPEC, sessionA, (doc) => {
    // A locality-blind witness reads only what it knows and answers normally.
    ok(doc.payload.parties.length === 2);
    return respondWith(doc, "dddd4444-0000-4000-8000-00000000000d",
      { challenge: CHALLENGE.A, domain: DOMAIN }, () => NOW);
  });
  deepStrictEqual(blind.kind, "handled");
  ok(blind.response.payload.ext === undefined, "a blind peer must not echo an ext it does not understand");
});
check("the namespace satisfies the framework's reverse-DNS grammar for an ext immediate key", () => {
  ok(EXT_KEY_GRAMMAR.test(NS), `${NS} is not a conforming ext key`);
  ok(!EXT_KEY_GRAMMAR.test("keyring"), "a bare key must be non-conforming — the grammar is the point");
});

// ==================================================== act 5: the VWC assertion
log("\n— act 5: the assertion in the credential — typed, with explicit negatives —");

// The SUMMARY, not the transcript. Three rules, all of them about bbs-2023
// selective disclosure (plan §7.1):
//
//  1. FLAT. BBS+ discloses at the level of RDF quads; a nested object is a
//     blank node whose path must be revealed to disclose anything under it.
//     So: no objects inside the assertion. Members sit directly in
//     witnessContext, prefixed `locality*` — which is also REQUIRED, not
//     stylistic: cred-spec already defines `witnessContext.method`, and an
//     unprefixed locality `method` would collide with it.
//  2. TIERED, so the common show is the private one — tier 1 alone is a
//     complete claim ("a witness says co-present, BLE tier") with no venue,
//     no time, no key.
//  3. PREDICATES, NOT IDENTIFIERS. `localityKeyMatchesCredentialSigner` says
//     the relation the witness verified in-session; the key id itself stays on
//     the artifact side, because a stable key id across ceremonies is a
//     correlation vector (plan §9.1).
function assertionFrom(obs, keyMatchesCredentialSigner) {
  return {
    // tier 1 — disclosed in almost every show
    localityConfirmed: obs.confirmed,
    localityMethod: obs.method,
    // tier 2 — disclosed when the verifier needs venue/time
    localityTopology: "witness-anchored",   // A-near-W and B-near-W; NOT A-near-B
    localitySensor: obs.sensorDid,
    localityVenue: obs.venueClaim,
    localityObservedAt: obs.observedAt,
    localityWindowSeconds: obs.windowSeconds,
    localityKeyMatchesCredentialSigner: keyMatchesCredentialSigner,
    localityHardwareAttestation: "verified",
    // tier 3 — forensic; opens the artifact side
    localityEvidenceCommitment: obs.transcriptDigestMultibase,
    localityRttMs: obs.corroboration.rttMs,
    localityRssiDbm: obs.corroboration.rssiDbm,
    localityRttBoundMs: obs.corroboration.rttBoundMs,
  };
  // NOT carried: the device key id (identifier, tier-3 leak — artifact side
  // only) and `residuals` (a deterministic function of localityMethod; as a
  // disclosable @set it would let a holder reveal only the flattering half of
  // a threat list, which is worse than not carrying it).
}
const assertion = assertionFrom(observation, aliceHw.keyId === transcriptA.keyId);
// The disclosure tiers, named once so the checks below and the implementation
// agree on what a default show contains.
const TIER1 = ["localityConfirmed", "localityMethod"];
const TIER2 = ["localityTopology", "localitySensor", "localityVenue", "localityObservedAt",
  "localityWindowSeconds", "localityKeyMatchesCredentialSigner", "localityHardwareAttestation"];
const TIER3 = ["localityEvidenceCommitment", "localityRttMs", "localityRssiDbm", "localityRttBoundMs"];

check("the assertion agrees with the observation and with the transcript it summarizes", () => {
  deepStrictEqual(assertion.localityEvidenceCommitment, digestMultibase(submitDoc.payload.ext[NS].locality.transcript));
  deepStrictEqual(assertion.localitySensor, submitResponse.payload.ext[NS].locality.observation.sensorDid);
  deepStrictEqual(assertion.localityMethod, transcriptA.method);
});
check("the assertion is FLAT — no nested object survives, which is what makes members separately disclosable", () => {
  for (const [k, v] of Object.entries(assertion))
    ok(v === null || typeof v !== "object", `${k} is an object — bbs-2023 would need its blank-node path revealed`);
  deepStrictEqual(Object.keys(assertion).sort(), [...TIER1, ...TIER2, ...TIER3].sort());
});
check("the key that answered on the radio IS the credential's signer — asserted as a PREDICATE, with the id left behind", () => {
  ok(assertion.localityKeyMatchesCredentialSigner);
  ok(!JSON.stringify(assertion).includes(aliceHw.keyId), "a key id in the credential is a correlation vector across ceremonies");
  ok(submitDoc.payload.ext[NS].locality.transcript.keyId === aliceHw.keyId, "...it belongs on the artifact side, where it stays");
  const wrong = assertionFrom({ ...observation, deviceKeyId: bobHw.keyId }, bobHw.keyId === transcriptA.keyId);
  ok(!wrong.localityKeyMatchesCredentialSigner, "a foreign key must not read as the credential's signer");
});
check("a tier-1-only show is a complete claim — and discloses no venue, no time, no sensor, no corroboration", () => {
  const show = Object.fromEntries(TIER1.map((k) => [k, assertion[k]]));
  deepStrictEqual(show, { localityConfirmed: true, localityMethod: "ble-challenge-response/0.1" });
  for (const k of [...TIER2, ...TIER3]) ok(!(k in show), `${k} leaked into the default show`);
});
check("failure is EMITTED, not omitted — and absence of the member is a third, distinct state", () => {
  const failed = {
    localityConfirmed: false, localityMethod: "none", localityReason: "declinedByHolder",
    localityTopology: "witness-anchored", localitySensor: SENSOR_DID,
    localityVenue: VENUE, localityObservedAt: NOW,
  };
  deepStrictEqual(failed.localityConfirmed, false);
  ok("localityReason" in failed, "a negative without a reason is not evidence");
  // Three states a verifier must be able to tell apart.
  const states = [assertion, failed, undefined].map((a) =>
    a === undefined ? "witness-does-not-do-locality" : a.localityConfirmed ? "confirmed" : "attempted-and-failed");
  deepStrictEqual(new Set(states).size, 3);
});

// ============================================ act 6: which canonicalization?
log("\n— act 6: the credential is a proof set — the bbs-2023 half needs every term defined —");

// Trust Task documents are eddsa-jcs-2022 (RFC 8785 over the JSON), so ext is
// covered whole. The CREDENTIAL is signed as a PROOF SET (plan §6.1):
// eddsa-jcs-2022 for the offline path, and bbs-2023 as the selective-disclosure
// base — and bbs-2023 is RDF-canonicalized. So a member whose term is undefined
// never enters the dataset the SD proof is taken over.
//
// That is why this act is a REQUIREMENT and not a curiosity: locality's whole
// privacy story is member-level disclosure, which lives on the RDF half. An
// undefined term is not merely unsigned — it is undisclosable, because it is
// not there to disclose. The terms below are mandatory work, not conditional.
const BASE_CTX = {
  "@version": 1.1,
  witnessContext: "https://trustoverip.org/credentials/witnessed-exchange#witnessContext",
};
// What the implementation must ADD to witnessedExchangeContext.ts. This rung
// authors it, so the app and witness server can import one agreed list.
const XSD = "http://www.w3.org/2001/XMLSchema#";
const V = "https://trustoverip.org/credentials/witnessed-exchange#";
const LOCALITY_TERMS = {
  // tier 1
  localityConfirmed: { "@id": `${V}localityConfirmed`, "@type": `${XSD}boolean` },
  localityMethod: `${V}localityMethod`,
  // tier 2
  localityTopology: `${V}localityTopology`,
  localitySensor: { "@id": `${V}localitySensor`, "@type": "@id" },
  localityVenue: `${V}localityVenue`,
  localityObservedAt: { "@id": `${V}localityObservedAt`, "@type": `${XSD}dateTime` },
  localityWindowSeconds: { "@id": `${V}localityWindowSeconds`, "@type": `${XSD}integer` },
  localityKeyMatchesCredentialSigner: { "@id": `${V}localityKeyMatchesCredentialSigner`, "@type": `${XSD}boolean` },
  localityHardwareAttestation: `${V}localityHardwareAttestation`,
  // tier 3
  localityEvidenceCommitment: `${V}localityEvidenceCommitment`,
  localityRttMs: { "@id": `${V}localityRttMs`, "@type": `${XSD}integer` },
  localityRssiDbm: { "@id": `${V}localityRssiDbm`, "@type": `${XSD}integer` },
  localityRttBoundMs: { "@id": `${V}localityRttBoundMs`, "@type": `${XSD}integer` },
  // failure path
  localityReason: `${V}localityReason`,
};frozen("locality-context-terms.json", {
  note: "The JSON-LD terms witnessedExchangeContext.ts must define so the locality assertion is covered by — and selectively disclosable from — the credential's bbs-2023 proof. Mandatory, not conditional: an undefined term is not merely unsigned, it is undisclosable. Authored here; app and witness-server import one agreed list or canonicalization diverges between signer and verifier.",
  terms: LOCALITY_TERMS,
});

// Flat inside witnessContext — one level, no object under it (plan §7.1).
const vwcShape = (ctx) => ({
  "@context": ctx,
  "@id": "urn:uuid:11111111-2222-4333-8444-555555555555",
  witnessContext: { ...assertion },
});
const nquads = async (doc, opts = {}) =>
  jsonld.canonize(doc, { algorithm: "URDNA2015", format: "application/n-quads", ...opts });

let quadsWithout, quadsWith;
await checkAsync("WITHOUT term definitions the assertion is not signed — safe mode REJECTS it, and unsafe mode drops it to zero quads", async () => {
  // Safe mode is what the DI signing path uses (witnessedExchangeContext.ts
  // says so in its own comment), and there an undefined term is fatal: the
  // credential cannot be signed at all.
  let threw = null;
  try { await nquads(vwcShape(BASE_CTX)); } catch (e) { threw = e; }
  ok(threw !== null, "safe mode must refuse to canonicalize a document with undefined terms");
  ok(/safe mode/i.test(String(threw.message)), `unexpected failure: ${threw.message}`);

  // With safe mode off — the silent half of the defect, and the one that would
  // ship: the members are in the JSON, absent from the dataset, unsigned.
  quadsWithout = await nquads(vwcShape(BASE_CTX), { safe: false });
  ok(!quadsWithout.includes("ble-challenge-response"),
    "an undefined term must not reach the canonical form");
  const localityQuads = quadsWithout.split("\n").filter((l) => l.includes(V) && !l.includes("#witnessContext"));
  deepStrictEqual(localityQuads.length, 0);
});
await checkAsync("WITH them it canonicalizes in safe mode, the members are in the dataset, and one mutated value changes the canonical form", async () => {
  const ctx = { ...BASE_CTX, ...LOCALITY_TERMS };
  quadsWith = await nquads(vwcShape(ctx));
  ok(quadsWith.includes("ble-challenge-response"), "the method must be in the signed dataset");
  ok(quadsWith.split("\n").length > quadsWithout.split("\n").length);
  const mutated = vwcShape(ctx);
  mutated.witnessContext.localityConfirmed = false;
  notDeepStrictEqual(await nquads(mutated), quadsWith);
});

await checkAsync("a tier-1-only derivation canonicalizes on its own — every member stands without its siblings", async () => {
  // What a bbs-2023 derived proof yields: some members, not all. If a tier-1
  // show could not canonicalize alone, the tiering in §7.1 would be fiction.
  const ctx = { ...BASE_CTX, ...LOCALITY_TERMS };
  const show = { "@context": ctx, "@id": "urn:uuid:11111111-2222-4333-8444-555555555555",
    witnessContext: Object.fromEntries(TIER1.map((k) => [k, assertion[k]])) };
  const q = await nquads(show);
  ok(q.includes("localityConfirmed") && q.includes("localityMethod"));
  ok(!q.includes("localityVenue") && !q.includes("localityObservedAt"),
    "a tier-1 show must not carry tier-2 quads");
  // ...and every quad in the show is also in the full credential's dataset.
  for (const line of q.split("\n").filter(Boolean))
    ok(quadsWith.includes(line.split(" ").slice(1).join(" ")), `tier-1 quad absent from the full set: ${line}`);
});

// ===================================================== act 7: what it costs
log("\n— act 7: the bytes —");

const bytes = (v) => Buffer.byteLength(jcs(v), "utf8");
const sizes = {
  transcriptInSubmitExt: bytes(submitDoc.payload.ext),
  observationInResponseExt: bytes(submitResponse.payload.ext),
  assertionInVwc: bytes(assertion),
  sensorDirectiveInSessionResponseExt: bytes(sessionResponse.payload.ext),
  totalAddedPerSession: bytes(submitDoc.payload.ext) + bytes(submitResponse.payload.ext)
    + bytes(assertion) + bytes(sessionResponse.payload.ext) + bytes(sessionA.payload.ext),
};
const frozenSizes = frozen("sizes.json", sizes);
check("the added evidence is measured, not estimated — and stable against the frozen figure", () =>
  deepStrictEqual(sizes, frozenSizes));
log(`\n  locality adds ${sizes.totalAddedPerSession} bytes per session ` +
    `(transcript ${sizes.transcriptInSubmitExt}, observation ${sizes.observationInResponseExt}, ` +
    `VWC assertion ${sizes.assertionInVwc}) — on top of ref-06w's 2,213-byte retained pair`);

// ------------------------------------------------------------------- verdict
log(`\n${failures === 0 ? "✅" : "❌"} ${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
