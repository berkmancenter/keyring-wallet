/**
 * ref-20 — the community administrator's half of the lab ceremonies (peer
 * identity vetting, invitations, join decisions), as the VTC's own admin
 * console drives them.
 *
 * Two doors, chosen per command the way the console chooses them (VTI main,
 * vtc-service/admin-ui/src):
 *
 * - **Signed Trust Task documents** at `POST /v1/trust-tasks`. VTI #1824,
 *   #1827 and #1834 moved the administrator's verbs onto the signed-document
 *   spine and removed their bearer routes (`GET /v1/invitations` now answers
 *   the console's HTML). Each document is issued by the admin DID, addressed to
 *   the community's DID, stamped `issuedAt` (whole seconds — see
 *   `wireSeconds`), and carries an eddsa-jcs-2022 proof made for
 *   `authentication`. The VTC verifies the proof against the document's own
 *   `issuer` and reads that signer's ACL row (`trust_tasks/mod.rs`
 *   `admin_signer`); there is no sign-in, so these commands leave no pending
 *   challenge behind and are charged to the signer's own rate bucket, not the
 *   per-address anonymous one (`routing/trust_task_admission.rs`).
 * - **Bearer REST routes**, behind DID auth (`/v1/auth/challenge` → signed
 *   `auth/authenticate/0.1` → `/v1/auth/`): whoami and branding. Each sends
 *   the `Trust-Task` header its route is bound to, or none on a route mounted
 *   without one (`routes/mod.rs`) — as the console's `getJsonExempt` does.
 *   VTI 0.47 (#1858) retired these and the REST sign-in with them.
 * - **Signed first, REST if the VTC predates the task**: the vetter grant
 *   listing, resend, and the endorsement list and revoke. VTI 0.47 serves them
 *   only as signed documents; a VTC that answers `unsupportedType` (resend/0.2,
 *   the administrator's form, is newer than the rest) gets the bearer route
 *   it still has, and the label says which door answered.
 *
 * The signer is `di-proof.mjs`, which mirrors
 * `@bifold/trust-tasks/src/documentProof.ts` (JCS, proof-config-hash ||
 * document-hash, eddsa-jcs-2022).
 *
 * Output contract, which the e2e harness parses: log lines first (never a
 * `{`, never `->`), then `[ref-20] <label> -> <status>`, then the answer as
 * JSON — the response document's `payload` for a signed task, the body for a
 * REST route. A refusal prints its status and the `trust-task-error` payload
 * (`{ code, message }`) and still exits 0; a transport failure, or an answer
 * that is not JSON, exits 1 with one line on stderr.
 *
 * Usage:
 *   node vtc-admin.mjs <vtcBaseUrl/v1> <vtcDid> <adminCredentialJson> <command> [args]
 *
 *   signed Trust Tasks:
 *     invite <subjectDid> [role]            vtc/invitations/issue/0.1 (30 days)
 *     invitations-list                      vtc/invitations/list/0.1
 *     invitation-deliver <id> [offer|message]  vtc/invitations/deliver/0.1
 *     invitation-revoke <id>                vtc/invitations/revoke/0.1
 *     members [cursor]                      vtc/members/list/0.1, every page from cursor
 *     member-remove <did> [reason]          vtc/members/admin-remove/0.1 (the community's default disposition)
 *     join-list [status]                    vtc/join-requests/list/0.1, every page
 *     join-decide <id> [approved|rejected]  vtc/join-requests/decide/0.1
 *     manifest                              vtc/join-requests/manifest/0.2
 *     register-type <typeUri> [description] vtc/endorsement-types/register/0.1
 *     list-types                            vtc/endorsement-types/list/0.1, every page
 *     vetter-grant <memberDid> [validitySeconds]  vtc/vetting/vetters/grant/0.1
 *     put-policy <regoFile> [purpose] [name]      policy/upsert/0.2
 *     activate-policy <id> [purpose]        policy/activate/0.1 (purpose read from the revision if omitted)
 *     active-policies [purpose]             policy/active/0.1
 *     put-criterion <jsonFile>              vtc/schemas/accepts/register/0.1
 *     delete-criterion <id>                 vtc/schemas/accepts/delete/0.1
 *     criteria                              vtc/schemas/accepts/list/0.2 (a community that serves join 0.3)
 *     put-criterion-0.2 <jsonFile>          vtc/schemas/accepts/register/0.2 (admission, query + issuers, invitation, vetting)
 *   signed, REST on a VTC that predates the task:
 *     vetters-list                          vtc/vetting/vetters/grants/list/0.1, every page
 *     vetter-resend <memberDid>             vtc/vetting/vetters/resend/0.2
 *     endorsements                          vtc/endorsements/list/0.1, every page
 *     revoke-endorsement <id>               vtc/endorsements/revoke/0.1
 *   REST (bearer; not on VTI 0.47):
 *     whoami, branding-show, branding-set <displayName> [logoUrl]
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateDidKeyHolder, signDocument } from "./di-proof.mjs";
import { withRetryAfter } from "./retry-after.mjs";

const SPEC = "https://trusttasks.org/spec/";

export const TASK = {
  // Signed documents (VTI main `vtc-service/src/trust_tasks/`).
  invitationIssue: `${SPEC}vtc/invitations/issue/0.1`,
  invitationList: `${SPEC}vtc/invitations/list/0.1`,
  invitationDeliver: `${SPEC}vtc/invitations/deliver/0.1`,
  invitationRevoke: `${SPEC}vtc/invitations/revoke/0.1`,
  membersList: `${SPEC}vtc/members/list/0.1`,
  memberAdminRemove: `${SPEC}vtc/members/admin-remove/0.1`,
  joinList: `${SPEC}vtc/join-requests/list/0.1`,
  joinDecide: `${SPEC}vtc/join-requests/decide/0.1`,
  manifest: `${SPEC}vtc/join-requests/manifest/0.2`,
  typeRegister: `${SPEC}vtc/endorsement-types/register/0.1`,
  typeList: `${SPEC}vtc/endorsement-types/list/0.1`,
  acceptsRegister: `${SPEC}vtc/schemas/accepts/register/0.1`,
  acceptsDelete: `${SPEC}vtc/schemas/accepts/delete/0.1`,
  acceptsList02: `${SPEC}vtc/schemas/accepts/list/0.2`,
  acceptsRegister02: `${SPEC}vtc/schemas/accepts/register/0.2`,
  joinDiscoveryShow: `${SPEC}vtc/community/join-discovery/show/0.1`,
  joinDiscoveryUpdate: `${SPEC}vtc/community/join-discovery/update/0.1`,
  memberRemove: `${SPEC}vtc/members/admin-remove/0.1`,
  memberCredentials: `${SPEC}vtc/members/credentials/0.1`,
  vettersGrant: `${SPEC}vtc/vetting/vetters/grant/0.1`,
  vettersGrantsList: `${SPEC}vtc/vetting/vetters/grants/list/0.1`,
  vettersResendAdmin: `${SPEC}vtc/vetting/vetters/resend/0.2`,
  policyUpsert: `${SPEC}policy/upsert/0.2`,
  policyGet: `${SPEC}policy/get/0.1`,
  policyActivate: `${SPEC}policy/activate/0.1`,
  policyActive: `${SPEC}policy/active/0.1`,
  // Bearer sign-in, and the REST routes bound to a task.
  challenge: `${SPEC}auth/challenge/0.1`,
  authenticate: `${SPEC}auth/authenticate/0.1`,
  whoami: `${SPEC}auth/whoami/0.1`,
  vettersResend: `${SPEC}vtc/vetting/vetters/resend/0.1`,
  endorsementList: `${SPEC}vtc/endorsements/list/0.1`,
  endorsementRevoke: `${SPEC}vtc/endorsements/revoke/0.1`,
};

/** The purpose a policy revision names in `ext` (admin-ui `lib/policies-api.ts` PURPOSE_EXT). */
const PURPOSE_EXT = "org.openvtc.purpose";

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
export function holderFromCredential(path) {
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

/**
 * RFC 3339 UTC at whole-second precision: `2026-09-28T10:15:00Z`.
 *
 * The VTC verifies a proof over its own re-serialisation of the document, and
 * chrono writes a zero fraction as nothing, so `…:00.000Z` from
 * `toISOString()` canonicalises differently there and the proof fails — about
 * one document in a thousand (admin-ui `lib/console-key.ts` `isoSeconds`;
 * `@bifold/trust-tasks` `wireTimestamp`). Whole seconds round-trip always.
 */
export function wireSeconds(at) {
  return `${at.toISOString().slice(0, 19)}Z`;
}

/**
 * How far back a proof's `created` is stamped. A Data-Integrity verifier
 * refuses a `created` in its future, and this clock is not the VTC's; the
 * document's `issuedAt` carries the freshness bound (10 minutes). The console
 * back-dates by the same 60 s (`console-key.ts` CREATED_BACKDATE_MS).
 */
const CREATED_BACKDATE_MS = 60_000;

/**
 * The signed Trust Task document: `{id, type, issuer, recipient, issuedAt,
 * payload, proof}`, as admin-ui `buildTrustTaskDocument` +
 * `signTrustTaskDocument` and vta-sdk `trust_task_sign::build_unsigned` build
 * it — issued by the admin DID itself (whose ACL row is the authority), for
 * `authentication` as vta-sdk signs every request that is not an approval.
 */
export function signTask(typeUri, payload, holder, recipient, now = new Date()) {
  const doc = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: typeUri,
    issuer: holder.did,
    recipient,
    issuedAt: wireSeconds(now),
    payload,
  };
  return signDocument(doc, holder, {
    proofPurpose: "authentication",
    created: wireSeconds(new Date(now.getTime() - CREATED_BACKDATE_MS)),
  });
}

/** The body as JSON, or a one-line error naming what came back instead. */
function parseBody(text, res, what) {
  try {
    return JSON.parse(text);
  } catch {
    const type = res.headers.get("content-type") ?? "";
    if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) {
      throw new Error(`${what} answered HTML (${res.status}), not JSON: this VTC serves no such route — it moved to a signed Trust Task or is gone`);
    }
    throw new Error(`${what} answered ${res.status} with a body that is not JSON: ${text.slice(0, 120)}`);
  }
}

/** One HTTP exchange; a 429 is retried after the wait it names (retry-after.mjs). */
async function exchange(url, init, what) {
  const r = await withRetryAfter(async () => {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // undici says only "fetch failed"; the cause is the useful part.
      const cause = err.cause ? `: ${err.cause.code ?? ""} ${err.cause.message ?? ""}`.trimEnd() : "";
      throw new Error(`${what}: ${err.message}${cause}`);
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, res };
  });
  return { status: r.status, body: r.text === "" ? null : parseBody(r.text, r.res, what) };
}

/**
 * Sign `payload` as `typeUri` and post it to `POST <base>/trust-tasks` — no
 * bearer and no `Trust-Task` header: the document's own `type` routes it
 * (admin-ui `lib/api.ts` `postDocument`). Answers `{ status, body }` where
 * `body` is the response document's `payload`: the result, or the
 * `trust-task-error` payload `{ code, message, details? }` on a refusal.
 */
export async function sendTask(base, vtcDid, holder, typeUri, payload) {
  const doc = signTask(typeUri, payload, holder, vtcDid);
  const short = typeUri.replace(SPEC, "");
  const { status, body } = await exchange(
    `${base}/trust-tasks`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) },
    `POST /trust-tasks (${short})`
  );
  if (!body || typeof body !== "object" || !("payload" in body)) {
    throw new Error(`POST /trust-tasks (${short}) answered ${status} without a Trust Task document: ${JSON.stringify(body)?.slice(0, 160)}`);
  }
  return { status, body: body.payload };
}

/**
 * Every page of a signed list (members, join requests, endorsement types): each
 * pages at `limit` up to 200 (or the payload's own `limit`, where a task's
 * maximum is lower) with `cursor` / `nextCursor`. Reading one page
 * misses whoever joined after the 50th — the lab passed 50 members on
 * 2026-09-25 and a join read as "not a member". Returns the first failing page
 * as is, or every item under one `items` (no `nextCursor`).
 */
export async function sendTaskAll(base, vtcDid, holder, typeUri, payload = {}, cursor) {
  const items = [];
  for (let page = 0; page < 100; page++) {
    const r = await sendTask(base, vtcDid, holder, typeUri, { limit: 200, ...payload, ...(cursor ? { cursor } : {}) });
    if (r.status !== 200 || !Array.isArray(r.body?.items)) return r;
    items.push(...r.body.items);
    cursor = r.body.nextCursor;
    if (!cursor) return { status: 200, body: { items, pages: page + 1 } };
  }
  throw new Error(`${typeUri}: more than 100 pages`);
}

/** One bearer REST call. `task` is the route's bound Trust-Task URI, or undefined for a route mounted without one. */
async function rest(base, path, { method = "GET", task, body, token } = {}) {
  return exchange(
    `${base}${path}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        ...(task ? { "Trust-Task": task } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    `${method} ${path}`
  );
}

/** `/v1/auth/challenge` → signed `auth/authenticate/0.1` → `/v1/auth/` → bearer. */
async function authenticate(base, vtcDid, holder) {
  const challenge = await rest(base, "/auth/challenge", { method: "POST", task: TASK.challenge, body: { subject: holder.did } });
  if (challenge.status !== 200) {
    throw new Error(`challenge failed ${challenge.status}: ${JSON.stringify(challenge.body)}`);
  }
  const now = new Date();
  const signed = signDocument(
    {
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: TASK.authenticate,
      payload: { challenge: challenge.body.challenge, sessionId: challenge.body.sessionId, scope: [] },
      issuer: holder.did,
      recipient: vtcDid,
      issuedAt: wireSeconds(now),
    },
    holder,
    { created: wireSeconds(new Date(now.getTime() - CREATED_BACKDATE_MS)) }
  );
  const auth = await rest(base, "/auth/", { method: "POST", task: TASK.authenticate, body: signed });
  if (auth.status !== 200) {
    throw new Error(`authenticate failed ${auth.status}: ${JSON.stringify(auth.body)}`);
  }
  const token = auth.body.payload?.tokens?.accessToken ?? auth.body.tokens?.accessToken;
  if (!token) throw new Error(`no access token in ${JSON.stringify(auth.body)}`);
  return token;
}

const show = (label, r) => {
  console.log(`[ref-20] ${label} -> ${r.status}`);
  console.log(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}, null, 2));
  return r;
};

/** The label a signed task prints: `trust-task vtc/invitations/issue/0.1`. */
const taskLabel = (typeUri) => `trust-task ${typeUri.replace(SPEC, "")}`;

/**
 * Every command: `signed` ones send documents with `send`/`sendAll`; the rest
 * get a bearer `token` first.
 */
const COMMANDS = {
  // ── signed Trust Tasks ─────────────────────────────────────────────────
  invite: {
    signed: true,
    // admin-ui lib/api.ts issueInvitation: { subjectDid, validityDays?, role? }.
    run: ({ send }, [subjectDid, role]) =>
      send(TASK.invitationIssue, { subjectDid, role: role ?? "member", validityDays: 30 }),
  },
  // The answer is { invitations: [...] }, not a paged { items } list.
  "invitations-list": { signed: true, run: ({ send }) => send(TASK.invitationList, {}) },
  // What the console's Send (channel "message") and QR offer (channel "offer") do.
  "invitation-deliver": {
    signed: true,
    run: ({ send }, [id, channel]) => send(TASK.invitationDeliver, { id, channel: channel ?? "offer" }),
  },
  "invitation-revoke": { signed: true, run: ({ send }, [id]) => send(TASK.invitationRevoke, { id }) },
  // A cursor, if given, starts there (e2e/openvtc/communityMembers.js passes the last page's).
  members: { signed: true, run: ({ sendAll }, [cursor]) => sendAll(TASK.membersList, {}, cursor) },
  // An administrator removing another member. No disposition is sent: the community applies its own default.
  "member-remove": {
    signed: true,
    run: ({ send }, [did, ...reason]) => {
      if (!did) throw new Error("usage: member-remove <memberDid> [reason]");
      return send(TASK.memberAdminRemove, { did, ...(reason.length ? { reason: reason.join(" ") } : {}) });
    },
  },
  "join-list": {
    signed: true,
    run: ({ sendAll }, [status]) => sendAll(TASK.joinList, status ? { status } : {}),
  },
  "join-decide": {
    signed: true,
    run: ({ send }, [id, decision, role]) => {
      // decide/0.1 is { id, decision, reason? } (additionalProperties: false);
      // the member's role comes from the invitation or the policy, not here.
      if (role && role !== "member") console.error(`[ref-20] join-decide: role ${role} ignored — decide/0.1 carries no role`);
      return send(TASK.joinDecide, { id, decision: decision ?? "approved", reason: process.env.JOIN_DECIDE_REASON ?? "ref-20: seed the vetter" });
    },
  },
  // Read as the same signed document an applicant sends (admin-ui plugins/vetting/api.ts fetchManifest).
  manifest: { signed: true, run: ({ send }) => send(TASK.manifest, {}) },
  "register-type": {
    signed: true,
    run: ({ send }, [typeUri, description]) => send(TASK.typeRegister, { typeUri, description: description ?? "" }),
  },
  "list-types": { signed: true, run: ({ sendAll }) => sendAll(TASK.typeList) },
  // VTI #1835 retired /v1/schemas; the criterion file is the register payload
  // as it was the POST body (surface_tasks.rs handle_accepts_register).
  "put-criterion": {
    signed: true,
    run: ({ send }, [file]) => send(TASK.acceptsRegister, JSON.parse(readFileSync(file, "utf8"))),
  },
  "delete-criterion": { signed: true, run: ({ send }, [id]) => send(TASK.acceptsDelete, { id }) },
  // A community from vti #1907 on serves these two at 0.2 only; a criterion states its admission.
  criteria: { signed: true, run: ({ send }) => send(TASK.acceptsList02, {}) },
  "put-criterion-0.2": {
    signed: true,
    run: ({ send }, [file]) => send(TASK.acceptsRegister02, JSON.parse(readFileSync(file, "utf8"))),
  },
  // Whether the join manifest answers a caller the community cannot identify
  // (vtc-service routes/community/join_discovery.rs). "closed" makes an
  // applicant's anonymous REST read fail, so the phone must ask over DIDComm or
  // TSP: the path keyring-bifold #158 signs.
  // What the community issued a member (its membership card, memberVmc, with
  // its credentialStatus), for checking the revocation bit after a removal.
  "member-credentials": { signed: true, run: ({ send }, [did]) => send(TASK.memberCredentials, { did }) },
  // The administrator removes a member; the community then pushes the member a
  // vtc/members/removal-notice/0.1 (vtc-service ceremony/removal_notice.rs).
  "member-remove": {
    signed: true,
    run: ({ send }, [did, reason]) => send(TASK.memberRemove, { did, ...(reason ? { reason } : {}) }),
  },
  "join-discovery-show": { signed: true, run: ({ send }) => send(TASK.joinDiscoveryShow, {}) },
  "join-discovery-set": {
    signed: true,
    run: ({ send }, [state]) => {
      if (state !== "open" && state !== "closed") throw new Error('join-discovery-set takes "open" or "closed"');
      return send(TASK.joinDiscoveryUpdate, { joinDiscovery: { public: state === "open" } });
    },
  },
  "vetter-grant": {
    signed: true,
    run: ({ send }, [memberDid, seconds]) =>
      send(TASK.vettersGrant, { memberDid, validitySeconds: Number(seconds ?? 15552000) }),
  },
  // The dry-run guide's step 00: an older community keeps the join policy it
  // was first booted with; upload the shipped default and ACTIVATE it
  // (uploading alone activates nothing).
  "put-policy": {
    signed: true,
    run: ({ send }, [file, purpose, name]) =>
      send(TASK.policyUpsert, {
        name: name ?? "join (default, Eucalyptus)",
        module: readFileSync(file, "utf8"),
        ext: { [PURPOSE_EXT]: purpose ?? "join" },
      }),
  },
  // policy/activate/0.1 requires the purpose, and refuses one the revision
  // does not decide (VTI #1834); the revision names it in `ext`.
  "activate-policy": {
    signed: true,
    run: async ({ send }, [id, purpose]) => {
      if (!purpose) {
        const got = await send(TASK.policyGet, { id });
        purpose = got.body?.policy?.ext?.[PURPOSE_EXT];
        if (got.status !== 200 || !purpose) {
          throw new Error(`activate-policy: no purpose given and policy/get ${id} answered ${got.status} naming none — pass it: activate-policy <id> <purpose>`);
        }
      }
      return send(TASK.policyActivate, { id, purpose });
    },
  },
  "active-policies": {
    signed: true,
    run: ({ send }, [purpose]) => send(TASK.policyActive, purpose ? { purpose } : {}),
  },

  // ── Signed first, REST on a VTC that predates the task ─────────────────
  // The grant listing, as the REST route answered it ({ vetters: [...] }).
  "vetters-list": {
    hybrid: true,
    signed: async ({ sendAll }) => {
      const r = await sendAll(TASK.vettersGrantsList, { limit: 100 }); // the task's maximum
      return r.status === 200 ? { status: 200, body: { vetters: r.body.items } } : r;
    },
    rest: ({ token, base }) => rest(base, "/vetting/vetters", { token }),
  },
  // A grant is issued once and delivered once. A vetter whose client was not
  // listening — or was reinstalled since — has the role and not the
  // credential, and shows no vetter seat at all. This hands it over again
  // (resend/0.2 with `memberDid` is the administrator's form).
  "vetter-resend": {
    hybrid: true,
    signed: ({ send }, [memberDid]) => send(TASK.vettersResendAdmin, { memberDid }),
    rest: ({ token, base }, [memberDid]) =>
      rest(base, `/vetting/vetters/${encodeURIComponent(memberDid)}/resend`, { method: "POST", task: TASK.vettersResend, token, body: {} }),
  },
  // A vetter grant is an endorsement, withdrawn through endorsements/revoke,
  // which flips the status-list bit the grant's `credentialStatus` points at.
  endorsements: {
    hybrid: true,
    signed: ({ sendAll }) => sendAll(TASK.endorsementList, { includeRevoked: true }),
    rest: ({ token, base }) => rest(base, "/credentials/endorsements", { task: TASK.endorsementList, token }),
  },
  // Both answers carry `statusListIndex` — the bit that just flipped.
  "revoke-endorsement": {
    hybrid: true,
    signed: ({ send }, [endorsementId]) => send(TASK.endorsementRevoke, { endorsementId }),
    rest: ({ token, base }, [id]) =>
      rest(base, `/credentials/endorsements/${encodeURIComponent(id)}`, { method: "DELETE", task: TASK.endorsementRevoke, token }),
  },

  // ── Bearer REST (gone from VTI 0.47) ───────────────────────────────────
  // `whoami` describes the bearer session a request carries, which a signed
  // document does not have, so it stays with the session surface (routes/mod.rs).
  whoami: { run: ({ token, base }) => rest(base, "/auth/whoami", { task: TASK.whoami, token }) },
  // What an applicant's client shows before it joins: `branding` on
  // join-requests/manifest/0.2. Admin REST with no Trust Task of its own.
  "branding-show": { run: ({ token, base }) => rest(base, "/community/branding", { token }) },
  "branding-set": {
    run: ({ token, base }, [displayName, logoUrl]) => {
      if (!displayName) throw new Error("usage: branding-set <displayName> [logoUrl]");
      return rest(base, "/community/branding", { method: "PUT", token, body: { displayName, ...(logoUrl ? { logoUrl } : {}) } });
    },
  },
};

/** The label a REST command prints, as before the port: `GET /members`. */
const REST_LABEL = {
  whoami: () => "GET /auth/whoami",
  "vetters-list": () => "GET /vetting/vetters",
  "vetter-resend": ([did]) => `POST /vetting/vetters/${did}/resend`,
  endorsements: () => "GET /credentials/endorsements",
  "revoke-endorsement": ([id]) => `DELETE /credentials/endorsements/${id}`,
  "branding-show": () => "GET /community/branding",
  "branding-set": () => "PUT /community/branding",
};

/** The task a signed command's answer comes from, for its label. */
const SIGNED_TASK = {
  invite: TASK.invitationIssue,
  "invitations-list": TASK.invitationList,
  "invitation-deliver": TASK.invitationDeliver,
  "invitation-revoke": TASK.invitationRevoke,
  members: TASK.membersList,
  "member-remove": TASK.memberAdminRemove,
  "join-list": TASK.joinList,
  "join-decide": TASK.joinDecide,
  manifest: TASK.manifest,
  "register-type": TASK.typeRegister,
  "list-types": TASK.typeList,
  "put-criterion": TASK.acceptsRegister,
  "delete-criterion": TASK.acceptsDelete,
  criteria: TASK.acceptsList02,
  "put-criterion-0.2": TASK.acceptsRegister02,
  "member-remove": TASK.memberRemove,
  "member-credentials": TASK.memberCredentials,
  "join-discovery-show": TASK.joinDiscoveryShow,
  "join-discovery-set": TASK.joinDiscoveryUpdate,
  "vetter-grant": TASK.vettersGrant,
  "put-policy": TASK.policyUpsert,
  "activate-policy": TASK.policyActivate,
  "active-policies": TASK.policyActive,
  "vetters-list": TASK.vettersGrantsList,
  "vetter-resend": TASK.vettersResendAdmin,
  endorsements: TASK.endorsementList,
  "revoke-endorsement": TASK.endorsementRevoke,
};

/** Whether a signed answer is the VTC saying it does not serve that task at all. */
const unsupportedType = (r) => r.status !== 200 && /unsupported.?type/i.test(String(r.body?.code ?? ""));

async function main() {
  const [base, vtcDid, credPath, command, ...args] = process.argv.slice(2);
  if (!base || !vtcDid || !credPath || !command) {
    console.error("usage: node vtc-admin.mjs <vtcBaseUrl/v1> <vtcDid> <adminCredential.json> <command> [args]");
    process.exit(1);
  }
  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(`unknown command ${command}`);
    process.exit(1);
  }
  const holder = holderFromCredential(credPath);
  console.log(`[ref-20] admin ${holder.did}`);

  if (cmd.hybrid) {
    console.log(`[ref-20] signed Trust Tasks to ${base}/trust-tasks, no sign-in`);
    const ctx = {
      send: (typeUri, payload) => sendTask(base, vtcDid, holder, typeUri, payload),
      sendAll: (typeUri, payload, cursor) => sendTaskAll(base, vtcDid, holder, typeUri, payload, cursor),
    };
    const answer = await cmd.signed(ctx, args);
    if (!unsupportedType(answer)) return void show(taskLabel(SIGNED_TASK[command]), answer);
    console.log(`[ref-20] the VTC does not serve ${taskLabel(SIGNED_TASK[command])}; asking its REST route`);
    const token = await authenticate(base, vtcDid, holder);
    console.log(`[ref-20] authenticated, bearer acquired`);
    return void show(REST_LABEL[command](args), await cmd.rest({ token, base }, args));
  }

  if (cmd.signed) {
    console.log(`[ref-20] signed Trust Tasks to ${base}/trust-tasks, no sign-in`);
    const ctx = {
      send: (typeUri, payload) => sendTask(base, vtcDid, holder, typeUri, payload),
      sendAll: (typeUri, payload, cursor) => sendTaskAll(base, vtcDid, holder, typeUri, payload, cursor),
    };
    return void show(taskLabel(SIGNED_TASK[command]), await cmd.run(ctx, args));
  }

  const token = await authenticate(base, vtcDid, holder);
  console.log(`[ref-20] authenticated, bearer acquired`);
  return void show(REST_LABEL[command](args), await cmd.run({ token, base }, args));
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  main().catch((err) => {
    console.error(`[ref-20] ${err.message}`);
    process.exit(1);
  });
}
