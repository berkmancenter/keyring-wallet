#!/usr/bin/env node
// measure-links.mjs: step 0.1(h). The size of the two pairing links and their QR codes.
//
//   node measure-links.mjs <the VTA's DID> [more DIDs]
//
// Prints, for each DID, the auth/oob link built the way the pinned producer builds it, and once the fallback's
// agent-connect link for a fresh did:key with the widest scope an agent can ask for.

import { mintIdentity } from "./identity.mjs";
import { MAX_LINK_BYTES_LEVEL_M, agentConnectLink, longestServiceDid, measureLink, oobLink } from "./links.mjs";

const dids = process.argv.slice(2);
if (!dids.length) {
  console.error("usage: node measure-links.mjs <the VTA's DID> [more DIDs]");
  process.exit(2);
}
// The shapes the producer writes: a 22-character request id and a 10-digit deadline.
const requestId = "q3Vn7Zk2Xo9Rt1LwPb4HdA";
const deadline = Math.floor(Date.now() / 1000) + 300;

const out = { limitBytes: MAX_LINK_BYTES_LEVEL_M, longestServiceDidBytes: longestServiceDid(), oob: [], agentConnect: {} };
for (const did of dids) {
  const method = did.split(":").slice(0, 2).join(":");
  out.oob.push({ did, method, didBytes: Buffer.byteLength(did), ...measureLink(oobLink({ serviceDid: did, requestId, deadline })) });
}
const agent = mintIdentity();
const widest = { capabilities: ["memory-read", "memory-write", "room-present", "room-open"], purposes: [] };
out.agentConnect = {
  didBytes: agent.did.length,
  bare: measureLink(agentConnectLink({ agentDid: agent.did, requestId, deadline })),
  widestScope: measureLink(agentConnectLink({ agentDid: agent.did, requestId, deadline, scope: widest })),
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.oob.every((row) => row.fits && row.qrDecodes) && out.agentConnect.widestScope.fits ? 0 : 1);
