/**
 * Keyring short invitation links, behind Caddy at <wallet host>/i.
 *
 *   POST /i         {"invitation": <out-of-band invitation>} → 201 {"url", "expiresAt"}
 *   GET|HEAD /i/<id>  Accept: application/json → 200 the invitation (what Credo's
 *                   short-URL resolver asks for); anything else → 302 to the
 *                   install page's long link (/invite/?oob=…)
 *   GET /healthz    200 "ok"
 *
 * A link lives LINKS_TTL_SECONDS (7 days) and is not consumed on fetch. Only the
 * invitation and its expiry are stored. No access log, no IPs on disk: the client
 * address is used for rate limiting in memory only.
 *
 * Sizes: the request body is capped at 8 KB, and the invitation itself at 6,000
 * bytes, so that the browser's long link (/invite/?oob=<base64url>, about 4/3 of
 * that) stays under the ~8 KB that browsers and intermediaries reliably carry.
 *
 * Environment: PORT (3090), PUBLIC_URL (https://wallet.asml.berkmancenter.org),
 * LINKS_DATA_DIR (./data), LINKS_TTL_SECONDS (604800), LINKS_MAX_BODY_BYTES (8192),
 * LINKS_MAX_INVITATION_BYTES (6000),
 * LINKS_MAX_LINKS (100000), LINKS_RATE_PER_MINUTE (10), LINKS_RATE_BURST (20),
 * LINKS_GLOBAL_PER_MINUTE (600).
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import { ID_RE, isInvitation, longInviteUrl, newId } from './links.mjs'
import { createRateLimiter } from './rateLimit.mjs'
import { createStore } from './store.mjs'

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
  'referrer-policy': 'no-referrer',
}

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

/** After a 413, at most this much more is read (and dropped) before the connection is cut. */
const MAX_DRAIN_BYTES = 64 * 1024

const readBody = (req, maxBytes) =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) return reject(new HttpError(413, 'too_large'))
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        // Stop keeping it and answer 413. Drain a bounded amount so the answer can be
        // sent, and cut the connection after it (Caddy's own body cap is the first
        // line; this holds if the service is ever reached some other way).
        reject(new HttpError(413, 'too_large'))
        req.removeAllListeners('data')
        let drained = 0
        req.on('data', (more) => {
          drained += more.length
          if (drained > MAX_DRAIN_BYTES) req.destroy()
        })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

/** The client address Caddy saw: it replaces X-Forwarded-For with the peer address. */
const clientKey = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return forwarded.at(-1) ?? req.socket.remoteAddress ?? 'unknown'
}

const wantsJson = (req) => String(req.headers.accept ?? '').toLowerCase().includes('application/json')

export const createLinksServer = (options = {}) => {
  const env = process.env
  const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value))
  const config = {
    publicUrl: (options.publicUrl ?? env.PUBLIC_URL ?? 'https://wallet.asml.berkmancenter.org').replace(/\/+$/, ''),
    dataDir: options.dataDir ?? env.LINKS_DATA_DIR ?? './data',
    ttlMs: (options.ttlSeconds ?? num(env.LINKS_TTL_SECONDS, 604800)) * 1000,
    maxBodyBytes: options.maxBodyBytes ?? num(env.LINKS_MAX_BODY_BYTES, 8192),
    maxInvitationBytes: options.maxInvitationBytes ?? num(env.LINKS_MAX_INVITATION_BYTES, 6000),
    maxLinks: options.maxLinks ?? num(env.LINKS_MAX_LINKS, 100000),
    perMinute: options.perMinute ?? num(env.LINKS_RATE_PER_MINUTE, 10),
    burst: options.burst ?? num(env.LINKS_RATE_BURST, 20),
    globalPerMinute: options.globalPerMinute ?? num(env.LINKS_GLOBAL_PER_MINUTE, 600),
    now: options.now ?? (() => Date.now()),
  }
  const store = createStore({ dir: config.dataDir, ttlMs: config.ttlMs, maxLinks: config.maxLinks, now: config.now })
  const limiter = createRateLimiter({
    perMinute: config.perMinute,
    burst: config.burst,
    globalPerMinute: config.globalPerMinute,
    now: config.now,
  })

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers })
    res.end(body)
  }
  const json = (res, status, value, head = false) => {
    const body = JSON.stringify(value)
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json' })
    res.end(head ? undefined : body)
  }
  const fail = (req, res, status, code) => {
    if (status === 413) {
      res.setHeader('connection', 'close')
      res.on('finish', () => req.socket.destroy())
    }
    return failWith(req, res, status, code)
  }
  const failWith = (req, res, status, code) =>
    wantsJson(req) || req.method === 'POST'
      ? json(res, status, { error: code }, req.method === 'HEAD')
      : send(res, status, req.method === 'HEAD' ? undefined : status === 404 ? 'Not found\n' : `${code}\n`, {
          'content-type': 'text/plain; charset=utf-8',
        })

  const create = async (req, res) => {
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'unsupported_media_type')
    }
    if (!limiter.allow(clientKey(req))) throw new HttpError(429, 'rate_limited')
    let body
    try {
      body = JSON.parse(await readBody(req, config.maxBodyBytes))
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(400, 'invalid_json')
    }
    if (!isInvitation(body?.invitation)) throw new HttpError(400, 'not_an_invitation')
    const invitationText = JSON.stringify(body.invitation)
    if (Buffer.byteLength(invitationText, 'utf8') > config.maxInvitationBytes) throw new HttpError(413, 'too_large')
    const id = newId()
    const stored = await store.put(id, invitationText)
    if (!stored) throw new HttpError(503, 'store_full')
    json(res, 201, { url: `${config.publicUrl}/i/${id}`, expiresAt: new Date(stored.expiresAt).toISOString() })
  }

  const resolve = async (req, res, id) => {
    const found = ID_RE.test(id) ? await store.get(id) : null
    if (!found) throw new HttpError(404, 'not_found')
    if (wantsJson(req)) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/json' })
      res.end(req.method === 'HEAD' ? undefined : found.invitation)
      return
    }
    send(res, 302, undefined, { location: longInviteUrl(config.publicUrl, found.invitation) })
  }

  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost')
      if (pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
        return send(res, 200, req.method === 'HEAD' ? undefined : 'ok\n', { 'content-type': 'text/plain' })
      }
      if (pathname === '/i' || pathname === '/i/') {
        if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed')
        return await create(req, res)
      }
      if (pathname.startsWith('/i/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed')
        return await resolve(req, res, pathname.slice(3))
      }
      throw new HttpError(404, 'not_found')
    } catch (error) {
      if (error instanceof HttpError) return fail(req, res, error.status, error.code)
      // Never log the body or the id: only that something failed.
      console.error(`${new Date().toISOString()} ${req.method} internal error: ${error?.name ?? 'Error'}`)
      if (!res.headersSent) fail(req, res, 500, 'internal_error')
    }
  })

  // Hourly: drop expired links and idle rate-limit buckets.
  const timer = setInterval(() => {
    store.sweep().catch(() => {})
    limiter.prune()
  }, 3600_000)
  timer.unref()
  server.on('close', () => clearInterval(timer))

  return { server, store, limiter, config }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, config } = createLinksServer()
  const port = Number(process.env.PORT ?? 3090)
  server.listen(port, () => console.log(`keyring-links listening on :${port}, public URL ${config.publicUrl}`))
}
