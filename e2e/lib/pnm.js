/**
 * One pnm call on a runner agent, the way every driver should make it:
 * through the slug's lock (scripts/openvtc/pnm-locked), and riding out the
 * Farm's rate limit instead of failing on it.
 *
 * Lifted from run-vta-approvals.js (wallet #331). The 236 gate's setup met the
 * Farm's rate limit at 12:48Z with back-to-back pnm calls, and a driver that
 * took the 429 as an answer failed a row the app never touched.
 *
 *   import { pnmCall } from "./lib/pnm.js";
 *   const out = pnmCall(["approvals", "list"], { slug: "farm3-runner-prague" });
 *   const list = pnmCall(["approvals", "list", "--json"], { slug, json: true });
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The lock wrapper every pnm call goes through: one call per pnm identity at a time on this Mac. */
export const PNM_LOCKED = path.resolve(here, "../../scripts/openvtc/pnm-locked");
/** The pnm binary, as the drivers already choose it. */
export const defaultPnmBin = () => process.env.PNM_BIN || path.join(os.homedir(), "vti-stack/bin/pnm");

/** A rate-limit answer, from the agent or from the proxy in front of it. */
export const RATE_LIMITED = /\b429\b|too many requests|rate.?limit|proxy \/ load balancer/i;

/** Block for `ms` without spinning: pnmCall is synchronous, like the execFileSync it wraps. */
export const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Leave this long between setup calls: back to back they met the Farm's rate limit (236, 12:48Z). */
export const pnmSpacing = (ms = 3000) => pause(ms);

/**
 * Run `pnm --vta <slug> <args…>` through the lock. Returns what it printed
 * (stdout then stderr), whatever its exit status: a refusal is an answer the
 * caller reads. A rate-limited answer is retried after 5, 10, 20, 40 s
 * (`retries` of them), each logged as `RATE-LIMITED <iso> pnm <args> (attempt n)`,
 * which is evidence for the Farm's rate-limit question as well as a retry.
 *
 * With `json: true` the output is parsed from its first "{" (pnm prints
 * "VTA:"/"DID:" header lines before the JSON) and the object returned; output
 * with no JSON in it throws, naming its last line.
 *
 * With `E2E_PNM_TIMING=1` each attempt also prints `PNM <slug> <args> <ms>ms`,
 * for a run's wall-clock accounting.
 *
 * `exec`, `sleep`, `now` and `timing` are for tests.
 */
export function pnmCall(
  args,
  {
    slug,
    pnmBin = defaultPnmBin(),
    locked = PNM_LOCKED,
    timeout = 120000,
    retries = 4,
    json = false,
    exec = execFileSync,
    sleep = pause,
    log = console.log,
    now = Date.now,
    timing = process.env.E2E_PNM_TIMING === "1",
  } = {}
) {
  if (!slug) throw new Error("pnmCall: no slug (the runner agent's pnm slug)");
  let out = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = now();
    try {
      out = exec(locked, ["--vta", slug, ...args], {
        encoding: "utf8",
        timeout,
        env: { ...process.env, PNM_BIN: pnmBin },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}` || String(err.message);
    }
    if (timing) log(`PNM ${slug} ${args.slice(0, 3).join(" ")} ${now() - started}ms`);
    if (!RATE_LIMITED.test(out)) break;
    log(`RATE-LIMITED ${new Date().toISOString()} pnm ${args.slice(0, 3).join(" ")} (attempt ${attempt + 1})`);
    if (attempt < retries) sleep(5000 * 2 ** attempt);
  }
  return json ? parsePnmJson(out) : out;
}

/** pnm's JSON output, read from its first "{" past the header lines. */
export function parsePnmJson(out) {
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`pnm printed no JSON: ${out.trim().split("\n").pop()?.slice(0, 160) ?? ""}`);
  return JSON.parse(out.slice(start));
}
