// Witness-server lifecycle for the witnessed VRC exchange e2e.
//
// Spawns bifold/packages/witness-server (ts-node) with a fresh temp wallet +
// invitation per run, waits for its "READY" banner, reads the persisted
// invitation URL, and tears it down. See docs/spikes/witnessed-e2e-spec.md.
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
 * Start the witness server. Returns { invitationUrl, publicUrl, name, stop }.
 * The phones reach it at publicUrl (WITNESS_PORT) directly; the witness reaches
 * them back through their mediator, so only phone→witness needs LAN reachability.
 */
export async function startWitness({
  publicUrl,
  name = process.env.WITNESS_NAME || "e2e-witness",
  port = Number(process.env.WITNESS_PORT || 9002),
  webPort = Number(process.env.WITNESS_WEB_PORT || 9003),
  readyTimeoutMs = 120000,
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

  const dir = mkdtempSync(join(tmpdir(), "e2e-witness-"));
  const invitationFile = join(dir, ".oob-invitation.json");

  console.log(`[e2e] starting witness "${name}" at ${publicUrl} (wallet: ${dir})`);
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let readyLogged = false;
  const onData = (buf) => {
    const s = buf.toString();
    // Surface witness lines (prefixed) so a stuck run is diagnosable
    for (const line of s.split("\n")) {
      if (line.trim()) console.log(`[witness] ${line.trimEnd()}`);
    }
    if (/witness server is ready/i.test(s)) readyLogged = true;
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);

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
        return { invitationUrl, publicUrl, name, stop };
      }
    }
    await sleep(1000);
  }
  await stop();
  throw new Error(`witness server not ready within ${readyTimeoutMs}ms`);
}
