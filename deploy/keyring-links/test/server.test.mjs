import assert from 'node:assert/strict'
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

import { ID_RE, isInvitation, longInviteUrl, newId } from '../src/links.mjs'
import { createRateLimiter } from '../src/rateLimit.mjs'
import { createLinksServer } from '../src/server.mjs'

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const PUBLIC = 'https://wallet.example.org'

describe('links', () => {
  it('makes 22-character base64url ids, all different', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId))
    assert.equal(ids.size, 1000)
    for (const id of ids) assert.match(id, ID_RE)
  })

  it('accepts out-of-band invitations only', async () => {
    assert.equal(isInvitation(await fixture('invitation-v1.json')), true)
    assert.equal(isInvitation(await fixture('invitation-v2.json')), true)
    assert.equal(isInvitation({ '@type': 'https://didcomm.org/out-of-band/1.0/invitation' }), true)
    assert.equal(isInvitation({ '@type': 'https://didcomm.org/basicmessage/1.0/message' }), false)
    assert.equal(isInvitation({ type: 'https://didcomm.org/out-of-band/1.1/invitation' }), false)
    assert.equal(isInvitation([]), false)
    assert.equal(isInvitation(null), false)
    assert.equal(isInvitation('https://didcomm.org/out-of-band/1.1/invitation'), false)
  })

  it('builds the long link the install page reads', () => {
    const text = '{"@type":"https://didcomm.org/out-of-band/1.1/invitation"}'
    const url = new URL(longInviteUrl(`${PUBLIC}/`, text))
    assert.equal(url.origin + url.pathname, `${PUBLIC}/invite/`)
    assert.equal(Buffer.from(url.searchParams.get('oob'), 'base64url').toString('utf8'), text)
  })
})

describe('rate limiter', () => {
  it('allows a burst, then refills per minute, per client and globally', () => {
    let t = 0
    const limiter = createRateLimiter({ perMinute: 10, burst: 3, globalPerMinute: 5, now: () => t })
    assert.deepEqual([1, 2, 3, 4].map(() => limiter.allow('a')), [true, true, true, false])
    assert.equal(limiter.allow('b'), true)
    assert.equal(limiter.allow('b'), true)
    assert.equal(limiter.allow('c'), false, 'the global bucket is empty')
    t += 60_000
    assert.equal(limiter.allow('a'), true)
    t += 10 * 60_000
    limiter.prune()
    assert.equal(limiter.size(), 0, 'refilled buckets are forgotten')
  })
})

describe('server', () => {
  let dir
  let clock
  let links
  let base
  const listen = async (options = {}) => {
    links = createLinksServer({ publicUrl: PUBLIC, dataDir: dir, now: () => clock, ...options })
    await new Promise((resolve) => links.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${links.server.address().port}`
  }
  const close = () => new Promise((resolve) => links.server.close(resolve))
  const post = (body, headers = { 'content-type': 'application/json' }) =>
    fetch(`${base}/i`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const getJson = (url) => fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual' })
  const getHtml = (url) => fetch(url, { headers: { accept: 'text/html,*/*' }, redirect: 'manual' })
  const idOf = (url) => new URL(url).pathname.split('/').pop()

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'keyring-links-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  beforeEach(async () => {
    clock = Date.UTC(2026, 9, 21)
    for (const name of await readdir(dir)) await rm(path.join(dir, name), { force: true })
  })

  it('stores a v1 invitation and answers it as JSON, not consumed by fetching', async () => {
    await listen()
    try {
      const invitation = await fixture('invitation-v1.json')
      const created = await post({ invitation })
      assert.equal(created.status, 201)
      const { url, expiresAt } = await created.json()
      assert.match(url, /^https:\/\/wallet\.example\.org\/i\/[A-Za-z0-9_-]{22}$/)
      assert.equal(expiresAt, new Date(clock + 7 * 24 * 3600_000).toISOString())
      for (let i = 0; i < 3; i++) {
        const res = await getJson(`${base}/i/${idOf(url)}`)
        assert.equal(res.status, 200)
        assert.match(res.headers.get('content-type'), /^application\/json/)
        assert.equal(res.headers.get('cache-control'), 'no-store')
        assert.deepEqual(await res.json(), invitation)
      }
    } finally {
      await close()
    }
  })

  it('accepts a v2 invitation', async () => {
    await listen()
    try {
      const created = await post({ invitation: await fixture('invitation-v2.json') })
      assert.equal(created.status, 201)
    } finally {
      await close()
    }
  })

  it('sends a browser to the install page with the long link', async () => {
    await listen()
    try {
      const invitation = await fixture('invitation-v1.json')
      const { url } = await (await post({ invitation })).json()
      const res = await getHtml(`${base}/i/${idOf(url)}`)
      assert.equal(res.status, 302)
      const location = new URL(res.headers.get('location'))
      assert.equal(location.origin + location.pathname, `${PUBLIC}/invite/`)
      assert.deepEqual(JSON.parse(Buffer.from(location.searchParams.get('oob'), 'base64url').toString('utf8')), invitation)
    } finally {
      await close()
    }
  })

  it('answers HEAD without a body', async () => {
    await listen()
    try {
      const { url } = await (await post({ invitation: await fixture('invitation-v1.json') })).json()
      const res = await fetch(`${base}/i/${idOf(url)}`, { method: 'HEAD', headers: { accept: 'application/json' } })
      assert.equal(res.status, 200)
      assert.equal(await res.text(), '')
    } finally {
      await close()
    }
  })

  it('treats unknown, malformed and expired ids alike: 404', async () => {
    await listen()
    try {
      const unknown = await getJson(`${base}/i/${newId()}`)
      assert.equal(unknown.status, 404)
      assert.deepEqual(await unknown.json(), { error: 'not_found' })
      assert.equal((await getHtml(`${base}/i/not-an-id`)).status, 404)
      assert.equal((await getJson(`${base}/i/../../etc/passwd`)).status, 404)

      const { url } = await (await post({ invitation: await fixture('invitation-v1.json') })).json()
      clock += 7 * 24 * 3600_000
      const expired = await getJson(`${base}/i/${idOf(url)}`)
      assert.equal(expired.status, 404)
      assert.deepEqual(await expired.json(), { error: 'not_found' })
      assert.deepEqual(await readdir(dir), [], 'the expired file is gone')
    } finally {
      await close()
    }
  })

  it('refuses what is not a JSON out-of-band invitation', async () => {
    await listen()
    try {
      const wrongType = await post('{}', { 'content-type': 'text/plain' })
      assert.equal(wrongType.status, 415)
      assert.equal((await post('{not json')).status, 400)
      const notInvitation = await post({ invitation: { '@type': 'https://didcomm.org/basicmessage/1.0/message' } })
      assert.equal(notInvitation.status, 400)
      assert.deepEqual(await notInvitation.json(), { error: 'not_an_invitation' })
      assert.equal((await post(await fixture('invitation-v1.json'))).status, 400, 'the invitation must be wrapped')
      assert.deepEqual(await readdir(dir), [], 'nothing stored')
    } finally {
      await close()
    }
  })

  it('refuses a body over the size cap with 413', async () => {
    await listen({ maxBodyBytes: 2048 })
    try {
      const invitation = { ...(await fixture('invitation-v1.json')), label: 'x'.repeat(4096) }
      const res = await post({ invitation })
      assert.equal(res.status, 413)
      assert.deepEqual(await res.json(), { error: 'too_large' })
    } finally {
      await close()
    }
  })

  it('refuses an invitation whose long link would be too long, even under the body cap', async () => {
    await listen({ maxBodyBytes: 8192, maxInvitationBytes: 6000 })
    try {
      const big = { ...(await fixture('invitation-v1.json')), label: 'x'.repeat(6500) }
      const res = await post({ invitation: big })
      assert.equal(res.status, 413)
      assert.deepEqual(await res.json(), { error: 'too_large' })
      const justFits = { ...(await fixture('invitation-v1.json')) }
      justFits.label = 'x'.repeat(6000 - JSON.stringify({ ...justFits, label: '' }).length)
      const created = await post({ invitation: justFits })
      assert.equal(created.status, 201)
      const { url } = await created.json()
      const location = (await getHtml(`${base}/i/${idOf(url)}`)).headers.get('location')
      assert.ok(location.length < 8192, `long link is ${location.length} characters`)
    } finally {
      await close()
    }
  })

  it('sweeps expired links before refusing a full store', async () => {
    await listen({ maxLinks: 2 })
    try {
      const invitation = await fixture('invitation-v1.json')
      assert.equal((await post({ invitation })).status, 201)
      assert.equal((await post({ invitation })).status, 201)
      assert.equal((await post({ invitation })).status, 503, 'full of live links')
      clock += 7 * 24 * 3600_000
      assert.equal((await post({ invitation })).status, 201, 'the expired ones made room')
      assert.equal(await links.store.count(), 1)
    } finally {
      await close()
    }
  })

  it('counts the links already on disk at start', async () => {
    await listen()
    try {
      await post({ invitation: await fixture('invitation-v1.json') })
      await post({ invitation: await fixture('invitation-v2.json') })
    } finally {
      await close()
    }
    await listen()
    try {
      assert.equal(await links.store.count(), 2)
    } finally {
      await close()
    }
  })

  it('rate-limits POST per client, and answers 503 when the store is full', async () => {
    await listen({ burst: 2, perMinute: 1, maxLinks: 3 })
    try {
      const invitation = await fixture('invitation-v1.json')
      const ip = (n) => ({ 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${n}` })
      assert.equal((await post({ invitation }, ip(1))).status, 201)
      assert.equal((await post({ invitation }, ip(1))).status, 201)
      const limited = await post({ invitation }, ip(1))
      assert.equal(limited.status, 429)
      assert.deepEqual(await limited.json(), { error: 'rate_limited' })
      assert.equal((await post({ invitation }, ip(2))).status, 201, 'another client is not limited')
      const full = await post({ invitation }, ip(3))
      assert.equal(full.status, 503)
      assert.deepEqual(await full.json(), { error: 'store_full' })
    } finally {
      await close()
    }
  })

  it('stores only the invitation and its expiry', async () => {
    await listen()
    try {
      const invitation = await fixture('invitation-v1.json')
      const { url } = await (
        await post({ invitation }, { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' })
      ).json()
      const files = await readdir(dir)
      assert.deepEqual(files, [`${idOf(url)}.json`])
      const record = JSON.parse(await readFile(path.join(dir, files[0]), 'utf8'))
      assert.deepEqual(Object.keys(record).sort(), ['expiresAt', 'invitation'])
      assert.equal((await readFile(path.join(dir, files[0]), 'utf8')).includes('198.51.100.7'), false)
    } finally {
      await close()
    }
  })

  it('sweeps expired links', async () => {
    await listen()
    try {
      await post({ invitation: await fixture('invitation-v1.json') })
      clock += 3 * 24 * 3600_000
      await post({ invitation: await fixture('invitation-v2.json') })
      clock += 5 * 24 * 3600_000
      assert.equal(await links.store.sweep(), 1)
      assert.equal(await links.store.count(), 1)
    } finally {
      await close()
    }
  })

  it('answers the health check and refuses other routes and methods', async () => {
    await listen()
    try {
      assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok\n')
      assert.equal((await fetch(`${base}/i`)).status, 405)
      assert.equal((await fetch(`${base}/i/${newId()}`, { method: 'DELETE' })).status, 405)
      assert.equal((await fetch(`${base}/`)).status, 404)
    } finally {
      await close()
    }
  })
})
