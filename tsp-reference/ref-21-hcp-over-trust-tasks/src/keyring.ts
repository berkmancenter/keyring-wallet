// Keyring's side signs and verifies with KEYRING'S OWN CODE: packages/trust-tasks/src/documentProof.ts,
// loaded from a Keyring checkout as it is (no copy). That file signs through Credo's key store, so
// this rung hands it the smallest stand-in for an agent: a did:key resolver (Credo's own DidKey)
// and a `sign` that uses the rung's throwaway Ed25519 key. Everything else — the proof
// configuration, the canonical form, the hashing, the timestamps, the verification rules — is
// the code the app ships.
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Identity } from "./identity.ts";

export interface KeyringProofs {
  sign(doc: Record<string, unknown>, by: Identity, proofPurpose?: "assertionMethod" | "authentication"): Promise<Record<string, unknown>>;
  /** vta-sdk's rule, as Keyring mirrors it: any purpose, the method must be in the signer's DID document. */
  verifyTrustTask(doc: Record<string, unknown>): Promise<{ ok: true; signer: string } | { ok: false; reason: string; detail: string }>;
  /** Keyring's stricter check against an expected controller and (optionally) a purpose. */
  verifyDocument(doc: Record<string, unknown>, controller: string, proofPurpose?: "assertionMethod" | "authentication"): Promise<boolean>;
  digestMultibase(value: unknown): string;
  digestBytesEqual(a: string, b: string): boolean;
  jcs(value: unknown): string;
  /** Credo's MultiBaseEncoder.decode, which Keyring's consentMatchCode uses. */
  multibaseDecode(value: string): Uint8Array;
}

export async function loadKeyringProofs(keyringRoot: string, keys: Map<string, Uint8Array>): Promise<KeyringProofs> {
  const pkg = join(keyringRoot, "packages", "trust-tasks");
  const mod = await import(pathToFileURL(join(pkg, "src", "documentProof.ts")).href);
  const require = createRequire(join(pkg, "package.json"));
  const credo = await import(pathToFileURL(require.resolve("@credo-ts/core")).href);
  const DidKey = credo.DidKey ?? credo.default?.DidKey;
  if (!DidKey) throw new Error("Credo's DidKey is not exported where expected");

  const agentFor = (signerDid?: string) => ({
    dids: {
      resolveDidDocument: async (did: string) => DidKey.fromDid(did.split("#")[0]).didDocument,
      getCreatedDids: async () => [],
    },
    dependencyManager: {
      resolve: () => ({
        sign: async ({ data }: { data: Uint8Array }) => {
          const seed = signerDid ? keys.get(signerDid) : undefined;
          if (!seed) throw new Error(`no key for ${signerDid}`);
          return { signature: ed25519.sign(data, seed) };
        },
      }),
    },
  });

  return {
    sign: (doc, by, proofPurpose) =>
      mod.signDocumentProof(agentFor(by.did), doc, by.did, { kmsKeyId: "rung-throwaway", ...(proofPurpose ? { proofPurpose } : {}) }),
    verifyTrustTask: (doc) => mod.verifyTrustTaskProof(agentFor(), doc),
    verifyDocument: (doc, controller, proofPurpose) =>
      mod.verifyDocumentProof(agentFor(), doc, controller, proofPurpose ? { proofPurpose } : {}),
    digestMultibase: mod.digestMultibase,
    digestBytesEqual: mod.digestBytesEqual,
    jcs: mod.jcsCanonicalize,
    multibaseDecode: (v: string) => (credo.MultiBaseEncoder ?? credo.default?.MultiBaseEncoder).decode(v).data,
  };
}
