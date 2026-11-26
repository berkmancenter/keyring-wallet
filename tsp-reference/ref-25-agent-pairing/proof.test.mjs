// A Data Integrity proof (eddsa-jcs-2022), made and checked. The recorded credentials are ones the lab VTA
// signed as a persona with `keys/sign-document/0.1` (fixtures/vta-signed-as-persona-<version>.json); they are
// checked here with no VTA running, with the key the persona's own DID document lists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { identityFromSeed } from "./identity.mjs";
import { signTask } from "./mediator.mjs";
import { CRYPTOSUITE, keyOfMethod, listedUnder, secure, verify } from "./proof.mjs";

const party = (byte) => identityFromSeed(new Uint8Array(32).fill(byte));
const agent = party(7);
const other = party(9);
const created = "2026-11-26T00:00:00Z";
const credential = () => ({
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"],
  type: ["VerifiableCredential", "DTGCredential", "DelegationCredential"],
  issuer: agent.did,
  issuerScope: "directed",
  credentialSubject: { id: other.did, delegation: { accepts: "a digest" } },
});
const by = (identity) => ({ verificationMethod: identity.authVm, edSecret: identity.edSecret, created });

const samples = readdirSync(new URL("./fixtures/", import.meta.url))
  .filter((name) => /^vta-signed-as-persona-.*\.json$/.test(name))
  .map((name) => ({ name, ...JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) }));

test("a document secured with a key verifies with that key and with no other", () => {
  const secured = secure(credential(), by(agent));
  assert.equal(secured.proof.cryptosuite, CRYPTOSUITE);
  assert.equal(secured.proof.proofPurpose, "assertionMethod");
  assert.equal(verify(secured, agent.edPublic), true);
  assert.equal(verify(secured, other.edPublic), false);
});

test("the proof carries the document's own context, and none when the document has none", () => {
  assert.deepEqual(secure(credential(), by(agent)).proof["@context"], credential()["@context"]);
  const { "@context": _context, ...bare } = credential();
  const secured = secure(bare, by(agent));
  assert.equal("@context" in secured.proof, false);
  assert.equal(verify(secured, agent.edPublic), true);
});

test("any change to the document or to the proof's options fails the check", () => {
  const secured = secure(credential(), by(agent));
  const changed = [
    { ...secured, issuerScope: "open" },
    { ...secured, credentialSubject: { ...secured.credentialSubject, delegation: { accepts: "another digest" } } },
    { ...secured, extra: true },
    { ...secured, proof: { ...secured.proof, created: "2026-11-27T00:00:00Z" } },
    { ...secured, proof: { ...secured.proof, proofPurpose: "authentication" } },
    { ...secured, proof: { ...secured.proof, verificationMethod: other.authVm } },
  ];
  for (const [index, document] of changed.entries()) assert.equal(verify(document, agent.edPublic), false, `change ${index}`);
  // The members' order is not part of what is signed.
  assert.equal(verify(Object.fromEntries(Object.entries(secured).reverse()), agent.edPublic), true);
});

test("a proof that names another context than the document's is refused before any signature is checked", () => {
  const secured = secure(credential(), by(agent));
  const moved = { ...secured, "@context": ["https://www.w3.org/ns/credentials/v2"] };
  assert.equal(verify(moved, agent.edPublic), false);
});

test("what is not one eddsa-jcs-2022 proof is not verified", () => {
  const secured = secure(credential(), by(agent));
  assert.equal(verify(credential(), agent.edPublic), false, "no proof");
  assert.equal(verify({ ...secured, proof: [secured.proof] }, agent.edPublic), false, "a proof set");
  assert.equal(verify({ ...secured, proof: { ...secured.proof, cryptosuite: "eddsa-rdfc-2022" } }, agent.edPublic), false, "another suite");
  assert.equal(verify({ ...secured, proof: { ...secured.proof, proofValue: "not multibase" } }, agent.edPublic), false, "a value that is not base58btc");
  assert.equal(verify({ ...secured, proof: { ...secured.proof, proofValue: "z0OIl" } }, agent.edPublic), false, "characters base58 does not have");
  assert.equal(verify(undefined, agent.edPublic), false);
});

test("securing a document that already has a proof is refused", () => {
  assert.throws(() => secure(secure(credential(), by(agent)), by(agent)), /already carries a proof/);
});

test("a Trust Task document the rung signs verifies as an authentication proof", () => {
  const document = signTask(agent, "https://trusttasks.org/spec/auth/whoami/0.1", other.did, {});
  assert.equal(document.proof.proofPurpose, "authentication");
  assert.equal("@context" in document.proof, false);
  assert.equal(verify(document, agent.edPublic), true);
  assert.equal(verify({ ...document, payload: { more: 1 } }, agent.edPublic), false);
});

test("a key is read from a DID document by its method, and only under the relationships that list it", () => {
  const document = {
    id: "did:example:p",
    verificationMethod: [{ id: "did:example:p#key-0", type: "Multikey", controller: "did:example:p", publicKeyMultibase: agent.authVm.split("#")[1] }],
    assertionMethod: ["did:example:p#key-0"],
    authentication: [{ id: "did:example:p#key-0" }],
  };
  assert.deepEqual(keyOfMethod(document, "did:example:p#key-0"), agent.edPublic);
  assert.equal(keyOfMethod(document, "did:example:p#key-1"), undefined);
  const holding = (publicKeyMultibase) => ({ verificationMethod: [{ id: "did:example:p#key-0", publicKeyMultibase }] });
  assert.equal(keyOfMethod(holding("zNotAKey"), "did:example:p#key-0"), undefined, "not a key");
  assert.equal(keyOfMethod(holding(agent.kid.split("#")[1]), "did:example:p#key-0"), undefined, "a key-agreement key signs nothing");
  assert.equal(listedUnder(document, "assertionMethod", "did:example:p#key-0"), true);
  assert.equal(listedUnder(document, "authentication", "did:example:p#key-0"), true);
  assert.equal(listedUnder(document, "keyAgreement", "did:example:p#key-0"), false);
});

test("the credentials the lab VTA signed as a persona are recorded", () => {
  assert.ok(samples.length > 0, "no fixtures/vta-signed-as-persona-<version>.json: record one with `node vta-run.mjs --record`");
});

for (const sample of samples) {
  test(`${sample.name}: the VTA's proof verifies with the key the persona's document lists, as the issuer`, () => {
    const { credential: secured, personaDocument } = sample;
    assert.equal(secured.issuer, personaDocument.id);
    assert.deepEqual(secured.type, ["VerifiableCredential", "DTGCredential", "DelegationCredential"]);
    assert.equal(secured.issuerScope, "directed");
    assert.equal(secured.proof.verificationMethod.split("#")[0], personaDocument.id);
    assert.equal(listedUnder(personaDocument, "assertionMethod", secured.proof.verificationMethod), true);
    const key = keyOfMethod(personaDocument, secured.proof.verificationMethod);
    assert.equal(verify(secured, key), true);
    assert.equal(verify({ ...secured, validUntil: "2099-01-01T00:00:00Z" }, key), false, "a later validUntil");
    assert.equal(verify(secured, agent.edPublic), false, "another key");
  });
}
