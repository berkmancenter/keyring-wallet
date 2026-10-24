/**
 * The origin a request arrived on, for answers that send the caller back to
 * this server. The publisher's storage calls ("does this object exist?", "give
 * me its URL") must come back the way the publisher came in: a publisher on the
 * same host uses http://localhost:<port>, never the public URL, which in a spike
 * or a CI job is a quick tunnel that rate-limits a burst of existence checks.
 * Behind a proxy, X-Forwarded-Proto carries the scheme the caller used.
 */
export const requestOrigin = (headers) => {
  const host = String(headers.host ?? '').trim()
  if (!host || /[\s/\\@]/.test(host)) throw new Error(`unusable Host header: ${headers.host}`)
  const forwarded = String(headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase()
  const proto = forwarded === 'https' || forwarded === 'http' ? forwarded : 'http'
  return `${proto}://${host}`
}
