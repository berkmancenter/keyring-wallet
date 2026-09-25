/**
 * ref-20 — the community-admin half of the peer identity vetting ceremony,
 * driven over the VTC's REST surface (community_vetting_subtask.md §3.8,
 * runbook steps 01–05).
 *
 * Why this exists rather than `cnm vetting …`: on vtc-service 0.11.58 /
 * cnm-cli 0.15.2 (VTI origin/main 53a7cde4) the CLI cannot reach a VTC.
 * `cnm --url https://<vtc>/v1 vetting …` and `VTA_URL=…` are both ignored —
 * the VTC's access log shows no request — and a VTC DID cannot be added as a
 * community because its `VTCRest` service entry omits `/v1`, so `cnm` posts
 * `/auth/challenge` (405) instead of `/v1/auth/challenge`. See
 * `docs/plans/keyring-on-the-vta-farm/community_vetting_subtask.md` §9.
 *
 * The handshake here is the same one Keyring performs as an applicant, and the
 * same signer: `di-proof.mjs` mirrors `@bifold/trust-tasks/src/documentProof.ts`
 * (JCS canonicalize, proof-config-hash || document-hash, eddsa-jcs-2022).
 *
 * Every VTC route is gated on a per-route `Trust-Task` header
 * (`vtc-service/src/routes/mod.rs`); the URLs below are read from that file,
 * not guessed.
 *
 * Usage:
 *   node vtc-admin.mjs <vtcBaseUrl> <vtcDid> <adminCredentialJson> <command> [args]
 *
 *   commands:
 *     whoami
 *     register-type <typeUri> <description>
 *     put-criterion <jsonFile>
 *     manifest
 *     vetters-list
 *     vetter-grant <memberDid> [validitySeconds]
 */
import { readFileSync } from "node:fs";
import { generateDidKeyHolder, signDocument, base58encode } from "./di-proof.mjs";

const TASK = {
  challenge: "https://trusttasks.org/spec/auth/challenge/0.1",
  authenticate: "https://trusttasks.org/spec/auth/authenticate/0.1",
  whoami: "https://trusttasks.org/spec/auth/whoami/0.1",
  typeRegister: "https://trusttasks.org/spec/vtc/endorsement-types/register/0.1",
  typeList: "https://trusttasks.org/spec/vtc/endorsement-types/list/0.1",
  vettersGrant: "https://trusttasks.org/spec/vtc/vetting/vetters/grant/0.1",
  vettersList: "https://trusttasks.org/spec/vtc/vetting/vetters/list/0.1",
  manifest: "https://trusttasks.org/spec/vtc/join-requests/manifest/0.2",
  joinList: "https://trusttasks.org/spec/vtc/join-requests/list/0.1",
  joinDecide: "https://trusttasks.org/spec/vtc/join-requests/decide/0.1",
  invitationIssue: "https://trusttasks.org/spec/vtc/invitations/issue/0.1",
  policyUpsert: "https://trusttasks.org/spec/policy/upsert/0.2",
  policyActivate: "https://trusttasks.org/spec/policy/activate/0.1",
  policyActive: "https://trusttasks.org/spec/policy/active/0.1",
  membersList: "https://trusttasks.org/spec/vtc/members/list/0.1",
  endorsementList: "https://trusttasks.org/spec/vtc/endorsements/list/0.1",
  endorsementRevoke: "https://trusttasks.org/spec/vtc/endorsements/revoke/0.1",
  vettersResend: "https://trusttasks.org/spec/vtc/vetting/vetters/resend/0.1",
};

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decode a base58btc multibase string (leading `z`) to bytes. */
function base58decode(s) {
  if (!s.startsWith("z")) throw new Error(`not base58btc multibase: ${s.slice(0, 8)}…`);
  let num = 0n;
  for (const ch of s.slice(1)) {
    const idx = BASE58.indexOf(ch);
    if (idx < 0) throw new Error(`bad base58 char ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const ch of s.slice(1)) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * A VTA-exported admin credential carries `privateKeyMultibase` — a Multikey
 * ed25519-priv (0x80 0x26 prefix) over the 32-byte seed. di-proof.mjs wants
 * that seed as hex.
 */
function holderFromCredential(path) {
  const cred = JSON.parse(readFileSync(path, "utf8"));
  const raw = base58decode(cred.privateKeyMultibase);
  // `vta export-admin` emits the bare 32-byte seed base58-encoded; a Multikey
  // ed25519-priv (0x80 0x26 prefix, 34 bytes) is the other shape in the wild.
  let seed;
  if (raw.length === 32) {
    seed = raw;
  } else if (raw.length === 34 && raw[0] === 0x80 && raw[1] === 0x26) {
    seed = raw.slice(2, 34);
  } else {
    throw new Error(`unrecognised private key: ${raw.length} bytes, head ${Buffer.from(raw.slice(0, 2)).toString("hex")}`);
  }
  const holder = generateDidKeyHolder(Buffer.from(seed).toString("hex"));
  if (holder.did !== cred.did) {
    throw new Error(`derived ${holder.did} but credential says ${cred.did}`);
  }
  return holder;
}

async function call(base, task, path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "Trust-Task": task,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/**
 * Every page of a list (members, join requests): both page at 50 by default
 * (vtc members/list/1.0, join-requests/list/1.0: `cursor`, `limit` up to 200,
 * `nextCursor`). Reading one page misses whoever joined after the 50th — the
 * lab passed 50 members on 2026-09-25 and a join read as "not a member".
 * Returns the first failing page as is, or every item under one `items`.
 */
async function callAll(base, task, path, { token } = {}) {
  const items = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await call(base, task, `${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { token });
    if (r.status !== 200 || typeof r.body !== "object" || !Array.isArray(r.body.items)) return r;
    items.push(...r.body.items);
    cursor = r.body.nextCursor;
    if (!cursor) return { status: 200, body: { items, pages: page + 1 } };
  }
  throw new Error(`${path}: more than 100 pages`);
}

/** `/v1/auth/challenge` → signed `auth/authenticate/0.1` → `/v1/auth/` → bearer. */
async function authenticate(base, vtcDid, holder) {
  const challenge = await call(base, TASK.challenge, "/auth/challenge", {
    method: "POST",
    body: { subject: holder.did },
  });
  if (challenge.status !== 200) {
    throw new Error(`challenge failed ${challenge.status}: ${JSON.stringify(challenge.body)}`);
  }
  const signed = signDocument(
    {
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: TASK.authenticate,
      payload: { challenge: challenge.body.challenge, sessionId: challenge.body.sessionId, scope: [] },
      issuer: holder.did,
      recipient: vtcDid,
      issuedAt: new Date().toISOString(),
    },
    holder
  );
  const auth = await call(base, TASK.authenticate, "/auth/", { method: "POST", body: signed });
  if (auth.status !== 200) {
    throw new Error(`authenticate failed ${auth.status}: ${JSON.stringify(auth.body)}`);
  }
  const token = auth.body.payload?.tokens?.accessToken ?? auth.body.tokens?.accessToken;
  if (!token) throw new Error(`no access token in ${JSON.stringify(auth.body)}`);
  return token;
}

const show = (label, r) => {
  console.log(`[ref-20] ${label} -> ${r.status}`);
  console.log(typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2));
  return r;
};

async function main() {
  const [base, vtcDid, credPath, command, ...args] = process.argv.slice(2);
  if (!base || !vtcDid || !credPath || !command) {
    console.error("usage: node vtc-admin.mjs <vtcBaseUrl/v1> <vtcDid> <adminCredential.json> <command> [args]");
    process.exit(1);
  }
  const holder = holderFromCredential(credPath);
  console.log(`[ref-20] admin ${holder.did}`);
  const token = await authenticate(base, vtcDid, holder);
  console.log(`[ref-20] authenticated, bearer acquired`);

  switch (command) {
    case "whoami":
      return void show("GET /auth/whoami", await call(base, TASK.whoami, "/auth/whoami", { token }));
    case "register-type":
      return void show(
        "POST /endorsement-types",
        await call(base, TASK.typeRegister, "/endorsement-types", {
          method: "POST",
          token,
          body: { typeUri: args[0], description: args[1] ?? "" },
        })
      );
    case "list-types":
      return void show("GET /endorsement-types", await call(base, TASK.typeList, "/endorsement-types", { token }));
    case "put-criterion":
      return void show(
        "POST /schemas/accepts",
        await call(base, TASK.typeRegister, "/schemas/accepts", {
          method: "POST",
          token,
          body: JSON.parse(readFileSync(args[0], "utf8")),
        })
      );
    case "manifest":
      return void show("GET /join-requests/manifest", await call(base, TASK.manifest, "/join-requests/manifest", { token }));
    case "join-list":
      return void show("GET /join-requests", await callAll(base, TASK.joinList, args[0] ? `/join-requests?status=${args[0]}` : "/join-requests", { token }));
    case "join-decide":
      return void show(
        `POST /join-requests/${args[0]}/decide`,
        await call(base, TASK.joinDecide, `/join-requests/${args[0]}/decide`, {
          method: "POST",
          token,
          body: { decision: args[1] ?? "approved", role: args[2] ?? "member", reason: "ref-20: seed the vetter" },
        })
      );
    case "delete-criterion":
      return void show(
        `DELETE /schemas/accepts/${args[0]}`,
        await call(base, TASK.typeRegister, `/schemas/accepts/${args[0]}`, { method: "DELETE", token })
      );
    // The dry-run guide's step 00: an older community keeps the join policy it
    // was first booted with; upload the shipped default and ACTIVATE it
    // (uploading alone activates nothing).
    case "put-policy": {
      const rego = readFileSync(args[0], "utf8");
      return void show(
        "POST /policies",
        await call(base, TASK.policyUpsert, "/policies", {
          method: "POST",
          token,
          body: { name: args[2] ?? "join (default, Eucalyptus)", module: rego, ext: { "org.openvtc.purpose": args[1] ?? "join" } },
        })
      );
    }
    case "activate-policy":
      return void show(
        `POST /policies/${args[0]}/activate`,
        await call(base, TASK.policyActivate, `/policies/${args[0]}/activate`, { method: "POST", token, body: {} })
      );
    case "active-policies":
      return void show("GET /policies/active", await call(base, TASK.policyActive, "/policies/active", { token }));
    case "invite":
      return void show(
        "POST /invitations",
        await call(base, TASK.invitationIssue, "/invitations", {
          method: "POST",
          token,
          body: { subjectDid: args[0], role: args[1] ?? "member", validityDays: 30 },
        })
      );
    case "members":
      return void show("GET /members", await callAll(base, TASK.membersList, "/members", { token }));
    case "vetters-list":
      return void show("GET /vetting/vetters", await call(base, TASK.vettersList, "/vetting/vetters", { token }));
    case "vetter-grant":
      return void show(
        "POST /vetting/vetters",
        await call(base, TASK.vettersGrant, "/vetting/vetters", {
          method: "POST",
          token,
          body: { memberDid: args[0], validitySeconds: Number(args[1] ?? 15552000) },
        })
      );
    // A vetter grant is an endorsement, and there is no vetter-specific
    // withdrawal: it is taken back through `endorsements/revoke`, which flips
    // the status-list bit the grant's `credentialStatus` points at. These two
    // are what let a refusal path be staged — without them the only way to
    // test a revoked vetter is to wait for one to expire.
    // A grant is issued once and delivered once. A vetter whose client was not
    // listening — or was reinstalled since — has the role and not the
    // credential, and shows no vetter seat at all. This is how a community
    // hands it over again.
    case "vetter-resend":
      return void show(
        `POST /vetting/vetters/${args[0]}/resend`,
        await call(base, TASK.vettersResend, `/vetting/vetters/${encodeURIComponent(args[0])}/resend`, {
          method: "POST",
          token,
          body: {},
        })
      );
    case "endorsements":
      return void show(
        "GET /credentials/endorsements",
        await call(base, TASK.endorsementList, "/credentials/endorsements", { token })
      );
    case "revoke-endorsement":
      // The response carries `statusListIndex` — the bit that just flipped,
      // which is what makes this checkable against the published list rather
      // than merely believed.
      return void show(
        `DELETE /credentials/endorsements/${args[0]}`,
        await call(base, TASK.endorsementRevoke, `/credentials/endorsements/${args[0]}`, {
          method: "DELETE",
          token,
        })
      );
    // What an applicant's client sees before it joins: the community's own
    // name, published as `branding` on join-requests/manifest/0.2. A community
    // that sets none publishes none, and every client then has nothing to show
    // but the DID — which is how Keyring's join screen came to show one.
    case "branding-show":
      return void show(
        "GET /community/branding",
        await call(base, "https://trusttasks.org/spec/vtc/community/profile/show/0.1", "/community/branding", { token })
      );
    case "branding-set": {
      const [displayName, logoUrl] = args;
      if (!displayName) throw new Error("usage: branding-set <displayName> [logoUrl]");
      return void show(
        "PUT /community/branding",
        await call(base, "https://trusttasks.org/spec/vtc/community/profile/update/0.1", "/community/branding", {
          method: "PUT",
          token,
          body: { displayName, ...(logoUrl ? { logoUrl } : {}) },
        })
      );
    }

    default:
      console.error(`unknown command ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[ref-20] ${err.message}`);
  process.exit(1);
});
