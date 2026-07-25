// Witness-server lifecycle for the witnessed VRC exchange e2e.
//
// Spawns bifold/packages/witness-server (ts-node) with a fresh temp wallet +
// invitation per run, waits for its "READY" banner, reads the persisted
// invitation URL, and tears it down. See e2e/README.md for usage.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { sleep } from "./driver.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const witnessDir = join(repoRoot, "bifold", "packages", "witness-server");

/**
 * Start a cloudflared quick tunnel to a local port and return its public
 * https://<name>.trycloudflare.com URL. This gives the local witness an HTTPS
 * endpoint — the app blocks cleartext http, and in production the witness is
 * reached over HTTPS (real mediators like aaleon have SSL); the tunnel mirrors
 * that for local testing while the witness runs in its stable DIRECT mode
 * (no mediator-pickup dependency). No cloudflare account needed for quick
 * tunnels.
 */
export async function startTunnel(port, readyTimeoutMs = 60000) {
  const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let url;
  const onData = (buf) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !url) url = m[0];
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);

  let exited = false;
  proc.on("exit", () => (exited = true));

  const stop = () => {
    if (!exited) proc.kill("SIGINT");
  };

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error("cloudflared exited before a tunnel URL appeared");
    if (url) {
      // give cloudflare a moment to route the fresh hostname globally
      await sleep(5000);
      console.log(`[e2e] tunnel up: ${url} → localhost:${port}`);
      return { url, stop };
    }
    await sleep(500);
  }
  stop();
  throw new Error(`cloudflared did not produce a tunnel URL within ${readyTimeoutMs}ms`);
}

/**
 * Best-effort LAN IP the phones can reach the Mac at (same Wi-Fi). Tries the
 * usual Wi-Fi interfaces; override with WITNESS_HOST_IP.
 */
export function detectHostIp() {
  if (process.env.WITNESS_HOST_IP) return process.env.WITNESS_HOST_IP;
  for (const iface of ["en0", "en1"]) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`).toString().trim();
      if (ip) return ip;
    } catch {
      /* interface has no IPv4 — try the next */
    }
  }
  throw new Error(
    "Could not detect a LAN IP for the witness — set WITNESS_HOST_IP=<mac-ip>"
  );
}

/**
 * Start the witness server behind an HTTPS tunnel (cloudflared). Returns
 * { invitationUrl, publicUrl, name, stop, waitForParticipants }.
 *
 * The witness runs in its normal DIRECT mode (HTTP inbound on WITNESS_PORT)
 * and the tunnel gives it a public https:// endpoint the app can reach (the
 * app blocks cleartext http; production witnesses are HTTPS). The witness
 * reaches the phones back through their mediator. Pass a fixed `publicUrl` and
 * `tunnel: false` to skip the tunnel (e.g. a debug build permitting cleartext).
 */
export async function startWitness({
  publicUrl,
  tunnel = !publicUrl,
  name = process.env.WITNESS_NAME || "e2e-witness",
  port = Number(process.env.WITNESS_PORT || 9002),
  webPort = Number(process.env.WITNESS_WEB_PORT || 9003),
  readyTimeoutMs = 180000,
} = {}) {
  // Free the ports first — a prior run's witness whose shutdown hung would
  // otherwise EADDRINUSE this one.
  for (const p of [port, webPort]) {
    try {
      const pids = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN`).toString().trim();
      if (pids) {
        execSync(`kill -9 ${pids.split("\n").join(" ")}`);
        console.log(`[e2e] freed leftover process on :${p}`);
      }
    } catch {
      /* nothing listening — good */
    }
  }

  // Bring up the HTTPS tunnel to the witness's inbound port first, so its
  // public URL can be baked into the invitation the witness publishes.
  let tunnelHandle;
  if (tunnel) {
    tunnelHandle = await startTunnel(port);
    publicUrl = tunnelHandle.url;
  }

  const dir = mkdtempSync(join(tmpdir(), "e2e-witness-"));
  const invitationFile = join(dir, ".oob-invitation.json");

  console.log(`[e2e] starting witness "${name}" — direct, public ${publicUrl} (wallet: ${dir})`);
  // transpile-only: the witness-server has pre-existing @types/node `Timeout`
  // type errors (WitnessService.ts:377/397) that a full ts-node typecheck
  // rejects; a harness launching the server only needs it to run.
  const proc = spawn("yarn", ["ts-node", "--transpile-only", "src/index.ts"], {
    cwd: witnessDir,
    env: {
      ...process.env,
      TS_NODE_TRANSPILE_ONLY: "1",
      WITNESS_PORT: String(port),
      WITNESS_WEB_PORT: String(webPort),
      WITNESS_NAME: name,
      WITNESS_PUBLIC_URL: publicUrl,
      WITNESS_INVITATION_FILE: invitationFile,
      WITNESS_VERBOSE: process.env.WITNESS_VERBOSE || "false",
      // Disable the co-location (BLE proximity) requirement: the witness
      // otherwise rejects the VP with a "locality-verification" error and the
      // exchange auto-falls back to a plain UNwitnessed VRC (no VWC / witness
      // shield). Appium-driven phones can't produce a locality proof; a real
      // deployment keeps this enforced.
      WITNESS_LOCALITY_REQUIRED: process.env.WITNESS_LOCALITY_REQUIRED || "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let readyLogged = false;
  // Count completed participant connections from the witness's own log — the
  // authoritative "a wallet connected" signal (the app shows no banner on
  // connect; witness participation only surfaces as a VWC after an exchange).
  let participantConnections = 0;
  const onData = (buf) => {
    const s = buf.toString();
    // Surface witness lines (prefixed) so a stuck run is diagnosable
    for (const line of s.split("\n")) {
      if (line.trim()) console.log(`[witness] ${line.trimEnd()}`);
    }
    if (/witness server is ready/i.test(s)) readyLogged = true;
    // "✓ Sent witness-announcement" fires once per completed participant
    const sent = s.match(/Sent witness-announcement/g);
    if (sent) participantConnections += sent.length;
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);

  // Resolve once the witness has announced to at least `count` participants
  // (i.e. their connections completed). Rejects on timeout.
  const waitForParticipants = async (count, timeoutMs = 90000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (exited) throw new Error("witness exited while waiting for participants");
      if (participantConnections >= count) return participantConnections;
      await sleep(1000);
    }
    throw new Error(
      `only ${participantConnections}/${count} participant(s) connected to the witness within ${timeoutMs}ms`
    );
  };

  let exited = false;
  proc.on("exit", (code) => {
    exited = true;
    if (code) console.error(`[e2e] witness process exited (code ${code})`);
  });

  const stop = async () => {
    if (!exited) {
      proc.kill("SIGINT");
      // give askar a moment to close the store cleanly
      for (let i = 0; i < 10 && !exited; i++) await sleep(300);
      if (!exited) proc.kill("SIGKILL");
    }
    if (tunnelHandle) tunnelHandle.stop();
    rmSync(dir, { recursive: true, force: true });
    console.log(`[e2e] witness stopped`);
  };

  // Readiness = the persisted invitation file appears (written only after the
  // agent initializes and creates the reusable invitation). The temp dir is
  // fresh per run, so the file can't be stale. The "server is ready" log is a
  // secondary signal used only for a cleaner message.
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      await stop();
      throw new Error("witness server exited before becoming ready");
    }
    if (existsSync(invitationFile)) {
      const { invitationUrl } = JSON.parse(readFileSync(invitationFile, "utf-8"));
      if (invitationUrl) {
        console.log(`[e2e] witness ready${readyLogged ? "" : " (invitation file present)"} — invitation captured`);
        return { invitationUrl, publicUrl, name, stop, waitForParticipants };
      }
    }
    await sleep(1000);
  }
  await stop();
  throw new Error(`witness server not ready within ${readyTimeoutMs}ms`);
}
