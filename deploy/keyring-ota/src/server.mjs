/**
 * Keyring over-the-air update server (phase 1 spike).
 *
 *   /hot-updater/...      phones' update checks (public), and /hot-updater/api/...
 *                         bundle management for the publisher (token)
 *   /storage/...          the publisher's uploads (token), for the CLI's standaloneStorage
 *   /files/<key>          bundle downloads (public; every bundle is RSA-signed and
 *                         the phone verifies it against the key in its binary)
 *
 * It keeps no access log and no per-device record: an update check carries the
 * platform, fingerprint, channel, ring and current bundle id, and nothing about
 * it is written down.
 *
 * Environment: HOT_UPDATER_AUTH_TOKEN (required), OTA_PUBLIC_URL (the https
 * address phones use), PORT (default 3080), OTA_DATA_DIR (default ./data).
 * OTA_LOG_CHECKS=1 prints each update check's path and each download, for a
 * spike or a gate run that must see which bundle a phone reports; never set it
 * on the hosted server, which keeps no access log.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { timingSafeEqual } from 'node:crypto'

import { hotUpdater, store } from './hotUpdater.mjs'

const token = process.env.HOT_UPDATER_AUTH_TOKEN
if (!token || token.length < 32) {
  console.error('HOT_UPDATER_AUTH_TOKEN must be set, 32 characters or more')
  process.exit(1)
}
const port = Number(process.env.PORT ?? 3080)
const logChecks = process.env.OTA_LOG_CHECKS === '1'

export const authorized = (header, expected = token) => {
  const given = Buffer.from(String(header ?? ''))
  const wanted = Buffer.from(`Bearer ${expected}`)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

const toWebRequest = (req) => {
  const url = `http://localhost${req.url}`
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: 'half',
  })
}

const send = async (res, response) => {
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const handleStorage = async (req, res, route) => {
  const request = toWebRequest(req)
  if (route === 'upload' && req.method === 'POST') {
    const form = await request.formData()
    const file = form.get('file')
    const key = form.get('key')
    if (!file || typeof key !== 'string') return json(res, 400, { error: 'file and key are required' })
    const storageUri = await store.put(key, Buffer.from(await file.arrayBuffer()))
    return json(res, 200, { storageUri })
  }
  const { storageUri } = await request.json()
  if (route === 'delete') {
    await store.remove(storageUri)
    return json(res, 200, { ok: true })
  }
  if (route === 'readText') {
    const text = await store.readText(storageUri)
    if (text === null) return json(res, 404, { error: 'not found' })
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end(text)
  }
  if (route === 'getDownloadUrl') return json(res, 200, { fileUrl: store.downloadUrl(storageUri) })
  return json(res, 404, { error: 'unknown storage route' })
}

const handleFile = async (req, res, key) => {
  let file
  try {
    file = store.file(decodeURIComponent(key))
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size })
  } catch {
    return json(res, 404, { error: 'not found' })
  }
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

export const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost')
    if (logChecks && (pathname.startsWith('/hot-updater/fingerprint/') || pathname.startsWith('/files/'))) {
      console.log(`${new Date().toISOString()} ${req.method} ${pathname}`)
    }
    if (pathname.startsWith('/files/')) return await handleFile(req, res, pathname.slice('/files/'.length))
    if (pathname.startsWith('/storage/')) {
      if (!authorized(req.headers.authorization)) return json(res, 401, { error: 'unauthorized' })
      return await handleStorage(req, res, pathname.slice('/storage/'.length))
    }
    if (pathname.startsWith('/hot-updater/api/') && !authorized(req.headers.authorization)) {
      return json(res, 401, { error: 'unauthorized' })
    }
    if (pathname === '/hot-updater' || pathname.startsWith('/hot-updater/')) {
      return await send(res, await hotUpdater.handler(toWebRequest(req)))
    }
    return json(res, 404, { error: 'not found' })
  } catch (error) {
    console.error(`${req.method} ${req.url?.split('?')[0]}: ${error}`)
    if (!res.headersSent) json(res, 500, { error: 'internal error' })
  }
})

server.listen(port, () => console.log(`keyring-ota listening on :${port}, public URL ${process.env.OTA_PUBLIC_URL ?? '(unset)'}`))
