#!/usr/bin/env node
// vta-serves.mjs: what one VTA serves, asked of the VTA itself.
//
//   lab/vta.sh up <vta binary> <commit>
//   node vta-serves.mjs            compare with fixtures/vta-<version>.json; exit 1 on a difference
//   node vta-serves.mjs --record   write that file
//
// A VTA that is asked for a version it does not serve answers `unsupportedVersion` and lists the versions it
// does serve. So the rung asks for version 0.0 of each task family agent connect uses and records the answer.
// It also records who the seeded administrator is (`auth/whoami`): the plan's assumption is that the phone's
// session is an administrator with no contexts (step 0.1(p), item 1).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { identityFromSeed } from "./identity.mjs";
import { call, signIn } from "./vta.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const record = process.argv.includes("--record");

export const FAMILIES = [
  "acl/grant", "acl/revoke", "acl/update", "acl/list", "acl/show", "acl/swap-key",
  "device/register", "device/list", "device/disable",
  "vta/contexts/create", "vta/contexts/list", "vta/contexts/update", "vta/contexts/delete",
  "vta/memory/put", "vta/memory/get", "vta/memory/list", "vta/memory/delete",
  "rooms/keys/present", "rooms/keys/open", "rooms/keys/seal", "rooms/keys/act",
  "auth/oob/request", "auth/oob/claim", "auth/oob/prove", "auth/oob/respond", "auth/oob/grant", "auth/oob/redeem",
  "task-consent/request", "task-consent/decision",
  "vault/credentials/present",
  // Step 0.1(f): a persona's DID, and the tasks that could sign a credential as it.
  "vta/webvh/dids/create", "keys/sign-document", "vta/credentials/issue", "credential-exchange/issue", "vault/sign-trust-task",
];

let lab;
try {
  lab = JSON.parse(execFileSync(`${here}lab/vta.sh`, ["status"], { encoding: "utf8" }));
} catch {
  console.error("no lab VTA is running: start one with `lab/vta.sh up <vta binary> <commit>`");
  process.exit(2);
}
const admin = identityFromSeed(Uint8Array.from(Buffer.from(readFileSync(lab.adminSeedFile, "utf8").trim(), "hex")));
const session = await signIn({ baseUrl: lab.baseUrl, vtaDid: lab.vtaDid, identity: admin });

const whoami = await call(session, "auth/whoami/0.1");
const administrator = whoami.ok
  ? { roles: whoami.payload.roles, scopes: whoami.payload.scopes, capabilities: [...(whoami.payload.capabilities ?? [])].sort() }
  : { refused: whoami.code ?? whoami.status };

const byVersion = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const serves = {};
for (const family of FAMILIES) {
  const answer = await call(session, `${family}/0.0`);
  const served = (answer.payload?.details?.servedVersions ?? []).map((uri) => uri.split("/").pop()).sort(byVersion);
  serves[family] = served.length ? served : `not served (${answer.status} ${answer.code ?? "no code"})`;
}

const result = { source: lab.source, binarySha256: lab.binarySha256, administrator, serves };
for (const [family, versions] of Object.entries(serves)) console.log(`${family.padEnd(26)} ${Array.isArray(versions) ? versions.join(", ") : versions}`);
console.log(`administrator: roles ${JSON.stringify(administrator.roles)}, scopes ${JSON.stringify(administrator.scopes)}, ${administrator.capabilities?.length ?? 0} capabilities`);

const file = `${here}fixtures/vta-${lab.source.version}.json`;
if (record) {
  mkdirSync(`${here}fixtures`, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2)}\n`);
  console.log(`recorded fixtures/vta-${lab.source.version}.json`);
  process.exit(0);
}
if (!existsSync(file)) {
  console.error(`no recorded result for vta ${lab.source.version}: run with --record`);
  process.exit(1);
}
const { recordedAt: _when, ...recorded } = JSON.parse(readFileSync(file, "utf8"));
const same = JSON.stringify(recorded) === JSON.stringify(result);
console.log(same ? "as recorded" : "DIFFERS from the recorded result");
process.exit(same ? 0 : 1);
