// hcp/consent.mjs: the `task-consent/request/0.1` payload a VTA sends Keyring for an HCP grant.
//
// The VTA holds the CLI's `hcp/grants/request` and asks the person's phone to approve it. The track C brief
// ("The consent request the VTA sends for an HCP grant") fixes the task type, the requester and the five effects;
// the backlog brief's Section B part 2 fixes the framework members. This is the rung's reading of both, written
// apart from Keyring, which reads such a payload in `hcp/approvals.ts`.
//
//   node hcp/consent.mjs --record    rewrites fixtures/hcp-consent-request.json from RECORD_INPUTS below

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HCP_GRANTS_REQUEST = "https://trusttasks.org/spec/hcp/grants/request/0.1";
/** The five effect kinds, in the order the VTA sends them. */
export const HCP_EFFECT_KINDS = ["hcpGrantClient", "hcpGrantAccess", "hcpGrantUseUntil", "hcpGrantTerm", "hcpGrantNotSignIn"];
/** The consent request lapses 5 minutes after the VTA holds the grant request. */
export const HCP_CONSENT_WINDOW_MS = 5 * 60 * 1000;
/** Every HCP demo grant is temporary, for 4 hours from approval. */
export const HCP_GRANT_SECONDS = 4 * 60 * 60;

const URN_UUID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** `a`, `a and b`, `a, b and c`. */
const list = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
/** `general_preferences` as people read it: `general preferences`. */
const categoryWords = (category) => category.replace(/_/g, " ");

function accessSummary(access) {
  return access
    .map((a) => `It can read ${list(a.categories.map(categoryWords))} to ${list(a.purposes.map((p) => p.description))}.`)
    .join(" ");
}

function keepForSummary(maxUseSeconds) {
  const minutes = maxUseSeconds / 60;
  return `It can keep what it reads for up to ${minutes} ${minutes === 1 ? "minute" : "minutes"} after reading it.`;
}

function check(inputs) {
  const { clientVid, clientName, operator, threadId, grantId, access, maxUseSeconds, heldAt } = inputs;
  const text = (v) => typeof v === "string" && v.length > 0;
  if (!text(clientVid) || !text(clientName)) throw new Error("clientVid and clientName are required");
  if (!operator || !text(operator.id) || !text(operator.name)) throw new Error("operator needs an id and a name");
  if (!URN_UUID.test(threadId) || !URN_UUID.test(grantId)) throw new Error("threadId and grantId are urn:uuid v4");
  if (!Array.isArray(access) || access.length === 0) throw new Error("access is a non-empty list");
  for (const a of access) {
    const ok =
      Array.isArray(a?.actions) && a.actions.length > 0 && a.actions.every(text) &&
      Array.isArray(a.categories) && a.categories.length > 0 && a.categories.every(text) &&
      Array.isArray(a.purposes) && a.purposes.length > 0 && a.purposes.every((p) => text(p?.code) && text(p?.description));
    if (!ok) throw new Error("each access entry has actions, categories and purposes");
  }
  // Whole minutes, so that the summary's number is the detail's.
  if (!Number.isInteger(maxUseSeconds) || maxUseSeconds <= 0 || maxUseSeconds % 60 !== 0) {
    throw new Error("maxUseSeconds is a positive whole number of minutes");
  }
  if (!Number.isFinite(Date.parse(heldAt))) throw new Error("heldAt is an instant");
  if (!text(inputs.challenge) || !text(inputs.payloadDigest)) throw new Error("challenge and payloadDigest are required");
}

/**
 * The payload of the `task-consent/request/0.1` the VTA sends for an HCP grant, its members in the order of the
 * schema's `propertyOrder`. `heldAt` is when the VTA held the grant request (an ISO-8601 instant).
 */
export function hcpConsentRequest(inputs) {
  check(inputs);
  const { clientVid, clientName, operator, threadId, grantId, access, maxUseSeconds, heldAt, challenge, payloadDigest } =
    inputs;
  const effects = [
    {
      kind: "hcpGrantClient",
      summary: `Run by ${operator.name}.`,
      detail: { clientVid, clientName, operator: { id: operator.id, name: operator.name }, threadId, grantId },
    },
    {
      kind: "hcpGrantAccess",
      summary: accessSummary(access),
      detail: {
        access: access.map((a) => ({
          actions: [...a.actions],
          categories: [...a.categories],
          purposes: a.purposes.map((p) => ({ code: p.code, description: p.description })),
        })),
      },
    },
    { kind: "hcpGrantUseUntil", summary: keepForSummary(maxUseSeconds), detail: { maxUseSeconds } },
    {
      kind: "hcpGrantTerm",
      summary: "For 4 hours from when you approve.",
      detail: { grantType: "temporary", expiresInSeconds: HCP_GRANT_SECONDS },
    },
    { kind: "hcpGrantNotSignIn", summary: "Approving gives access. It is not signing in.", detail: {} },
  ];
  return {
    challenge,
    taskType: HCP_GRANTS_REQUEST,
    payloadDigest,
    sideEffects: "mutating",
    exposure: { discloses: "secret", actsAsSubject: false },
    effects,
    requester: clientVid,
    approverSet: "owner",
    minApprovals: 1,
    excludeRequester: true,
    expiresAt: new Date(Date.parse(heldAt) + HCP_CONSENT_WINDOW_MS).toISOString(),
  };
}

/**
 * The fixture's inputs: the match-number vectors' first case (its thread and its `did:key`), and the grant Keyring's
 * own approval fixture (`hcp/__tests__/fixtures/hcpApproval.ts`) describes. `challenge` and `payloadDigest` are fixed
 * stand-ins of the right form (the digest is the schema's own example), not computed over a grant request.
 */
export const RECORD_INPUTS = {
  clientVid: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  clientName: "hcp-cli",
  operator: { id: "did:web:labs.example", name: "Example Labs" },
  threadId: "urn:uuid:7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51",
  grantId: "urn:uuid:3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  access: [
    {
      actions: ["read"],
      categories: ["general_preferences"],
      purposes: [{ code: "personalization", description: "tailor its answers" }],
    },
  ],
  maxUseSeconds: 600,
  heldAt: "2026-11-27T10:00:00.000Z",
  challenge: "hcp-rung-challenge-7c2a9e41-5b3d",
  payloadDigest: "zQmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR",
};

export const RECORD_FILE = new URL("../fixtures/hcp-consent-request.json", import.meta.url);

/** The fixture: its inputs, and the payload `hcpConsentRequest` gives for them. */
export const recordFixture = () => ({ version: 1, inputs: RECORD_INPUTS, payload: hcpConsentRequest(RECORD_INPUTS) });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes("--record")) {
    console.error("usage: node hcp/consent.mjs --record");
    process.exit(2);
  }
  writeFileSync(RECORD_FILE, `${JSON.stringify(recordFixture(), null, 2)}\n`);
  console.log(`wrote ${fileURLToPath(RECORD_FILE)}`);
}
