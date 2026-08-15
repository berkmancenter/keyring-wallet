// ref-06w3 — the taskContext binding: id-only vs digest vs proofValue.
//
// Glenn's finding (sync call, 2026-08): the VWC's taskContext is a document id,
// and "nothing stops me creating a different trust task with the same document
// ID — it's not proof of anything." The link must be evidentiary and
// tamper-resistant: the proof value, or a hash of the whole trust task.
// He asked for both to be tried; this rung is the trial.
//
// Three acts, one forgery. Mallory mints a counterfeit witness/session document
// carrying the SAME id as the genuine one. Each act pairs the same VWC against
// the genuine and forged documents under a different binding rule:
//
//   act 1 — id-only (the spec as merged, #213):   forgery ACCEPTED  ← the hole
//   act 2 — digestMultibase over the whole doc:   forgery REJECTED, proof not needed
//   act 3 — proofValue anchor:                    forgery rejected ONLY if the
//            verifier verifies the signature (string-match alone is spoofable by
//            copying the proof block), and impossible to use at all on a
//            conforming UNPROOFED session (witness/session 0.1 declares
//            proofRequirement.request: OPTIONAL).
//
// Faithful shapes: witness/session 0.1 payload = { parties } (merged schema);
// DigestMultibase = _framework/0.3 $defs (multibase multihash, z/u headers,
// base58btc RECOMMENDED); digests over RFC 8785 (JCS) canonicalization.

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";
import { deepStrictEqual, ok } from "node:assert";

// ── tiny conformant primitives ──────────────────────────────────────────────

/** RFC 8785 (JCS) for our value domain: sorted keys, no floats, UTF-8. */
function jcs(v) {
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest();

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58btc(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

/** _framework/0.3 $defs/DigestMultibase: z + base58btc(multihash sha2-256). */
function digestMultibase(doc) {
  const digest = sha256(Buffer.from(jcs(doc), "utf8"));
  return "z" + base58btc(Buffer.concat([Buffer.from([0x12, 0x20]), digest]));
}

/** eddsa-jcs-2022-shaped proof (simplified: Ed25519 over sha256(JCS(doc sans proof))). */
function signDoc(doc, privateKey, verificationMethod) {
  const { proof: _drop, ...unsigned } = doc;
  const sig = edSign(null, sha256(Buffer.from(jcs(unsigned), "utf8")), privateKey);
  return {
    ...unsigned,
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-jcs-2022",
      verificationMethod,
      proofPurpose: "assertionMethod",
      proofValue: "z" + base58btc(sig),
    },
  };
}

function proofVerifies(doc, publicKey) {
  if (!doc.proof?.proofValue) return false;
  const { proof, ...unsigned } = doc;
  let n = 0n;
  for (const ch of proof.proofValue.slice(1)) n = n * 58n + BigInt(B58.indexOf(ch));
  let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex;
  const sig = Buffer.from(hex.padStart(128, "0"), "hex");
  return edVerify(null, sha256(Buffer.from(jcs(unsigned), "utf8")), publicKey, sig);
}

// ── checks harness (rung convention) ────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ── the cast and the documents ──────────────────────────────────────────────

const bob = generateKeyPairSync("ed25519");      // participating party (session author)
const wendy = generateKeyPairSync("ed25519");    // witness (VWC issuer)
const mallory = generateKeyPairSync("ed25519");  // forger

const SESSION_ID = "bbbb2222-2222-4222-8222-222222222222";

// Genuine witness/session document (merged 0.1 shape: payload = { parties }).
const genuineUnproofed = {
  type: "https://trusttasks.org/spec/witness/session/0.1",
  id: SESSION_ID,
  threadId: SESSION_ID,
  parentThreadId: "aaaa1111-1111-4111-8111-111111111111",
  payload: { parties: ["did:example:alice-rel", "did:example:bob-rel"] },
};
const genuineSigned = signDoc(genuineUnproofed, bob.privateKey, "did:example:bob-rel#key-1");

// Mallory's counterfeit: SAME id, different everything that matters.
const forged = {
  type: "https://trusttasks.org/spec/witness/session/0.1",
  id: SESSION_ID, // ← the whole attack
  threadId: SESSION_ID,
  parentThreadId: "aaaa1111-1111-4111-8111-111111111111",
  payload: { parties: ["did:example:mallory-rel", "did:example:bob-rel"] },
};

// Wendy's VWC (three variants of the binding member under test).
const vwcBase = {
  issuer: "did:example:wendy",
  credentialSubject: {
    witnessedRelationship: ["did:example:alice-rel", "did:example:bob-rel"],
    taskContext: SESSION_ID,
  },
};

console.log("ref-06w3 — taskContext binding: id-only vs digest vs proofValue\n");

// ── act 1: the spec as merged — id-only ─────────────────────────────────────
console.log("act 1 — id-only binding (witness/session/submit 0.1: “taskContext MUST equal the id”)");

const pairById = (vwc, doc) => doc.id === vwc.credentialSubject.taskContext;

check("genuine document pairs by id", () => ok(pairById(vwcBase, genuineSigned)));
check("FORGED document ALSO pairs by id — evidence of the wrong event verifies cleanly", () =>
  ok(pairById(vwcBase, forged)));

// ── act 2: digest binding ───────────────────────────────────────────────────
console.log("\nact 2 — taskDigestMultibase (digest over JCS of the whole document)");

const vwcDigest = structuredClone(vwcBase);
vwcDigest.credentialSubject.taskDigestMultibase = digestMultibase(genuineUnproofed);

const pairByDigest = (vwc, doc) => {
  const { proof: _p, ...sansProof } = doc; // digest is over the document as authored (pre-proof)
  return doc.id === vwc.credentialSubject.taskContext &&
         digestMultibase(sansProof) === vwc.credentialSubject.taskDigestMultibase;
};

check("genuine document pairs: id matches AND digest matches", () =>
  ok(pairByDigest(vwcDigest, genuineSigned)));
check("forged document REJECTED: id matches but digest differs", () =>
  ok(!pairByDigest(vwcDigest, forged)));
check("works on a conforming UNPROOFED session (request proof is OPTIONAL in 0.1)", () =>
  ok(pairByDigest(vwcDigest, genuineUnproofed)));
check("digest is conformant DigestMultibase (z + base58btc multihash, per _framework/0.3)", () =>
  ok(/^z[1-9A-HJ-NP-Za-km-z]+$/.test(vwcDigest.credentialSubject.taskDigestMultibase) &&
     vwcDigest.credentialSubject.taskDigestMultibase.length >= 16));

// ── act 3: proofValue binding ───────────────────────────────────────────────
console.log("\nact 3 — taskProofValue (anchor on the session document's proof.proofValue)");

const vwcProof = structuredClone(vwcBase);
vwcProof.credentialSubject.taskProofValue = genuineSigned.proof.proofValue;

// 3a. String-match alone is spoofable: Mallory pastes the genuine proof block.
const forgedWithStolenProof = { ...forged, proof: structuredClone(genuineSigned.proof) };
const pairByProofString = (vwc, doc) =>
  doc.proof?.proofValue === vwc.credentialSubject.taskProofValue;

check("string-match pairs the genuine signed document", () =>
  ok(pairByProofString(vwcProof, genuineSigned)));
check("string-match ALONE is spoofable — forged doc with the stolen proof block passes", () =>
  ok(pairByProofString(vwcProof, forgedWithStolenProof)));

// 3b. With full signature verification, the theft is caught.
const pairByProofVerified = (vwc, doc, pk) =>
  pairByProofString(vwc, doc) && proofVerifies(doc, pk);

check("with signature verification, the stolen proof block is caught (sig doesn't cover forged content)", () =>
  ok(!pairByProofVerified(vwcProof, forgedWithStolenProof, bob.publicKey)));
check("genuine signed document still pairs under full verification", () =>
  ok(pairByProofVerified(vwcProof, genuineSigned, bob.publicKey)));
check("Mallory self-signing can't help either — her proofValue never equals the anchored one", () => {
  const selfSigned = signDoc(forged, mallory.privateKey, "did:example:mallory#key-1");
  ok(!pairByProofString(vwcProof, selfSigned));
});

// 3c. The structural gap: a conforming unproofed session has nothing to anchor to.
check("UNPROOFED conforming session: proofValue anchor is IMPOSSIBLE (no proof exists)", () =>
  ok(genuineUnproofed.proof === undefined));

// ── cost: Glenn's expense concern, measured ─────────────────────────────────
console.log("\ncost — recomputing the digest at verification time");
const t0 = process.hrtime.bigint();
const N = 10_000;
for (let i = 0; i < N; i++) digestMultibase(genuineUnproofed);
const usPerOp = Number(process.hrtime.bigint() - t0) / 1000 / N;
console.log(`  JCS + SHA-256 + multibase over the session document: ${usPerOp.toFixed(1)} µs/op`);
check("digest recompute is negligible (< 1 ms)", () => ok(usPerOp < 1000));

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
console.log(`
verdict:
  id-only     — forgeable (act 1). The hole is real.
  digest      — catches the forgery unconditionally; needs no proof on the
                document; self-verifying by recompute (~${usPerOp.toFixed(0)} µs); already the
                registry's convention (DigestMultibase, RFC 8785).
  proofValue  — catches the forgery ONLY behind full signature verification
                (string-match is spoofable by copying the proof block), and is
                structurally unavailable on the unproofed sessions the merged
                spec permits (proofRequirement.request: OPTIONAL).
recommendation: taskContext stays the id (locator, §4.9.1) + REQUIRED
                taskDigestMultibase (binder). proofValue remains a fine
                *index key* where a proof happens to exist, but cannot be
                the normative binding.`);
process.exit(failed ? 1 : 0);
