// Ephemeral local VTA (Verifiable Trust Agent) lifecycle, for e2e/dev runs
// against a real vta binary (OpenVTC / First Person Project) instead of a
// mock. Mirrors witness.js's shape: fresh temp state per run, an HTTPS
// tunnel for reachability, a readiness wait, and a stop() that tears
// everything down.
//
// Unlike the witness (an Aries/Credo agent this repo already runs), `vta` is
// an external Rust binary from https://firstperson.dev. Run
// `node scripts/openvtc/fetch-binaries.mjs vta` once to cache a pinned copy
// (see scripts/openvtc/README.md) — VTA_BIN below finds it there
// automatically; override VTA_BIN to point elsewhere (a system install, a
// different pin) instead.
//
// did:webvh's DID identifier is DERIVED FROM its hosting domain, and a free
// cloudflared quick tunnel gets a random new hostname every run — so every
// call to startVta mints a BRAND NEW, never-reconnectable VTA DID. That is
// exactly right for a spin-up-fresh-per-run test fixture (the same shape as
// the witness server) and exactly wrong for anything meant to persist across
// sessions; this module intentionally does not support the latter.
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPortFree, startTunnel } from "./witness.js";
import { sleep } from "./driver.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cachedVtaBin = join(repoRoot, "external", "bin", "vta");
const VTA_BIN = process.env.VTA_BIN || (existsSync(cachedVtaBin) ? cachedVtaBin : "vta");

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function runVta(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(VTA_BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.stderr.on("data", (b) => (out += b.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      const clean = stripAnsi(out);
      if (code !== 0) {
        reject(new Error(`${VTA_BIN} ${args.join(" ")} exited ${code}:\n${clean}`));
      } else {
        resolve(clean);
      }
    });
  });
}

/**
 * Serve `dir` as static files on `port` — just enough to host a did:webvh
 * `did.jsonl` behind a tunnel. The tunnel makes this briefly internet-
 * reachable at a hard-to-guess but public URL, so requests are confined to
 * `dir`: the resolved path must stay under it (blocks `..` traversal), and
 * only GET/HEAD are served. Returns a stop() function.
 */
function startStaticHost(dir, port) {
  const root = resolve(dir);
  const server = createHttpServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    try {
      const requested = resolve(root, "." + decodeURIComponent(req.url.split("?")[0]));
      if (requested !== root && !requested.startsWith(root + sep)) {
        res.writeHead(403);
        return res.end();
      }
      const data = readFileSync(requested);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port);
  return () => server.close();
}

/**
 * Bring up a fresh, disposable VTA: non-interactive `vta setup --from`,
 * an offline-minted admin `did:key`, the daemon started and health-checked
 * through its own HTTPS tunnel. REST-only (no mediator) — pass
 * `mediatorDid` for a messaging-enabled VTA once a local/test mediator
 * exists to point it at.
 *
 * Returns { vtaDid, vtaUrl, adminDid, adminCredential, stop }.
 * `adminCredential` is the base64 blob `vta create-did-key` prints — decode
 * with `Buffer.from(x, "base64").toString()` for { did, privateKeyMultibase,
 * vtaDid, vtaUrl }, the shape a client needs to authenticate as this admin.
 */
export async function startVta({
  name = process.env.VTA_NAME || "e2e-vta",
  // Defaults deliberately avoid 4723/8101/9002/9003 — Appium, WDA, and the
  // witness server (see e2e/README.md) all use those.
  port = Number(process.env.VTA_PORT || 8180),
  didHostPort = Number(process.env.VTA_DIDHOST_PORT || 8181),
  mediatorDid,
  readyTimeoutMs = 60000,
} = {}) {
  for (const p of [port, didHostPort]) await assertPortFree(p);

  const dir = mkdtempSync(join(tmpdir(), "e2e-vta-"));
  const dataDir = join(dir, "data");
  const configPath = join(dir, "config.toml");
  const didHostDir = join(dir, "didhost", "dids", "vta");
  mkdirSync(didHostDir, { recursive: true });

  const didHostStop = startStaticHost(join(dir, "didhost"), didHostPort);
  const didHostTunnel = await startTunnel(didHostPort);
  const vtaTunnel = await startTunnel(port);

  const setupToml = [
    `config_path = ${JSON.stringify(configPath)}`,
    `data_dir    = ${JSON.stringify(dataDir)}`,
    `vta_name    = ${JSON.stringify(name)}`,
    `public_url  = ${JSON.stringify(vtaTunnel.url)}`,
    ``,
    `[server]`,
    `host = "0.0.0.0"`,
    `port = ${port}`,
    ``,
    `[secrets]`,
    `backend = "plaintext"`,
    ``,
    `[messaging]`,
    mediatorDid ? `kind = "existing"` : `kind = "skip"`,
    ...(mediatorDid ? [`did = ${JSON.stringify(mediatorDid)}`] : []),
    ``,
    `[vta_did]`,
    `kind               = "create_webvh"`,
    `url                = ${JSON.stringify(`${didHostTunnel.url}/dids/vta`)}`,
    `portable           = true`,
    `pre_rotation_count = 1`,
    ``,
  ].join("\n");
  const setupTomlPath = join(dir, "setup.toml");
  writeFileSync(setupTomlPath, setupToml);

  console.log(`[e2e] provisioning VTA "${name}" — ${vtaTunnel.url} (state: ${dir})`);
  const setupOut = await runVta(["setup", "--from", setupTomlPath]);
  const vtaDidMatch = setupOut.match(/VTA DID:\s+(\S+)/);
  if (!vtaDidMatch) throw new Error(`vta setup did not report a VTA DID:\n${setupOut}`);
  const vtaDid = vtaDidMatch[1];

  copyFileSync(join(dataDir, "did-logs", "VTA-did.jsonl"), join(didHostDir, "did.jsonl"));

  const adminOut = await runVta(["--config", configPath, "create-did-key", "--context", "vta", "--admin", "--label", "e2e"]);
  const adminDidMatch = adminOut.match(/^DID:\s+(\S+)/m);
  const adminCredMatch = adminOut.match(/Credential:\n(\S+)/);
  if (!adminDidMatch || !adminCredMatch) throw new Error(`vta create-did-key did not report a DID/credential:\n${adminOut}`);
  const adminDid = adminDidMatch[1];
  const adminCredential = adminCredMatch[1];

  const proc = spawn(VTA_BIN, ["--config", configPath], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  proc.on("exit", (code) => {
    exited = true;
    if (code) console.error(`[e2e] vta process exited (code ${code})`);
  });
  proc.stdout.on("data", (b) => {
    for (const line of b.toString().split("\n")) if (line.trim()) console.log(`[vta] ${stripAnsi(line).trimEnd()}`);
  });
  proc.stderr.on("data", (b) => {
    for (const line of b.toString().split("\n")) if (line.trim()) console.log(`[vta] ${stripAnsi(line).trimEnd()}`);
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
    didHostStop();
    didHostTunnel.stop();
    vtaTunnel.stop();
    rmSync(dir, { recursive: true, force: true });
    console.log(`[e2e] vta stopped`);
  };

  const deadline = Date.now() + readyTimeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (exited) {
      await stop();
      throw new Error("vta process exited before becoming ready");
    }
    try {
      const res = await fetch(`${vtaTunnel.url}/health`);
      if (res.ok) {
        console.log(`[e2e] vta ready — ${vtaDid}`);
        return { vtaDid, vtaUrl: vtaTunnel.url, adminDid, adminCredential, stop };
      }
      lastErr = new Error(`health check returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(1000);
  }
  await stop();
  throw new Error(`vta not healthy within ${readyTimeoutMs}ms: ${lastErr?.message}`);
}
