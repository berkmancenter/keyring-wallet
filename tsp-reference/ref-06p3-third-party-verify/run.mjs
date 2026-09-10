// ref-06p3 — the §7.3 third-party verification algorithm.
//
// ref-06p proved the binding algebra could be constructed and that forgeries
// could be rejected at the point they were made. This rung is the other
// side: a verifier, cold, handed only the four artifacts a holder presents
// (plan §3) — the VWC, the retained witness/session document, the retained
// submit#response, and (for the tier-3 check) the raw transcript — and
// nothing else. No shared state with whoever built the bundle. Does the
// algorithm §7.3 describes actually catch a tampered input at the step that
// should catch it, and pass a genuine one clean?
//
// Design under test: docs/plans/locality-plan.md §7.3 (the eight steps),
// §7.1 rule 3 (predicate vs. identifier — what step 6 costs to actually
// check), §9.2 (residuals, priced).
//
// Needs: nothing. No radios (that's ref-06p2), no relay (ref-06p4), no
// platform attestation roots (ref-06p5), no @openvtc/trust-tasks pipeline —
// this rung is standalone crypto over hand-built fixtures, the same
// primitives ref-06p uses, verified independently.
//
// Run: npm install && npm start   (npm run check for quiet)
//      node run.mjs --freeze      to re-cut the frozen fixtures

import { deepStrictEqual, ok } from "node:assert";
import {
  createHash, createPrivateKey, createPublicKey,
  sign as edSign, verify as edVerify,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const QUIET = process.argv.includes("--quiet");
const FREEZE = process.argv.includes("--freeze");
const log = (...a) => QUIET || console.log(...a);

let checks = 0, failures = 0;
function check(name, fn) {
  try { fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---------------------------------------------------------------- primitives
// Identical to ref-06p's — duplicated, not imported (rungs are
// self-contained). This rung's whole point is to be checkable with nothing
// but node:crypto and the artifacts a holder would actually present.

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
function digestMultibase(v) {
  return "z" + base58btc(Buffer.concat([Buffer.from([0x12, 0x20]),
    createHash("sha256").update(Buffer.from(jcs(v), "utf8")).digest()]));
}
// SPEC.md §4.9.3: digest over the JCS form with the top-level proof removed.
function taskDigest(doc) {
  const { proof, ...unproofed } = doc;
  return digestMultibase(unproofed);
}
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

function signedDoc(key, verificationMethod, unproofed, now) {
  const proof = {
    type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022",
    verificationMethod, created: now, proofPurpose: "assertionMethod",
    proofValue: sign(key, jcs(unproofed)),
  };
  return { ...unproofed, proof };
}
function verifyDocProof(doc, keyLookup) {
  const { proof, ...unproofed } = doc;
  if (!proof) return { ok: false, reason: "proofMissing" };
  const key = keyLookup(proof.verificationMethod);
  if (!key) return { ok: false, reason: "witnessDidUnresolvable" };
  if (!verify(key, jcs(unproofed), proof.proofValue)) return { ok: false, reason: "proofInvalid" };
  return { ok: true };
}

// The device transcript binding — identical to ref-06p §5.3/act 2.
function bindingFor({ taskDigestMultibase, challenge, sensorNonce, sensorDid }) {
  return jcs({ context: "keyring-locality-v1", taskDigestMultibase, challenge, sensorNonce, sensorDid });
}
function makeTranscript(hwKey, { taskDigestMultibase, challenge, sensorNonce, sensorDid }, hardwareAttestation = "verified") {
  return {
    method: "ble-challenge-response/0.1",
    taskDigestMultibase, challenge, sensorNonce, sensorDid,
    keyId: hwKey.keyId,
    signature: sign(hwKey, bindingFor({ taskDigestMultibase, challenge, sensorNonce, sensorDid })),
    hardwareAttestation,
  };
}

const NS = "edu.harvard.seas.atl.keyring";

// ------------------------------------------------------- the §7.3 algorithm
// Eight steps as the plan orders them. 1–7 are mechanical (pass or fail);
// step 8 is policy and is NOT implemented here — the plan says so
// explicitly ("the design deliberately does not pretend to make it"). This
// rung stops at emitting what a policy would need: pass/fail, the step that
// failed, and a named residual set.

function step1_vwcProof(vwc, witnessKeyLookup) {
  return verifyDocProof(vwc, witnessKeyLookup);
}

function step2_taskContextBinding(vwc, sessionDoc) {
  if (vwc.taskContext !== sessionDoc.id) return { ok: false, reason: "taskContextMismatch" };
  if (vwc.taskDigestMultibase !== taskDigest(sessionDoc)) return { ok: false, reason: "taskDigestMismatch" };
  return { ok: true };
}

function step3_submitResponseProof(submitResponse, vwc, witnessKeyLookup) {
  const proofResult = verifyDocProof(submitResponse, witnessKeyLookup);
  if (!proofResult.ok) return proofResult;
  const { proof, ...vwcUnproofed } = vwc;
  if (submitResponse.payload.vwcDigestMultibase !== digestMultibase(vwcUnproofed))
    return { ok: false, reason: "vwcDigestMismatch" };
  return { ok: true };
}

function step4_assertionAgreesWithTranscript(vwc, submitResponse, transcript) {
  const assertion = vwc.witnessContext;
  const observation = submitResponse.payload.ext[NS].locality.observation;
  if (assertion.localityMethod !== observation.method) return { ok: false, reason: "methodMismatch" };
  const transcriptDigest = digestMultibase(transcript);
  if (assertion.localityEvidenceCommitment !== transcriptDigest) return { ok: false, reason: "evidenceCommitmentMismatch" };
  if (observation.transcriptDigestMultibase !== transcriptDigest) return { ok: false, reason: "observationTranscriptMismatch" };
  return { ok: true };
}

function step5_transcriptBinding(transcript, sessionDoc, expected, deviceKeyLookup) {
  if (transcript.taskDigestMultibase !== taskDigest(sessionDoc)) return { ok: false, reason: "taskDigestMismatch" };
  if (transcript.challenge !== expected.challenge) return { ok: false, reason: "challengeMismatch" };
  if (transcript.sensorDid !== expected.sensorDid) return { ok: false, reason: "sensorMismatch" };
  const key = deviceKeyLookup(transcript.keyId);
  if (!key) return { ok: false, reason: "unknownKey" };
  if (!verify(key, bindingFor(transcript), transcript.signature)) return { ok: false, reason: "transcriptSignatureInvalid" };
  return { ok: true };
}

// Tier 3 (plan §7.1 rule 3, §7.3 step 6): the credential carries a PREDICATE,
// not the device key id. By default a verifier trusts that predicate — the
// default show never opens the artifact side. Opening it (openArtifactSide)
// is the deep check, and it costs exactly what §9.1 says it costs: the
// unlinkability of the show, because now the device's stable key id is in
// view. Both paths are real code, not a comment, because the plan is making
// a claim about what "trust" vs. "verify" actually buys here.
function step6_keyMatchesCredentialSigner(vwc, transcript, vrcSignerKeyId, openArtifactSide) {
  if (!openArtifactSide) {
    if (vwc.witnessContext.localityKeyMatchesCredentialSigner !== true)
      return { ok: false, reason: "predicateNotAsserted" };
    return { ok: true, checked: "predicate-only" };
  }
  if (transcript.keyId !== vrcSignerKeyId) return { ok: false, reason: "keyMismatch" };
  return { ok: true, checked: "artifact-opened" };
}

// Shape-only: the actual App Attest / Play Integrity chain-to-platform-root
// verification is ref-06p5's job (needs real platform test credentials).
// What IS checkable here without that: the assertion cannot claim a
// stronger attestation state than the transcript it summarizes recorded.
function step7_hardwareAttestationShape(vwc, transcript) {
  if (!["verified", "present-unverified", "absent"].includes(transcript.hardwareAttestation))
    return { ok: false, reason: "hardwareAttestationUnknownState" };
  if (vwc.witnessContext.localityHardwareAttestation !== transcript.hardwareAttestation)
    return { ok: false, reason: "hardwareAttestationAssertionMismatch" };
  return { ok: true };
}

// §9.2, priced: what a method's own physics leaves open. Derived from the
// method a verifier reads, not carried as a disclosable member (§7.1 rule
// 6) — carrying it would let a holder reveal only the flattering half.
const RESIDUALS_BY_METHOD = {
  "ble-challenge-response/0.1": ["rf-relay"],
  "nfc-kiosk/0.1": [],
};
function residualsFor(method) {
  return method in RESIDUALS_BY_METHOD ? RESIDUALS_BY_METHOD[method] : ["unknownMethod"];
}

// §7.1 rule 5: a verifier MUST be able to tell "this witness does not do
// locality" (no locality* member at all) apart from "attempted and failed"
// (localityConfirmed: false, with a reason) apart from "confirmed" — and
// the ONLY signal for the first is the absence of the members entirely, so
// it has to be checked before any of the mechanical steps below, not
// inferred from one of them failing.
function hasLocalityMembers(witnessContext) {
  return Object.keys(witnessContext ?? {}).some((k) => k.startsWith("locality"));
}

function verifyWitnessedLocality(bundle, ctx) {
  if (!hasLocalityMembers(bundle.vwc.witnessContext))
    return { pass: true, failedAtStep: null, reason: null, localityOutcome: "not-offered", residuals: null, steps: [] };

  const steps = [];
  const run = (n, fn) => { const r = fn(); steps.push({ step: n, ...r }); return r; };

  if (!run(1, () => step1_vwcProof(bundle.vwc, ctx.witnessKeyLookup)).ok)
    return { pass: false, failedAtStep: 1, reason: steps[0].reason, localityOutcome: null, residuals: null, steps };
  if (!run(2, () => step2_taskContextBinding(bundle.vwc, bundle.sessionDoc)).ok)
    return { pass: false, failedAtStep: 2, reason: steps[1].reason, localityOutcome: null, residuals: null, steps };
  if (!run(3, () => step3_submitResponseProof(bundle.submitResponse, bundle.vwc, ctx.witnessKeyLookup)).ok)
    return { pass: false, failedAtStep: 3, reason: steps[2].reason, localityOutcome: null, residuals: null, steps };

  // Declined or interrupted: §7.1's second explicit negative. There is no
  // transcript to check further — the device never answered on the radio —
  // so steps 4–7 do not run. The document-level checks above (proof,
  // taskContext/taskDigest binding) still apply: even a "we didn't attempt
  // it" claim rides on a genuine, correctly-bound witness/session pair.
  if (bundle.vwc.witnessContext.localityConfirmed === false) {
    return {
      pass: true, failedAtStep: null,
      reason: bundle.vwc.witnessContext.localityReason ?? null,
      localityOutcome: "declined", residuals: null, steps,
    };
  }

  if (!run(4, () => step4_assertionAgreesWithTranscript(bundle.vwc, bundle.submitResponse, bundle.transcript)).ok)
    return { pass: false, failedAtStep: 4, reason: steps[3].reason, localityOutcome: null, residuals: null, steps };
  if (!run(5, () => step5_transcriptBinding(bundle.transcript, bundle.sessionDoc, ctx.expected, ctx.deviceKeyLookup)).ok)
    return { pass: false, failedAtStep: 5, reason: steps[4].reason, localityOutcome: null, residuals: null, steps };
  if (!run(6, () => step6_keyMatchesCredentialSigner(bundle.vwc, bundle.transcript, bundle.vrcSignerKeyId, ctx.openArtifactSide ?? false)).ok)
    return { pass: false, failedAtStep: 6, reason: steps[5].reason, localityOutcome: null, residuals: null, steps };
  if (!run(7, () => step7_hardwareAttestationShape(bundle.vwc, bundle.transcript)).ok)
    return { pass: false, failedAtStep: 7, reason: steps[6].reason, localityOutcome: null, residuals: null, steps };

  return {
    pass: true, failedAtStep: null, reason: null, localityOutcome: "confirmed", steps,
    // Step 8, named but not decided (plan §7.3: "the verifier's judgement,
    // and the design deliberately does not pretend to make it").
    residuals: residualsFor(bundle.vwc.witnessContext.localityMethod),
  };
}

// ------------------------------------------------------------------ fixtures

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

const DID = { wendy: "did:peer:4wendy", alice: "did:peer:4alice", mallory: "did:peer:4mallory" };
const wendyKey = keyFromSeed("77".repeat(32));
const aliceHw = keyFromSeed("11".repeat(32));
const malloryHw = keyFromSeed("ee".repeat(32));
const WENDY_VM = `${DID.wendy}#key-1`;
const witnessKeyLookup = (vm) => (vm === WENDY_VM ? wendyKey : null);
const deviceKeyLookup = (keyId) => ({ [aliceHw.keyId]: aliceHw, [malloryHw.keyId]: malloryHw }[keyId] ?? null);

const NOW = "2026-08-21T15:04:05Z";
const CHALLENGE = "9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const NONCE = "5a6b7c8d9e0f1a2b3c4d5e6f70819200";
const VENUE = "Applied Technology Lab, Cambridge MA — Room 2";

log("ref-06p3 — the §7.3 third-party verification algorithm\n");

// ============================================== act 0: build a genuine bundle
log("— act 0: build the four artifacts a holder would actually present —");

const sessionDoc = {
  id: "bbbb2222-2222-4222-8222-222222222222",
  type: "https://trusttasks.org/witness/session/0.1",
  threadId: "bbbb2222-2222-4222-8222-222222222222",
  parentThreadId: "aaaa1111-1111-4111-8111-111111111111",
  issuer: DID.alice, recipient: DID.wendy, issuedAt: NOW,
  payload: { parties: ["did:peer:alice-rel", "did:peer:bob-rel"] },
};
const digestA = taskDigest(sessionDoc);
const GENUINE_TRANSCRIPT = makeTranscript(aliceHw, {
  taskDigestMultibase: digestA, challenge: CHALLENGE, sensorNonce: NONCE, sensorDid: DID.wendy,
});

// Builds a fully self-consistent bundle from a transcript plus explicit
// overrides — every field that ISN'T overridden is correctly re-derived
// from the given transcript, so a forgery test that overrides exactly one
// thing isolates exactly one step. (Cloning the genuine bundle and mutating
// one field, tried first, kept tripping an EARLIER step instead — mutating
// the transcript changes its own digest, which is itself one of the things
// step 4 checks, so an isolated step-5-or-later forgery has to be built
// consistent-up-to-the-flaw, not mutated after the fact.)
function buildBundle({
  transcript = GENUINE_TRANSCRIPT,
  vrcSignerKeyId = aliceHw.keyId,
  observationOverrides = {},
  assertionOverrides = {},
  corruptVwcProof = false,
  corruptSubmitResponseProof = false,
  vwcDigestClaimOverride = null,
} = {}) {
  const observation = {
    method: transcript.method, sensorDid: DID.wendy, venueClaim: VENUE,
    observedAt: NOW, windowSeconds: 120, confirmed: true,
    deviceKeyId: transcript.keyId,
    transcriptDigestMultibase: digestMultibase(transcript),
    corroboration: { rttMs: 180, rssiDbm: -58, rttBoundMs: 400 },
    residuals: ["rf-relay", "venue-scale-range"], // carried operationally; NOT trusted by the verifier (§7.1 rule 6) — see act 1
    ...observationOverrides,
  };
  const assertion = {
    localityConfirmed: true, localityMethod: transcript.method,
    localityTopology: "witness-anchored", localitySensor: DID.wendy,
    localityVenue: VENUE, localityObservedAt: NOW, localityWindowSeconds: 120,
    localityKeyMatchesCredentialSigner: transcript.keyId === vrcSignerKeyId,
    localityHardwareAttestation: transcript.hardwareAttestation,
    localityEvidenceCommitment: digestMultibase(transcript),
    localityRttMs: 180, localityRssiDbm: -58, localityRttBoundMs: 400,
    ...assertionOverrides,
  };
  const vwcUnsigned = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: "urn:uuid:11111111-2222-4333-8444-555555555555",
    type: ["VerifiableCredential", "DTGCredential", "WitnessCredential"],
    issuer: DID.wendy, taskContext: sessionDoc.id, taskDigestMultibase: digestA,
    credentialSubject: { id: DID.alice },
    witnessContext: assertion,
  };
  let vwc = signedDoc(wendyKey, WENDY_VM, vwcUnsigned, NOW);
  if (corruptVwcProof) vwc = { ...vwc, proof: { ...vwc.proof, proofValue: vwc.proof.proofValue.slice(0, -4) + "XXXX" } };

  const submitResponseUnsigned = {
    id: "ffff6666-0000-4000-8000-00000000000f",
    type: "https://trusttasks.org/witness/session/submit/0.1#response",
    threadId: sessionDoc.id, parentThreadId: sessionDoc.parentThreadId,
    issuer: DID.wendy, recipient: DID.alice, issuedAt: NOW,
    payload: {
      vwc: { type: vwc.type }, // a summary; the full vwc is presented separately
      vwcDigestMultibase: vwcDigestClaimOverride ?? digestMultibase(vwcUnsigned),
      ext: { [NS]: { locality: { observation } } },
    },
  };
  let submitResponse = signedDoc(wendyKey, WENDY_VM, submitResponseUnsigned, NOW);
  if (corruptSubmitResponseProof) submitResponse = { ...submitResponse, proof: { ...submitResponse.proof, proofValue: submitResponse.proof.proofValue.slice(0, -4) + "XXXX" } };

  return { vwc, sessionDoc, submitResponse, transcript, vrcSignerKeyId };
}

// The second of §7.1's three explicit states: attempted, not confirmed.
// There is no transcript — the device never answered on the radio, so
// nothing was ever recorded to bind or to lose. `reason` distinguishes a
// choice (`declinedByHolder`) from an interruption (`windowLost`); either
// way it is a first-class value, not a shared catch-all (plan §7.1 rule 5).
function buildDeclinedBundle(reason = "declinedByHolder") {
  const assertion = {
    localityConfirmed: false, localityMethod: "none", localityReason: reason,
  };
  const vwcUnsigned = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: "urn:uuid:11111111-2222-4333-8444-555555555555",
    type: ["VerifiableCredential", "DTGCredential", "WitnessCredential"],
    issuer: DID.wendy, taskContext: sessionDoc.id, taskDigestMultibase: digestA,
    credentialSubject: { id: DID.alice },
    witnessContext: assertion,
  };
  const vwc = signedDoc(wendyKey, WENDY_VM, vwcUnsigned, NOW);
  const submitResponseUnsigned = {
    id: "ffff6666-0000-4000-8000-00000000000f",
    type: "https://trusttasks.org/witness/session/submit/0.1#response",
    threadId: sessionDoc.id, parentThreadId: sessionDoc.parentThreadId,
    issuer: DID.wendy, recipient: DID.alice, issuedAt: NOW,
    payload: {
      vwc: { type: vwc.type },
      vwcDigestMultibase: digestMultibase(vwcUnsigned),
      ext: { [NS]: { locality: { observation: { method: "none", confirmed: false, reason, sensorDid: DID.wendy } } } },
    },
  };
  const submitResponse = signedDoc(wendyKey, WENDY_VM, submitResponseUnsigned, NOW);
  return { vwc, sessionDoc, submitResponse, transcript: null, vrcSignerKeyId: null };
}

// The first of §7.1's three states: no locality* member anywhere in
// witnessContext — this witness simply does not do locality (policy `off`,
// or a locality-blind witness). The ONLY signal is total absence; anything
// else (a `false` flag, a nested object with nothing in it) would blur it
// into "attempted and failed."
function buildNotOfferedBundle() {
  const vwcUnsigned = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: "urn:uuid:11111111-2222-4333-8444-555555555555",
    type: ["VerifiableCredential", "DTGCredential", "WitnessCredential"],
    issuer: DID.wendy, taskContext: sessionDoc.id, taskDigestMultibase: digestA,
    credentialSubject: { id: DID.alice },
    witnessContext: { event: "keyring-vrc-exchange", sessionId: sessionDoc.id }, // cred-spec's base fields only
  };
  const vwc = signedDoc(wendyKey, WENDY_VM, vwcUnsigned, NOW);
  const submitResponseUnsigned = {
    id: "ffff6666-0000-4000-8000-00000000000f",
    type: "https://trusttasks.org/witness/session/submit/0.1#response",
    threadId: sessionDoc.id, parentThreadId: sessionDoc.parentThreadId,
    issuer: DID.wendy, recipient: DID.alice, issuedAt: NOW,
    payload: { vwc: { type: vwc.type }, vwcDigestMultibase: digestMultibase(vwcUnsigned) }, // no locality ext at all
  };
  const submitResponse = signedDoc(wendyKey, WENDY_VM, submitResponseUnsigned, NOW);
  return { vwc, sessionDoc, submitResponse, transcript: null, vrcSignerKeyId: null };
}

const GENUINE = buildBundle();
const ctx = {
  witnessKeyLookup, deviceKeyLookup,
  expected: { challenge: CHALLENGE, sensorDid: DID.wendy },
};

const frozenBundle = frozen("genuine-bundle.json", GENUINE);
check("the genuine bundle is reproducible byte-for-byte — matches the frozen fixture", () =>
  deepStrictEqual(GENUINE, frozenBundle));

// ==================================================== act 1: the genuine pass
log("\n— act 1: the genuine bundle passes all seven mechanical steps —");

const genuineVerdict = verifyWitnessedLocality(GENUINE, ctx);
check("verify() returns pass:true, localityOutcome:'confirmed', with all seven steps ok", () => {
  ok(genuineVerdict.pass, `unexpected failure at step ${genuineVerdict.failedAtStep}: ${genuineVerdict.reason}`);
  deepStrictEqual(genuineVerdict.localityOutcome, "confirmed");
  deepStrictEqual(genuineVerdict.steps.map((s) => s.ok), [true, true, true, true, true, true, true]);
});
check("the verdict NAMES residuals — it is not a bare boolean", () => {
  ok(Array.isArray(genuineVerdict.residuals), "residuals must be an explicit array, not absent");
  deepStrictEqual(genuineVerdict.residuals, ["rf-relay"]);
});
check("the observation's own residuals field is NOT what the verdict reports (§7.1 rule 6: not disclosable, not trusted)", () => {
  const inflated = buildBundle({ observationOverrides: { residuals: [] } });
  const verdict = verifyWitnessedLocality(inflated, ctx);
  ok(verdict.pass, "changing the carried (non-normative) residuals list must not affect pass/fail");
  deepStrictEqual(verdict.residuals, ["rf-relay"], "the verifier derives residuals from the METHOD, ignoring whatever the observation happened to carry");
});

// ============================================ act 2: seven independent forgeries
log("\n— act 2: seven forgeries, each caught at the step that should catch it —");

function tamper(bundle, path, mutate) {
  const clone = JSON.parse(JSON.stringify(bundle));
  const parts = path.split(".");
  let node = clone;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
  node[parts.at(-1)] = mutate(node[parts.at(-1)]);
  return clone;
}

check("1 · VWC proof tampered — a byte flips in the proofValue", () => {
  const bad = buildBundle({ corruptVwcProof: true });
  const v = verifyWitnessedLocality(bad, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 1, "proofInvalid"]);
});

check("2 · session document tampered after the VWC bound to it — ref-06w3's forgery, checked from the verifier's side", () => {
  const bad = tamper(GENUINE, "sessionDoc.payload", (p) => ({ ...p, parties: [...p.parties, DID.mallory] }));
  const v = verifyWitnessedLocality(bad, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 2, "taskDigestMismatch"]);
});

check("3 · submit#response proof tampered", () => {
  const bad = buildBundle({ corruptSubmitResponseProof: true });
  const v = verifyWitnessedLocality(bad, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 3, "proofInvalid"]);
});

check("3b · submit#response's vwcDigestMultibase claims a different VWC", () => {
  const bad = buildBundle({ vwcDigestClaimOverride: "zSTUB" });
  const v = verifyWitnessedLocality(bad, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 3, "vwcDigestMismatch"]);
});

check("4 · the assertion's evidence commitment disagrees with the transcript it actually summarizes", () => {
  // The retained transcript swapped for a different (independently valid)
  // one AFTER the VWC/submitResponse were built and bound to the original —
  // exactly what "the retained pair doesn't match the credential" looks
  // like to a verifier holding both.
  const altTranscript = makeTranscript(aliceHw, {
    taskDigestMultibase: digestA, challenge: CHALLENGE, sensorNonce: "00".repeat(16), sensorDid: DID.wendy,
  });
  const bad = { ...GENUINE, transcript: altTranscript };
  const v = verifyWitnessedLocality(bad, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 4, "evidenceCommitmentMismatch"]);
});

check("5 · the device transcript signature is invalid, everything else self-consistent", () => {
  // Built consistent-up-to-the-flaw: the commitment digests in the
  // assertion/observation are derived from THIS (bad-signature) transcript,
  // so step 4 agrees and only step 5's actual signature check catches it.
  const badSigTranscript = { ...GENUINE_TRANSCRIPT, signature: GENUINE_TRANSCRIPT.signature.slice(0, -4) + "XXXX" };
  const bad = buildBundle({ transcript: badSigTranscript });
  const v = verifyWitnessedLocality(bad, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 5, "transcriptSignatureInvalid"]);
});

check("6 · opening the artifact side catches a forged predicate — mallory's key answered, not alice's, but the credential lies", () => {
  const malloryTranscript = makeTranscript(malloryHw, {
    taskDigestMultibase: digestA, challenge: CHALLENGE, sensorNonce: NONCE, sensorDid: DID.wendy,
  });
  // Force the predicate to true regardless of the real (mismatched) key —
  // an honest witness would assert it false here; this is what a witness
  // LYING about the relation looks like, which is exactly the case the
  // trust-only default cannot catch.
  const bad = buildBundle({ transcript: malloryTranscript, assertionOverrides: { localityKeyMatchesCredentialSigner: true } });
  const trustOnly = verifyWitnessedLocality(bad, { ...ctx, openArtifactSide: false });
  ok(trustOnly.pass, "the trust-only default path DOES pass — it never looks at the artifact side; this is documented, not a bug (plan §7.3 step 6, §9.1)");
  const opened = verifyWitnessedLocality(bad, { ...ctx, openArtifactSide: true });
  deepStrictEqual([opened.pass, opened.failedAtStep, opened.reason], [false, 6, "keyMismatch"]);
});

check("7 · the assertion claims a stronger attestation state than the transcript recorded", () => {
  const weakTranscript = makeTranscript(aliceHw, {
    taskDigestMultibase: digestA, challenge: CHALLENGE, sensorNonce: NONCE, sensorDid: DID.wendy,
  }, "present-unverified");
  const bad = buildBundle({ transcript: weakTranscript, assertionOverrides: { localityHardwareAttestation: "verified" } });
  const v = verifyWitnessedLocality(bad, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 7, "hardwareAttestationAssertionMismatch"]);
});

// ============================================== act 3: the three states, verified
log("\n— act 3: confirmed / declined / not-offered — three states, never inferred —");

check("declined — a real reason, no transcript to check, document-level integrity still holds", () => {
  const declined = buildDeclinedBundle("windowLost");
  const v = verifyWitnessedLocality(declined, ctx);
  deepStrictEqual([v.pass, v.localityOutcome, v.reason], [true, "declined", "windowLost"]);
  deepStrictEqual(v.steps.length, 3, "only the document-level steps (1–3) run — there is no transcript to check further");
  ok(v.residuals === null, "a declined outcome has no residuals to name — nothing was confirmed");
});

check("declined with a tampered proof still fails at step 1 — 'nothing happened' is not exempt from integrity checks", () => {
  const declined = buildDeclinedBundle("declinedByHolder");
  const tamperedDeclined = { ...declined, vwc: { ...declined.vwc, proof: { ...declined.vwc.proof, proofValue: declined.vwc.proof.proofValue.slice(0, -4) + "XXXX" } } };
  const v = verifyWitnessedLocality(tamperedDeclined, ctx);
  deepStrictEqual([v.pass, v.failedAtStep, v.reason], [false, 1, "proofInvalid"]);
});

check("not-offered — no locality* member at all, distinct from a declined claim", () => {
  const notOffered = buildNotOfferedBundle();
  const v = verifyWitnessedLocality(notOffered, ctx);
  deepStrictEqual([v.pass, v.localityOutcome, v.reason, v.steps.length], [true, "not-offered", null, 0]);
});

check("the three states are pairwise distinguishable — no two collapse into the same signal", () => {
  const outcomes = [
    verifyWitnessedLocality(GENUINE, ctx).localityOutcome,
    verifyWitnessedLocality(buildDeclinedBundle(), ctx).localityOutcome,
    verifyWitnessedLocality(buildNotOfferedBundle(), ctx).localityOutcome,
  ];
  deepStrictEqual(new Set(outcomes).size, 3, `expected three distinct outcomes, got ${JSON.stringify(outcomes)}`);
});

// ------------------------------------------------------------------- verdict
log(`\n${failures === 0 ? "✅" : "❌"} ${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
