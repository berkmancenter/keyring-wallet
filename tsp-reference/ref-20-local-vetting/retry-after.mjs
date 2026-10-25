/**
 * Retry a request the VTC refused with 429, after the wait it asked for.
 *
 * VTC main puts a per-IP limiter in front of its unauthenticated routes
 * (`vtc-service/src/routing/rate_limit.rs`, limiter `unauth`). Every admin call
 * here authenticates first (challenge, then authenticate), so a runner that
 * reads several lists in a row — members, then join requests of five
 * statuses — is refused part way: `authenticate failed 429`. Every 429 from
 * that limiter carries `Retry-After: <seconds>` (never 0) and a JSON body with
 * `retryAfterSecs`. The wait is taken from the header, else the body, else one
 * second, and is bounded, as is the number of attempts: a limiter that keeps
 * refusing is reported, not waited out.
 */

export const MAX_ATTEMPTS = 5;
export const MAX_WAIT_MS = 30_000;

/** Milliseconds the refusal asks for: `Retry-After`, else `retryAfterSecs`, else 1 s; at most MAX_WAIT_MS. */
export function retryAfterMs(headers, body) {
  const fromHeader = Number(headers?.get?.("retry-after"));
  const fromBody = Number(body?.retryAfterSecs);
  const secs = fromHeader > 0 ? fromHeader : fromBody > 0 ? fromBody : 1;
  return Math.min(secs * 1000, MAX_WAIT_MS);
}

/**
 * Call `send` until it answers anything but 429, or MAX_ATTEMPTS have been
 * refused; returns the last answer. `send` resolves to
 * `{ status, headers, body }`.
 */
export async function withRetryAfter(send, { sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), maxAttempts = MAX_ATTEMPTS } = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await send();
    if (r.status !== 429 || attempt >= maxAttempts) return r;
    await sleep(retryAfterMs(r.headers, r.body));
  }
}
