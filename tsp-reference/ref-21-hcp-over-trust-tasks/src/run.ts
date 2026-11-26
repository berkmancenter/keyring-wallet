// ref-21: the proposed hcp/* Trust Tasks, run end to end the way Keyring would run them.
//
// Three parties, each a throwaway did:key, each holding its own socket on a real mediator:
//   - the PROVIDER: a toy HCP Provider standing in for the VTA with the `hcp` feature. Its inbound path is
//     the proposal's own TSP consumer (@openvtc/trust-tasks-tsp TspConsumer: SPEC 7.2 proof, freshness,
//     replay, schema, size), and its documents are signed with the proposal's signer. It follows the VTI
//     design (OpenVTC/verifiable-trust-infrastructure#2823): a held grant request is approved through
//     task-consent/request + decision, with Keyring as the bound approver.
//   - the AGENT: the Context Client (our planned plugin's role), using the proposal's TS libraries.
//   - KEYRING: the Management Client. It signs with KEYRING'S OWN packages/trust-tasks/src/documentProof.ts,
//     picks each proof purpose with Keyring's own proofPurpose.ts, verifies with Keyring's own
//     verifyTrustTaskProof, and reads a consent request the way Keyring's consentCheck.ts does.
//
// Every payload that crosses the wire is checked against the PROPOSED Trust Task schema and, where HCP has
// a schema for the same object, against HCP's OWN schema at b790561. Mock data only.
//
//   ./setup.sh && npm install
//   MEDIATOR_DID=did:... npm start      # through a mediator (see README for the dev mediator's DID)
//   npm start -- --loopback             # no network: in-memory delivery
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { respondWith, rejectWith } from "@openvtc/trust-tasks/runtime";
import { DataIntegrityProofVerifier, signTrustTask, signerFromPrivateKey } from "@openvtc/trust-tasks-proof";
import { TspConsumer, unpackTrustTask, advertisedSender } from "@openvtc/trust-tasks-tsp";
import * as grantRequest from "@openvtc/trust-tasks/hcp/grants/request/0.1/payload";
import * as query from "@openvtc/trust-tasks/hcp/entries/query/0.1/payload";
import * as create from "@openvtc/trust-tasks/hcp/entries/create/0.1/payload";
import * as list from "@openvtc/trust-tasks/hcp/grants/list/0.1/payload";
import * as revoke from "@openvtc/trust-tasks/hcp/grants/revoke/0.1/payload";
import * as revoked from "@openvtc/trust-tasks/hcp/grants/revoked/0.1/payload";
import * as audit from "@openvtc/trust-tasks/hcp/audit/read/0.1/payload";
import * as summary from "@openvtc/trust-tasks/hcp/disclosures/summary/0.1/payload";
import * as consentRequest from "@openvtc/trust-tasks/task-consent/request/0.1/payload";
import * as consentDecision from "@openvtc/trust-tasks/task-consent/decision/0.2/payload";
import * as nextStep from "@openvtc/trust-tasks/trust-task-next-step/0.1/payload";
import * as taskError from "@openvtc/trust-tasks/trust-task-error/0.6/payload";

import { mintIdentity, publicKeys, type Identity } from "./identity.ts";
import { attachMediator, Loopback, DEFAULT_MEDIATOR, type Wire } from "./transport.ts";
import { Schemas } from "./schemas.ts";
import { loadKeyringProofs } from "./keyring.ts";

// ── Setup ────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
// The proposal and HCP's spec are fetched at pinned commits by ./setup.sh into .upstream/ (git-ignored).
const UPSTREAM = resolve(here, "..", ".upstream");
const TT = process.env.HCP_TT_ROOT ?? resolve(UPSTREAM, "tt");
const HCP = process.env.HCP_SPEC_ROOT ?? resolve(UPSTREAM, "hcp-spec");
// Keyring's own code is this repository's, unless told otherwise.
const KEYRING = process.env.KEYRING_ROOT ?? resolve(here, "..", "..", "..");
const QUIET = process.argv.includes("--quiet");
const LOOPBACK = process.argv.includes("--loopback");
const MEDIATOR = process.env.MEDIATOR_DID ?? DEFAULT_MEDIATOR;
const say = (...a: unknown[]) => void (QUIET ? undefined : console.log(...a));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Doc = Record<string, any>;
interface Check { id: string; title: string; ok: boolean; expected: string; observed: string; meaning: string }
const checks: Check[] = [];
function check(id: string, title: string, ok: boolean, expected: string, observed: string, meaning = "") {
  checks.push({ id, title, ok, expected, observed, meaning });
  say(`  ${ok ? "✓" : "✗"} [${id}] ${title}${ok ? "" : `\n      expected: ${expected}\n      observed: ${observed}`}`);
}
const frames: { from: string; to: string; type: string; bytes: number }[] = [];

const schemas = new Schemas(TT, HCP);
const provider = mintIdentity("VTA (toy HCP provider)");
const agent = mintIdentity("Agent (Context Client)");
const keyring = mintIdentity("Keyring (Management Client)");
const byDid = new Map([provider, agent, keyring].map((p) => [p.did, p]));
const nameOf = (did: string) => byDid.get(did)?.name ?? did.slice(0, 24);
const keys = new Map([provider, agent, keyring].map((p) => [p.did, p.edSecret]));
const kr = await loadKeyringProofs(KEYRING, keys);
const krModule = await import(pathToFileURL(join(KEYRING, "packages", "core", "src", "modules", "trust-tasks", "module", "proofPurpose.ts")).href);
const purposeForDocumentType: (t: string) => "authentication" | "assertionMethod" = krModule.purposeForDocumentType;
const krDoc = await import(pathToFileURL(join(KEYRING, "packages", "trust-tasks", "src", "documentProof.ts")).href);
const wireTimestamp: (d?: Date) => string = krDoc.wireTimestamp;

const prSigner = (id: Identity) => signerFromPrivateKey("ed25519", id.edSecret);
const signers = new Map([provider, agent].map((p) => [p.did, prSigner(p)]));
for (const [did, s] of signers) if (s.did !== did) throw new Error(`the PR signer derives ${s.did}, not ${did}`);
const prVerifier = new DataIntegrityProofVerifier();

// The payload validator the PR's consumer runs (SPEC §7.2 item 2): ajv over the generated module's schema.
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
const compiled = new WeakMap<object, any>();
const payloadValidator = {
  validate(schema: object, payload: unknown) {
    let v = compiled.get(schema);
    if (!v) compiled.set(schema, (v = ajv.compile(schema)));
    const ok = v(payload);
    return { ok, errors: ok ? [] : (v.errors ?? []).map((e: any) => `payload${e.instancePath} ${e.message}`) };
  },
};

const now = () => new Date();
const plus = (s: number) => new Date(Date.now() + s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const secs = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const urn = () => `urn:uuid:${randomUUID()}`;
const bare = (t: string) => t.split("#")[0]!;

/** Build a document (unsigned). Keyring's documents take Keyring's own wire timestamp. */
function build(from: Identity, to: Identity, type: string, payload: unknown, threadId?: string): Doc {
  const id = urn();
  const issuedAt = from === keyring ? wireTimestamp(now()) : secs();
  return { id, type, issuer: from.did, recipient: to.did, issuedAt, threadId: threadId ?? id, payload };
}
async function sign(by: Identity, doc: Doc, purposeOverride?: "authentication" | "assertionMethod"): Promise<Doc> {
  if (by === keyring) return kr.sign(doc, keyring, purposeOverride ?? purposeForDocumentType(doc.type));
  return signTrustTask(doc as any, signers.get(by.did)!, purposeOverride ? { proofPurpose: purposeOverride } : {}) as Doc;
}

// ── Wires ────────────────────────────────────────────────────────────────────
const notes: string[] = [];
const note = (s: string) => (notes.push(s), say(`  · ${s}`));
let wires: Map<string, Wire>;
let transportUsed = "loopback";
if (LOOPBACK) {
  const hub = new Loopback();
  wires = new Map([provider, agent, keyring].map((p) => [p.did, hub.wire(p)]));
} else {
  try {
    say(`── attaching three parties to the mediator ${MEDIATOR.slice(0, 48)}… ──`);
    wires = new Map();
    for (const p of [provider, agent, keyring]) wires.set(p.did, await attachMediator(p, MEDIATOR, note));
    transportUsed = `mediator ${MEDIATOR}`;
  } catch (e: any) {
    note(`mediator unreachable (${e?.message ?? e}); falling back to in-memory delivery`);
    const hub = new Loopback();
    wires = new Map([provider, agent, keyring].map((p) => [p.did, hub.wire(p)]));
  }
}

// ── A party on the wire ─────────────────────────────────────────────────────
interface Inbound { doc: Doc; sender: string; bytes: Uint8Array; unpacked: any }
type Handler = (inb: Inbound) => Promise<Uint8Array | Doc | undefined>;
const waiting = new Map<string, { from: string; resolve: (d: Doc) => void }>();

async function seal(from: Identity, toDid: string, doc: Doc): Promise<Uint8Array> {
  const { packTrustTask } = await import("@openvtc/trust-tasks-tsp");
  const sealed: any = await packTrustTask(doc, {
    senderVid: from.did,
    receiverVid: toDid,
    keys: { senderSigningKey: from.edSecret, senderEncryptionKey: from.xSecret, receiverEncryptionKey: publicKeys(toDid).encPub },
  });
  return sealed.bytes ?? sealed;
}
async function post(from: Identity, toDid: string, docOrBytes: Doc | Uint8Array, type: string) {
  const bytes = docOrBytes instanceof Uint8Array ? docOrBytes : await seal(from, toDid, docOrBytes);
  frames.push({ from: from.name, to: nameOf(toDid), type, bytes: bytes.length });
  wires.get(from.did)!.send(toDid, bytes);
}
async function ask(from: Identity, to: Identity, doc: Doc, timeoutMs = 30000): Promise<Doc> {
  const thread = doc.threadId ?? doc.id;
  const key = `${from.did}|${thread}`;
  const reply = new Promise<Doc>((res, rej) => {
    const t = setTimeout(() => (waiting.delete(key), rej(new Error(`${from.name}: no reply to ${doc.type} in ${timeoutMs} ms`))), timeoutMs);
    waiting.set(key, { from: to.did, resolve: (d) => (clearTimeout(t), res(d)) });
  });
  await post(from, to.did, doc, doc.type);
  return reply;
}
const isReplyType = (t: string) => t.endsWith("#response") || t.startsWith(bare(taskError.TYPE_URI)) || t.startsWith(bare(nextStep.TYPE_URI));

function listen(me: Identity, handler: Handler) {
  wires.get(me.did)!.onFrame((bytes) =>
    void (async () => {
      const sender = advertisedSender(bytes);
      if (!sender) throw new Error("frame with no sender");
      const pk = publicKeys(sender);
      const unpacked: any = await unpackTrustTask(bytes, {
        recipientVid: me.did,
        keys: { receiverDecryptionKey: me.xSecret, senderEncryptionKey: pk.encPub, senderSigningKey: pk.signPub },
      });
      const doc = unpacked.document as Doc;
      // Every payload on the wire, against the proposed schema.
      const errs = schemas.checkTrustTask(doc.type, doc.payload);
      if (errs.length) note(`schema: ${doc.type} from ${nameOf(sender)} fails the proposed schema: ${errs.slice(0, 3).join("; ")}`);
      const key = `${me.did}|${doc.threadId ?? doc.id}`;
      const w = waiting.get(key);
      if (w && w.from === sender && isReplyType(doc.type)) {
        waiting.delete(key);
        w.resolve(doc);
        return;
      }
      const out = await handler({ doc, sender, bytes, unpacked });
      if (out) await post(me, sender, out, out instanceof Uint8Array ? `reply to ${doc.type}` : (out as Doc).type);
    })().catch((e) => note(`${me.name} dropped a frame: ${e?.stack?.split("\n")[0] ?? e}`)),
  );
}

// ── The provider (VTA stand-in) ─────────────────────────────────────────────
const PURPOSES = {
  personalisation: "https://registry.trustoverip.org/dtg/purpose/personalisation/1",
  taskExecution: "https://registry.trustoverip.org/dtg/purpose/taskExecution/1",
};
const SUBJECT = "hcp-sub-keyring-demo";
const MANAGEMENT_TOKEN = "hcp_mt_rung_management"; // a mock: the VTI design gives Keyring no token in V0 (#2823 hcp.md §4.4)
const NEUTRAL = "The request is not authorized.";
interface Entry { id: string; category: string; value: string; declarationType: string; createdBy: string; at: string; version: number }
const store: Entry[] = [
  { id: urn(), category: "travel_preferences", value: "Prefers aisle seats and early-morning flights.", declarationType: "person-declared", createdBy: keyring.did, at: secs(), version: 1 },
  { id: urn(), category: "health_context", value: "Severe peanut allergy.", declarationType: "person-declared", createdBy: keyring.did, at: secs(), version: 1 },
];
interface Grant { grantId: string; token: string; client: string; categories: string[]; purposes: string[]; issuedAt: string; expiresAt: string; status: "active" | "revoked"; revokedAt?: string; access: any[] }
const grants: Grant[] = [];
const auditLog: any[] = [];
interface Hold { issuer: string; canonical: string; payload: any; state: "pending" | "approved" | "denied" | "granted"; challenge: string; payloadDigest: string; grantId?: string; consentDocType?: string }
const holds = new Map<string, Hold>();
const registered = new Map<string, { name: string; operator: { id: string; name: string } }>();

const providerConsumer = new TspConsumer({
  recipientVid: provider.did,
  decryptionKey: provider.xSecret,
  signingKey: provider.edSecret,
  resolveSender: (vid) => ({ encryptionKey: publicKeys(vid).encPub, signingKey: publicKeys(vid).signPub }),
  proofVerifier: prVerifier,
  payloadValidator: payloadValidator as any,
  newErrorId: urn,
});
const PROVIDER_SPECS: Record<string, any> = {
  [grantRequest.TYPE_URI]: grantRequest.SPEC,
  [query.TYPE_URI]: query.SPEC,
  [create.TYPE_URI]: create.SPEC,
  [list.TYPE_URI]: list.SPEC,
  [revoke.TYPE_URI]: revoke.SPEC,
  [audit.TYPE_URI]: audit.SPEC,
  [summary.TYPE_URI]: summary.SPEC,
  [consentDecision.TYPE_URI]: consentDecision.SPEC,
};

function event(eventType: string, initiator: { role: string; id: string }, extra: Record<string, unknown> = {}) {
  auditLog.push({
    eventId: urn(), eventType, timestamp: secs(),
    participants: { initiator, provider: { id: provider.did } },
    entryId: null, relatedEntryId: null, purpose: null, purposeDescription: null, grantId: null, ...extra,
  });
}
function entryObject(e: Entry) {
  return {
    schema: "https://hcp.example/spec/entry/2.0",
    id: e.id,
    type: ["ContextEntry"],
    subject: { id: SUBJECT },
    content: { profile: "https://hcp.example/spec/profiles/general-context/2.0", value: e.value, language: "en" },
    assertion: { declarationType: e.declarationType },
    classification: { categories: [e.category] },
    record: {
      status: "active", version: e.version,
      provenance: {
        assertedBy: { id: SUBJECT, assurance: "authenticated" }, assertedAt: e.at, source: "person-input",
        submittedByClient: { id: keyring.did, name: "Keyring", operator: { id: "keyring.example", name: "Keyring" } },
        authorizedUnder: "management", recordedByProvider: provider.did, recordedAt: e.at,
      },
    },
  };
}
function grantObject(g: Grant) {
  const reg = registered.get(g.client) ?? { name: "unregistered", operator: { id: "unknown", name: "unknown" } };
  return {
    grantId: g.grantId, subject: { id: SUBJECT }, authorizingPrincipal: { id: SUBJECT },
    client: { id: g.client, ...reg }, access: g.access, grantType: "temporary",
    issuedAt: g.issuedAt, expiresAt: g.expiresAt, status: g.status,
  };
}

async function providerHandle(doc: Doc): Promise<Doc> {
  const reply = (payload: unknown) => sign(provider, respondWith(doc as any, urn(), payload, secs) as Doc);
  const refuse = (code: string, message = NEUTRAL) => sign(provider, rejectWith(doc as any, urn(), { code, message, retryable: false }, secs) as Doc);
  const p = doc.payload;
  const isManagement = doc.issuer === keyring.did;
  switch (bare(doc.type)) {
    case grantRequest.TYPE_URI: {
      const canonical = kr.jcs(p);
      const hold = holds.get(doc.threadId);
      if (!hold) {
        const payloadDigest = kr.digestMultibase(p);
        const h: Hold = { issuer: doc.issuer, canonical, payload: p, state: "pending", challenge: randomBytes(16).toString("hex"), payloadDigest };
        holds.set(doc.threadId, h);
        // Ask the bound approver (Keyring), after the hold is answered (VTI #2823 hcp.md §5.2 steps 5-7).
        setTimeout(() => void askKeyringToApprove(doc.threadId, h).catch((e) => note(`provider: consent leg failed: ${e?.message ?? e}`)), 50);
        return held(doc);
      }
      if (hold.issuer !== doc.issuer) return refuse("permissionDenied");
      if (hold.canonical !== canonical) return refuse("malformedRequest", "The resubmission differs from the held request.");
      if (hold.state === "pending") return held(doc);
      if (hold.state === "denied") return refuse("permissionDenied");
      if (hold.state === "approved") {
        const g: Grant = {
          grantId: urn(), token: `hcp_at_${randomBytes(12).toString("hex")}`, client: doc.issuer,
          categories: p.access.flatMap((a: any) => a.categories),
          purposes: p.access.flatMap((a: any) => (a.purposes ?? []).map((x: any) => x.code)),
          issuedAt: secs(), expiresAt: plus(p.expiresIn ?? 4 * 3600), status: "active",
          access: p.access.map((a: any) => ({ type: a.type, actions: a.actions, categories: a.categories, purposes: (a.purposes ?? []).map((x: any) => ({ code: x.code, description: x.description ?? x.code })) })),
        };
        grants.push(g);
        hold.state = "granted";
        hold.grantId = g.grantId;
        event("grant.issued", { role: "hcp-provider", id: provider.did }, { grantId: g.grantId });
        return reply({ accessToken: g.token, tokenExpiresAt: plus(3600), grant: grantObject(g) });
      }
      const g = grants.find((x) => x.grantId === hold.grantId)!;
      return g.status === "active" ? reply({ accessToken: g.token, tokenExpiresAt: plus(3600), grant: grantObject(g) }) : refuse("permissionDenied");
    }
    case consentDecision.TYPE_URI: {
      // Only the bound approver decides; the decision names the challenge and the digest it was shown.
      if (!isManagement) return refuse("permissionDenied");
      const entry = [...holds.entries()].find(([, h]) => h.challenge === p.challenge);
      if (!entry) return refuse("task-consent/decision:unknownChallenge", "No pending request has this challenge.");
      const [, h] = entry;
      if (p.payloadDigest !== h.payloadDigest) return refuse("task-consent/decision:digestMismatch", "The digest is not the one shown.");
      h.state = p.decision === "approve" ? "approved" : "denied";
      if (p.decision === "approve") registered.set(h.issuer, { name: "Notes helper", operator: { id: "self", name: "You, from your own terminal" } });
      return reply({ status: p.decision === "approve" ? "granted" : "denied", payloadDigest: h.payloadDigest });
    }
    case query.TYPE_URI: {
      const g = grants.find((x) => x.token === p.accessToken);
      if (!g) return refuse("hcp:invalidToken", "The access token is not valid.");
      if (g.client !== doc.issuer) return refuse("permissionDenied");
      if (g.status !== "active") return refuse("hcp:invalidToken", "The access token is not valid.");
      const asked: string[] = p.categories ?? g.categories;
      if (!g.purposes.includes(p.purpose) || asked.some((c) => !g.categories.includes(c))) return refuse("permissionDenied");
      const useUntil = plus(3600);
      const hits = store.filter((e) => asked.includes(e.category)).slice(0, Math.min(p.maxEntries ?? 5, 20));
      event("context.read", { role: "context-client", id: doc.issuer }, { grantId: g.grantId, purpose: p.purpose, categories: asked });
      return reply({
        entries: hits.map((e) => ({
          ref: `hcp-ref-${e.id.slice(-8)}`, version: e.version,
          content: { profile: "https://hcp.example/spec/profiles/general-context/2.0", value: e.value, language: "en" },
          assertion: { declarationType: e.declarationType }, classification: { categories: [e.category] },
          standing: { assurance: "authenticated", confirmed: true }, useUntil,
        })),
        retrievalId: urn(), minimization: { method: "lexical" }, categoriesSearched: asked, directives: [], respondedAt: secs(),
      });
    }
    case create.TYPE_URI: {
      if (!isManagement) return refuse("permissionDenied");
      const e: Entry = { id: urn(), category: p.classification.categories[0], value: String(p.content.value), declarationType: p.assertion.declarationType, createdBy: doc.issuer, at: secs(), version: 1 };
      store.push(e);
      event("entry.created", { role: "management-client", id: doc.issuer }, { entryId: e.id, categories: [e.category] });
      return reply({ entry: entryObject(e) });
    }
    case list.TYPE_URI:
      if (!isManagement) return refuse("permissionDenied");
      return reply({ grants: grants.filter((g) => !p.status || g.status === p.status).map(grantObject) });
    case audit.TYPE_URI:
      if (!isManagement) return refuse("permissionDenied");
      return reply({ events: auditLog });
    case summary.TYPE_URI: {
      if (!isManagement) return refuse("permissionDenied");
      const clients = [...new Set(grants.map((g) => g.client))].map((c) => {
        const gs = grants.filter((g) => g.client === c);
        const reads = auditLog.filter((a) => a.eventType === "context.read" && a.participants.initiator.id === c);
        return {
          client: { id: c, ...(registered.get(c) ?? { name: "unregistered", operator: { id: "unknown", name: "unknown" } }) },
          grants: gs.map((g) => ({ grantId: g.grantId, status: g.status })),
          categories: [...new Set(gs.flatMap((g) => g.categories))], purposes: [...new Set(gs.flatMap((g) => g.purposes))],
          entries: store.length, retrievals: reads.length,
          firstAt: reads[0]?.timestamp ?? gs[0]!.issuedAt, lastAt: reads.at(-1)?.timestamp ?? gs[0]!.issuedAt,
          usableUntil: gs.some((g) => g.status === "active") ? plus(3600) : null,
          notification: gs.some((g) => g.status === "revoked") ? "delivered" : "none",
        };
      });
      return reply({ clients });
    }
    case revoke.TYPE_URI: {
      if (!isManagement) return refuse("permissionDenied");
      const g = grants.find((x) => x.grantId === p.grantId);
      if (!g) return refuse("permissionDenied");
      if (g.status === "active") {
        g.status = "revoked";
        g.revokedAt = doc.issuedAt;
        event("grant.revoked", { role: "management-client", id: doc.issuer }, { grantId: g.grantId });
        setTimeout(() => void sendNotice(g).catch((e) => note(`provider: notice failed: ${e?.message ?? e}`)), 50);
      }
      return reply({});
    }
  }
  return refuse("unsupportedType", `no handler for ${doc.type}`);
}
function held(doc: Doc): Promise<Doc> {
  return sign(provider, {
    id: urn(), type: nextStep.TYPE_URI, issuer: provider.did, recipient: doc.issuer, issuedAt: secs(), threadId: doc.threadId,
    payload: {
      expects: [{ typeUri: `${grantRequest.TYPE_URI}#request`, reason: "The request is with the person, who has not decided yet.", hint: { retryAfter: 1 } }],
      continuation: "resubmit",
      inResponseTo: { typeUri: doc.type, id: doc.id },
    },
  });
}

/** VTI #2823 §5: a VTA-signed task-consent/request to the bound approver, one effect per HCP 6.1.6 item. */
let consentTypeForm = consentRequest.TYPE_URI; // bare, unless a probe asks for the #request form
const consentSeen: Doc[] = [];
async function askKeyringToApprove(grantThread: string, h: Hold) {
  const a = h.payload.access[0];
  const effects = [
    { kind: "hcpClient", summary: "Run by you, from your own terminal." },
    { kind: "hcpChat", summary: "It will be able to chat with you." },
    { kind: "hcpMemories", summary: `It will be able to read and change the memories ${a.categories.join(", ")}, and no others.` },
    { kind: "hcpPurposes", summary: `It can use them for: ${(a.purposes ?? []).map((x: any) => x.description ?? x.code).join("; ")}` },
    { kind: "hcpDuration", summary: `For 4 hours, until ${plus(h.payload.expiresIn ?? 14400)}.` },
    { kind: "hcpNotSignIn", summary: "Approving gives access. It is not signing in." },
    // The scanned thread: Keyring accepts the request only for the VID and threadId it scanned (#2823 §5.2).
    // task-consent/request has no member for it; an effect's untyped `after` is the only place to put it.
    { kind: "hcpGrantRequest", summary: "The connection you scanned.", after: { threadId: grantThread, client: h.issuer } },
  ];
  const payload = {
    challenge: h.challenge, taskType: grantRequest.TYPE_URI, payloadDigest: h.payloadDigest,
    sideEffects: "mutating", exposure: { discloses: "secret", actsAsSubject: true }, effects,
    requester: h.issuer, approverSet: "keyring-owner", minApprovals: 1, excludeRequester: true, expiresAt: plus(300),
  };
  const doc = await sign(provider, { ...build(provider, keyring, consentTypeForm, payload) });
  const ack = await ask(provider, keyring, doc);
  consentSeen.push(ack);
}

/** hcp/grants/revoked to the grant's client, then the same notice again (a retry), to see the dedupe. */
const noticeAcks: Doc[] = [];
async function sendNotice(g: Grant) {
  const noticeId = urn();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const doc = await sign(provider, build(provider, byDid.get(g.client)!, `${revoked.TYPE_URI}#request`, { noticeId, grantId: g.grantId, revokedAt: g.revokedAt, reason: "revoked" }));
    noticeAcks.push(await ask(provider, byDid.get(g.client)!, doc));
  }
}

listen(provider, async ({ doc, unpacked }) => {
  const spec = PROVIDER_SPECS[bare(doc.type)];
  if (!spec) {
    note(`provider: no spec for ${doc.type}`);
    return undefined;
  }
  const result = await providerConsumer.consume(unpacked, spec, (accepted: any) => providerHandle(accepted) as any);
  if (result.outcome.kind === "rejected") lastPipelineRefusal = JSON.parse(new TextDecoder().decode(result.reply!));
  return result.reply ? providerConsumer.packReply(result) : undefined;
});
let lastPipelineRefusal: Doc | undefined;

// ── The agent (Context Client) ──────────────────────────────────────────────
const agentConsumer = new TspConsumer({
  recipientVid: agent.did,
  decryptionKey: agent.xSecret,
  signingKey: agent.edSecret,
  resolveSender: (vid) => ({ encryptionKey: publicKeys(vid).encPub, signingKey: publicKeys(vid).signPub }),
  proofVerifier: prVerifier,
  payloadValidator: payloadValidator as any,
  newErrorId: urn,
});
const processedNotices = new Map<string, string>();
let agentToken: string | undefined;
listen(agent, async ({ doc, unpacked }) => {
  if (bare(doc.type) !== revoked.TYPE_URI) return undefined;
  const result = await agentConsumer.consume(unpacked, revoked.SPEC as any, (accepted: any) => {
    const p = accepted.payload;
    if (!processedNotices.has(p.noticeId)) {
      processedNotices.set(p.noticeId, p.grantId);
      agentToken = undefined; // stop using the grant at once
    }
    return sign(agent, respondWith(accepted, urn(), {}, secs) as Doc) as any;
  });
  return result.reply ? agentConsumer.packReply(result) : undefined;
});

// ── Keyring (Management Client) ─────────────────────────────────────────────
// The scan: the agent's QR gives Keyring its VID and the grant request's threadId (plan §3.2; #2823 §5.2).
let scanned: { client: string; threadId: string } | undefined;
const keyringSaw: { lines: string[]; matchCode?: string; verdict: string }[] = [];
const decisionReplies: Doc[] = [];
let personDecides: "approve" | "deny" = "approve";

/** Keyring's consentCheck.ts checkConsentRequest, line for line (it cannot be imported under Node: it reaches
 * react-native through VtaClient). Its type check is an EXACT match on VTA_TASK.consentRequest. */
async function keyringCheckConsent(doc: Doc): Promise<string> {
  const payload = doc.payload;
  if (doc.type !== "https://trusttasks.org/spec/task-consent/request/0.1" || !payload || typeof payload !== "object") return "malformed";
  const verdict = await kr.verifyTrustTask(doc);
  if (!verdict.ok) return verdict.reason;
  if (doc.proof.proofPurpose !== "authentication") return "wrong-purpose";
  if ((verdict as any).signer !== doc.issuer) return "signer-not-issuer";
  if (doc.issuer !== provider.did) return "wrong-issuer";
  if (doc.recipient !== keyring.did) return "wrong-recipient";
  const expiresAt = Date.parse(String(payload.expiresAt ?? ""));
  if (!Number.isFinite(expiresAt)) return "malformed";
  if (expiresAt <= Date.now()) return "expired";
  return "ok";
}
function keyringMatchCode(digest: string): string | undefined {
  // consentCheck.ts consentMatchCode: the first six hex chars of the multihash's digest bytes.
  try {
    const bytes = kr.multibaseDecode(digest);
    if (bytes.length !== 34 || bytes[0] !== 0x12 || bytes[1] !== 0x20) return undefined;
    return Buffer.from(bytes.slice(2, 5)).toString("hex").slice(0, 6);
  } catch {
    return undefined;
  }
}

listen(keyring, async ({ doc }) => {
  if (bare(doc.type) !== consentRequest.TYPE_URI) return undefined;
  const verdict = await keyringCheckConsent(doc);
  const lines = (doc.payload?.effects ?? []).map((e: any) => String(e?.summary ?? e?.kind ?? "")).filter(Boolean);
  const scannedEffect = (doc.payload?.effects ?? []).find((e: any) => e?.kind === "hcpGrantRequest")?.after;
  const matchesScan = !!scanned && doc.payload?.requester === scanned.client && scannedEffect?.threadId === scanned.threadId;
  keyringSaw.push({ lines, matchCode: keyringMatchCode(doc.payload?.payloadDigest), verdict: verdict === "ok" && !matchesScan ? "not-the-scan" : verdict });
  const status = verdict === "ok" && matchesScan ? "prompted" : "refused";
  const ack = await sign(keyring, respondWith(doc as any, urn(), { status, ...(status === "refused" ? { reason: verdict } : {}) }, () => wireTimestamp(now())) as Doc);
  if (status === "prompted") {
    // The person reads the checklist and answers with face or fingerprint (mocked); Keyring signs the decision.
    setTimeout(() => void (async () => {
      const d = await sign(keyring, build(keyring, provider, consentDecision.TYPE_URI, { challenge: doc.payload.challenge, payloadDigest: doc.payload.payloadDigest, decision: personDecides }));
      decisionReplies.push(await ask(keyring, provider, d));
    })().catch((e) => note(`keyring: decision failed: ${e?.message ?? e}`)), 200);
  }
  return ack;
});

/** Keyring's VtaClient.sendTask reading of a reply (VtaClient.ts:2105-2110): an error becomes VtiRefusal(code, message,
 * details); anything else is returned as the result. */
function keyringReads(reply: Doc): { refusal?: { code: string; message: string; details?: unknown }; result?: unknown } {
  if (String(reply?.type ?? "").startsWith("https://trusttasks.org/spec/trust-task-error/")) {
    const p = reply.payload ?? {};
    return { refusal: { code: p.code ?? "unknown", message: p.message ?? "refused", details: p.details } };
  }
  return { result: reply.payload ?? reply };
}

// ── The run ─────────────────────────────────────────────────────────────────
say(`\n  provider ${provider.did.slice(0, 28)}…\n  agent    ${agent.did.slice(0, 28)}…\n  keyring  ${keyring.did.slice(0, 28)}…`);
const ASK = {
  access: [{
    type: "https://hcp.example/spec/authorization/context-access",
    actions: ["read"],
    categories: ["travel_preferences", "dietary_preferences"],
    purposes: [
      { code: PURPOSES.personalisation, description: "Personalise its answers for you" },
      { code: PURPOSES.taskExecution, description: "Do the tasks you ask of it" },
    ],
  }],
  expiresIn: 14400,
};

async function agentConnect(): Promise<{ thread: string; replies: Doc[] }> {
  const first = await sign(agent, build(agent, provider, `${grantRequest.TYPE_URI}#request`, ASK));
  scanned = { client: agent.did, threadId: first.threadId };
  const replies: Doc[] = [];
  let reply = await ask(agent, provider, first);
  replies.push(reply);
  for (let i = 0; i < 15 && reply.type === nextStep.TYPE_URI; i++) {
    await sleep(1000 * (reply.payload?.expects?.[0]?.hint?.retryAfter ?? 1));
    reply = await ask(agent, provider, await sign(agent, build(agent, provider, `${grantRequest.TYPE_URI}#request`, ASK, first.threadId)));
    replies.push(reply);
  }
  return { thread: first.threadId, replies };
}
async function agentQuery(token: string, categories = ["travel_preferences", "dietary_preferences"], signIt = true) {
  const d = build(agent, provider, `${query.TYPE_URI}#request`, { query: "What should I know before booking dinner on the trip?", categories, purpose: PURPOSES.personalisation, maxEntries: 5, accessToken: token });
  return ask(agent, provider, signIt ? await sign(agent, d) : d);
}
async function keyringTask(type: string, payload: unknown, purpose?: "authentication" | "assertionMethod") {
  return ask(keyring, provider, await sign(keyring, build(keyring, provider, `${type}#request`, payload), purpose));
}
const hcpCheck = (label: string, name: string, value: unknown) => {
  const errs = schemas.checkHcp(name, value);
  check(`hcp-schema:${label}`, `${label} also validates against HCP's own ${name}`, errs.length === 0, "valid", errs.slice(0, 4).join("; ") || "valid", "Same object, judged by HCP's schema rather than the proposal's.");
};

try {
  say("\n── 1. Connect: the agent asks, the VTA holds it and asks Keyring, the person approves ──");
  const { thread, replies } = await agentConnect();
  const firstReply = replies[0]!;
  check("connect-held", "the first grant request is held with a next step, not an error", firstReply.type === nextStep.TYPE_URI, nextStep.TYPE_URI, firstReply.type);
  const grantReply = replies.at(-1)!;
  check("connect-granted", "after Keyring's approval, the resubmission on the same thread gets the grant", grantReply.type === grantRequest.RESPONSE_TYPE_URI, grantRequest.RESPONSE_TYPE_URI, `${grantReply.type} after ${replies.length} replies`);
  check("consent-keyring-check", "Keyring's own consent check accepts the VTA's task-consent/request", keyringSaw[0]?.verdict === "ok", "ok", keyringSaw[0]?.verdict ?? "never received");
  check("consent-match-code", "Keyring can show the six-digit match code from the request's payloadDigest", !!keyringSaw[0]?.matchCode, "a code", keyringSaw[0]?.matchCode ?? "none");
  check("consent-decision-accepted", "the VTA's pipeline accepts Keyring's decision (Keyring signs it assertionMethod)", decisionReplies[0]?.type === consentDecision.RESPONSE_TYPE_URI, consentDecision.RESPONSE_TYPE_URI, decisionReplies[0]?.type ?? "no reply");
  say(`     Keyring showed the person:\n${(keyringSaw[0]?.lines ?? []).map((l) => `       - ${l}`).join("\n")}`);
  agentToken = grantReply.payload?.accessToken;
  if (grantReply.payload?.grant) hcpCheck("grant", "grant.json", grantReply.payload.grant);

  say("\n── 2. The agent reads context under the grant ──");
  const q1 = await agentQuery(agentToken!);
  check("query-ok", "a query under the grant returns entries", q1.type === query.RESPONSE_TYPE_URI, query.RESPONSE_TYPE_URI, `${q1.type} ${JSON.stringify(q1.payload).slice(0, 160)}`);
  // The one documented rename on this object (query spec.md:127): HCP `timestamp` is the task's `respondedAt`.
  if (q1.payload) { const { respondedAt, ...rest } = q1.payload; hcpCheck("query-result", "operations/query-result.json", { ...rest, timestamp: respondedAt }); }
  const before = (q1.payload?.entries ?? []).length;

  say("\n── 3. Keyring adds a memory (hcp/entries/create), as VTI V0 says: no token ──");
  const createPayload = (withToken: boolean) => ({
    schema: "https://hcp.example/spec/entry/2.0",
    subject: { id: SUBJECT },
    content: { profile: "https://hcp.example/spec/profiles/general-context/2.0", value: "I'm vegetarian.", language: "en" },
    classification: { categories: ["dietary_preferences"] },
    assertion: { declarationType: "person-declared" },
    record: { provenance: { source: "person-input" } },
    ...(withToken ? { accessToken: MANAGEMENT_TOKEN } : {}),
  });
  const noTok = await keyringTask(create.TYPE_URI, createPayload(false));
  check("v0-no-token", "a governance task with NO accessToken (the VTI V0 design, #2823 §4.4) passes the proposed schema", noTok.type === create.RESPONSE_TYPE_URI, create.RESPONSE_TYPE_URI, `${noTok.type} ${JSON.stringify(noTok.payload).slice(0, 200)}`, "The proposed governance schemas make accessToken REQUIRED; the VTI design has Keyring send none until V1.");
  const created = await keyringTask(create.TYPE_URI, createPayload(true));
  check("create-ok", "with a (mock) management token, the VTA stores the memory", created.type === create.RESPONSE_TYPE_URI, create.RESPONSE_TYPE_URI, `${created.type} ${JSON.stringify(keyringReads(created)).slice(0, 200)}`);
  hcpCheck("create-request", "operations/create-request.json", (({ accessToken, ...rest }) => rest)(createPayload(true) as any));
  if (created.payload?.entry) hcpCheck("entry", "entry.json", created.payload.entry);
  const q2 = await agentQuery(agentToken!);
  check("memory-used", "the agent's next query sees the new memory", (q2.payload?.entries ?? []).length === before + 1, `${before + 1} entries`, `${(q2.payload?.entries ?? []).length} entries`);

  say("\n── 4. Keyring reads what the agent has: grants, audit, disclosure summary ──");
  const gl = await keyringTask(list.TYPE_URI, { accessToken: MANAGEMENT_TOKEN });
  check("list-ok", "grants/list returns the grant", gl.payload?.grants?.length === 1, "1 grant", JSON.stringify(keyringReads(gl)).slice(0, 160));
  const au = await keyringTask(audit.TYPE_URI, { accessToken: MANAGEMENT_TOKEN });
  check("audit-ok", "audit/read returns events", (au.payload?.events ?? []).length > 0, "events", JSON.stringify(keyringReads(au)).slice(0, 200));
  for (const [i, ev] of (au.payload?.events ?? []).entries()) if (i < 3) hcpCheck(`audit-event-${i}`, "audit-event.json", ev);
  const su = await keyringTask(summary.TYPE_URI, { accessToken: MANAGEMENT_TOKEN });
  check("summary-ok", "disclosures/summary returns the client", su.payload?.clients?.length === 1, "1 client", JSON.stringify(keyringReads(su)).slice(0, 200));
  hcpCheck("disclosure-summary", "operations/disclosure-summary-result.json", su.payload);

  say("\n── 5. Probes on the live grant ──");
  const unsigned = await agentQuery(agentToken!, undefined, false);
  check("probe-unsigned", "a token-carrying request with no proof is refused proofRequired", unsigned.payload?.code === "proofRequired", "proofRequired", `${unsigned.type} ${unsigned.payload?.code}`);
  check("probe-unsigned-error-unsigned", "that refusal comes back unsigned (the library builds it)", unsigned.proof === undefined, "no proof", unsigned.proof ? "signed" : "no proof", "Keyring's checkVtaReply exempts trust-task-error replies from the proof check (vtaReplyProof.ts:33), so this is fine.");
  const stolen = await ask(keyring, provider, await sign(keyring, build(keyring, provider, `${query.TYPE_URI}#request`, { query: "x", categories: ["travel_preferences"], purpose: PURPOSES.personalisation, accessToken: agentToken! })));
  check("probe-token-other-vid", "the agent's token presented from Keyring's DID is refused permissionDenied", stolen.payload?.code === "permissionDenied", "permissionDenied", `${stolen.type} ${stolen.payload?.code}`);
  const assertion = await keyringTask(list.TYPE_URI, { accessToken: MANAGEMENT_TOKEN }, "assertionMethod");
  check("probe-keyring-assertion-purpose", "a Keyring request signed assertionMethod (signDocumentProof's default) is accepted", assertion.type === list.RESPONSE_TYPE_URI, list.RESPONSE_TYPE_URI, assertion.type, "The PR verifier accepts authentication or assertionMethod.");
  const strict = await kr.verifyDocument(gl, provider.did);
  const lenient = await kr.verifyTrustTask(gl);
  check("probe-keyring-verifies-reply", "Keyring's vta-sdk-mirror verifier accepts the VTA's reply", lenient.ok, "ok", JSON.stringify(lenient));
  check("info-keyring-strict-verifier", "(information) Keyring's stricter verifyDocumentProof, at its default purpose, refuses the VTA's reply; Keyring's reply path uses the lenient verifier instead", !strict, "false (and not on the reply path)", String(strict), "The PR signs replies proofPurpose authentication; verifyDocumentProof defaults to assertionMethod. checkVtaReply uses verifyTrustTaskProof (vtaReplyProof.ts:35), which accepts any purpose. Only matters if new HCP code reaches for verifyDocumentProof.");
  const tok = agentToken ?? "hcp_at_placeholder";
  const tokenDigestSpec = "u" + Buffer.concat([Buffer.from([0x12, 0x20]), createHash("sha256").update(tok, "utf8").digest()]).toString("base64url");
  const tokenDigestKeyring = kr.digestMultibase(tok);
  check("info-access-token-digest", "(information) Keyring's digestMultibase is not the spec's accessTokenDigest, and need not be: that digest is a record the provider keeps and never goes on the wire", tokenDigestKeyring !== tokenDigestSpec, "different, and unused by Keyring", `${tokenDigestKeyring} vs ${tokenDigestSpec}`, "Spec: SHA-256 multihash of the token's UTF-8 bytes, base64url (u). Keyring: the JSON form, base58btc (z).");

  say("\n── 6. Keyring revokes; the agent is told, and its next request is refused ──");
  const grantId = gl.payload?.grants?.[0]?.grantId;
  const rv = await keyringTask(revoke.TYPE_URI, { grantId, accessToken: MANAGEMENT_TOKEN });
  check("revoke-ok", "grants/revoke succeeds", rv.type === revoke.RESPONSE_TYPE_URI, revoke.RESPONSE_TYPE_URI, rv.type);
  for (let i = 0; i < 40 && noticeAcks.length < 2; i++) await sleep(250);
  check("notice-acked", "the revocation notice reaches the agent and is acknowledged", noticeAcks[0]?.type === revoked.RESPONSE_TYPE_URI, revoked.RESPONSE_TYPE_URI, noticeAcks[0]?.type ?? "no ack");
  check("notice-dedupe", "a second delivery of the same noticeId is acknowledged and not acted on again", noticeAcks[1]?.type === revoked.RESPONSE_TYPE_URI && processedNotices.size === 1, "ack, 1 notice recorded", `${noticeAcks[1]?.type}, ${processedNotices.size} recorded`);
  const after = await ask(agent, provider, await sign(agent, build(agent, provider, `${query.TYPE_URI}#request`, { query: "x", categories: ["travel_preferences"], purpose: PURPOSES.personalisation, accessToken: grantReply.payload.accessToken })));
  check("after-revoke", "the old token is refused hcp:invalidToken", after.payload?.code === "hcp:invalidToken", "hcp:invalidToken", `${after.type} ${after.payload?.code}`);
  const read = keyringReads(after);
  check("keyring-reads-hcp-error", "Keyring's reply reading turns the hcp error into a refusal with its code intact", read.refusal?.code === "hcp:invalidToken", "VtiRefusal code hcp:invalidToken", JSON.stringify(read));

  say("\n── 7. Probes on the connect path ──");
  // a) Keyring reads a held reply the way VtaClient.sendTask does: anything not an error is the result.
  const asResult = keyringReads(firstReply);
  check("probe-next-step-as-result", "Keyring's sendTask would treat a held reply (next step) as a refusal or a hold, not as the result", !!asResult.refusal, "a hold, not a result", `returned as result: ${JSON.stringify(asResult.result).slice(0, 120)}`, "Matters if any governance task Keyring sends can be held (task consent on governance).");
  // b) The consent request with a #request fragment: Keyring's exact type match.
  consentTypeForm = `${consentRequest.TYPE_URI}#request`;
  keyringSaw.length = 0;
  const second = await sign(agent, build(agent, provider, `${grantRequest.TYPE_URI}#request`, { ...ASK, expiresIn: 3600 }));
  scanned = { client: agent.did, threadId: second.threadId };
  await ask(agent, provider, second);
  for (let i = 0; i < 40 && keyringSaw.length === 0; i++) await sleep(250);
  check("probe-consent-fragment", "Keyring accepts a task-consent/request typed with a #request fragment, as the PR's demo types every request", keyringSaw[0]?.verdict === "ok", "ok", keyringSaw[0]?.verdict ?? "never received", "consentCheck.ts compares doc.type to the bare Type URI exactly.");
  consentTypeForm = consentRequest.TYPE_URI;
  // c) The person declines: what does the agent get?
  personDecides = "deny";
  keyringSaw.length = 0;
  const declined = await agentConnect();
  const last = declined.replies.at(-1)!;
  check("probe-declined", "a declined grant request ends in a typed outcome the agent can tell from other refusals", last.type === taskError.TYPE_URI && last.payload?.code !== "permissionDenied", "a distinct code", `${last.type} ${last.payload?.code}`, "The specs define no declined outcome; the neutral permissionDenied is all an agent can see.");
  personDecides = "approve";
  // d) MCP: what vta-mcp's vta_call would do with this flow (read from vta-sdk at f7b78e29d, not run).
  check("mcp-vta-call-thread", "an agent going through vta-mcp's vta_call can resubmit on the same threadId", false, "a threadId parameter", "vta_call takes {operation, payload}; vta-sdk build_task_document mints a fresh id and sets no threadId (client/mod.rs:4203-4213)", "Not run: read from source. Each resubmission through vta_call would be a new held request, and a new prompt on the phone.");
  check("mcp-vta-call-next-step", "vta_call surfaces a held reply as a hold", false, "a hold", "extract_trust_task_payload treats any payload without code+message as success (client/mod.rs:2492-2510): a next step is returned as a result", "Not run: read from source.");
} catch (e: any) {
  note(`RUN STOPPED: ${e?.stack ?? e}`);
} finally {
  for (const w of wires.values()) await w.close();
}

// ── Report ──────────────────────────────────────────────────────────────────
const out = resolve(here, "..", "out"); // git-ignored; a frozen run is in fixtures/
mkdirSync(out, { recursive: true });
const report = {
  transport: transportUsed,
  keyringRoot: KEYRING,
  checks,
  notes,
  frames: { count: frames.length, maxBytes: Math.max(0, ...frames.map((f) => f.bytes)), largest: [...frames].sort((a, b) => b.bytes - a.bytes).slice(0, 5) },
  keyringShowed: keyringSaw,
  lastPipelineRefusal,
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const passed = checks.filter((c) => c.ok).length;
console.log(`\n${passed}/${checks.length} checks as expected · transport: ${transportUsed} · ${frames.length} frames, largest ${report.frames.maxBytes} B · report: out/report.json`);
for (const c of checks.filter((c) => !c.ok)) console.log(`  ✗ ${c.id}: ${c.title}\n      ${c.observed}${c.meaning ? `\n      → ${c.meaning}` : ""}`);
process.exit(0);
