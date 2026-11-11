import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bundleUrl, warmMetroBundle, _resetWarmed } from "./metroWarm.js";

const quiet = () => {};
const up = async () => true;
const okFetch = (calls) => async (url) => {
  calls.push(url);
  return { ok: true, status: 200, text: async () => "x".repeat(2048) };
};

beforeEach(() => _resetWarmed());

test("bundleUrl asks for the dev bundle the app asks for", () => {
  const u = new URL(bundleUrl("ios", 8081, "asml.bkc.harvard.wallet"));
  assert.equal(u.host, "localhost:8081");
  assert.equal(u.pathname, "/index.bundle");
  assert.equal(u.searchParams.get("platform"), "ios");
  assert.equal(u.searchParams.get("dev"), "true");
  assert.equal(u.searchParams.get("app"), "asml.bkc.harvard.wallet");
});

test("fetches once per platform and port", async () => {
  const calls = [];
  const o = { port: 8081, appId: "a", metroUp: up, fetchImpl: okFetch(calls), log: quiet, env: {} };
  assert.equal(await warmMetroBundle("android", o), "warmed");
  assert.equal(await warmMetroBundle("android", o), "already");
  assert.equal(await warmMetroBundle("ios", o), "warmed");
  assert.equal(calls.length, 2);
});

test("skipped when no Metro listens (release builds) or E2E_METRO_WARM=0", async () => {
  const calls = [];
  const base = { port: 8081, appId: "a", fetchImpl: okFetch(calls), log: quiet };
  assert.equal(await warmMetroBundle("ios", { ...base, metroUp: async () => false, env: {} }), "skipped");
  assert.equal(await warmMetroBundle("ios", { ...base, metroUp: up, env: { E2E_METRO_WARM: "0" } }), "skipped");
  assert.equal(calls.length, 0);
});

test("an HTTP error from Metro fails here, naming the platform", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "SyntaxError in foo.js" });
  await assert.rejects(
    warmMetroBundle("android", { port: 8081, appId: "a", metroUp: up, fetchImpl, log: quiet, env: {} }),
    /android bundle failed with HTTP 500: SyntaxError in foo\.js/
  );
});

test("a bundle slower than the timeout fails here, not five minutes into the run", async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(
    warmMetroBundle("ios", { port: 8081, appId: "a", metroUp: up, fetchImpl, timeoutMs: 50, log: quiet, env: {} }),
    /ios bundle could not be fetched \(no bundle within 0 s\)/
  );
});

test("a failed fetch is retried by the next call (nothing cached)", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) throw new Error("ECONNRESET");
    return { ok: true, status: 200, text: async () => "ok" };
  };
  const o = { port: 8081, appId: "a", metroUp: up, fetchImpl, log: quiet, env: {} };
  await assert.rejects(warmMetroBundle("android", o), /ECONNRESET/);
  assert.equal(await warmMetroBundle("android", o), "warmed");
});
