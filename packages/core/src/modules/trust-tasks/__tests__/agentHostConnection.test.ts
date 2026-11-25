/**
 * An agent host's automatic connection (vtafarm-api docs/mobile-connection-app-api.md,
 * at d2cc4100): the QR, the three calls, and every error in the doc's tables,
 * against a mock server. The host's own words are never shown or logged; what
 * the phone does about each answer is.
 */
import {
  AgentHostConnectionError,
  connectWithAgentHost,
  parseAgentHostQr,
  reportConnected,
  submitAdminDid,
  waitUntilAgentReady,
  type HostConnectionAccepted,
} from '../module/agentHostConnection'

const VTA = 'did:webvh:QmXo:dids.ic3.dev:keyring-runner-vta'
const CALLBACK = 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/callback/6f7c7198-ab23.SECRETCALLBACKTOKEN'
const PROGRESS = 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/6f7c7198-ab23'
const COMPLETE = `${PROGRESS}/complete`
const ADMIN = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const TOKEN = 'SECRETPROGRESSTOKEN'

const qr = (value: Record<string, unknown>) => JSON.stringify(value)

describe('the QR', () => {
  it('is JSON with exactly vta_did and callback_url', () => {
    expect(parseAgentHostQr(qr({ vta_did: VTA, callback_url: CALLBACK }))).toEqual({
      vtaDid: VTA,
      callbackUrl: CALLBACK,
      host: 'vtafarm-api.ic3.dev',
    })
  })

  it('takes the callback exactly as given, surrounding whitespace of the scan aside', () => {
    expect(parseAgentHostQr(`  ${qr({ vta_did: VTA, callback_url: CALLBACK })}\n`)?.callbackUrl).toBe(CALLBACK)
  })

  it('accepts firstperson.dev as well as ic3.dev', () => {
    const url = 'https://vtafarm-api.dev-dids.firstperson.dev/api/v1/mobile-connections/callback/x.y'
    expect(parseAgentHostQr(qr({ vta_did: VTA, callback_url: url }))?.host).toBe('vtafarm-api.dev-dids.firstperson.dev')
  })

  it.each([
    ['not JSON', 'did:webvh:QmXo:dids.ic3.dev:x'],
    ['a JSON array', '[1,2]'],
    ['a missing callback', qr({ vta_did: VTA })],
    ['a missing agent', qr({ callback_url: CALLBACK })],
    ['an extra member', qr({ vta_did: VTA, callback_url: CALLBACK, admin_did: ADMIN })],
    ['an agent that is not a did:webvh', qr({ vta_did: 'did:key:z6Mk', callback_url: CALLBACK })],
    ['a callback that is not a string', qr({ vta_did: VTA, callback_url: 7 })],
  ])('is not one with %s', (_name, text) => {
    expect(parseAgentHostQr(text)).toBeUndefined()
  })

  it.each([
    ['plain http', 'http://vtafarm-api.ic3.dev/api/v1/mobile-connections/callback/x'],
    ['another site', 'https://vtafarm-api.example.com/api/v1/mobile-connections/callback/x'],
    ['a look-alike ending', 'https://vtafarm-api.evilic3.dev/cb/x'],
    ['the allowed name as a prefix', 'https://ic3.dev.example.com/cb/x'],
    ['a user part', 'https://ic3.dev@example.com/cb/x'],
    ['an explicit port', 'https://vtafarm-api.ic3.dev:8443/cb/x'],
    ['not a URL', 'callback'],
  ])('is refused, never called, with %s', (_name, url) => {
    expect(() => parseAgentHostQr(qr({ vta_did: VTA, callback_url: url }))).toThrow(
      expect.objectContaining({ reason: 'hostNotAllowed' })
    )
  })
})

/** A mock agent host: answers by URL, in order, and records what it was sent. */
function mockHost(routes: Record<string, Array<{ status: number; body?: unknown } | Error>>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = []
  const fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined,
    })
    const queue = routes[url]
    if (!queue?.length) throw new Error(`no answer queued for a call`)
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    if (next instanceof Error) throw next
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: async () => next.body,
    } as unknown as Response
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const accepted = {
  connection: { request_id: '6f7c7198-ab23', status: 'provisioning', vta_did: VTA, expires_at: '2026-10-01T22:05:00Z' },
  server_time: '2026-10-01T22:00:10Z',
  progress_token: TOKEN,
  progress_url: PROGRESS,
  completion_url: COMPLETE,
  progress_expires_at: '2026-10-01T23:00:10Z',
}
const progress = (status: string, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    server_time: '2026-10-01T22:01:30Z',
    connection: { request_id: '6f7c7198-ab23', status, vta_did: VTA, ...extra },
  },
})
const noSleep = { sleep: async () => undefined }
const offer = { vtaDid: VTA, callbackUrl: CALLBACK, host: 'vtafarm-api.ic3.dev' }

describe('1. submitting the phone’s key', () => {
  it('POSTs exactly { admin_did } as JSON to the callback as given, and keeps what comes back', async () => {
    const host = mockHost({ [CALLBACK]: [{ status: 202, body: accepted }] })
    const result = await submitAdminDid(offer, ADMIN, { fetch: host.fetch, ...noSleep })
    expect(host.calls).toHaveLength(1)
    expect(host.calls[0]).toMatchObject({ url: CALLBACK, method: 'POST' })
    expect(host.calls[0].headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(host.calls[0].body!)).toEqual({ admin_did: ADMIN })
    expect(result).toEqual({
      requestId: '6f7c7198-ab23',
      status: 'provisioning',
      progressToken: TOKEN,
      progressUrl: PROGRESS,
      completionUrl: COMPLETE,
      progressExpiresAt: '2026-10-01T23:00:10Z',
    })
  })

  it.each([
    [400, { error: 'admin_did must be a valid Ed25519 did:key', reason: 'invalid_admin_did' }, 'badKey'],
    [400, { error: 'Invalid connection request body.' }, 'badRequest'],
    [404, { error: 'Connection not found.' }, 'expired'],
    [409, { error: 'connection already claimed or VTA not ready', reason: 'connection_conflict' }, 'taken'],
    [
      410,
      { error: 'connection request expired or cancelled; scan a new QR code', reason: 'connection_expired' },
      'expired',
    ],
    [503, { error: 'Automatic mobile connection is not available.' }, 'unavailable'],
  ])('a %i (%j) stops at once: %s', async (status, body, reason) => {
    const host = mockHost({ [CALLBACK]: [{ status, body }] })
    await expect(submitAdminDid(offer, ADMIN, { fetch: host.fetch, ...noSleep })).rejects.toMatchObject({ reason })
    expect(host.calls).toHaveLength(1)
  })

  it.each([429, 500])('a %i is retried with backoff, and the same key goes again', async (status) => {
    const sleeps: number[] = []
    const host = mockHost({
      [CALLBACK]: [
        { status, body: { error: 'x' } },
        { status, body: { error: 'x' } },
        { status: 202, body: accepted },
      ],
    })
    const result = await submitAdminDid(offer, ADMIN, { fetch: host.fetch, sleep: async (ms) => void sleeps.push(ms) })
    expect(result.progressToken).toBe(TOKEN)
    expect(host.calls.map((c) => JSON.parse(c.body!))).toEqual([
      { admin_did: ADMIN },
      { admin_did: ADMIN },
      { admin_did: ADMIN },
    ])
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]).toBeGreaterThan(sleeps[0])
  })

  it('a 500 that persists ends as busy', async () => {
    const host = mockHost({ [CALLBACK]: [{ status: 500, body: { reason: 'connection_unavailable' } }] })
    await expect(submitAdminDid(offer, ADMIN, { fetch: host.fetch, ...noSleep })).rejects.toMatchObject({
      reason: 'busy',
    })
    expect(host.calls.length).toBeGreaterThan(1)
  })

  it('a lost answer is retried with the same key (the host acknowledges a duplicate)', async () => {
    const host = mockHost({ [CALLBACK]: [new TypeError('Network request failed'), { status: 202, body: accepted }] })
    const result = await submitAdminDid(offer, ADMIN, { fetch: host.fetch, ...noSleep })
    expect(result.requestId).toBe('6f7c7198-ab23')
  })

  it('progress and completion addresses on another site are refused, so the token never leaves for one', async () => {
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: { ...accepted, progress_url: 'https://elsewhere.example.com/p' } }],
    })
    await expect(submitAdminDid(offer, ADMIN, { fetch: host.fetch, ...noSleep })).rejects.toMatchObject({
      reason: 'hostNotAllowed',
    })
  })

  it('an accepted answer without a progress token cannot be followed', async () => {
    const { progress_token: _omit, ...withoutToken } = accepted
    const host = mockHost({ [CALLBACK]: [{ status: 202, body: withoutToken }] })
    await expect(submitAdminDid(offer, ADMIN, { fetch: host.fetch, ...noSleep })).rejects.toMatchObject({
      reason: 'badAnswer',
    })
  })
})

const acceptedRequest: HostConnectionAccepted = {
  requestId: '6f7c7198-ab23',
  status: 'provisioning',
  progressToken: TOKEN,
  progressUrl: PROGRESS,
  completionUrl: COMPLETE,
  progressExpiresAt: '2026-10-01T23:00:10Z',
}

describe('2. waiting for the agent', () => {
  it('tells the caller each status the host reports, for the screen to name', async () => {
    const statuses: string[] = []
    const host = mockHost({
      [PROGRESS]: [progress('provisioning'), progress('provisioning'), progress('awaiting_mobile')],
    })
    await waitUntilAgentReady(acceptedRequest, {
      fetch: host.fetch,
      ...noSleep,
      onStatus: (s) => void statuses.push(s),
    })
    expect(statuses).toEqual(['provisioning', 'provisioning', 'awaiting_mobile'])
  })

  it('polls about every three seconds with the bearer token until awaiting_mobile', async () => {
    const sleeps: number[] = []
    const host = mockHost({
      [PROGRESS]: [progress('provisioning'), progress('provisioning'), progress('awaiting_mobile')],
    })
    await waitUntilAgentReady(acceptedRequest, { fetch: host.fetch, sleep: async (ms) => void sleeps.push(ms) })
    expect(host.calls).toHaveLength(3)
    expect(host.calls.every((c) => c.method === 'GET' && c.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true)
    expect(sleeps).toEqual([3000, 3000])
  })

  it('connected already is ready too (a retried phone after the host recorded it)', async () => {
    const host = mockHost({ [PROGRESS]: [progress('connected')] })
    await expect(waitUntilAgentReady(acceptedRequest, { fetch: host.fetch, ...noSleep })).resolves.toBe('connected')
  })

  it('failed stops, carrying the host’s safe error as detail only', async () => {
    const host = mockHost({ [PROGRESS]: [progress('failed', { error: 'VTA deployment failed' })] })
    await expect(waitUntilAgentReady(acceptedRequest, { fetch: host.fetch, ...noSleep })).rejects.toMatchObject({
      reason: 'setupFailed',
      hostError: 'VTA deployment failed',
    })
  })

  it.each([
    [401, { error: 'Invalid mobile progress credential.' }, 'notAccepted'],
    [404, { error: 'Connection or VTA not found.', reason: 'connection_not_found' }, 'gone'],
    [410, { error: 'expired', reason: 'connection_expired' }, 'timedOut'],
  ])('a %i stops: %s', async (status, body, reason) => {
    const host = mockHost({ [PROGRESS]: [{ status, body }] })
    await expect(waitUntilAgentReady(acceptedRequest, { fetch: host.fetch, ...noSleep })).rejects.toMatchObject({
      reason,
    })
    expect(host.calls).toHaveLength(1)
  })

  it.each([429, 500])('a %i polls again, backing off', async (status) => {
    const sleeps: number[] = []
    const host = mockHost({ [PROGRESS]: [{ status, body: {} }, progress('awaiting_mobile')] })
    await waitUntilAgentReady(acceptedRequest, { fetch: host.fetch, sleep: async (ms) => void sleeps.push(ms) })
    expect(sleeps[0]).toBeGreaterThan(3000)
  })

  it('stops at the progress expiry rather than polling forever', async () => {
    let clock = Date.parse('2026-10-01T22:59:55Z')
    const host = mockHost({ [PROGRESS]: [progress('provisioning')] })
    await expect(
      waitUntilAgentReady(acceptedRequest, {
        fetch: host.fetch,
        now: () => clock,
        sleep: async (ms) => void (clock += ms),
      })
    ).rejects.toMatchObject({ reason: 'timedOut' })
  })

  it('stops when told to, without another call', async () => {
    let stop = false
    const host = mockHost({ [PROGRESS]: [progress('provisioning')] })
    const waiting = waitUntilAgentReady(acceptedRequest, {
      fetch: host.fetch,
      sleep: async () => void (stop = true),
      shouldStop: () => stop,
    })
    await expect(waiting).rejects.toMatchObject({ reason: 'cancelled' })
    expect(host.calls).toHaveLength(1)
  })
})

describe('3. reporting the phone connected', () => {
  it('POSTs { status: "connected" } with the bearer token', async () => {
    const host = mockHost({ [COMPLETE]: [progress('connected')] })
    await reportConnected(acceptedRequest, { fetch: host.fetch, ...noSleep })
    expect(host.calls[0]).toMatchObject({ url: COMPLETE, method: 'POST' })
    expect(host.calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(host.calls[0].body!)).toEqual({ status: 'connected' })
  })

  it.each([429, 500])('a %i is retried (completion is safe to repeat)', async (status) => {
    const host = mockHost({ [COMPLETE]: [{ status, body: {} }, progress('connected')] })
    await reportConnected(acceptedRequest, { fetch: host.fetch, ...noSleep })
    expect(host.calls).toHaveLength(2)
  })

  it('a 409 (agent not running yet) is retried after a wait, as the doc says to keep polling', async () => {
    const host = mockHost({
      [COMPLETE]: [{ status: 409, body: { reason: 'connection_conflict' } }, progress('connected')],
    })
    await reportConnected(acceptedRequest, { fetch: host.fetch, ...noSleep })
    expect(host.calls).toHaveLength(2)
  })

  it.each([
    [400, 'badRequest'],
    [401, 'notAccepted'],
    [404, 'gone'],
    [410, 'timedOut'],
  ])('a %i stops: %s', async (status, reason) => {
    const host = mockHost({ [COMPLETE]: [{ status, body: {} }] })
    await expect(reportConnected(acceptedRequest, { fetch: host.fetch, ...noSleep })).rejects.toMatchObject({
      reason,
    })
  })
})

describe('the whole connection', () => {
  it('submits, waits, links through the given step, then reports connected — in that order', async () => {
    const order: string[] = []
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [progress('provisioning'), progress('awaiting_mobile')],
      [COMPLETE]: [progress('connected')],
    })
    await connectWithAgentHost(offer, {
      fetch: host.fetch,
      ...noSleep,
      adminDid: async () => (order.push('key'), ADMIN),
      onAccepted: () => void order.push('accepted'),
      link: async () => void order.push('link'),
    })
    expect(order).toEqual(['key', 'accepted', 'link'])
    expect(
      host.calls.map(
        (c) => `${c.method} ${c.url === CALLBACK ? 'callback' : c.url === COMPLETE ? 'complete' : 'progress'}`
      )
    ).toEqual(['POST callback', 'GET progress', 'GET progress', 'POST complete'])
  })

  it('a link that fails is never reported connected', async () => {
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [progress('awaiting_mobile')],
      [COMPLETE]: [progress('connected')],
    })
    await expect(
      connectWithAgentHost(offer, {
        fetch: host.fetch,
        ...noSleep,
        adminDid: async () => ADMIN,
        link: async () => {
          throw new Error('signing in failed')
        },
      })
    ).rejects.toThrow('signing in failed')
    expect(host.calls.some((c) => c.url === COMPLETE)).toBe(false)
  })

  it('a completion report that fails leaves the phone linked: it is a report, not the link', async () => {
    const warn = jest.fn()
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [progress('awaiting_mobile')],
      [COMPLETE]: [{ status: 410, body: {} }],
    })
    await expect(
      connectWithAgentHost(offer, {
        fetch: host.fetch,
        ...noSleep,
        adminDid: async () => ADMIN,
        link: async () => undefined,
        warn,
      })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('never in a log or an error', () => {
  it('neither the callback nor the progress token appears in any error or warning', async () => {
    const seen: string[] = []
    const collect = (e: unknown) => {
      const error = e as AgentHostConnectionError
      seen.push(String(error.message), JSON.stringify(error))
    }
    for (const status of [400, 404, 409, 410, 429, 500, 503]) {
      const host = mockHost({ [CALLBACK]: [{ status, body: { error: `echo ${CALLBACK} ${TOKEN}` } }] })
      await submitAdminDid(offer, ADMIN, { fetch: host.fetch, ...noSleep }).catch(collect)
    }
    for (const status of [401, 404, 410]) {
      const host = mockHost({ [PROGRESS]: [{ status, body: { error: `echo ${TOKEN}` } }] })
      await waitUntilAgentReady(acceptedRequest, { fetch: host.fetch, ...noSleep }).catch(collect)
    }
    const warn = jest.fn()
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [progress('awaiting_mobile')],
      [COMPLETE]: [{ status: 401, body: { error: TOKEN } }],
    })
    await connectWithAgentHost(offer, {
      fetch: host.fetch,
      ...noSleep,
      adminDid: async () => ADMIN,
      link: async () => undefined,
      warn,
    })
    seen.push(JSON.stringify(warn.mock.calls))
    const all = seen.join('\n')
    expect(all).not.toContain('SECRETCALLBACKTOKEN')
    expect(all).not.toContain(TOKEN)
    expect(all).not.toContain('mobile-connections')
  })
})
