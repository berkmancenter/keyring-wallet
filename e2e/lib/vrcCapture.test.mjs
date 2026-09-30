import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MARKER, extractCredentials } from "./check-vrc-credentials.mjs";
import {
  checkOptionsFromEnv,
  enforceCredentialCheck,
  filterKeepingContinuations,
  hwVerifiedMarkerSeen,
  requireHwVerified,
  saveIssuedCredentialFiles,
} from "./vrcCapture.js";

const PREFIX = "09-30 14:55:01.123 32257 32411 I ReactNativeJS:";
const vrc = {
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://registry.trustoverip.org/dtg/context/v1",
    "https://www.firstperson.network/hardware-evidence/v1",
  ],
  type: ["VerifiableCredential", "DTGCredential", "RelationshipCredential"],
  issuer: "did:peer:0zA",
  issuerScope: "pairwise",
  validFrom: "2026-09-30T00:00:00Z",
  credentialSubject: { id: "did:peer:0zB" },
  evidence: [
    {
      id: "urn:uuid:4f3c2b1a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
      type: ["HardwareKeyAttestation", "BiometricAttestation"],
      created: "2026-09-30T00:00:00Z",
      authenticationMethod: { type: "biometric" },
      hardwareBinding: { keyStorage: "StrongBox", platform: "android", keyType: "EC-P256", algorithm: "ECDSA-SHA256", publicKey: "k" },
      attestation: { format: "android-key-attestation-v3", certificateChain: ["<PEM #1: 900 chars>"] },
      signature: { value: "MEUCIQDk3oUuB9ZfVwwQp1gT6n4e2v1k8lPq0w3Zr9sYc7hVbgIgF2", algorithm: "ECDSA-SHA256" },
    },
  ],
  proof: { type: "DataIntegrityProof", cryptosuite: "eddsa-rdfc-2022", proofPurpose: "assertionMethod", verificationMethod: "did:peer:0zA#key-1", proofValue: "z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNRWYzoShsFhDrvdGwQg" },
};

function logcatWithSplitPayload() {
  const json = JSON.stringify(vrc);
  const cut = Math.floor(json.length / 2);
  return [
    `${PREFIX} [VRC] [INVITER] unrelated line that the filter drops`,
    `${PREFIX} ${MARKER} side=ISSUER exchange=ex-1 record=- ${json.slice(0, cut)}`,
    `09-30 14:55:01.124 32257 32411 I ReactNativeJS: ${json.slice(cut)}`,
    `${PREFIX} [VRC:Verify] ✓ Native verification passed [cryptographic] (76ms)`,
  ].join("\n");
}

test("filterKeepingContinuations keeps the unmarked continuation of a split payload", () => {
  const kept = filterKeepingContinuations(logcatWithSplitPayload(), /VRC:/);
  assert.equal(kept.length, 3);
  const entries = extractCredentials(kept.join("\n"), "x");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "ok");
  assert.equal(entries[0].side, "ISSUER");
});

test("a plain filter would have truncated it (why continuations are kept)", () => {
  const plain = logcatWithSplitPayload().split("\n").filter((l) => /VRC:/.test(l)).join("\n");
  assert.equal(extractCredentials(plain, "x")[0].status, "truncated");
});

test("saveIssuedCredentialFiles writes one json per readable payload", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vrccap-"));
  const written = saveIssuedCredentialFiles("UDID1", filterKeepingContinuations(logcatWithSplitPayload(), /VRC:/).join("\n"), dir);
  assert.equal(written.length, 1);
  assert.match(path.basename(written[0]), /^issued-credential-UDID1-ISSUER-0\.json$/);
  assert.deepEqual(JSON.parse(readFileSync(written[0], "utf8")), vrc);
  assert.equal(readdirSync(dir).length, 1);
});

test("enforceCredentialCheck fails loudly when no credential was captured, passes on a good one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vrccap-"));
  const empty = path.join(dir, "witnessed-logcat-U-1.txt");
  writeFileSync(empty, `${PREFIX} [VRC] nothing issued here`);
  const saved = process.exitCode;
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = (m) => errors.push(m);
  try {
    process.exitCode = 0;
    const bad = enforceCredentialCheck([empty], {});
    assert.equal(bad.ok, false);
    assert.equal(process.exitCode, 1);
    assert.match(errors.join(""), /VRC CREDENTIAL CHECK FAILED/);
    assert.ok(bad.findings.some((f) => f.code === "no-credentials"));

    // a run that already failed does not get a second, empty-capture failure
    process.exitCode = 1;
    assert.equal(enforceCredentialCheck([empty], {}).ok, true);

    const good = path.join(dir, "issued-credential-U-ISSUER-0.json");
    writeFileSync(good, JSON.stringify(vrc));
    process.exitCode = 0;
    const ok = enforceCredentialCheck([good], {});
    assert.equal(ok.ok, true);
    assert.equal(process.exitCode, 0);

    assert.equal(enforceCredentialCheck([empty], { E2E_VRC_CHECK: "off" }), null);
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exitCode = saved;
  }
});

test("hardware verify failures are WARN by default, FAIL only with E2E_VRC_STRICT_MARKERS=1", () => {
  assert.equal(checkOptionsFromEnv({}).strictMarkers, false);
  assert.equal(checkOptionsFromEnv({ E2E_VRC_STRICT_MARKERS: "1" }).strictMarkers, true);
  assert.equal(checkOptionsFromEnv({}).expect, "v5");
  assert.deepEqual(checkOptionsFromEnv({}).requireStorage, ["StrongBox", "TEE", "SecureEnclave"]);
});

test("hwVerifiedMarkerSeen needs an actual pass line", () => {
  assert.equal(hwVerifiedMarkerSeen(`${PREFIX} [HW:Verify] ✓ Native verification passed [cryptographic] (138ms)`), true);
  assert.equal(hwVerifiedMarkerSeen(`${PREFIX} [VRC:Verify] ✓ Native verification passed [cryptographic] (76ms)`), true);
  assert.equal(hwVerifiedMarkerSeen(`${PREFIX} [HW:Verify] ▶ Verifying [android/StrongBox, android-key-attestation-v3]`), false);
  assert.equal(
    hwVerifiedMarkerSeen(`${PREFIX} [HW:Verify] ✗ Native verification failed: Certificate chain validation failed: timestamp check failed`),
    false
  );
  assert.equal(hwVerifiedMarkerSeen(null), false);
});

test("requireHwVerified is opt-in", () => {
  assert.equal(requireHwVerified({}), false);
  assert.equal(requireHwVerified({ E2E_REQUIRE_HW_VERIFIED: "1" }), true);
  assert.equal(requireHwVerified({ E2E_REQUIRE_HW_VERIFIED: "0" }), false);
});
