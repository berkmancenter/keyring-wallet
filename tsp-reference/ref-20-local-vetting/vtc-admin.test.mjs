/**
 * vtc-admin.mjs against a fake VTC: what each command puts on the wire, and
 * what it prints for the e2e callers that parse its stdout.
 *
 * The documents are checked against the published payload schemas the VTC
 * validates them with (trust-tasks-rs 0.24.6 `specs/**`, every one
 * `additionalProperties: false`), and each proof is verified here the way the
 * VTC verifies it: eddsa-jcs-2022 over the document minus `proof`, by the key
 * the document's `issuer` names (vti-common `verify_trust_task_proof_with`).
 *
 *   node --test vtc-admin.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import canonicalize from "canonicalize";
import { base58encode, generateDidKeyHolder } from "./di-proof.mjs";
import { signTask } from "./vtc-admin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "vtc-admin.mjs");
const VTC_DID = "did:webvh:QmTest:vtc.example";
const SPEC = "https://trusttasks.org/spec/";

// A throwaway admin: a fixed seed, written as `vta export-admin` writes one.
const SEED_HEX = "11".repeat(32);
const ADMIN = generateDidKeyHolder(SEED_HEX);
const dir = mkdtempSync(path.join(tmpdir(), "vtc-admin-test-"));
const CRED = path.join(dir, "admin.json");
writeFileSync(CRED, JSON.stringify({ did: ADMIN.did, privateKeyMultibase: "z" + base58encode(Buffer.from(SEED_HEX, "hex")) }));

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58decode(s) {
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
  const out = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

/** The VTC's check: the proof verifies under the issuer's own did:key. */
function verifyProof(doc) {
  const { proof, ...unsigned } = doc;
  const { proofValue, ...config } = proof;
  const vmDid = config.verificationMethod.split("#")[0];
  assert.equal(vmDid, doc.issuer, "the proof's key belongs to the document's issuer (SPEC §4.7)");
  const pub = base58decode(vmDid.slice("did:key:z".length)).slice(2);
  const input = new Uint8Array(64);
  input.set(sha256(new TextEncoder().encode(canonicalize(config))), 0);
  input.set(sha256(new TextEncoder().encode(canonicalize(unsigned))), 32);
  return ed25519.verify(base58decode(proofValue.slice(1)), input, pub);
}

/** Whole-second RFC 3339 UTC — what chrono writes back, so what the VTC re-canonicalises. */
const WIRE_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Every property a payload may carry, per the published schema. */
const ALLOWED = {
  "vtc/invitations/issue/0.1": ["ext", "role", "subjectDid", "validityDays"],
  "vtc/invitations/list/0.1": ["ext"],
  "vtc/invitations/deliver/0.1": ["channel", "ext", "id"],
  "vtc/invitations/revoke/0.1": ["ext", "id"],
  "vtc/members/list/0.1": ["cursor", "ext", "limit", "role"],
  "vtc/join-requests/list/0.1": ["cursor", "ext", "limit", "status"],
  "vtc/join-requests/decide/0.1": ["decision", "ext", "id", "reason"],
  "vtc/join-requests/manifest/0.2": ["ext"],
  "vtc/endorsement-types/register/0.1": ["claimSchema", "description", "ext", "typeUri"],
  "vtc/schemas/accepts/register/0.1": ["description", "ext", "id", "query", "vetting"],
  "vtc/schemas/accepts/delete/0.1": ["ext", "id"],
  "vtc/community/join-discovery/show/0.1": ["ext"],
  "vtc/community/join-discovery/update/0.1": ["ext", "joinDiscovery"],
  "vtc/members/admin-remove/0.1": ["did", "disposition", "ext", "reason"],
  "vtc/endorsement-types/list/0.1": ["cursor", "ext", "limit"],
  "vtc/vetting/vetters/grant/0.1": ["ext", "memberDid", "validitySeconds"],
  "policy/upsert/0.2": ["appliesTo", "description", "enabled", "expectedVersion", "ext", "id", "module", "name", "priority"],
  "policy/activate/0.1": ["contextId", "ext", "id", "purpose"],
  "policy/active/0.1": ["contextId", "ext", "purpose"],
  "policy/get/0.1": ["ext", "id"],
};

/**
 * A fake VTC. `tasks` answers a signed document by its type (short form);
 * `rest` answers `METHOD /path`. Records every request.
 */
async function fakeVtc({ tasks = {}, rest = {} } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url, "http://x");
    seen.push({ method: req.method, path: url.pathname + url.search, headers: req.headers, body });
    const send = (status, json) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (req.method === "POST" && url.pathname === "/v1/trust-tasks") {
      const short = String(body?.type ?? "").replace(SPEC, "");
      const answer = tasks[short];
      if (!answer) return send(400, { type: `${SPEC}trust-task-error/0.5`, payload: { code: "unsupportedTypeOrVersion", message: short } });
      const [status, payload] = typeof answer === "function" ? answer(body) : answer;
      return send(status, { id: `urn:uuid:${crypto.randomUUID()}`, type: status < 300 ? `${body.type}#response` : `${SPEC}trust-task-error/0.5`, threadId: body.id, payload });
    }
    if (req.method === "POST" && url.pathname === "/v1/auth/challenge") return send(200, { challenge: "c-1", sessionId: "s-1" });
    if (req.method === "POST" && url.pathname === "/v1/auth/") return send(200, { payload: { tokens: { accessToken: "bearer-1" } } });
    const answer = rest[`${req.method} ${url.pathname}`];
    if (answer) return send(...answer);
    // What VTI main answers for a removed admin route: the console's HTML.
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html>console</html>");
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  return { base, seen, close: () => new Promise((ok) => server.close(ok)) };
}

function run(base, ...args) {
  return new Promise((ok) => {
    execFile("node", [CLI, base, VTC_DID, CRED, ...args], { encoding: "utf8" }, (err, stdout, stderr) =>
      ok({ code: err ? err.code : 0, stdout, stderr })
    );
  });
}

/** The signed documents a run sent, each checked for shape and proof. */
function signedDocs(seen) {
  const docs = seen.filter((r) => r.path === "/v1/trust-tasks").map((r) => {
    assert.equal(r.headers.authorization, undefined, "a signed document carries no bearer");
    assert.equal(r.headers["trust-task"], undefined, "the document's own type routes it");
    const d = r.body;
    assert.match(d.id, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.equal(d.issuer, ADMIN.did);
    assert.equal(d.recipient, VTC_DID);
    assert.match(d.issuedAt, WIRE_SECONDS);
    assert.ok(Math.abs(Date.parse(d.issuedAt) - Date.now()) < 60_000, "issuedAt is now");
    assert.equal(d.proof.type, "DataIntegrityProof");
    assert.equal(d.proof.cryptosuite, "eddsa-jcs-2022");
    assert.equal(d.proof.proofPurpose, "authentication");
    assert.equal(d.proof.verificationMethod, ADMIN.verificationMethod);
    assert.match(d.proof.created, WIRE_SECONDS);
    assert.ok(Date.parse(d.proof.created) <= Date.parse(d.issuedAt), "created is back-dated, never in the verifier's future");
    assert.ok(verifyProof(d), `the proof on ${d.type} verifies`);
    const short = d.type.replace(SPEC, "");
    assert.ok(ALLOWED[short], `${short} is a known task`);
    for (const k of Object.keys(d.payload)) assert.ok(ALLOWED[short].includes(k), `${short} payload carries no ${k}`);
    return { short, payload: d.payload };
  });
  return docs;
}

test("signTask: whole-second instants on a whole second, and a proof that a changed payload breaks", () => {
  const now = new Date("2026-09-28T10:15:00.000Z");
  const doc = signTask(`${SPEC}vtc/invitations/list/0.1`, {}, ADMIN, VTC_DID, now);
  assert.equal(doc.issuedAt, "2026-09-28T10:15:00Z", "not .000Z, which the VTC re-serialises without");
  assert.equal(doc.proof.created, "2026-09-28T10:14:00Z");
  assert.equal(doc.proof.proofPurpose, "authentication");
  assert.ok(verifyProof(doc));
  assert.equal(verifyProof({ ...doc, payload: { ext: { "org.example": {} } } }), false);
  assert.equal(verifyProof({ ...doc, recipient: "did:web:elsewhere" }), false);
});

/** What run-vti-invite.js's communityRead parses. */
const inviteParse = (out) => JSON.parse(out.slice(out.indexOf("\n{") + 1));
/** What run-vti-vetting.js's admin parses. */
const vettingParse = (out) => JSON.parse(out.slice(out.indexOf("{")));
/** What communityMembers.js parses. */
const membersParse = (out) => JSON.parse(out.slice(out.indexOf("{", out.indexOf("->"))));
/** What run-vetter-grant-lifecycle.js reads as the status. */
const statusOf = (out) => /-> (\d{3})/.exec(out)?.[1];

test("invite: a signed vtc/invitations/issue/0.1, and the VIC printed where invite-persona.sh reads it", async () => {
  const vic = { type: ["VerifiableCredential", "InvitationCredential"], id: "urn:uuid:vic-1" };
  const vtc = await fakeVtc({ tasks: { "vtc/invitations/issue/0.1": [200, { subjectDid: "did:key:zApplicant", vic }] } });
  try {
    const r = await run(vtc.base, "invite", "did:key:zApplicant", "member");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/invitations/issue/0.1", payload: { subjectDid: "did:key:zApplicant", role: "member", validityDays: 30 } },
    ]);
    assert.equal(vtc.seen.some((s) => s.path.startsWith("/v1/auth")), false, "no bearer sign-in for a signed task");
    assert.equal(statusOf(r.stdout), "200");
    assert.deepEqual(inviteParse(r.stdout).vic, vic);
    const raw = r.stdout;
    assert.deepEqual(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).vic, vic);
  } finally {
    await vtc.close();
  }
});

test("invitations-list and invitation-deliver: signed, answered as { invitations } and the offer", async () => {
  const offer = { credential_issuer: VTC_DID, credential_configuration_ids: ["x"] };
  const vtc = await fakeVtc({
    tasks: {
      "vtc/invitations/list/0.1": [200, { invitations: [{ id: "urn:uuid:vic-1", subjectDid: "did:key:zA", issuedBy: ADMIN.did, issuedAt: "2026-09-28T00:00:00Z" }] }],
      "vtc/invitations/deliver/0.1": [200, { id: "urn:uuid:vic-1", channel: "offer", offer, expiresAt: "2026-09-28T01:00:00Z" }],
    },
  });
  try {
    const listed = await run(vtc.base, "invitations-list");
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(inviteParse(listed.stdout).invitations[0].id, "urn:uuid:vic-1");
    const delivered = await run(vtc.base, "invitation-deliver", "urn:uuid:vic-1");
    assert.equal(delivered.code, 0, delivered.stderr);
    assert.deepEqual(inviteParse(delivered.stdout).offer, offer);
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/invitations/list/0.1", payload: {} },
      { short: "vtc/invitations/deliver/0.1", payload: { id: "urn:uuid:vic-1", channel: "offer" } },
    ]);
  } finally {
    await vtc.close();
  }
});

test("members: every page of a signed vtc/members/list/0.1, as one { items }", async () => {
  const vtc = await fakeVtc({
    tasks: {
      "vtc/members/list/0.1": (doc) =>
        doc.payload.cursor ? [200, { items: [{ did: "did:key:zB" }] }] : [200, { items: [{ did: "did:key:zA" }], nextCursor: "c2" }],
    },
  });
  try {
    const r = await run(vtc.base, "members");
    assert.equal(r.code, 0, r.stderr);
    for (const parse of [inviteParse, membersParse, vettingParse]) {
      assert.deepEqual(parse(r.stdout).items.map((m) => m.did), ["did:key:zA", "did:key:zB"]);
      assert.equal(parse(r.stdout).nextCursor, undefined);
    }
    assert.ok(r.stdout.includes("did:key:zB"), "run-leave-community.mjs greps the output for the DID");
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/members/list/0.1", payload: { limit: 200 } },
      { short: "vtc/members/list/0.1", payload: { limit: 200, cursor: "c2" } },
    ]);
  } finally {
    await vtc.close();
  }
});

test("join-list and join-decide: signed; decide/0.1 carries no role", async () => {
  const vtc = await fakeVtc({
    tasks: {
      "vtc/join-requests/list/0.1": [200, { items: [{ id: "3f1e0a39-5c61-4a0e-9d8c-2d1c9bb0b111", status: "deferred" }] }],
      "vtc/join-requests/decide/0.1": [200, { requestId: "3f1e0a39-5c61-4a0e-9d8c-2d1c9bb0b111", status: "approved" }],
    },
  });
  try {
    const all = await run(vtc.base, "join-list");
    const deferred = await run(vtc.base, "join-list", "deferred");
    assert.equal(vettingParse(deferred.stdout).items.length, 1);
    const decided = await run(vtc.base, "join-decide", "3f1e0a39-5c61-4a0e-9d8c-2d1c9bb0b111", "approved", "member");
    assert.equal(decided.code, 0, decided.stderr);
    assert.equal(inviteParse(decided.stdout).status, "approved");
    assert.equal(all.code, 0, all.stderr);
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/join-requests/list/0.1", payload: { limit: 200 } },
      { short: "vtc/join-requests/list/0.1", payload: { status: "deferred", limit: 200 } },
      { short: "vtc/join-requests/decide/0.1", payload: { id: "3f1e0a39-5c61-4a0e-9d8c-2d1c9bb0b111", decision: "approved", reason: "ref-20: seed the vetter" } },
    ]);
  } finally {
    await vtc.close();
  }
});

test("manifest, register-type, list-types, vetter-grant: signed, payloads per their schemas", async () => {
  const vtc = await fakeVtc({
    tasks: {
      "vtc/join-requests/manifest/0.2": [200, { communityDid: VTC_DID, criteria: [] }],
      "vtc/endorsement-types/register/0.1": [200, { endorsementType: { typeUri: "urn:t" } }],
      "vtc/endorsement-types/list/0.1": [200, { items: [{ typeUri: "urn:t" }] }],
      "vtc/vetting/vetters/grant/0.1": [200, { credentialId: "urn:uuid:c", endorsementId: "e1", validFrom: "2026-09-28T00:00:00Z", validUntil: "2027-03-27T00:00:00Z" }],
    },
  });
  try {
    for (const args of [["manifest"], ["register-type", "urn:t", "A type"], ["list-types"], ["vetter-grant", "did:key:zV"], ["vetter-grant", "did:key:zV", "86400"]]) {
      const r = await run(vtc.base, ...args);
      assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`);
      assert.equal(statusOf(r.stdout), "200");
    }
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/join-requests/manifest/0.2", payload: {} },
      { short: "vtc/endorsement-types/register/0.1", payload: { typeUri: "urn:t", description: "A type" } },
      { short: "vtc/endorsement-types/list/0.1", payload: { limit: 200 } },
      { short: "vtc/vetting/vetters/grant/0.1", payload: { memberDid: "did:key:zV", validitySeconds: 15552000 } },
      { short: "vtc/vetting/vetters/grant/0.1", payload: { memberDid: "did:key:zV", validitySeconds: 86400 } },
    ]);
  } finally {
    await vtc.close();
  }
});

test("put-policy, activate-policy, active-policies: signed; activate names the purpose, read from the revision when not given", async () => {
  const id = "0b7d9a52-6b0e-4f55-9a0c-7a3f1d2e4c11";
  const vtc = await fakeVtc({
    tasks: {
      "policy/upsert/0.2": [200, { created: true, policy: { id } }],
      "policy/get/0.1": [200, { policy: { id, ext: { "org.openvtc.purpose": "join" } } }],
      "policy/activate/0.1": [200, { activated: id, purpose: "join" }],
      "policy/active/0.1": [200, { bindings: [] }],
    },
  });
  const rego = path.join(dir, "join.rego");
  writeFileSync(rego, "package vtc.join\n");
  try {
    for (const args of [["put-policy", rego], ["activate-policy", id], ["activate-policy", id, "join"], ["active-policies"], ["active-policies", "join"]]) {
      const r = await run(vtc.base, ...args);
      assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`);
    }
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "policy/upsert/0.2", payload: { name: "join (default, Eucalyptus)", module: "package vtc.join\n", ext: { "org.openvtc.purpose": "join" } } },
      { short: "policy/get/0.1", payload: { id } },
      { short: "policy/activate/0.1", payload: { id, purpose: "join" } },
      { short: "policy/activate/0.1", payload: { id, purpose: "join" } },
      { short: "policy/active/0.1", payload: {} },
      { short: "policy/active/0.1", payload: { purpose: "join" } },
    ]);
  } finally {
    await vtc.close();
  }
});

test("put-criterion, delete-criterion: signed vtc/schemas/accepts tasks, the file is the payload", async () => {
  const body = { id: "vetted-member", description: "One vetter", query: { credentials: [{ id: "v", format: "ldp_vc" }] }, vetting: { minStatements: 1 } };
  const vtc = await fakeVtc({
    tasks: {
      "vtc/schemas/accepts/register/0.1": [200, { criterion: body }],
      "vtc/schemas/accepts/delete/0.1": [200, { id: "vetted-member" }],
    },
  });
  const criterion = path.join(dir, "criterion.json");
  writeFileSync(criterion, JSON.stringify(body));
  try {
    for (const args of [["put-criterion", criterion], ["delete-criterion", "vetted-member"]]) {
      const r = await run(vtc.base, ...args);
      assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`);
      assert.equal(statusOf(r.stdout), "200");
    }
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/schemas/accepts/register/0.1", payload: body },
      { short: "vtc/schemas/accepts/delete/0.1", payload: { id: "vetted-member" } },
    ]);
    assert.ok(!vtc.seen.some((s) => s.path.startsWith("/v1/schemas")), "no REST criteria route");
  } finally {
    await vtc.close();
  }
});

test("join-discovery-show, join-discovery-set: whether the manifest answers an unidentified caller", async () => {
  const vtc = await fakeVtc({
    tasks: {
      "vtc/community/join-discovery/show/0.1": [200, { joinDiscovery: { public: true } }],
      "vtc/community/join-discovery/update/0.1": [200, { joinDiscovery: { public: false } }],
    },
  });
  try {
    for (const args of [["join-discovery-show"], ["join-discovery-set", "closed"], ["join-discovery-set", "open"]]) {
      const r = await run(vtc.base, ...args);
      assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`);
      assert.equal(statusOf(r.stdout), "200");
    }
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/community/join-discovery/show/0.1", payload: {} },
      { short: "vtc/community/join-discovery/update/0.1", payload: { joinDiscovery: { public: false } } },
      { short: "vtc/community/join-discovery/update/0.1", payload: { joinDiscovery: { public: true } } },
    ]);
    const bad = await run(vtc.base, "join-discovery-set", "maybe");
    assert.notEqual(bad.code, 0, "only open or closed");
  } finally {
    await vtc.close();
  }
});

test("member-remove: the admin removes a member, with a reason when given", async () => {
  const vtc = await fakeVtc({ tasks: { "vtc/members/admin-remove/0.1": [200, { did: "did:key:zM", removed: true }] } });
  try {
    for (const args of [["member-remove", "did:key:zM"], ["member-remove", "did:key:zM", "left the lab"]]) {
      const r = await run(vtc.base, ...args);
      assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`);
      assert.equal(statusOf(r.stdout), "200");
    }
    assert.deepEqual(signedDocs(vtc.seen), [
      { short: "vtc/members/admin-remove/0.1", payload: { did: "did:key:zM" } },
      { short: "vtc/members/admin-remove/0.1", payload: { did: "did:key:zM", reason: "left the lab" } },
    ]);
  } finally {
    await vtc.close();
  }
});

test("a refusal prints the trust-task-error's status and payload, and the callers see it as a refusal", async () => {
  const vtc = await fakeVtc({ tasks: { "vtc/invitations/list/0.1": [403, { code: "permissionDenied", message: "not an inviter" }] } });
  try {
    const r = await run(vtc.base, "invitations-list");
    assert.equal(statusOf(r.stdout), "403");
    assert.equal(vettingParse(r.stdout).code, "permissionDenied");
  } finally {
    await vtc.close();
  }
});

test("the REST routes VTI main keeps: bearer sign-in, then the route, with the console's Trust-Task header or none", async () => {
  const vtc = await fakeVtc({
    rest: {
      "GET /v1/auth/whoami": [200, { did: ADMIN.did, role: "admin" }],
      "GET /v1/vetting/vetters": [200, { vetters: [] }],
      "POST /v1/vetting/vetters/did%3Akey%3AzV/resend": [200, { memberDid: "did:key:zV" }],
      "GET /v1/credentials/endorsements": [200, { items: [] }],
      "DELETE /v1/credentials/endorsements/e1": [200, { statusListIndex: 7 }],
      "GET /v1/community/branding": [200, { displayName: "Lab" }],
      "PUT /v1/community/branding": [200, { displayName: "Lab" }],
    },
  });
  const expected = [
    [["whoami"], "GET /v1/auth/whoami", `${SPEC}auth/whoami/0.1`],
    [["vetters-list"], "GET /v1/vetting/vetters", undefined],
    [["vetter-resend", "did:key:zV"], "POST /v1/vetting/vetters/did%3Akey%3AzV/resend", `${SPEC}vtc/vetting/vetters/resend/0.1`],
    [["endorsements"], "GET /v1/credentials/endorsements", `${SPEC}vtc/endorsements/list/0.1`],
    [["revoke-endorsement", "e1"], "DELETE /v1/credentials/endorsements/e1", `${SPEC}vtc/endorsements/revoke/0.1`],
    [["branding-show"], "GET /v1/community/branding", undefined],
    [["branding-set", "Lab"], "PUT /v1/community/branding", undefined],
  ];
  try {
    for (const [args, route, header] of expected) {
      vtc.seen.length = 0;
      const r = await run(vtc.base, ...args);
      assert.equal(r.code, 0, `${args[0]}: ${r.stderr}`);
      const call = vtc.seen.find((s) => `${s.method} ${s.path}` === route);
      assert.ok(call, `${args[0]} calls ${route}`);
      assert.equal(call.headers.authorization, "Bearer bearer-1");
      assert.equal(call.headers["trust-task"], header, `${args[0]}'s Trust-Task header`);
      assert.match(statusOf(r.stdout), /^2/);
    }
  } finally {
    await vtc.close();
  }
});

test("a removed route answered with HTML is a refusal, not JSON the caller mis-parses", async () => {
  // No task answers: the fake plays an old VTC's door refusing an unknown type.
  const vtc = await fakeVtc();
  try {
    const r = await run(vtc.base, "whoami");
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /answered HTML|not JSON/);
  } finally {
    await vtc.close();
  }
});
