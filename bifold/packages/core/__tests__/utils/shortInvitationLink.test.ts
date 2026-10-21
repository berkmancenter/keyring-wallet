/**
 * The short invitation link: the sender stores the invitation on our links
 * service (POST /i) and shares /i/<id>; the receiver's Credo fetches it back
 * (parseInvitationShortUrl, Accept: application/json). Against a fake of the
 * service's contract (keyring-wallet deploy/keyring-links/README.md), and with
 * the service down or refusing: then the long link is shared, as before.
 */
import { DidCommOutOfBandInvitation, parseInvitationShortUrl } from '@credo-ts/didcomm'

import { isShortInvitationLink, LINKS_ORIGIN, shortenInvitation } from '../../src/utils/shortInvitationLink'
import { deepLinkCarriesInvitation } from '../../src/utils/invitationLink'

const OOB_V1 = 'https://didcomm.org/out-of-band/1.1/invitation'

type FakeResponse = {
  ok: boolean
  status: number
  url: string
  headers: { get: (name: string) => string | null }
  json: () => Promise<unknown>
}
const respond = (url: string, status: number, body?: unknown, headers: Record<string, string> = {}): FakeResponse => {
  const h: Record<string, string> = {
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => h[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

/** The links service's contract, in memory. `refuse` answers every POST with that status instead. */
function fakeLinksService(origin = LINKS_ORIGIN, refuse?: number) {
  const store = new Map<string, unknown>()
  const posted: { body: string; headers: Record<string, string> }[] = []
  const fetch = jest.fn(
    async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
      const { pathname } = new URL(url)
      const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
      if ((init.method ?? 'GET') === 'POST' && (pathname === '/i' || pathname === '/i/')) {
        posted.push({ body: init.body ?? '', headers })
        if (refuse) return respond(url, refuse, { error: 'refused' })
        if (!headers['content-type']?.startsWith('application/json'))
          return respond(url, 415, { error: 'unsupported_media_type' })
        const invitation = (JSON.parse(init.body ?? '{}') as { invitation?: Record<string, unknown> }).invitation
        if (invitation?.['@type'] !== OOB_V1) return respond(url, 400, { error: 'not_an_invitation' })
        const id = `id${String(store.size).padStart(20, '0')}`
        store.set(id, invitation)
        return respond(url, 201, { url: `${origin}/i/${id}`, expiresAt: '2026-10-28T00:00:00Z' })
      }
      const id = /^\/i\/([A-Za-z0-9_-]+)$/.exec(pathname)?.[1]
      if (id && store.has(id)) {
        if (headers.accept?.includes('application/json')) return respond(url, 200, store.get(id))
        return respond(url, 302, undefined, { Location: `${origin}/invite/?oob=x` })
      }
      return respond(url, 404, { error: 'not_found' })
    }
  )
  return { fetch, store, posted }
}

const invitation = () =>
  new DidCommOutOfBandInvitation({
    label: 'AL Wallet',
    goalCode: 'relationship.credential.bidirectional',
    handshakeProtocols: ['https://didcomm.org/didexchange/1.1' as never],
    services: [
      'did:peer:2.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECxJ2MwFTFGB.Vz6MkqRYqQiSgvZQdnBytw86Qbs2ZWUkGv22od935YF4s8M7V',
    ],
  })

describe('the short invitation link', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  test('round trip: stored by the sender, fetched back by the receiver as the same invitation', async () => {
    const service = fakeLinksService()
    const sent = invitation()
    const short = await shortenInvitation(sent.toJSON(), { fetch: service.fetch as never })
    expect(short).toMatch(new RegExp(`^${LINKS_ORIGIN.replace(/\./g, '\\.')}/i/[A-Za-z0-9_-]{16,}$`))
    expect(short!.length).toBeLessThan(70)
    expect(isShortInvitationLink(short!)).toBe(true)
    expect(deepLinkCarriesInvitation(short!)).toBe(true)
    // What the receiver's Credo does with it, as is.
    const received = await parseInvitationShortUrl(short!, { fetch: service.fetch } as never)
    expect(received.toJSON()).toEqual(sent.toJSON())
    // It asked for JSON, as the service's contract needs.
    const get = service.fetch.mock.calls.find(([, init]) => (init?.method ?? 'GET') === 'GET')
    expect(get?.[1]?.headers).toEqual(expect.objectContaining({ Accept: 'application/json' }))
  })

  test.each([
    ['the service is unreachable', 'throw'],
    ['the host has no /i yet (404)', 404],
    ['too large (413)', 413],
    ['rate-limited (429)', 429],
    ['store full (503)', 503],
    ['refused as not an invitation (400)', 400],
  ] as const)('%s: no short link, so the long one is shared', async (_why, outcome) => {
    const service = fakeLinksService(LINKS_ORIGIN, outcome === 'throw' ? undefined : outcome)
    const fetch =
      outcome === 'throw'
        ? jest.fn(async () => {
            throw new Error('Network request failed')
          })
        : service.fetch
    expect(await shortenInvitation(invitation().toJSON(), { fetch: fetch as never })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\[VRC\] short link: not made/))
  })

  test('a service that never answers is given up on, and the long link is shared', async () => {
    const fetch = jest.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    )
    expect(await shortenInvitation(invitation().toJSON(), { fetch: fetch as never, timeoutMs: 20 })).toBeUndefined()
  })

  test('a 201 naming a link that is not ours is not shared', async () => {
    const service = fakeLinksService('https://elsewhere.example')
    expect(await shortenInvitation(invitation().toJSON(), { fetch: service.fetch as never })).toBeUndefined()
  })

  test('what it sends is the invitation as JSON, and the log carries no part of it', async () => {
    const service = fakeLinksService()
    const sent = invitation()
    const short = await shortenInvitation(sent.toJSON(), { fetch: service.fetch as never })
    expect(service.posted).toHaveLength(1)
    expect(service.posted[0].headers['content-type']).toMatch(/^application\/json/)
    expect(JSON.parse(service.posted[0].body)).toEqual({ invitation: sent.toJSON() })
    for (const [line] of warn.mock.calls) {
      expect(String(line)).not.toContain(short!.slice(-10))
      expect(String(line)).not.toContain('AL Wallet')
    }
  })

  test.each([
    ['https://wallet.asml.berkmancenter.org/invite', false],
    ['https://wallet.asml.berkmancenter.org/i/', false],
    ['https://wallet.asml.berkmancenter.org/i/abc', false],
    ['https://elsewhere.example/i/AAAAAAAAAAAAAAAAAAAAAA', false],
    ['keyring://messages', false],
  ])('not a short invitation link: %s', (link, expected) => {
    expect(isShortInvitationLink(link)).toBe(expected)
    expect(deepLinkCarriesInvitation(link)).toBe(false)
  })

  test('the long links still carry an invitation for the router', () => {
    expect(deepLinkCarriesInvitation(invitation().toUrl({ domain: `${LINKS_ORIGIN}/invite` }))).toBe(true)
    expect(deepLinkCarriesInvitation('https://x.example/?c_i=e30')).toBe(true)
    expect(deepLinkCarriesInvitation('https://x.example/?d_m=e30')).toBe(true)
    expect(deepLinkCarriesInvitation('https://x.example/?url=https%3A%2F%2Fy')).toBe(true)
  })
})
