// Witness-server lifecycle for the witnessed VRC exchange e2e.
//
// Spawns bifold/packages/witness-server (ts-node) with a fresh temp wallet +
// invitation per run (VRC_WALLET_PATH points the wallet itself into the same
// per-run temp dir as the invitation file, so both are wiped together by
// stop() — no separate `yarn fresh` needed, and no run can inherit another
// run's persisted mediation state; see docs/spikes/e2e-vrc-connect-findings.md
// "the part that made this look machine-specific"), waits for its "READY"
// banner, reads the persisted invitation URL, and tears it down. See
// e2e/README.md for usage.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { sleep } from "./driver.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const witnessDir = join(repoRoot, "bifold", "packages", "witness-server");

/**
 * Authoritative "is this port actually free" check via a real bind attempt.
 * `lsof`-based freeing (below) can miss a listener it has no permission to
 * enumerate — e.g. a root-owned process — in which case `lsof -tiTCP:<port>`
 * silently returns nothing even though the port is occupied, and the witness
 * only finds out ~15s later via a raw EADDRINUSE stack trace at the bottom of
 * its full startup banner. Bind-testing here fails fast, before the tunnel
 * and witness process even start, with a message that names the actual port
 * and how to work around it.
 */
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use by another process on this machine (not one this harness ` +
              `started or can identify/kill — e.g. \`lsof -tiTCP:${port}\` may show nothing even though ` +
              `\`ss -ltn\` shows it LISTENing, which happens for a process this user can't enumerate). ` +
              `Set WITNESS_PORT/WITNESS_WEB_PORT to an unused port and retry.`
          )
        );
      } else {
        reject(err);
      }
    });
    srv.listen(port, () => srv.close(() => resolve()));
  });
}

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
  // otherwise EADDRINUSE this one. Best-effort: only catches processes this
  // user can see/kill via lsof (see assertPortFree below for the case it can't).
  for (const p of [port, webPort]) {
    try {
      const pids = execSync(`lsof -tiTCP:${p} -sTCP:LISTEN`).toString().trim();
      if (pids) {
        execSync(`kill -9 ${pids.split("\n").join(" ")}`);
        console.log(`[e2e] freed leftover process on :${p}`);
      }
    } catch {
      /* nothing listening (visible to lsof) — good */
    }
  }

  // Verify both ports actually ended up free — authoritative, unlike the
  // lsof-based freeing above — and fail fast with a clear, actionable error
  // instead of a confusing EADDRINUSE stack trace after the witness has
  // already spent ~15s spinning up its agent and printing its full banner.
  for (const p of [port, webPort]) {
    await assertPortFree(p);
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
    // `yarn ts-node ...` spawns ts-node as a GRANDCHILD of this process — killing
    // just `proc` only signals the yarn wrapper, orphaning the actual witness
    // server (still holding the port, still running). detached: true makes proc
    // its own process group leader, so stop() can kill the whole group at once.
    detached: true,
    env: {
      ...process.env,
      TS_NODE_TRANSPILE_ONLY: "1",
      WITNESS_PORT: String(port),
      WITNESS_WEB_PORT: String(webPort),
      WITNESS_NAME: name,
      WITNESS_PUBLIC_URL: publicUrl,
      WITNESS_INVITATION_FILE: invitationFile,
      WITNESS_VERBOSE: process.env.WITNESS_VERBOSE || "false",
      // Wallet lives in the per-run temp dir — see the file header. Also makes
      // this run immune to `bifold/packages/witness-server/.env`'s own wallet
      // location, if it sets one.
      VRC_WALLET_PATH: join(dir, "wallets"),
      // DIRECT mode by default, regardless of what a developer's local
      // bifold/packages/witness-server/.env has committed to
      // MEDIATOR_INVITATION_URL. That file is gitignored and per-developer, and
      // dotenv (`import 'dotenv/config'` in witness-server/src/index.ts) never
      // overrides a variable already present in the environment — so without
      // this line, an uncommented MEDIATOR_INVITATION_URL there silently
      // switches this run's transport out from under it. This is the exact
      // divergence that made "works on my machine" true for one developer and
      // false for another: see docs/spikes/e2e-vrc-connect-findings.md ("why
      // Alberto"). Explicit empty string by default (not just omission, so it
      // can't be inherited from the calling shell's own environment either);
      // set WITNESS_MEDIATOR_INVITATION_URL to deliberately test mediator mode.
      MEDIATOR_INVITATION_URL: process.env.WITNESS_MEDIATOR_INVITATION_URL || "",
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
  // The banner's own report of what it actually started as — read back below
  // to confirm the MEDIATOR_INVITATION_URL override above took effect, instead
  // of assuming it did. A silent transport mismatch is exactly the bug this
  // harness spent a day chasing (docs/spikes/e2e-vrc-connect-findings.md).
  let observedTransport;
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
    const transportMatch = s.match(/Transport:\s+(DIRECT \(HTTP\)|MEDIATOR \(WebSocket\))/);
    if (transportMatch) observedTransport = transportMatch[1];
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
      // negative pid targets the whole process group (yarn + its ts-node
      // grandchild) — see the `detached: true` comment above.
      try {
        process.kill(-proc.pid, "SIGINT");
      } catch {
        /* group already gone */
      }
      // give askar a moment to close the store cleanly
      for (let i = 0; i < 10 && !exited; i++) await sleep(300);
      if (!exited) {
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch {
          /* group already gone */
        }
      }
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
        // Confirm the transport we asked for (via MEDIATOR_INVITATION_URL above)
        // is the transport that actually started, from the witness's own banner —
        // not assumed. Fail loudly here, in seconds, rather than as a mysterious
        // participant-connect timeout 2+ minutes into an attended device run.
        const expectMediator = Boolean(process.env.WITNESS_MEDIATOR_INVITATION_URL);
        const expectedTransport = expectMediator ? "MEDIATOR (WebSocket)" : "DIRECT (HTTP)";
        if (observedTransport && observedTransport !== expectedTransport) {
          await stop();
          throw new Error(
            `witness started in ${observedTransport} mode, expected ${expectedTransport} ` +
              `(requested via MEDIATOR_INVITATION_URL=${JSON.stringify(
                process.env.WITNESS_MEDIATOR_INVITATION_URL || ""
              )}). This should be impossible — the harness sets MEDIATOR_INVITATION_URL ` +
              `explicitly precisely so a local .env can't override it; if this fires, something ` +
              `upstream of that env var changed. See docs/spikes/e2e-vrc-connect-findings.md.`
          );
        }
        console.log(
          `[e2e] witness ready${readyLogged ? "" : " (invitation file present)"} — invitation captured` +
            (observedTransport ? ` (${observedTransport})` : "")
        );
        return { invitationUrl, publicUrl, name, stop, waitForParticipants };
      }
    }
    await sleep(1000);
  }
  await stop();
  throw new Error(`witness server not ready within ${readyTimeoutMs}ms`);
}
