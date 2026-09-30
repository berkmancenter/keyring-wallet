/**
 * Self-test for check-vrc-credentials.mjs, run by `node check-vrc-credentials.mjs --self-test`.
 * Synthetic credentials in the shape the wallet emits, each expected to earn
 * one verdict. Offline: no device, no artifacts directory, no network.
 */
import assert from "node:assert/strict";

import {
  CTX_DTG_LEGACY,
  CTX_HARDWARE_EVIDENCE,
  CTX_REGISTRY,
  CTX_V2,
  MARKER,
  checkCredential,
  extractCredentials,
  verdictOf,
} from "./check-vrc-credentials.mjs";

const clone = (o) => JSON.parse(JSON.stringify(o));

/** A good v5 VRC, as the log redaction leaves it (PEMs become placeholders). */
function goodVrc() {
  return {
    "@context": [CTX_V2, CTX_REGISTRY, CTX_HARDWARE_EVIDENCE],
    type: ["VerifiableCredential", "DTGCredential", "RelationshipCredential"],
    issuer: "did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    issuerScope: "pairwise",
    validFrom: "2026-09-30T10:00:00.000Z",
    validUntil: "2027-09-30T10:00:00.000Z",
    credentialSubject: { id: "did:peer:0z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH" },
    evidence: [
      {
        id: "urn:uuid:4f3c2b1a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
        type: ["BiometricAttestation", "HardwareKeyAttestation"],
        created: "2026-09-30T10:00:01.000Z",
        authenticationMethod: { type: "Fingerprint", authenticatorType: "platform", userVerification: "required" },
        hardwareBinding: {
          keyStorage: "StrongBox",
          platform: "android",
          keyType: "EC-P256",
          algorithm: "ECDSA-SHA256",
          publicKey: "BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjqAKeFmCHQ0ozDUxYjT9uf2iJcF2E0ZlXgOnkL3wJzqb6h8w=",
        },
        attestation: {
          format: "android-key-attestation-v3",
          certificateChain: ["<PEM #1: 1192 chars>", "<PEM #2: 1276 chars>", "<PEM #3: 1340 chars>", "<PEM #4: 1800 chars>"],
        },
        signature: { value: "MEUCIQDk3oUuB9ZfVwwQp1gT6n4e2v1k8lPq0w3Zr9sYc7hVbgIgF2", algorithm: "ECDSA-SHA256", signedContentHash: "n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V4FGUYnmnI=" },
        biometricMethod: { type: "Fingerprint", authenticatorType: "platform", userVerification: "required" },
      },
    ],
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      created: "2026-09-30T10:00:02Z",
      verificationMethod: "did:peer:0z6Mkha#key-1",
      proofPurpose: "assertionMethod",
      proofValue: "z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNRWYzoShsFhDrvdGwQg",
    },
  };
}

function logcatLine(credential, { cut } = {}) {
  let json = JSON.stringify(credential);
  if (cut) json = json.slice(0, cut);
  return `09-30 10:00:03.123 31346 31442 I ReactNativeJS: ${MARKER} side=RECEIVER exchange=ae49e953 record=r-1 ${json}`;
}

const byCode = (r, code) => r.findings.filter((f) => f.code === code);

const cases = [
  ["good v5 VRC with evidence passes with no WARN or FAIL", () => {
    const r = checkCredential(goodVrc());
    assert.equal(verdictOf(r.findings), "PASS", JSON.stringify(r.findings.filter((f) => f.level === "FAIL" || f.level === "WARN")));
    assert.equal(r.keyStorage, "StrongBox");
    assert.equal(r.chainLength, 4);
  }],
  ["legacy-context VRC fails in v5 mode", () => {
    const c = goodVrc();
    c["@context"][2] = CTX_DTG_LEGACY;
    const r = checkCredential(c, { expect: "v5" });
    assert.equal(verdictOf(r.findings), "FAIL");
    assert.equal(byCode(r, "context-legacy-in-v5").length, 1);
  }],
  ["legacy-context VRC passes in legacy mode, and the v5 context fails there", () => {
    const c = goodVrc();
    c["@context"][2] = CTX_DTG_LEGACY;
    assert.equal(verdictOf(checkCredential(c, { expect: "legacy" }).findings), "PASS");
    const v5 = checkCredential(goodVrc(), { expect: "legacy" });
    assert.equal(byCode(v5, "context-v5-in-legacy").length, 1);
    assert.equal(verdictOf(v5.findings), "FAIL");
  }],
  ["--expect any accepts either context list", () => {
    const c = goodVrc();
    c["@context"][2] = CTX_DTG_LEGACY;
    assert.equal(verdictOf(checkCredential(c, { expect: "any" }).findings), "PASS");
    assert.equal(verdictOf(checkCredential(goodVrc(), { expect: "any" }).findings), "PASS");
  }],
  ["an Ed25519Signature2018 proof fails", () => {
    const c = goodVrc();
    c.proof = { type: "Ed25519Signature2018", created: "2026-09-30T10:00:02Z", proofPurpose: "assertionMethod", verificationMethod: "did:peer:0z6Mkha#key-1", jws: "eyJ..abc" };
    const r = checkCredential(c);
    assert.equal(verdictOf(r.findings), "FAIL");
    assert.equal(byCode(r, "proof")[0].level, "FAIL");
  }],
  ["a missing issuerScope fails", () => {
    const c = goodVrc();
    delete c.issuerScope;
    const r = checkCredential(c);
    assert.equal(verdictOf(r.findings), "FAIL");
    assert.equal(byCode(r, "issuerScope")[0].level, "FAIL");
  }],
  ["an empty certificate chain with StrongBox fails; with Software it only warns", () => {
    const c = goodVrc();
    c.evidence[0].attestation.certificateChain = [];
    const strong = checkCredential(c);
    assert.equal(verdictOf(strong.findings), "FAIL");
    assert.equal(strong.chainLength, 0);
    c.evidence[0].hardwareBinding.keyStorage = "Software";
    const soft = checkCredential(c);
    assert.equal(verdictOf(soft.findings), "WARN");
    assert.equal(byCode(soft, "keyStorage")[0].level, "INFO");
  }],
  ["an unknown evidence member and an unknown top-level member warn", () => {
    const c = goodVrc();
    c.evidence[0].hardwareBindng = { keyStorage: "StrongBox" };
    c.issuerscope = "pairwise";
    const r = checkCredential(c);
    assert.equal(verdictOf(r.findings), "WARN");
    assert.equal(byCode(r, "unknown-evidence-member").length, 1);
    assert.equal(byCode(r, "unknown-member").length, 1);
  }],
  ["a VRC without evidence fails by default and warns with requireEvidence off", () => {
    const c = goodVrc();
    delete c.evidence;
    assert.equal(verdictOf(checkCredential(c).findings), "FAIL");
    assert.equal(verdictOf(checkCredential(c, { requireEvidence: false }).findings), "WARN");
  }],
  ["a two-element evidence array and a wrong attestation format fail", () => {
    const c = goodVrc();
    c.evidence.push(clone(c.evidence[0]));
    assert.equal(byCode(checkCredential(c), "evidence-shape")[0].level, "FAIL");
    const d = goodVrc();
    d.evidence[0].attestation.format = "apple-appattest-v1";
    assert.equal(byCode(checkCredential(d), "attestation-format")[0].level, "FAIL");
  }],
  ["a non-VRC credential is recorded and not judged", () => {
    const r = checkCredential({ "@context": [CTX_V2], type: ["VerifiableCredential", "DTGCredential", "StatementCredential"] });
    assert.equal(r.kind, "other");
    assert.equal(verdictOf(r.findings), "PASS");
  }],
  ["a truncated logcat payload is reported as truncated, not parsed", () => {
    const entries = extractCredentials(logcatLine(goodVrc(), { cut: 900 }), "x.txt");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "truncated");
    assert.equal(entries[0].credential, undefined);
  }],
  ["a payload split over continuation log entries is joined", () => {
    const json = JSON.stringify(goodVrc());
    const head = `09-30 10:00:03.123 31346 31442 I ReactNativeJS: ${MARKER} side=INVITER exchange=e record=r ${json.slice(0, 700)}`;
    const tail = `09-30 10:00:03.124 31346 31442 I ReactNativeJS: ${json.slice(700)}`;
    const other = "09-30 10:00:03.200 31346 31442 I ReactNativeJS: [VRC] next message";
    const entries = extractCredentials([head, tail, other].join("\n"), "x.txt");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "ok");
    assert.equal(entries[0].side, "INVITER");
  }],
  ["an unparsable payload is reported, and a bare JSON dump is taken whole", () => {
    const bad = `09-30 10:00:03.123 1 2 I ReactNativeJS: ${MARKER} side=RECEIVER exchange=e record=r {"a":1,}`;
    assert.equal(extractCredentials(bad, "x.txt")[0].status, "unparsable");
    const dump = extractCredentials(JSON.stringify(goodVrc(), null, 2), "issued-credential-U-RECEIVER-VerifiableCredential-1-0.json");
    assert.equal(dump[0].status, "ok");
    assert.equal(dump[0].side, "RECEIVER");
  }],
  ["a logcat line with a full payload round-trips through extraction and the checks", () => {
    const entries = extractCredentials(`noise\n${logcatLine(goodVrc())}\nmore noise`, "x.txt");
    assert.equal(entries[0].status, "ok");
    assert.equal(verdictOf(checkCredential(entries[0].credential).findings), "PASS");
  }],
];

/** Run every case; returns { passed, failed: [{ name, error }] } and never throws. */
export function runSelfTest(log = console.log) {
  let passed = 0;
  const failed = [];
  for (const [name, fn] of cases) {
    try {
      fn();
      passed++;
      log(`  ok    ${name}`);
    } catch (e) {
      failed.push({ name, error: e.message });
      log(`  FAIL  ${name}\n        ${e.message.split("\n")[0]}`);
    }
  }
  log(`self-test: ${passed}/${cases.length} passed`);
  return { passed, failed };
}
