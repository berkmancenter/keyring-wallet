/**
 * A community's HTTP routes sit behind a per-address rate limiter (VTI main,
 * vtc-service `routing/rate_limit.rs`). It answers 429 with `Retry-After`,
 * never 0, and a body naming the limiter. A client that meets it should wait
 * as asked and try again rather than report a failure: the community is busy,
 * not broken. One more try, after a bounded wait, is enough for a phone — a
 * limiter that is still refusing is reported as busy by the caller.
 *
 * DIDComm and TSP traffic does not pass this limiter (it is HTTP-only), so
 * only Keyring's plain HTTP reads and the invitation redeem go through here.
 *
 * The same one more try answers 421 Misdirected Request, at once: a client
 * reused a connection opened for another host behind the same certificate
 * (HTTP/2 coalescing), and RFC 9110 §15.5.20 allows retrying on a fresh one.
 * Measured on the lab's ngrok hosts (2026-09-22, and an iOS redeem on
 * 2026-09-27).
 */

/** The longest a phone waits before its one more try. */
export const BUSY_WAIT_CAP_MS = 10_000

/** How long a 429 asks to be waited: `Retry-After` seconds, else one second, at most the cap. */
export function busyWaitMs(response: Pick<Response, 'headers'>, capMs = BUSY_WAIT_CAP_MS): number {
  const secs = Number(response.headers?.get?.('retry-after'))
  return Math.min((secs > 0 ? secs : 1) * 1000, capMs)
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Fetch, and try once more when the answer asks for it: after the wait a 429
 * names (at most `capMs`), or at once after a 421. Returns the last answer; a
 * caller that still sees 429 knows the community is busy.
 */
export async function fetchWaitingIfBusy(
  doFetch: typeof fetch,
  url: string,
  init?: RequestInit,
  sleep: (ms: number) => Promise<void> = pause,
  capMs = BUSY_WAIT_CAP_MS
): Promise<Response> {
  const first = await doFetch(url, init)
  if (first.status === 421) return doFetch(url, init)
  if (first.status !== 429) return first
  await sleep(busyWaitMs(first, capMs))
  return doFetch(url, init)
}
