// Fetch a platform's dev bundle from Metro once, before the first session of that platform starts.
//
// A debug build loads its JS from Metro, and the first request for a platform makes Metro transform every module
// (about 7,000 here). On a cold Metro (`yarn start --reset-cache`) under memory pressure, that took longer than the
// apps wait: on 2026-10-15 the witnessed suite's Android app sat on its splash and the iOS app showed "Could not
// connect to development server" while Metro restarted the bundle from 0 % seven times, and the run died five minutes
// later with "onboarding did not finish within 5min (last action: )". The same recipe had passed on 241 only because
// Metro was already warm from the suite run before it. Fetching the bundle here, before any app starts, makes the
// apps' own requests hit a warm Metro, and a slow or broken bundle fails here, naming Metro, instead of later.
//
// Skipped when nothing listens on the Metro port (release builds and FORCE_BUNDLING builds carry their JS), and with
// E2E_METRO_WARM=0.

const warmed = new Set();

/** The URL the app itself asks for (React Native's debug defaults), so Metro builds the same graph. */
export function bundleUrl(platform, port, appId) {
  const q = new URLSearchParams({
    platform,
    dev: "true",
    lazy: "true",
    minify: "false",
    inlineSourceMap: "false",
    modulesOnly: "false",
    runModule: "true",
    app: appId,
  });
  return `http://localhost:${port}/index.bundle?${q}`;
}

/**
 * warmMetroBundle(platform, { port, appId, metroUp, fetchImpl, timeoutMs, log, env }):
 * resolves to "warmed" | "skipped" | "already"; throws when Metro answers with an error or not within timeoutMs.
 */
export async function warmMetroBundle(platform, opts) {
  const {
    port,
    appId,
    metroUp,
    fetchImpl = fetch,
    timeoutMs = 15 * 60 * 1000,
    log = console.log,
    env = process.env,
  } = opts;
  if (env.E2E_METRO_WARM === "0") return "skipped";
  if (warmed.has(`${platform}:${port}`)) return "already";
  if (!(await metroUp())) return "skipped";
  const url = bundleUrl(platform, port, appId);
  const t0 = Date.now();
  log(`[e2e] metro: fetching the ${platform} bundle before the app starts…`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  let body;
  try {
    res = await fetchImpl(url, { signal: ac.signal });
    body = await res.text();
  } catch (e) {
    const why = ac.signal.aborted ? `no bundle within ${Math.round(timeoutMs / 1000)} s` : e.message;
    throw new Error(`metro: the ${platform} bundle could not be fetched (${why}); the app would render nothing`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`metro: the ${platform} bundle failed with HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  warmed.add(`${platform}:${port}`);
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[e2e] metro: ${platform} bundle ready in ${s} s (${Math.round(body.length / 1024)} KB)`);
  return "warmed";
}

/** Tests only: forget which bundles were fetched. */
export function _resetWarmed() {
  warmed.clear();
}
