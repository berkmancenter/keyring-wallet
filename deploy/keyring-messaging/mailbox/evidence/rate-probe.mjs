// Per-IP rate limit behind a reverse proxy (M3 S2 row D). The mediator keys its per-IP limiter on the socket peer
// unless the peer is in `[server] trust_xff_cidrs`, in which case X-Forwarded-For names the client.
// This probe sends N requests from 127.0.0.1 with X-Forwarded-For rotating over N addresses (MODE=rotate) or the
// same address (MODE=same), and counts the statuses. With 127.0.0.1/32 trusted, rotate = N buckets (no 429);
// with nothing trusted, rotate = one bucket (429s once the burst is spent).
//   MEDIATOR_URL=http://127.0.0.1:7049 PATH_=/mediator/v1/whoami METHOD=GET MODE=rotate N=40 node rate-probe.mjs
const base = process.env.MEDIATOR_URL ?? "http://127.0.0.1:7049";
const path = process.env.PATH_ ?? "/mediator/v1/whoami";
const method = process.env.METHOD ?? "GET";
const body = process.env.BODY;
const mode = process.env.MODE ?? "rotate";
const n = Number(process.env.N ?? 40);
const results = await Promise.all(Array.from({ length: n }, (_, i) => {
  const ip = mode === "rotate" ? `198.51.100.${(i % 250) + 1}` : "198.51.100.7";
  const headers = { "x-forwarded-for": ip };
  if (body) headers["content-type"] = "application/json";
  return fetch(`${base}${path}`, { method, headers, body }).then((r) => r.status).catch(() => -1);
}));
const counts = results.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
console.log(`rate-probe ${method} ${path} MODE=${mode} N=${n}: ${JSON.stringify(counts)}`);
