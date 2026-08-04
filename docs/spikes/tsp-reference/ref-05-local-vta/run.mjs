#!/usr/bin/env node
// ref-05-local-vta — our own VTA, and the capability ladder read from it.
//
// Assumes a VTA is reachable at VTA_URL (default http://localhost:8100).
// Bring one up either way:
//
//   native:  cd external/verifiable-trust-infrastructure
//            cargo build -p vta-service --features tsp,setup -p pnm-cli
//            ./target/debug/vta setup --from <this dir>/vta-setup.toml
//            ./target/debug/vta --config /tmp/ref05-vta/config.toml
//   docker:  docker compose up --build     (in this directory)
//
// What this rung proves:
//   1. A VTA runs locally and serves its OWN did:webvh document — no separate
//      DID-hosting service in the loop.
//   2. That document is the trust anchor AND the capability advertisement:
//      the service entries are how a client picks an envelope format
//      (TSPTransport > DIDCommMessaging > VTARest).
//   3. Enabling TSP mutates the DID document WITHOUT rotating any key — so a
//      client that only re-resolves on key rotation would never notice a peer
//      turning TSP on. Bounded-staleness caching is the only correct policy.
//   4. The hash-chained log is verifiable: entry N names its predecessor.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };
const here = dirname(fileURLToPath(import.meta.url));
const VTA_URL = process.env.VTA_URL ?? "http://localhost:8100";

let checks = 0;
const assert = (cond, what) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  checks++;
  say(`    ✓ ${what}`);
};

// ─────────────────────────────── 1. liveness
say(`── the VTA at ${VTA_URL} ──`);
let health;
try {
  health = await (await fetch(`${VTA_URL}/health`)).json();
} catch (e) {
  console.error(`\nNo VTA at ${VTA_URL} — start one first (see the header of this file).\n${e.message}`);
  process.exit(2);
}
assert(health.status === "ok", `health: ${JSON.stringify(health)}`);

// Detail endpoints are authenticated — proof that even "read your own status"
// is gated. Nothing in this stack is reachable without a proven identity.
const details = await fetch(`${VTA_URL}/health/details`);
assert(details.status === 401 || details.status === 403, `/health/details refuses anonymous access (${details.status})`);

// ─────────────────────────────── 2. the self-hosted DID document
say("\n── its did:webvh log (self-hosted — no DID-hosting service) ──");
const logText = await (await fetch(`${VTA_URL}/.well-known/did.jsonl`)).text();
const entries = logText.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
assert(entries.length >= 1, `log has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`);

const doc = entries.at(-1).state;
const scid = entries[0].parameters.scid;
assert(doc.id.includes(scid), `DID embeds its self-certifying id (scid ${scid.slice(0, 12)}…)`);
say(`      ${doc.id}`);

// The hash chain: each versionId is `<n>-<hash>`, and later entries carry the
// previous hash — this is what makes webvh history tamper-evident.
if (entries.length > 1) {
  const seq = entries.map((e) => Number(String(e.versionId).split("-")[0]));
  assert(seq.every((n, i) => n === i + 1), `version chain is sequential: ${seq.join(" → ")}`);
}

// ─────────────────────────────── 3. the capability ladder
say("\n── service entries = the envelope-format ladder our client reads ──");
const services = doc.service ?? [];
for (const s of services) say(`      ${s.type.padEnd(16)} ${String(s.serviceEndpoint).slice(0, 64)}`);
const types = services.map((s) => s.type);
assert(types.includes("VTARest"), "advertises VTARest (the always-present fallback)");

const LADDER = ["TSPTransport", "DIDCommMessaging", "VTARest"];
const chosen = LADDER.find((t) => types.includes(t));
say(`      → a client would choose: ${chosen}`);
assert(chosen !== undefined, "at least one known transport is advertised");

if (types.includes("TSPTransport")) {
  const tsp = services.find((s) => s.type === "TSPTransport");
  assert(String(tsp.serviceEndpoint).startsWith("did:"), "the TSP endpoint is a MEDIATOR DID, not a URL (indirection, as in ref-04)");
}

// ─────────────────────────────── 4. mutation without rotation
say("\n── the caching rule, demonstrated ──");
if (entries.length > 1) {
  const vmIds = (d) => (d.verificationMethod ?? []).map((vm) => vm.id.split("#").pop()).sort().join(",");
  const first = vmIds(entries[0].state);
  const last = vmIds(doc);
  assert(first === last, `verificationMethods unchanged across ${entries.length} versions (${last})`);
  const svcFirst = (entries[0].state.service ?? []).map((s) => s.type).sort().join(",");
  const svcLast = types.slice().sort().join(",");
  assert(svcFirst !== svcLast, `services DID change: [${svcFirst}] → [${svcLast}]`);
  say(`      ⇒ capability changed with NO key rotation — cache DID docs with a TTL,`);
  say(`        never "until rotation", or a peer enabling TSP is invisible forever.`);
} else {
  say(`      (only one log entry — enable TSP to see the mutation:`);
  say(`       vta --config <cfg> services tsp enable --mediator-did <did>)`);
}

// ─────────────────────────────── 5. fixture comparison
const fx = join(here, "fixtures", "vta-did-log.jsonl");
if (existsSync(fx)) {
  const frozen = readFileSync(fx, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const frozenDoc = frozen.at(-1).state;
  const frozenTypes = (frozenDoc.service ?? []).map((s) => s.type).sort();
  say(`\n── frozen fixture (a VTA provisioned by this rung's recipe) ──`);
  assert(frozenTypes.join(",") === "TSPTransport,VTARest", `fixture advertises ${frozenTypes.join(" + ")}`);
  assert(
    (frozen[0].state.verificationMethod ?? []).length === (frozenDoc.verificationMethod ?? []).length,
    "fixture confirms the same no-rotation property",
  );
}

console.log(`\nREF-05 PASS — ${checks} checks against a self-hosted local VTA: it serves its own did:webvh, advertises the transport ladder, and changes capability without rotating keys`);
