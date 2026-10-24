/**
 * Token buckets for POST /i: one per client address plus one global bucket.
 * In memory only, never written anywhere; an idle client's bucket is dropped.
 */
export const createRateLimiter = ({ perMinute, burst, globalPerMinute, now = () => Date.now() }) => {
  const buckets = new Map()
  const refill = (bucket, rate, cap, t) => {
    bucket.tokens = Math.min(cap, bucket.tokens + ((t - bucket.at) / 60000) * rate)
    bucket.at = t
  }
  const global = { tokens: globalPerMinute, at: now() }

  return {
    /** True if this client may POST now (and spends a token). */
    allow(key) {
      const t = now()
      refill(global, globalPerMinute, globalPerMinute, t)
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { tokens: burst, at: t }
        buckets.set(key, bucket)
      }
      refill(bucket, perMinute, burst, t)
      if (bucket.tokens < 1 || global.tokens < 1) return false
      bucket.tokens -= 1
      global.tokens -= 1
      return true
    },

    /** Forget buckets that have refilled completely (nothing to remember about them). */
    prune() {
      const t = now()
      for (const [key, bucket] of buckets) {
        refill(bucket, perMinute, burst, t)
        if (bucket.tokens >= burst) buckets.delete(key)
      }
    },

    size: () => buckets.size,
  }
}
