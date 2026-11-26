#!/usr/bin/env node
// vta-run.mjs: the VTA cases of agent-connect-plan.md step 0.1, against the lab VTA `lab/vta.sh` started.
//
//   node vta-run.mjs              run every case; compare with fixtures/vta-cases-<version>.json; exit 1 on a difference
//   node vta-run.mjs --record     write that file
//   node vta-run.mjs --only d-grant,p3-bound
//
// Keyring's part is played by the VTA's one administrator, the agent's by fresh did:keys the administrator
// grants an `application` entry to. Everything is a signed Trust Task over the VTA's HTTPS binding. Each case
// reports a small object of codes and facts; a random id never appears in it, so two runs compare equal.
//
// The cases need the task versions the plan names (acl/grant 0.3, vta/memory/put 0.3). On a VTA that does not
// serve them, each case reports that and nothing else.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import canonicalize from "canonicalize";
import { identityFromSeed, mintIdentity } from "./identity.mjs";
import { keyOfMethod, listedUnder, secure, verify } from "./proof.mjs";
import { call, signIn, trySignIn } from "./vta.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const record = args.includes("--record");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : undefined;

let lab;
try {
  lab = JSON.parse(execFileSync(`${here}lab/vta.sh`, ["status"], { encoding: "utf8" }));
} catch {
  console.error("no lab VTA is running: start one with `lab/vta.sh up <vta binary> <commit>`");
  process.exit(2);
}
const at = { baseUrl: lab.baseUrl, vtaDid: lab.vtaDid };
const admin = identityFromSeed(Uint8Array.from(Buffer.from(readFileSync(lab.adminSeedFile, "utf8").trim(), "hex")));
const A = await signIn({ ...at, identity: admin });

/** An answer as one word: `ok`, the refusal's code, or its HTTP status when it carries none. */
const code = (answer) => (answer.ok ? "ok" : (answer.code ?? `http ${answer.status}`));
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const uniq = () => Array.from(randomBytes(10), (b) => BASE32[b % 32]).join("");
const inFourHours = () => new Date(Date.now() + 4 * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z");
const sorted = (list) => [...(list ?? [])].sort();

/** A memory: a top-level context, or a child when `parent` is given. Returns the id the VTA gave it. */
async function newContext(name = "Memory", parent) {
  const answer = await call(A, "vta/contexts/create/1.0", parent ? { id: `m${uniq()}`, name, parent } : { id: `keyring-memory-${uniq()}`, name });
  if (!answer.ok) throw new Error(`could not create a context: ${code(answer)}`);
  return answer.payload.id;
}

const entryFor = (subject, { contexts, capabilities = ["memory-read", "memory-write"], purposes = ["assist"], role = "application", expiresAt, label = "ref-25" }) => ({
  subject,
  role,
  act: contexts === "all" ? { scope: "all" } : { scope: "contexts", contexts },
  keys: { scope: "none" },
  capabilities: capabilities === "ceiling" ? { scope: "ceiling" } : { scope: "listed", grants: capabilities.map((capability) => ({ capability })) },
  purposes: purposes === "any" ? { scope: "any" } : { scope: "listed", purposes },
  label,
  ...(expiresAt ? { expiresAt } : {}),
});

/** A fresh did:key with an entry, signed in. */
async function newParty(options) {
  const identity = mintIdentity();
  const granted = await call(A, "acl/grant/0.3", { entry: entryFor(identity.did, options) });
  if (!granted.ok) throw new Error(`grant refused: ${code(granted)}`);
  return { identity, session: await signIn({ ...at, identity }) };
}

const put = (session, contextId, key = "note/1", value = "a note") => call(session, "vta/memory/put/0.3", { contextId, key, value });
const get = (session, contextId, key = "note/1") => call(session, "vta/memory/get/0.2", { contextId, keys: [key] });
const entryOf = async (subject) => ((await call(A, "acl/list/0.4", {})).payload.entries ?? []).find((entry) => entry.subject === subject);
const deviceOf = async (deviceId) => ((await call(A, "device/list/0.3", {})).payload.devices ?? []).find((device) => device.deviceId === deviceId);
const registerAgent = (session) => call(session, "device/register/0.2", { consumerKind: { kind: "service", serviceKind: "aiAgent" }, displayName: "ref-25 agent" });

/** The proof a key swap asks for: a compact EdDSA JWT signed by the NEW key (vta-sdk `build_swap_presentation`). */
function linkProof(next) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${b64({ alg: "EdDSA", typ: "JWT", kid: next.authVm })}.${b64({
    iss: next.did,
    aud: lab.vtaDid,
    exp: Math.floor(Date.now() / 1000) + 300,
    vp: { type: ["VerifiablePresentation", "AclSwapRequest"], holder: next.did },
  })}`;
  return `${input}.${Buffer.from(ed25519.sign(new TextEncoder().encode(input), next.edSecret)).toString("base64url")}`;
}

/** Move `party`'s entry to a fresh key, as the entry's own subject. Returns the new party and the answer. */
async function swap(party) {
  const next = mintIdentity();
  const answer = await call(party.session, "acl/swap-key/0.1", { currentSubject: party.identity.did, newSubject: next.did, linkProof: linkProof(next) });
  const signedIn = answer.ok ? await trySignIn({ ...at, identity: next }) : { ok: false };
  return { answer, party: signedIn.ok ? { identity: next, session: signedIn.session } : undefined };
}

const cases = [];
/** `needs` names the task versions a case uses beyond the two every case needs (see the run, below). */
const add = (id, title, fn, needs = []) => cases.push({ id, title, fn, needs });

add("p1-administrator", "0.1(p) item 1: who the seeded administrator is", async () => {
  const who = await call(A, "auth/whoami/0.1");
  return { roles: who.payload.roles, scopes: who.payload.scopes };
});

add("p2-create-context", "0.1(p) item 2 and 0.1(o): creating a memory, the second create, and a scoped administrator", async () => {
  const id = `keyring-memory-${uniq()}`;
  const first = await call(A, "vta/contexts/create/1.0", { id, name: "Work notes" });
  const second = await call(A, "vta/contexts/create/1.0", { id, name: "Work notes" });
  const listed = ((await call(A, "vta/contexts/list/1.0")).payload.contexts ?? []).find((context) => context.id === id);
  const scoped = await newParty({ contexts: [id], role: "admin", capabilities: "ceiling", purposes: "any" });
  const who = await call(scoped.session, "auth/whoami/0.1");
  return {
    create: code(first),
    idAsAsked: first.payload.id === id,
    createAgain: code(second),
    createAgainSaysConflict: /conflict/i.test(second.message ?? ""),
    listedWithItsName: listed?.name === "Work notes",
    scopedAdministrator: {
      roles: who.payload.roles,
      scoped: (who.payload.scopes ?? []).length > 0,
      createsTopLevel: code(await call(scoped.session, "vta/contexts/create/1.0", { id: `keyring-memory-${uniq()}`, name: "Refused?" })),
      createsUnderItsOwn: code(await call(scoped.session, "vta/contexts/create/1.0", { id: `m${uniq()}`, name: "Child", parent: id })),
    },
  };
});

add("d-grant", "0.1(d): acl/grant 0.3 with listed memory capabilities and listed purposes; capability names as spelled", async () => {
  const memory = await newContext();
  const grant = (subject, capabilities, purposes = ["assist"]) =>
    call(A, "acl/grant/0.3", {
      entry: { ...entryFor(subject, { contexts: [memory], purposes }), capabilities: { scope: "listed", grants: capabilities.map((capability) => ({ capability })) } },
    });
  const agent = mintIdentity();
  const kebab = await grant(agent.did, ["memory-read", "memory-write"]);
  const who = kebab.ok ? await call(await signIn({ ...at, identity: agent }), "auth/whoami/0.1") : undefined;
  return {
    kebabCase: code(kebab),
    camelCase: code(await grant(mintIdentity().did, ["memoryRead", "memoryWrite"])),
    aPurposeNameNobodyDefined: code(await grant(mintIdentity().did, ["memory-read"], ["zzz"])),
    aPurposeNameWithAHyphen: code(await grant(mintIdentity().did, ["memory-read"], ["not-a-purpose"])),
    noPurposesMember: code(await call(A, "acl/grant/0.3", { entry: (({ purposes: _dropped, ...rest }) => rest)(entryFor(mintIdentity().did, { contexts: [memory] })) })),
    agentSees: who ? { roles: who.payload.roles, scopes: (who.payload.scopes ?? []).map((s) => s.replace(memory, "<its memory>")), capabilities: sorted(who.payload.capabilities) } : undefined,
  };
});

add("p3-bound", "0.1(p) item 3: an entry bound to one memory is refused a second one, and a grant naming a context that does not exist", async () => {
  const mine = await newContext("Mine");
  const other = await newContext("Other");
  const agent = await newParty({ contexts: [mine] });
  const wrote = await put(agent.session, mine);
  const read = await get(agent.session, mine);
  return {
    own: { put: code(wrote), get: code(read), readBack: read.payload.items?.[0]?.value === "a note" },
    other: {
      put: code(await put(agent.session, other)),
      get: code(await get(agent.session, other)),
      list: code(await call(agent.session, "vta/memory/list/0.3", { contextId: other })),
    },
    grantNamingAContextThatDoesNotExist: code(await call(A, "acl/grant/0.3", { entry: entryFor(mintIdentity().did, { contexts: [`keyring-memory-${uniq()}`] }) })),
  };
});

add("o-hierarchy", "0.1(o): an entry naming a context reaches its children; an entry naming a child does not reach the parent", async () => {
  const parent = await newContext("Parent");
  const child = await newContext("Child", parent);
  const holdsParent = await newParty({ contexts: [parent] });
  const holdsChild = await newParty({ contexts: [child] });
  return {
    childIdIsParentSlashId: child.startsWith(`${parent}/`),
    aPathAsTheId: code(await call(A, "vta/contexts/create/1.0", { id: `${parent}/x${uniq()}`, name: "Path" })),
    entryNamingTheParent: { putInChild: code(await put(holdsParent.session, child)), getInChild: code(await get(holdsParent.session, child)) },
    entryNamingTheChild: { putInChild: code(await put(holdsChild.session, child)), putInParent: code(await put(holdsChild.session, parent)), getInParent: code(await get(holdsChild.session, parent)) },
  };
});

add("b-register", "0.1(b): the agent registers as aiAgent, and rooms/keys/act is refused after and not before", async () => {
  const memory = await newContext();
  const agent = await newParty({ contexts: [memory], capabilities: "ceiling" });
  // Not a request a VTA completes as a member: the question is only which refusal comes first.
  const document = { id: `urn:uuid:${crypto.randomUUID()}`, type: "https://trusttasks.org/spec/rooms/records/append/0.1", issuedAt: new Date().toISOString(), recipient: lab.vtaDid, payload: {} };
  const act = () => call(agent.session, "rooms/keys/act/0.12", { document });
  const before = await act();
  const registered = await registerAgent(agent.session);
  const after = await act();
  const again = await registerAgent(agent.session);
  return {
    actBeforeRegistering: code(before),
    register: code(registered),
    kindOnTheWire: registered.payload.binding?.consumerKind,
    hasDeviceId: typeof registered.payload.binding?.deviceId === "string",
    actAfterRegistering: code(after),
    registerAgain: code(again),
    registerAgainSaysAlreadyRegistered: /alreadyRegistered/.test(again.message ?? ""),
  };
});

add("c-swap", "0.1(c): acl/swap-key by the entry's own subject, and what it keeps", async () => {
  const memory = await newContext();
  const expiresAt = inFourHours();
  const agent = await newParty({ contexts: [memory], purposes: ["assist", "recall"], expiresAt, label: "swap me" });
  const registered = await registerAgent(agent.session);
  const deviceId = registered.payload.binding?.deviceId;
  const before = await entryOf(agent.identity.did);
  const withoutProof = await call(agent.session, "acl/swap-key/0.1", { currentSubject: agent.identity.did, newSubject: mintIdentity().did });
  const swapped = await swap(agent);
  const after = swapped.party ? await entryOf(swapped.party.identity.did) : undefined;
  const device = deviceId ? await deviceOf(deviceId) : undefined;
  const kept = (name) => JSON.stringify(before?.[name]) === JSON.stringify(after?.[name]);
  return {
    withoutALinkProof: code(withoutProof),
    withoutALinkProofSays: /link_proof_required/.test(withoutProof.message ?? "") ? "acl:link_proof_required" : "something else",
    swap: code(swapped.answer),
    theNewKeySignsIn: Boolean(swapped.party),
    oldSubjectStillListed: Boolean(await entryOf(agent.identity.did)),
    keeps: after ? { role: kept("role"), act: kept("act"), capabilities: kept("capabilities"), purposes: kept("purposes"), expiresAt: kept("expiresAt") && after.expiresAt === expiresAt, label: kept("label") } : undefined,
    deviceFollows: device ? { sameDeviceId: true, consumerIsTheNewKey: device.consumerDid === swapped.party?.identity.did, kind: device.consumerKind } : "the device is not listed",
    theOldSessionAfterTheSwap: code(await call(agent.session, "auth/whoami/0.1")),
    theNewKeyReadsItsMemory: swapped.party ? code(await put(swapped.party.session, memory)) : undefined,
  };
});

for (const swaps of [1, 2]) {
  add(`l-revoke-after-${swaps}-swap${swaps > 1 ? "s" : ""}`, `0.1(l) and 0.1(e): revoke by deviceId after ${swaps} key swap${swaps > 1 ? "s" : ""}, and the agent's next memory call`, async () => {
    const memory = await newContext();
    let agent = await newParty({ contexts: [memory] });
    const deviceId = (await registerAgent(agent.session)).payload.binding?.deviceId;
    const first = agent;
    for (let i = 0; i < swaps; i++) {
      const swapped = await swap(agent);
      if (!swapped.party) return { swap: code(swapped.answer) };
      agent = swapped.party;
    }
    const wrote = await put(agent.session, memory);
    const device = await deviceOf(deviceId);
    const revokeTheFirstKey = await call(A, "acl/revoke/0.3", { subject: first.identity.did, revocation: { kind: "entry" } });
    const revoke = await call(A, "acl/revoke/0.3", { subject: device?.consumerDid ?? "did:key:unknown", revocation: { kind: "entry" } });
    return {
      memoryBeforeRevoke: code(wrote),
      deviceListNamesTheNewestKey: device?.consumerDid === agent.identity.did,
      revokingTheFirstKey: code(revokeTheFirstKey),
      revokeByTheDevicesKey: code(revoke),
      deviceStillListed: Boolean(await deviceOf(deviceId)),
      entryStillListed: Boolean(await entryOf(agent.identity.did)),
      // The session below was opened before the revoke and is used again after it, unchanged.
      onTheSessionOpenedBeforeTheRevoke: {
        whoami: code(await call(agent.session, "auth/whoami/0.1")),
        memoryGet: code(await get(agent.session, memory)),
        memoryPut: code(await put(agent.session, memory)),
        memoryPutNamingItsPurpose: code(await call(agent.session, "vta/memory/put/0.3", { contextId: memory, key: "note/2", value: "after", purpose: "assist" })),
        memoryList: code(await call(agent.session, "vta/memory/list/0.3", { contextId: memory })),
        sessionLifetimeMinutes: Math.round((Date.parse(agent.session.session.expiresAt) - Date.parse(agent.session.session.issuedAt)) / 60000),
      },
      signInAgain: (await trySignIn({ ...at, identity: agent.identity })).ok ? "ok" : "refused",
    };
  });
}

add("l-disable", "0.1(l): device/disable by deviceId, and whether the device still authenticates", async () => {
  const memory = await newContext();
  const agent = await newParty({ contexts: [memory] });
  const deviceId = (await registerAgent(agent.session)).payload.binding?.deviceId;
  const disabled = await call(A, "device/disable/0.1", { deviceId, reason: "ref-25" });
  const again = await trySignIn({ ...at, identity: agent.identity });
  return {
    disable: code(disabled),
    nextMemoryGetOnTheOldSession: code(await get(agent.session, memory)),
    signInAgain: again.ok ? "ok" : (again.code ?? "refused"),
    memoryOnANewSession: again.ok ? code(await get(again.session, memory)) : "no session",
    entryStillListed: Boolean(await entryOf(agent.identity.did)),
  };
});

add("p5-narrow", "0.1(p) item 5: removing a memory from an entry, and the agent's next call on it", async () => {
  const kept = await newContext("Kept");
  const removed = await newContext("Removed");
  const agent = await newParty({ contexts: [kept, removed] });
  const before = { kept: code(await put(agent.session, kept)), removed: code(await put(agent.session, removed)) };
  const byUpdate = await call(A, "acl/update/0.3", { subject: agent.identity.did, act: { scope: "contexts", contexts: [kept] } });
  const byRevoke = await call(A, "acl/revoke/0.3", { subject: agent.identity.did, revocation: { kind: "act", act: { scope: "contexts", contexts: [kept] } } });
  return {
    before,
    narrowWithAclUpdate: code(byUpdate),
    narrowWithAclRevokeKindAct: code(byRevoke),
    theActItNamesIsWhatRemains: JSON.stringify(byRevoke.payload.entry?.act?.contexts) === JSON.stringify([kept]),
    // `after` uses the session opened before the narrowing; `onANewSession` signs in again.
    after: { kept: code(await put(agent.session, kept)), removed: code(await put(agent.session, removed)), getRemoved: code(await get(agent.session, removed)) },
    whoamiScopesOnThatSession: ((await call(agent.session, "auth/whoami/0.1")).payload.scopes ?? []).length,
    onANewSession: await (async () => {
      const again = await signIn({ ...at, identity: agent.identity });
      return { kept: code(await put(again, kept)), removed: code(await put(again, removed)), getRemoved: code(await get(again, removed)) };
    })(),
  };
});

add("p6-counts-delete", "0.1(p) item 6: counting a memory's items without their values, and deleting a memory that holds some", async () => {
  const memory = await newContext("To delete");
  const agent = await newParty({ contexts: [memory] });
  for (const key of ["a", "b", "c"]) await put(agent.session, memory, `note/${key}`);
  const listed = await call(A, "vta/memory/list/0.3", { contextId: memory, includeValues: false });
  const items = listed.payload.items ?? [];
  const isListed = async (id) => ((await call(A, "vta/contexts/list/1.0")).payload.contexts ?? []).some((context) => context.id === id);
  const remove = (id, force) => call(A, "vta/contexts/delete/1.2", force ? { id, force: true } : { id });
  // Three memories: an empty one, one that holds items and that no entry names, and the agent's.
  const empty = await newContext("Empty");
  const itemsOnly = await newContext("Items only");
  await put(A, itemsOnly);
  const itemsOnlyPlain = await remove(itemsOnly, false);
  const itemsOnlyForced = itemsOnlyPlain.ok ? undefined : await remove(itemsOnly, true);
  const plain = await remove(memory, false);
  const forced = plain.ok ? undefined : await remove(memory, true);
  const entry = await entryOf(agent.identity.did);
  return {
    list: code(listed),
    count: items.length,
    anyValueReturned: items.some((item) => "value" in item),
    deleteAnEmptyMemory: code(await remove(empty, false)),
    aMemoryWithItemsAndNoEntry: { withoutForce: code(itemsOnlyPlain), withForce: itemsOnlyForced ? code(itemsOnlyForced) : "not needed", stillListed: await isListed(itemsOnly) },
    aMemoryAnEntryNames: { withoutForce: code(plain), withForce: forced ? code(forced) : "not needed", stillListed: await isListed(memory) },
    theEntryThatNamedIt: entry ? { listed: true, contexts: (entry.act?.contexts ?? []).length } : { listed: false },
    theAgentsNextGet: code(await get(agent.session, memory, "note/a")),
  };
});

add("p7-two-identities", "0.1(p) item 7: two identities, two memories, each reaching only its own", async () => {
  const one = await newContext("One");
  const two = await newContext("Two");
  const first = await newParty({ contexts: [one] });
  const second = await newParty({ contexts: [two] });
  return {
    first: { own: code(await put(first.session, one)), theOthers: code(await get(first.session, two)) },
    second: { own: code(await put(second.session, two)), theOthers: code(await get(second.session, one)) },
  };
});

/** A persona as Keyring makes one: a context, and a `did:webvh` the VTA mints and holds the keys of. */
async function newPersona() {
  const contextId = `keyring-persona-${uniq()}`;
  const context = await call(A, "vta/contexts/create/1.0", { id: contextId, name: "Persona" });
  if (!context.ok) throw new Error(`could not create the persona's context: ${code(context)}`);
  // No `serverId`: nothing hosts the log, and the VTA reads the DID's document from the log it holds.
  const created = await call(A, "vta/webvh/dids/create/1.2", { contextId, url: `${lab.baseUrl.replace("127.0.0.1", "localhost")}/personas/${contextId}`, setPrimary: true });
  return { contextId, created, did: created.payload.did, document: created.payload.didDocument, signingKeyId: created.payload.signingKeyId, agreementKeyId: created.payload.kaKeyId };
}

const wireTime = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
const DTG_CONTEXT = ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"];

/** The grant of agent-connect-plan.md section 3.4, unsigned: the persona delegates to the agent for 7 days. */
const delegationGrant = (personaDid, agentDid, from = new Date()) => ({
  "@context": DTG_CONTEXT,
  id: `urn:uuid:${crypto.randomUUID()}`,
  type: ["VerifiableCredential", "DTGCredential", "DelegationCredential"],
  issuer: personaDid,
  issuerScope: "directed",
  validFrom: wireTime(from),
  validUntil: wireTime(new Date(from.getTime() + 7 * 86400e3)),
  credentialSubject: { id: agentDid, delegation: { scope: ["keyring.agent.chat", "keyring.agent.memory"] } },
});

add(
  "f-sign-as-persona",
  "0.1(f): which VTA task signs a W3C credential as the persona, who may call it, and what the other candidate issues",
  async () => {
    const persona = await newPersona();
    if (!persona.created.ok) return { createThePersona: code(persona.created) };
    const other = await newPersona();
    const agentKey = mintIdentity();
    const grant = delegationGrant(persona.did, agentKey.did);
    const sign = (session, payload) => call(session, "keys/sign-document/0.1", payload);
    const signed = await sign(A, { keyId: persona.signingKeyId, document: grant });
    const secured = signed.payload.document;
    const method = signed.payload.proof?.verificationMethod;
    const key = keyOfMethod(persona.document, method);
    const { proof: _proof, ...returned } = secured ?? {};
    if (record && signed.ok && !existsSync(sampleFile())) {
      writeFileSync(sampleFile(), `${JSON.stringify({ source: lab.source, personaDocument: persona.document, credential: secured }, null, 2)}\n`);
    }

    // The agent's own entries: what section 3.3 grants it, the same with the persona's context added, and two
    // that carry the signing capability itself. Each is asked to sign as the persona with the persona's key.
    const memory = await newContext();
    const asked = async (options) => {
      const party = await newParty(options);
      return code(await sign(party.session, { keyId: persona.signingKeyId, document: delegationGrant(persona.did, party.identity.did) }));
    };

    // The other candidate: the VTA issues a credential itself from claims.
    const issued = await call(A, "vta/credentials/issue/0.2", { holder: agentKey.did, claims: { delegation: { scope: ["keyring.agent.chat"] } }, credentialType: "DelegationCredential", validitySeconds: 3600 });
    const credential = issued.payload.credential ?? {};

    // The acceptance is the agent's own: signed here with its key, never by a VTA.
    const acceptance = secure(
      { ...delegationGrant(agentKey.did, persona.did), credentialSubject: { id: persona.did, delegation: { accepts: "a digest" } } },
      { verificationMethod: agentKey.authVm, edSecret: agentKey.edSecret, created: wireTime() },
    );

    return {
      thePersona: {
        create: code(persona.created),
        method: persona.created.payload.didMethod,
        hostedByNoServer: persona.created.payload.serverless === true,
        signingKeyIsItsFirstMethod: persona.signingKeyId === `${persona.did}#key-0`,
      },
      signTheGrantAsThePersona: code(signed),
      signerIsThePersona: signed.payload.signerDid === persona.did,
      proof: signed.ok
        ? {
            cryptosuite: secured.proof.cryptosuite,
            proofPurpose: secured.proof.proofPurpose,
            methodIsThePersonasSigningKey: method === persona.signingKeyId,
            listedUnderAssertionMethod: listedUnder(persona.document, "assertionMethod", method),
            carriesTheDocumentsContext: JSON.stringify(secured.proof["@context"]) === JSON.stringify(DTG_CONTEXT),
          }
        : undefined,
      everyMemberReturnedAsSent: canonicalize(returned) === canonicalize(grant),
      verifiesWithTheKeyInThePersonasDocument: Boolean(key) && verify(secured, key),
      // Controls: the same check must fail on a changed credential and with another persona's key.
      verifiesAfterOneScopeIsAdded: Boolean(key) && verify({ ...secured, credentialSubject: { ...secured?.credentialSubject, delegation: { scope: ["keyring.agent.chat", "keyring.agent.memory", "more"] } } }, key),
      verifiesWithAnotherPersonasKey: verify(secured, keyOfMethod(other.document, other.signingKeyId) ?? new Uint8Array(32)),
      alsoSigns: {
        issuerAsAnObjectWithAnId: code(await sign(A, { keyId: persona.signingKeyId, document: { ...grant, issuer: { id: persona.did } } })),
        underAuthentication: code(await sign(A, { keyId: persona.signingKeyId, document: grant, proofPurpose: "authentication" })),
      },
      refuses: {
        anotherPersonaAsIssuer: code(await sign(A, { keyId: persona.signingKeyId, document: { ...grant, issuer: other.did } })),
        aDidKeyAsIssuer: code(await sign(A, { keyId: persona.signingKeyId, document: { ...grant, issuer: mintIdentity().did } })),
        noIssuer: code(await sign(A, { keyId: persona.signingKeyId, document: (({ issuer: _issuer, ...rest }) => rest)(grant) })),
        aDocumentThatHasAProof: code(await sign(A, { keyId: persona.signingKeyId, document: secured })),
        thePersonasAgreementKey: code(await sign(A, { keyId: persona.agreementKeyId, document: grant })),
        aKeyNobodyHolds: code(await sign(A, { keyId: `${persona.did}#key-9`, document: grant })),
      },
      theAgentAskedToSignAsThePersona: {
        withItsMemoryEntry: await asked({ contexts: [memory] }),
        withThePersonasContextAdded: await asked({ contexts: [persona.contextId, memory] }),
        withTheSigningCapabilityListed: await asked({ contexts: [persona.contextId], capabilities: ["sign-document"] }),
        withEveryCapabilityAnApplicationHas: await asked({ contexts: [persona.contextId], capabilities: "ceiling" }),
      },
      credentialsIssue: {
        answer: code(issued),
        issuerIsThePersona: credential.issuer === persona.did,
        issuerIsTheVta: credential.issuer === lab.vtaDid,
        type: credential.type,
        context: credential["@context"],
        hasIssuerScope: "issuerScope" in credential,
      },
      theAgentsAcceptance: { signedByItsOwnKey: verify(acceptance, agentKey.edPublic), verifiesWithThePersonasKey: Boolean(key) && verify(acceptance, key) },
    };
  },
  ["keys/sign-document/0.1", "vta/webvh/dids/create/1.2", "vta/credentials/issue/0.2"],
);

// ───────────────────────────────────────────────────────────────── the run

const needed = ["acl/grant/0.3", "vta/memory/put/0.3"];
const asked = new Map();
/** Why `path` cannot be used on this VTA, or `undefined` when it serves that version. Asked once per task. */
async function notServed(path) {
  if (!asked.has(path)) {
    const family = path.slice(0, path.lastIndexOf("/"));
    const probe = await call(A, `${family}/0.0`);
    const served = (probe.payload?.details?.servedVersions ?? []).map((uri) => uri.split("/").pop());
    asked.set(path, served.includes(path.split("/").pop()) ? undefined : `${path} is not served (it serves ${served.join(", ") || "no version"})`);
  }
  return asked.get(path);
}
const missingFor = async (paths) => (await Promise.all(paths.map(notServed))).filter(Boolean);

const file = `${here}fixtures/vta-cases-${lab.source.version}.json`;
/** One credential the VTA signed as a persona, kept so `proof.test.mjs` checks it with no VTA running. Written once. */
function sampleFile() {
  return `${here}fixtures/vta-signed-as-persona-${lab.source.version}.json`;
}
const recorded = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).cases : {};
console.log(`vta ${lab.source.version} at ${lab.source.commit.slice(0, 9)}, binary sha256 ${lab.binarySha256.slice(0, 16)}…`);
const rows = [];
for (const item of cases) {
  if (only && !only.includes(item.id)) continue;
  let observed;
  const missing = await missingFor([...needed, ...item.needs]);
  if (missing.length) observed = { notRunnable: missing };
  else {
    try {
      observed = await item.fn();
    } catch (error) {
      observed = { error: String(error?.message ?? error) };
    }
  }
  const known = item.id in recorded;
  const asRecorded = known && JSON.stringify(observed) === JSON.stringify(recorded[item.id]);
  rows.push({ id: item.id, observed, asRecorded: known ? asRecorded : null });
  console.log(`${!known ? "new " : asRecorded ? "ok  " : "DIFF"} ${item.id.padEnd(26)} ${JSON.stringify(observed)}`);
  if (known && !asRecorded) console.log(`     recorded                   ${JSON.stringify(recorded[item.id])}`);
}
if (record) {
  mkdirSync(`${here}fixtures`, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ recordedAt: new Date().toISOString(), source: lab.source, binarySha256: lab.binarySha256, cases: Object.fromEntries(rows.map((row) => [row.id, row.observed])) }, null, 2)}\n`);
  console.log(`recorded ${rows.length} cases to fixtures/vta-cases-${lab.source.version}.json`);
}
const differing = rows.filter((row) => row.asRecorded === false).length;
const unknown = rows.filter((row) => row.asRecorded === null).length;
console.log(`${rows.length - differing - unknown} of ${rows.length} as recorded${unknown ? `, ${unknown} with no recorded result` : ""}`);
process.exit(differing || (unknown && !record) ? 1 : 0);
