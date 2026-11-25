/**
 * Single-line diagnostic dump of an issued VRC, read back by the e2e checker
 * (e2e/check-vrc-credentials.mjs) from logcat. Both credential paths use it:
 * the DIDComm credential-exchange handler (vrc-manager) and the Trust Task
 * ceremony (trust-tasks/ceremony.ts), which stores and delivers the VRC
 * without ever driving a credential exchange to `done`.
 */

/**
 * Replace bulky PEM / binary blobs so a full credential (incl. LD proof) fits
 * in a single ReactNativeJS log line. Structure is preserved for debugging.
 */
export function slimCredentialForLog(credential: unknown): unknown {
  if (credential == null || typeof credential !== 'object') return credential
  const walk = (value: any): any => {
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        if (k === 'certificateChain' && Array.isArray(v)) {
          out[k] = v.map((c, i) => (typeof c === 'string' ? `<PEM #${i + 1}: ${c.length} chars>` : walk(c)))
        } else if (typeof v === 'string' && (v.includes('-----BEGIN CERTIFICATE-----') || v.length > 500)) {
          out[k] = `<omitted ${v.length} chars>`
        } else {
          out[k] = walk(v)
        }
      }
      return out
    }
    return value
  }
  return walk(credential)
}

export const ISSUED_VRC_MARKER = '[VRC:IssuedCredentialJSON]'

/** The marker line for one credential (exported for tests). */
export function formatIssuedVrcLine(side: string, exchange: string, record: string, credential: unknown): string {
  return `${ISSUED_VRC_MARKER} side=${side} exchange=${exchange} record=${record} ${JSON.stringify(slimCredentialForLog(credential))}`
}

/**
 * Log the credential as one line so e2e/logcat can reassemble it without
 * Android's ~4KB truncation of multi-line pretty-prints. Certificate chains
 * and any string over 500 chars are elided; best-effort, never throws.
 */
export function logIssuedVrcJson(side: string, exchange: string, record: string, credential: unknown): void {
  try {
    if (!credential || typeof credential !== 'object') return
    // eslint-disable-next-line no-console
    console.log(formatIssuedVrcLine(side, exchange, record, credential))
  } catch {
    /* best-effort diagnostic dump */
  }
}
