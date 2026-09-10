// Ephemeral local DIDComm mediator (Affinidi Secure Messaging Mediator via
// OpenVTC's `mediator`/`mediator-setup` binaries), for e2e/dev runs against a
// real messaging-enabled VTA. Mirrors vta.js's shape: fresh temp state per
// run, an HTTPS tunnel for reachability, a readiness wait, a stop() that
// tears everything down. Pair with `startVta({ mediatorDid })`.
//
// `mediator`/`mediator-setup` are external Rust binaries from
// https://firstperson.dev — see e2e/README.md / scripts/openvtc/README.md
// for how to fetch and pin them (`scripts/openvtc/fetch-binaries.mjs`).
//
// Needs a local redis reachable at MEDIATOR_REDIS_URL (default
// redis://127.0.0.1/) — the mediator's message queue backend. Not started
// or managed here; this module only checks it's reachable and fails fast
// with an actionable message if not.
//
// Like vta.js's did:webvh, the mediator's did:peer service entry embeds the
// tunnel's URL at generation time, so every call mints a brand-new,
// never-reconnectable mediator identity — the same "right for a disposable
// fixture, wrong for anything persistent" tradeoff.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPortFree, startTunnel } from "./witness.js";
import { sleep } from "./driver.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cachedBin = (name) => join(repoRoot, "external", "bin", name);
const MEDIATOR_BIN = process.env.MEDIATOR_BIN || (existsSync(cachedBin("mediator")) ? cachedBin("mediator") : "mediator");
const MEDIATOR_SETUP_BIN =
  process.env.MEDIATOR_SETUP_BIN || (existsSync(cachedBin("mediator-setup")) ? cachedBin("mediator-setup") : "mediator-setup");
const REDIS_URL = process.env.MEDIATOR_REDIS_URL || "redis://127.0.0.1/";

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Authoritative "is redis actually reachable" check via a real TCP connect —
 * the mediator's own error if this is wrong is a full Rust panic several
 * seconds into startup; this fails in milliseconds with a message naming the
 * actual problem, same rationale as vta.js/witness.js's port checks.
 */
async function assertRedisReachable(url) {
  const { hostname, port } = new URL(url);
  await new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: hostname || "127.0.0.1", port: Number(port) || 6379 });
    socket.once("connect", () => {
      socket.end();
      resolvePromise();
    });
    socket.once("error", (err) => {
      reject(
        new Error(
          `redis at ${url} is not reachable (${err.code ?? err.message}) — the mediator needs a running redis ` +
            `for its message queue. Start one (e.g. \`redis-server\` locally) or set MEDIATOR_REDIS_URL.`
        )
      );
    });
  });
}

function runMediatorSetup(args, { cwd } = {}) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(MEDIATOR_SETUP_BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.stderr.on("data", (b) => (out += b.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      const clean = stripAnsi(out);
      if (code !== 0) reject(new Error(`${MEDIATOR_SETUP_BIN} ${args.join(" ")} exited ${code}:\n${clean}`));
      else resolvePromise(clean);
    });
  });
}

/**
 * Bring up a fresh, disposable mediator: a local `did:peer` generated with
 * its service entry pointed at a cloudflared tunnel, `mediator.toml`'s
 * `local_endpoints` wired to match (mediator-setup leaves it commented —
 * without it the mediator warns "no local_endpoints configured" and Routing
 * 2.0 self-loopback delivery silently never matches), the daemon started and
 * health-checked through the tunnel.
 *
 * Returns { mediatorDid, mediatorUrl, stop }. Pass `mediatorDid` to
 * `startVta()` (vta.js) to wire a messaging-enabled VTA to this mediator.
 */
export async function startMediator({
  port = Number(process.env.MEDIATOR_PORT || 7037),
  readyTimeoutMs = 30000,
} = {}) {
  await assertRedisReachable(REDIS_URL);
  await assertPortFree(port);

  const tunnel = await startTunnel(port);

  const dir = mkdtempSync(join(tmpdir(), "e2e-mediator-"));
  const configPath = join(dir, "mediator.toml");

  console.log(`[e2e] provisioning mediator — ${tunnel.url} (state: ${dir})`);
  await runMediatorSetup([
    "--non-interactive",
    "--deployment",
    "local",
    "--protocol",
    "didcomm",
    "--did-method",
    "peer",
    "--admin",
    "generate",
    "--secret-storage",
    "file",
    "--listen-address",
    `0.0.0.0:${port}`,
    "--public-url",
    tunnel.url,
    "--config",
    configPath,
  ], { cwd: dir });

  // mediator-setup writes atm-functions.lua (and mediator-build.toml,
  // admin-monitor.json) relative to its OWN cwd, but mediator.toml's
  // functions_file points at ./conf/atm-functions.lua — relative to the
  // *daemon's* cwd, which we also run from `dir` below, but the file landed
  // at `dir/atm-functions.lua`, not `dir/conf/`. Copy it there. Confirmed
  // empirically; worth upstreaming as a mediator-setup inconsistency, but
  // working around it here.
  const confDir = join(dir, "conf");
  copyFileSync(join(dir, "atm-functions.lua"), join(confDir, "atm-functions.lua"));

  let tomlText = readFileSync(configPath, "utf8");
  const mediatorDidMatch = tomlText.match(/mediator_did\s*=\s*"did:\/\/(did:peer:[^"]+)"/);
  if (!mediatorDidMatch) throw new Error(`mediator.toml has no mediator_did:\n${tomlText}`);
  const mediatorDid = mediatorDidMatch[1];

  // Uncommented by hand: mediator-setup leaves this commented with an
  // example value. Without it the mediator logs "no local_endpoints
  // configured" and never recognizes itself as a valid Routing 2.0 local
  // authority for the tunnel's host — confirmed empirically (see module doc).
  if (/^#\s*local_endpoints\s*=/m.test(tomlText)) {
    tomlText = tomlText.replace(/^#\s*local_endpoints\s*=.*$/m, `local_endpoints = ${JSON.stringify([tunnel.url])}`);
  } else {
    tomlText += `\nlocal_endpoints = ${JSON.stringify([tunnel.url])}\n`;
  }
  writeFileSync(configPath, tomlText);

  const proc = spawn(MEDIATOR_BIN, ["--config", configPath], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  proc.on("exit", (code) => {
    exited = true;
    if (code) console.error(`[e2e] mediator process exited (code ${code})`);
  });
  proc.stdout.on("data", (b) => {
    for (const line of b.toString().split("\n")) if (line.trim()) console.log(`[mediator] ${stripAnsi(line).trimEnd()}`);
  });
  proc.stderr.on("data", (b) => {
    for (const line of b.toString().split("\n")) if (line.trim()) console.log(`[mediator] ${stripAnsi(line).trimEnd()}`);
  });

  const stop = async () => {
    if (!exited) {
      try {
        process.kill(-proc.pid, "SIGINT");
      } catch {
        /* group already gone */
      }
      for (let i = 0; i < 10 && !exited; i++) await sleep(300);
      if (!exited) {
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch {
          /* group already gone */
        }
      }
    }
    tunnel.stop();
    rmSync(dir, { recursive: true, force: true });
    console.log(`[e2e] mediator stopped`);
  };

  // Readiness: any HTTP response (even a 404 — there's no health route at
  // the bare path) proves the tunnel + daemon are both up; only a network
  // failure (tunnel not routed yet, daemon not listening) counts as not-ready.
  const deadline = Date.now() + readyTimeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (exited) {
      await stop();
      throw new Error("mediator process exited before becoming ready");
    }
    try {
      await fetch(`${tunnel.url}/mediator/v1/`);
      console.log(`[e2e] mediator ready — ${mediatorDid}`);
      return { mediatorDid, mediatorUrl: tunnel.url, stop };
    } catch (err) {
      lastErr = err;
    }
    await sleep(1000);
  }
  await stop();
  throw new Error(`mediator not reachable within ${readyTimeoutMs}ms: ${lastErr?.message}`);
}
