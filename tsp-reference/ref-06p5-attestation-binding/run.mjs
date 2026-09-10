// ref-06p5 — App Attest / Play Integrity bound to the locality transcript,
// verified against real platform roots.
//
// Design under test: docs/plans/locality-plan.md §5.4 ("integrity attestation,
// when present, covers the same binding"), §7.1 (localityHardwareAttestation:
// verified | present-unverified | absent), §7.3 step 7.
//
// Split honestly down the middle, because the two platforms are not
// symmetric: App Attest can be verified fully offline against Apple's own
// public root, so this rung does that for real. Play Integrity's tokens are
// encrypted and CANNOT be verified offline at all — decoding one requires a
// live call to Google's own backend with a registered Play Console app and
// Google Cloud credentials. That is not a missing test fixture, it is a
// live-service dependency, so it gets a separate, explicitly optional script
// (live-play-integrity-optional.mjs) rather than a fixture pretending to
// stand in for one. What's built here for Play Integrity is a shape-only
// consistency check, in the same spirit as ref-06p3's step 7.
//
// Run: npm install && npm start   (npm run check for quiet)

import { deepStrictEqual, ok } from "node:assert";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyAttestation } from "node-app-attest";

const QUIET = process.argv.includes("--quiet");
const log = (...a) => QUIET || console.log(...a);

let checks = 0, failures = 0;
function check(name, fn) {
  try { fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const FIXTURES = join(import.meta.dirname, "fixtures");
const devFixture = JSON.parse(readFileSync(join(FIXTURES, "attestation-development.json"), "utf8"));
const prodFixture = JSON.parse(readFileSync(join(FIXTURES, "attestation-production.json"), "utf8"));

// The App ID this specific real attestation was captured against — baked
// into the leaf certificate's RP-ID hash extension by the real device at
// attestation time. Cannot be substituted for Keyring's own App ID without
// a new capture, which needs a real device (see README).
const BUNDLE_IDENTIFIER = "io.uebelacker.AppAttestExample";
const TEAM_IDENTIFIER = "V8H6LQ9448";

log("ref-06p5 — App Attest / Play Integrity binding\n");

// =============================================== act 0: the root is genuine
log("— act 0: the platform root this rung trusts is Apple's own, verified independently —");

const pinnedRootPath = join(FIXTURES, "apple-app-attestation-root-ca.pem");
const pinnedRoot = new X509Certificate(readFileSync(pinnedRootPath, "utf8"));
// Fetched directly via `curl https://www.apple.com/certificateauthority/
// Apple_App_Attestation_Root_CA.pem` (raw HTTPS, not a summarizing fetch —
// see README on why that distinction mattered while building this) on
// 2026-08-21. Frozen here as the expected fingerprint of BOTH that download
// and `node-app-attest`'s internally hardcoded root, so a future dependency
// bump that silently swapped roots would be caught.
const EXPECTED_FINGERPRINT = "1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32";

check("the pinned root matches Apple's own published cert, fetched independently", () => {
  deepStrictEqual(pinnedRoot.fingerprint256, EXPECTED_FINGERPRINT);
});

// node-app-attest doesn't export its internal root, so this checks it the
// only way available without patching the dependency: the genuine fixture
// below only verifies AT ALL if node-app-attest's hardcoded root matches
// the one that actually signed it — and act 0 has already shown that root
// is Apple's real one. A future act (act 1) verifying successfully IS the
// confirmation that node-app-attest's embedded root is the same cert.
log("  (node-app-attest doesn't export its embedded root for direct comparison —");
log("   act 1 verifying successfully against a real Apple-signed chain is the confirmation)");

// ======================================= act 1: the genuine attestation, real
log("\n— act 1: a real, Apple-signed attestation object verifies, offline, for real —");

let devResult;
check("the development-environment fixture verifies against Apple's real root", () => {
  devResult = verifyAttestation({
    attestation: Buffer.from(devFixture.attestation, "base64"),
    challenge: Buffer.from(devFixture.challenge, "base64"),
    keyId: devFixture.keyId,
    bundleIdentifier: BUNDLE_IDENTIFIER,
    teamIdentifier: TEAM_IDENTIFIER,
    allowDevelopmentEnvironment: true,
  });
  deepStrictEqual(devResult.environment, "development");
  deepStrictEqual(devResult.keyId, devFixture.keyId);
  ok(devResult.publicKey.includes("BEGIN PUBLIC KEY"));
});

let prodResult;
check("the production-environment fixture verifies, and reports environment:'production'", () => {
  prodResult = verifyAttestation({
    attestation: Buffer.from(prodFixture.attestation, "base64"),
    challenge: Buffer.from(prodFixture.challenge, "base64"),
    keyId: prodFixture.keyId,
    bundleIdentifier: BUNDLE_IDENTIFIER,
    teamIdentifier: TEAM_IDENTIFIER,
  });
  deepStrictEqual(prodResult.environment, "production");
});

// ================================================ act 2: four ways to forge
log("\n— act 2: tamper one byte at a time — each caught by a different check —");

function flipByte(base64, offset) {
  const buf = Buffer.from(base64, "base64");
  buf[offset] ^= 0xff;
  return buf;
}

check("1 · the attestation object itself tampered — the CBOR/cert structure breaks", () => {
  let threw = null;
  try {
    verifyAttestation({
      attestation: flipByte(devFixture.attestation, 100),
      challenge: Buffer.from(devFixture.challenge, "base64"),
      keyId: devFixture.keyId,
      bundleIdentifier: BUNDLE_IDENTIFIER, teamIdentifier: TEAM_IDENTIFIER,
      allowDevelopmentEnvironment: true,
    });
  } catch (e) { threw = e; }
  ok(threw !== null, "a byte-flipped attestation object must not verify");
});

check("2 · the challenge tampered — the reconstructed nonce no longer matches the cert extension", () => {
  let threw = null;
  try {
    verifyAttestation({
      attestation: Buffer.from(devFixture.attestation, "base64"),
      challenge: flipByte(devFixture.challenge, 0),
      keyId: devFixture.keyId,
      bundleIdentifier: BUNDLE_IDENTIFIER, teamIdentifier: TEAM_IDENTIFIER,
      allowDevelopmentEnvironment: true,
    });
  } catch (e) { threw = e; }
  ok(threw?.message === "nonce does not match", `expected a nonce mismatch, got: ${threw?.message}`);
});

check("3 · the keyId tampered — doesn't match the credential id or the public-key hash", () => {
  let threw = null;
  try {
    verifyAttestation({
      attestation: Buffer.from(devFixture.attestation, "base64"),
      challenge: Buffer.from(devFixture.challenge, "base64"),
      keyId: "wrongKeyIdWrongKeyIdWrongKeyIdWrongKeyId=",
      bundleIdentifier: BUNDLE_IDENTIFIER, teamIdentifier: TEAM_IDENTIFIER,
      allowDevelopmentEnvironment: true,
    });
  } catch (e) { threw = e; }
  ok(threw?.message === "keyId does not match", `expected a keyId mismatch, got: ${threw?.message}`);
});

check("4 · the wrong App ID — the RP-ID hash in authData doesn't match team.bundle", () => {
  let threw = null;
  try {
    verifyAttestation({
      attestation: Buffer.from(devFixture.attestation, "base64"),
      challenge: Buffer.from(devFixture.challenge, "base64"),
      keyId: devFixture.keyId,
      bundleIdentifier: "edu.harvard.seas.atl.keyring", teamIdentifier: TEAM_IDENTIFIER,
      allowDevelopmentEnvironment: true,
    });
  } catch (e) { threw = e; }
  ok(threw?.message === "appId does not match", `expected an appId mismatch, got: ${threw?.message}`);
});

// ========================================= act 3: the Keyring binding, wired
log("\n— act 3: the transcript binding as the App Attest challenge — the wiring, not a live round trip —");

// Identical to ref-06p's §5.3 binding — the same five values the device
// signs with its hardware key, reused here as the App Attest `challenge`.
// verifyAttestation() computes clientDataHash = SHA256(challenge) itself
// (see node_modules/node-app-attest/src/verifyAttestation.js step 2), so
// the RAW binding bytes are what gets passed in, not a pre-hashed value.
function jcs(v) {
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function bindingFor({ taskDigestMultibase, challenge, sensorNonce, sensorDid }) {
  return jcs({ context: "keyring-locality-v1", taskDigestMultibase, challenge, sensorNonce, sensorDid });
}
const TRANSCRIPT_FIELDS = {
  taskDigestMultibase: "zQmThPAfpiEuXaQYikrEdvtWJbtJSCcwYPrh9vWe2pTaoWZ",
  challenge: "9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  sensorNonce: "5a6b7c8d9e0f1a2b3c4d5e6f70819200",
  sensorDid: "did:peer:4wendy",
};
const binding = bindingFor(TRANSCRIPT_FIELDS);
const clientDataHash = createHash("sha256").update(Buffer.from(binding, "utf8")).digest();

check("the binding is deterministic and produces stable bytes to attest over", () => {
  deepStrictEqual(bindingFor(TRANSCRIPT_FIELDS), binding);
  deepStrictEqual(clientDataHash.length, 32);
});
check("mutating ANY of the five fields changes the resulting clientDataHash — §5.4's binds-both-ways property, one layer up", () => {
  for (const field of Object.keys(TRANSCRIPT_FIELDS)) {
    const mutated = bindingFor({ ...TRANSCRIPT_FIELDS, [field]: TRANSCRIPT_FIELDS[field] + "00" });
    const mutatedHash = createHash("sha256").update(Buffer.from(mutated, "utf8")).digest();
    ok(!mutatedHash.equals(clientDataHash), `mutating ${field} did not change clientDataHash`);
  }
});
check("feeding OUR binding as the challenge against the REAL fixture correctly fails — proof the check is live, not a rubber stamp", () => {
  // This is the honest boundary: no real device has ever signed OUR
  // binding (that needs an actual Secure Enclave attestKey() call, ref-06p5
  // has no device). What CAN be shown without one: verifyAttestation() is
  // actually sensitive to the challenge bytes, not just checking shape —
  // substituting our own real binding for the fixture's real captured
  // challenge must fail, specifically on the nonce check.
  let threw = null;
  try {
    verifyAttestation({
      attestation: Buffer.from(devFixture.attestation, "base64"),
      challenge: Buffer.from(binding, "utf8"),
      keyId: devFixture.keyId,
      bundleIdentifier: BUNDLE_IDENTIFIER, teamIdentifier: TEAM_IDENTIFIER,
      allowDevelopmentEnvironment: true,
    });
  } catch (e) { threw = e; }
  ok(threw?.message === "nonce does not match", `expected a nonce mismatch, got: ${threw?.message}`);
});

// ============================================== act 4: the absent path
log("\n— act 4: no attestation offered — the exchange completes, the state is recorded, nothing is inferred —");

// §7.1: localityHardwareAttestation is verified | present-unverified |
// absent, and absence must be an explicit, recorded state — never a
// silent default. This needs no cryptography, only that the assembly
// code doesn't throw, block, or guess when there is nothing to check.
function assembleHardwareAttestationField({ attestationObject, verifiedResult }) {
  if (!attestationObject) return "absent";
  return verifiedResult ? "verified" : "present-unverified";
}
check("absent when no attestation object was offered at all", () => {
  deepStrictEqual(assembleHardwareAttestationField({ attestationObject: null, verifiedResult: null }), "absent");
});
check("present-unverified when an attestation object exists but wasn't (yet) verified", () => {
  deepStrictEqual(assembleHardwareAttestationField({ attestationObject: Buffer.from("stub"), verifiedResult: null }), "present-unverified");
});
check("verified only once the real check (act 1's code path) actually ran and passed", () => {
  deepStrictEqual(assembleHardwareAttestationField({ attestationObject: Buffer.from(devFixture.attestation, "base64"), verifiedResult: devResult }), "verified");
});

// ===================================== act 5: Play Integrity — shape only
log("\n— act 5: Play Integrity — shape-only, honestly, and why —");

// Real Play Integrity tokens are encrypted; decoding one is a live call to
// Google's own backend (POST .../v1/{packageName}:decodeIntegrityToken)
// with a registered Play Console app and Google Cloud credentials — there
// is no offline verification path, with or without test data. What IS
// checkable without that: the same consistency property ref-06p3's step 7
// checks for App Attest — the assertion cannot claim a state its own
// artifact doesn't support.
function verifyPlayIntegrityShapeOnly({ requestHashClaimed, requestHashRecorded, assertionState }) {
  if (!["verified", "present-unverified", "absent"].includes(assertionState))
    return { ok: false, reason: "unknownState" };
  if (assertionState === "verified" && requestHashClaimed !== requestHashRecorded)
    return { ok: false, reason: "requestHashMismatch" };
  return { ok: true };
}
check("shape-only: matching requestHash + a consistent state passes THIS check (not a real signature check)", () => {
  deepStrictEqual(verifyPlayIntegrityShapeOnly({
    requestHashClaimed: clientDataHash.toString("base64"),
    requestHashRecorded: clientDataHash.toString("base64"),
    assertionState: "verified",
  }), { ok: true });
});
check("shape-only: a claimed 'verified' state whose requestHash doesn't match its own record is caught", () => {
  deepStrictEqual(verifyPlayIntegrityShapeOnly({
    requestHashClaimed: clientDataHash.toString("base64"),
    requestHashRecorded: "zSTUB",
    assertionState: "verified",
  }), { ok: false, reason: "requestHashMismatch" });
});
log("  (this act proves consistency, NOT a real signature or root check — see live-play-integrity-optional.mjs)");

// ------------------------------------------------------------------- verdict
log(`\n${failures === 0 ? "✅" : "❌"} ${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
