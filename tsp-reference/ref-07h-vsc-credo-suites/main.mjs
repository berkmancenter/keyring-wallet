import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

import "@openwallet-foundation/askar-nodejs";
import { Agent, ClaimFormat, JsonTransformer, PeerDidNumAlgo, W3cCredential, W3cCredentialsModule, W3cJsonLdVerifiableCredential } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { DataIntegritySuiteModule, DATA_INTEGRITY_PROOF_TYPE, EDDSA_RDFC_2022_CRYPTOSUITE_NAME } from "./di-suite.mjs";
import { createRung07hDocumentLoader } from "./document-loader.mjs";
// @bifold/trust-tasks is declared platform-neutral by the root CLAUDE.md ("no
// Node-only or RN-only imports allowed"), so its build output is directly
// importable from a plain Node script — this is the SAME primitive
// production code calls, not a reimplementation.
import { taskDigestMultibase, digestBytesEqual } from "../../bifold/packages/trust-tasks/build/documentProof.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let checks = 0;
function assert(cond, what) {
  if (!cond) throw new Error(`FAILED: ${what}`);
  checks++;
}

const DTG_NS = "https://firstperson.network/credentials/dtg/v1#"; // plan §2.2's placeholder — Q6 (namespace) is orthogonal to what this rung proves
const DTG_CONTEXT = "https://firstperson.network/credentials/dtg/v1";

async function makeWitnessAgent() {
  const agent = new Agent({
    config: { label: "ref-07h-witness" },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref07h-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: "ref07h-testkey" },
      }),
      dataIntegrity: new DataIntegritySuiteModule(),
      // Same wiring shape as production's createVrcDocumentLoader (see that
      // file's own doc comment): pass the factory itself, not a pre-invoked
      // loader — Credo calls it with the real AgentContext internally.
      w3cCredentials: new W3cCredentialsModule({ documentLoader: createRung07hDocumentLoader }),
    },
  });
  await agent.initialize();
  return agent;
}

async function createWitnessDid(agent) {
  const result = await agent.dids.create({
    method: "peer",
    options: {
      numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
      createKey: { type: { kty: "OKP", crv: "Ed25519" } },
    },
  });
  const did = result.didState.did;
  const verificationMethod = result.didState.didDocument?.verificationMethod?.[0]?.id;
  if (!did || !verificationMethod) {
    throw new Error(`witness DID creation failed: ${JSON.stringify(result.didState)}`);
  }
  return { did, verificationMethod };
}

function loadRealVrc() {
  const fixturePath = path.join(
    __dirname,
    "../ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json"
  );
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  // Either half of the real captured exchange works — this rung needs one
  // real, previously-signed VRC to be the object of a witness statement, not
  // both directions of the edge. Bob's half, arbitrarily.
  const vrc = raw.vrcs?.[0]?.credential;
  if (!vrc?.issuer || !vrc?.proof) {
    throw new Error(`fixture did not contain the expected shape: ${fixturePath}`);
  }
  return vrc;
}

/** D1/D2/D3/D4/D7 — the dtg:witnessed VSC shape, plan §3's table. */
function buildVscJson({ witnessDid, subjectId, vrcDigest, taskContext }) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2", DTG_CONTEXT],
    type: ["VerifiableCredential", "DTGCredential", "StatementCredential"],
    issuer: witnessDid,
    validFrom: new Date().toISOString(),
    taskContext, // D4 — top level, sibling of credentialSubject
    credentialSubject: {
      id: subjectId, // D6 — MUST equal the referenced VRC's issuer
      predicate: `${DTG_NS}witnessed`, // D2
      object: { digestMultibase: vrcDigest }, // D3
      witnessContext: { event: "ref-07h", sessionId: "ref-07h-session", method: "ref-07h-harness" },
    },
  };
}

const SUITES = [
  { label: "Ed25519Signature2018", proofType: "Ed25519Signature2018" },
  { label: "DataIntegrityProof/eddsa-rdfc-2022", proofType: DATA_INTEGRITY_PROOF_TYPE, cryptosuite: EDDSA_RDFC_2022_CRYPTOSUITE_NAME },
];

/** D6, precisely (plan §3 D6, §3.2): the two independent checks a verifier holding the referenced VRC MUST run. */
function checkD6(vscJson, vrc, vrcDigest) {
  const digestOk = digestBytesEqual(vscJson.credentialSubject.object.digestMultibase, vrcDigest);
  const subjectOk = vscJson.credentialSubject.id === vrc.issuer;
  return { digestOk, subjectOk, pass: digestOk && subjectOk };
}

export async function main({ say }) {
  const agent = await makeWitnessAgent();
  try {
    const { did: witnessDid, verificationMethod } = await createWitnessDid(agent);
    const vrc = loadRealVrc();
    const vrcDigest = taskDigestMultibase(vrc);
    say(`  witness DID: ${witnessDid}`);
    say(`  real VRC issuer (this VSC's expected subject): ${vrc.issuer}`);
    say(`  taskDigestMultibase(vrc) = ${vrcDigest}\n`);

    for (const suite of SUITES) {
      say(`── ${suite.label} ──`);
      const taskContext = `urn:uuid:ref-07h-${suite.proofType}-${Date.now()}`;

      // 1. Sign a correctly-formed VSC (subject == VRC issuer) through Credo's real signing path.
      const vscJson = buildVscJson({ witnessDid, subjectId: vrc.issuer, vrcDigest, taskContext });
      const credential = JsonTransformer.fromJSON(vscJson, W3cCredential, { validate: false });
      const signed = await agent.w3cCredentials.signCredential({
        format: ClaimFormat.LdpVc,
        credential,
        proofType: suite.proofType,
        ...(suite.cryptosuite ? { cryptosuite: suite.cryptosuite } : {}),
        verificationMethod,
      });
      const signedJson = JsonTransformer.toJSON(signed);
      assert(signedJson.proof?.type === suite.proofType, `${suite.label}: signed proof carries the expected type`);
      if (suite.cryptosuite) {
        assert(signedJson.proof?.cryptosuite === suite.cryptosuite, `${suite.label}: signed proof carries the expected cryptosuite`);
      }

      // 2. Verify through Credo's real verify path — not a hand-rolled verifier.
      const verifyResult = await agent.w3cCredentials.verifyCredential({ credential: signed });
      if (verifyResult.isValid !== true) {
        say(`  verifyResult (${suite.label}): ${JSON.stringify(verifyResult, null, 2)}`);
      }
      assert(verifyResult.isValid === true, `${suite.label}: Credo's real verify path accepts the honestly-signed VSC`);

      // 3. D6, run against the credential Credo just verified (not the pre-sign fixture).
      const d6 = checkD6(signedJson, vrc, vrcDigest);
      assert(d6.digestOk, `${suite.label}: D6 digest check passes (object.digestMultibase == taskDigestMultibase(vrc))`);
      assert(d6.subjectOk, `${suite.label}: D6 subject check passes (credentialSubject.id == vrc.issuer)`);
      assert(d6.pass, `${suite.label}: D6 overall passes on a Credo-verified, correctly-subjected VSC`);

      // 4. Negative — tamper: any signed member changed must break the proof under Credo's real verify.
      const tamperedJson = JsonTransformer.toJSON(signed);
      tamperedJson.credentialSubject.object.digestMultibase = tamperedJson.credentialSubject.object.digestMultibase.slice(0, -4) + "zzzz";
      // Signed (proofed) JSON re-hydrates as W3cJsonLdVerifiableCredential, not
      // the unsigned W3cCredential used above for pre-sign construction —
      // verifyCredential rejects the latter outright ("Credential must be
      // either a W3cJsonLdVerifiableCredential or a W3cJwtVerifiableCredential").
      const tampered = JsonTransformer.fromJSON(tamperedJson, W3cJsonLdVerifiableCredential, { validate: false });
      const tamperVerify = await agent.w3cCredentials.verifyCredential({ credential: tampered });
      assert(tamperVerify.isValid === false, `${suite.label}: Credo's real verify path rejects a tampered object.digestMultibase`);

      // 5. Negative — wrong subject, HONESTLY signed: a validly-signed VSC whose
      //    credentialSubject.id is NOT the referenced VRC's issuer. Credo's
      //    signature verify must PASS (it is a genuine signature over genuine
      //    bytes); D6 must independently REJECT it. This is the case D6 exists
      //    for — a valid signature says nothing about which edge was witnessed.
      const wrongSubjectJson = buildVscJson({
        witnessDid,
        subjectId: "did:key:z6MkpTHR8VNsWrongSubjectNotTheVrcIssuer",
        vrcDigest,
        taskContext: `${taskContext}-wrong-subject`,
      });
      const wrongSubjectCredential = JsonTransformer.fromJSON(wrongSubjectJson, W3cCredential, { validate: false });
      const wrongSubjectSigned = await agent.w3cCredentials.signCredential({
        format: ClaimFormat.LdpVc,
        credential: wrongSubjectCredential,
        proofType: suite.proofType,
        ...(suite.cryptosuite ? { cryptosuite: suite.cryptosuite } : {}),
        verificationMethod,
      });
      const wrongSubjectVerify = await agent.w3cCredentials.verifyCredential({ credential: wrongSubjectSigned });
      assert(wrongSubjectVerify.isValid === true, `${suite.label}: a wrong-subject VSC still verifies honestly under Credo (its signature is genuine)`);
      const wrongSubjectSignedJson = JsonTransformer.toJSON(wrongSubjectSigned);
      const d6Wrong = checkD6(wrongSubjectSignedJson, vrc, vrcDigest);
      assert(d6Wrong.digestOk, `${suite.label}: wrong-subject VSC still has a correct digest (isolating the subject check)`);
      assert(!d6Wrong.subjectOk, `${suite.label}: D6 subject check correctly fails (credentialSubject.id != vrc.issuer)`);
      assert(!d6Wrong.pass, `${suite.label}: D6 overall correctly rejects a validly-signed, wrong-subject VSC`);

      say(`  all ${suite.label} checks passed\n`);
    }

    say(`${checks} checks passed.`);
  } finally {
    await agent.shutdown();
  }
}
