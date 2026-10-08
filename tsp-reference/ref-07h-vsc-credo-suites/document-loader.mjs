// A minimal equivalent of bifold/packages/core/src/modules/vrc/createVrcDocumentLoader.ts,
// simplified for this rung: DID resolution + the standard/security contexts
// @bifold/vrc-contexts already bundles (imported from its real build output,
// not retyped) + ONE local entry for the DTG context, mapped to the plan's
// D7 IRI — NOT the mismatched https://www.firstperson.network/dtg/v1 that
// production's DTG_CONTEXT_URL still carries (plan §2.5).
//
// The DTG context document here defines real JSON-LD terms for every member
// this rung emits — pulled forward from plan V2's eventual @bifold/vrc-contexts
// work, proven against Credo's REAL signing path rather than a bespoke test
// harness. This is NOT optional (see the README's "safe: true" finding):
// ref-07c measured "untermed member -> 0 quads, not fatal" using plain
// jsonld.expand()/canonize() without safe mode. Credo's real shipped signing
// path (both Ed25519Signature2018 and DataIntegrityProof/eddsa-rdfc-2022 —
// confirmed on Ed25519Signature2018 first) sets safe: true unconditionally,
// baked into @digitalcredentials/jsonld-signatures and
// @digitalcredentials/eddsa-rdfc-2022-cryptosuite, not a Credo config toggle.
// Under safe mode, a property that cannot expand to an absolute IRI throws
// (jsonld.ValidationError) instead of silently dropping to zero quads. So an
// untermed member does not just "sign without that claim" here — it blocks
// signing outright. `object.digestMultibase` is the one member NOT termed
// below: it is already defined and @protected by the base credentials/v2
// context (security#digestMultibase), and redefining a protected term is
// itself a fatal JSON-LD error (plan §3.7 / Alberto's review, finding A2).
import { DidResolverService, isDid } from "@credo-ts/core";
import {
  CREDENTIALS_V2_CONTEXT_URL,
  CREDENTIALS_V2_CONTEXT_DOCUMENT,
  CACHED_STANDARD_CONTEXTS,
} from "../../bifold/packages/vrc-contexts/build/index.js";

export const DTG_CONTEXT_URL = "https://firstperson.network/credentials/dtg/v1"; // plan D7 — the spec's own IRI, not production's mismatched one

// Must match main.mjs's DTG_NS (independently declared there, same as this
// file independently declares DTG_CONTEXT_URL above — this rung's existing
// convention, not a new one).
const DTG_NS = "https://firstperson.network/credentials/dtg/v1#";

const DTG_CONTEXT_DOCUMENT = {
  "@context": {
    "@protected": true,
    DTGCredential: `${DTG_NS}DTGCredential`, // D1 — type-array members need terms too, not only credentialSubject properties
    StatementCredential: `${DTG_NS}StatementCredential`, // D1
    predicate: { "@id": `${DTG_NS}predicate`, "@type": "@id" }, // D2
    object: `${DTG_NS}object`, // D3 — digestMultibase itself: see comment above, not redefined here
    taskContext: `${DTG_NS}taskContext`, // D4 — top-level sibling of credentialSubject
    witnessContext: {
      "@id": `${DTG_NS}witnessContext`,
      "@context": {
        "@protected": true,
        event: `${DTG_NS}event`,
        sessionId: `${DTG_NS}sessionId`,
        method: `${DTG_NS}method`,
      },
    },
  },
};

const LOCAL_CONTEXTS = {
  [DTG_CONTEXT_URL]: DTG_CONTEXT_DOCUMENT,
  [CREDENTIALS_V2_CONTEXT_URL]: CREDENTIALS_V2_CONTEXT_DOCUMENT,
  ...CACHED_STANDARD_CONTEXTS,
};

// Ported from createVrcDocumentLoader.ts's VERIFICATION_METHOD_CONTEXTS /
// toPlainVerificationMethod, not reinvented: Ed25519Signature2018's verify
// path (JwsLinkedDataSignature.assertVerificationMethod) requires the
// dereferenced key document's own @context to include the suite's security
// context — a bare {id, type, controller, publicKey...} document with no
// @context fails verification with "the '@context' of the verification
// method (key) MUST contain the context url ...ed25519-2018/v1", even
// though signing (which does not dereference the key document the same way)
// succeeds. Only Ed25519VerificationKey2018 needs this in production; that
// is the only entry there, so it is the only one here.
const VERIFICATION_METHOD_CONTEXTS = {
  Ed25519VerificationKey2018: ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/ed25519-2018/v1"],
};

function toPlainVerificationMethod(key) {
  const plain = { id: key.id, type: key.type, controller: key.controller };
  if (VERIFICATION_METHOD_CONTEXTS[key.type]) {
    plain["@context"] = VERIFICATION_METHOD_CONTEXTS[key.type];
  }
  if (key.publicKeyBase58) plain.publicKeyBase58 = key.publicKeyBase58;
  if (key.publicKeyBase64) plain.publicKeyBase64 = key.publicKeyBase64;
  if (key.publicKeyHex) plain.publicKeyHex = key.publicKeyHex;
  if (key.publicKeyPem) plain.publicKeyPem = key.publicKeyPem;
  if (key.publicKeyMultibase) plain.publicKeyMultibase = key.publicKeyMultibase;
  if (key.publicKeyJwk) plain.publicKeyJwk = key.publicKeyJwk;
  return plain;
}

export function createRung07hDocumentLoader(agentContext) {
  const didResolver = agentContext.dependencyManager.resolve(DidResolverService);

  return async (url) => {
    const normalizedUrl = url.split("#")[0];

    if (isDid(normalizedUrl)) {
      const result = await didResolver.resolve(agentContext, normalizedUrl);
      if (result.didResolutionMetadata.error || !result.didDocument) {
        throw new Error(`Unable to resolve DID: ${normalizedUrl}`);
      }
      const { didDocument } = result;
      const documentJson = didDocument.toJSON();
      if (url.includes("#")) {
        const fragment = `#${url.split("#").pop() ?? ""}`;
        const key = didDocument.dereferenceKey(fragment);
        return { contextUrl: null, documentUrl: url, document: toPlainVerificationMethod(key) };
      }
      return { contextUrl: null, documentUrl: url, document: documentJson };
    }

    if (LOCAL_CONTEXTS[url]) {
      return { contextUrl: null, documentUrl: url, document: LOCAL_CONTEXTS[url] };
    }

    if (!/^https?:/i.test(normalizedUrl)) {
      return { contextUrl: null, documentUrl: url, document: { "@id": url } };
    }

    throw new Error(
      `document loader: no local entry for ${url} and this rung does not fall back to the network (unlike production's createVrcDocumentLoader) — add it to LOCAL_CONTEXTS if it's a genuine new dependency`
    );
  };
}
