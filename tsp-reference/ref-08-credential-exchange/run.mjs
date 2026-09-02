/**
 * ref-08 — credential-exchange/{query,present,pending/*} against a real,
 * locally-provisioned vta-service (trust_tasks_subtask.md §9 step 4).
 *
 * Phase 1 (this rung, so far): the DID-auth handshake every REST call needs —
 * POST /auth/challenge, then a holder eddsa-jcs-2022-signed
 * auth/authenticate/0.1 Trust Task to POST /auth/ — proven against a VTA
 * spun up by e2e/lib/vta.js (cloudflared-tunneled, non-interactive
 * `vta setup --from`). Confirmed from the real vta-service Rust source
 * (vta-sdk/src/{auth_di,trust_task_sign,protocols/auth}.rs) and its live
 * /openapi.json, not guessed.
 *
 * did:key + the DataIntegrityProof/eddsa-jcs-2022 shape here mirror
 * @bifold/trust-tasks/src/documentProof.ts exactly (same JCS-canonicalize,
 * same proof-config-hash || document-hash construction, same proofValue
 * encoding) — Keyring's own signer is this proof, just against a different
 * counterparty.
 *
 * Usage: node run.mjs <vtaUrl>  (vtaUrl from e2e/lib/vta.js's startVta())
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import canonicalize from "canonicalize";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58encode(bytes) {
  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }
  return "1".repeat(leadingZeros) + digits.reverse().map((d) => B58[d]).join("");
}

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
}
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A did:key:z... holder identity — multicodec 0xed01 (ed25519-pub). Reuses
 * VERIFIER_SECRET_KEY (hex) if set, so the same DID persists across runs —
 * needed to grant it an ACL role once (`vta import-did`) and reuse it,
 * instead of every run minting an unknown DID the VTA has never seen.
 */
function generateDidKeyHolder() {
  const privateKey = process.env.VERIFIER_SECRET_KEY
    ? hexToBytes(process.env.VERIFIER_SECRET_KEY)
    : ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const prefixed = new Uint8Array([0xed, 0x01, ...publicKey]);
  const did = "did:key:z" + base58encode(prefixed);
  return {
    did,
    privateKey,
    secretKeyHex: bytesToHex(privateKey),
    verificationMethod: `${did}#${did.slice("did:key:".length)}`,
  };
}

/**
 * Sign a Trust Task document with eddsa-jcs-2022 — same algorithm as
 * @bifold/trust-tasks's signDocumentProof: sha256(JCS(proof config)) ||
 * sha256(JCS(document without proof)), ed25519-signed, multibase(base58btc).
 */
function signDocument(doc, holder) {
  const proofConfig = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: new Date().toISOString(),
    verificationMethod: holder.verificationMethod,
    proofPurpose: "assertionMethod",
  };
  const configHash = sha256(new TextEncoder().encode(canonicalize(proofConfig)));
  const documentHash = sha256(new TextEncoder().encode(canonicalize(doc)));
  const signedInput = new Uint8Array(configHash.length + documentHash.length);
  signedInput.set(configHash, 0);
  signedInput.set(documentHash, configHash.length);
  const signature = ed25519.sign(signedInput, holder.privateKey);
  return { ...doc, proof: { ...proofConfig, proofValue: "z" + base58encode(signature) } };
}

const TASK_AUTH_CHALLENGE = "https://trusttasks.org/spec/auth/challenge/0.1";
const TASK_AUTH_AUTHENTICATE = "https://trusttasks.org/spec/auth/authenticate/0.1";

async function postTrustTask(url, body, bearer) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const TASK_CREDENTIAL_EXCHANGE_QUERY = process.env.QUERY_TYPE_URI || "https://trusttasks.org/spec/credential-exchange/query/0.1";

/** A minimal DCQL query — one credential request, SD-JWT-VC format, by vct. */
function minimalDcqlQuery(vct) {
  return {
    credentials: [{ id: "membership", format: "dc+sd-jwt", meta: { vct_values: [vct] } }],
  };
}

async function main() {
  const vtaUrl = process.argv[2];
  const vtaDid = process.argv[3];
  if (!vtaUrl || !vtaDid) {
    console.error("usage: node run.mjs <vtaUrl> <vtaDid>  (both from e2e/lib/vta.js's startVta())");
    process.exit(1);
  }

  const holder = generateDidKeyHolder();
  console.log(`[ref-08] verifier holder: ${holder.did}`);
  if (!process.env.VERIFIER_SECRET_KEY) {
    console.log(`[ref-08] (new holder — export VERIFIER_SECRET_KEY=${holder.secretKeyHex} to reuse it,`);
    console.log(`[ref-08]  and grant it ACL: vta import-did --did ${holder.did} --role initiator)`);
  }

  // POST /auth/challenge — flat JSON is accepted per its own doc comment
  // ("Flat-JSON or Trust-Task auth document"); no proof needed for the
  // challenge step itself.
  const challenge = await postTrustTask(`${vtaUrl}/auth/challenge`, { subject: holder.did });
  console.log(`[ref-08] POST /auth/challenge -> ${challenge.status}`);
  console.log(JSON.stringify(challenge.body, null, 2));

  if (challenge.status !== 200) {
    console.log("[ref-08] challenge step failed — stopping here (see status/body above).");
    return;
  }

  const { challenge: nonce, sessionId } = challenge.body;
  const unsigned = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: TASK_AUTH_AUTHENTICATE,
    payload: { challenge: nonce, sessionId, scope: [] },
    issuer: holder.did,
    recipient: vtaDid,
    issuedAt: new Date().toISOString(),
  };
  const signed = signDocument(unsigned, holder);

  const authenticate = await postTrustTask(`${vtaUrl}/auth/`, signed);
  console.log(`[ref-08] POST /auth/ -> ${authenticate.status}`);
  console.log(JSON.stringify(authenticate.body, null, 2));

  if (authenticate.status !== 200) {
    console.log("[ref-08] authenticate step failed — stopping here.");
    return;
  }
  const accessToken = authenticate.body.payload?.tokens?.accessToken ?? authenticate.body.tokens?.accessToken;

  // Phase 2: submit the DCQL query as this now-authenticated (but not
  // pre-trusted-as-verifier — role `initiator` only) holder. handle_credential_
  // query defers any query from a caller it hasn't specifically pre-trusted,
  // regardless of ACL role — proving that is the point of this phase.
  const queryDoc = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: TASK_CREDENTIAL_EXCHANGE_QUERY,
    payload: {
      dcql_query: minimalDcqlQuery("https://openvtc.org/credentials/MembershipCredential"),
      nonce: crypto.randomUUID(),
      purpose: "ref-08: prove the query/defer wire path",
    },
    issuer: holder.did,
    recipient: vtaDid,
    issuedAt: new Date().toISOString(),
  };
  const signedQuery = signDocument(queryDoc, holder);

  const query = await postTrustTask(`${vtaUrl}/api/trust-tasks`, signedQuery, accessToken);
  console.log(`[ref-08] POST /api/trust-tasks (credential-exchange/query/0.1) -> ${query.status}`);
  console.log(JSON.stringify(query.body, null, 2));
}

main();
