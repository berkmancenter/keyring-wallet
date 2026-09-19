import { gzip } from 'pako'

import {
  bitAt,
  checkStatusEntry,
  decodeEncodedList,
  guardStatusListUrl,
  statusEntryOf,
} from '../../../src/modules/trust-tasks/module/vtiStatusList'

jest.mock('@bifold/trust-tasks', () => ({
  verifyDocumentProof: jest.fn(async () => true),
}))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyDocumentProof } = require('@bifold/trust-tasks')

const ISSUER = 'did:webvh:community.example'

/** A list of `bits` bits with the given indices set, encoded as issuers write it. */
const encodeList = (bits: number, set: number[] = []): string => {
  const bytes = new Uint8Array(bits / 8)
  for (const i of set) bytes[i >>> 3] |= 0x80 >>> (i & 7)
  const gz = gzip(bytes)
  let binary = ''
  for (const b of gz) binary += String.fromCharCode(b)
  return `u${globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

const listCredential = (encodedList: string, overrides: Record<string, unknown> = {}) => ({
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'BitstringStatusListCredential'],
  issuer: ISSUER,
  credentialSubject: { type: 'BitstringStatusList', statusPurpose: 'revocation', encodedList },
  proof: { type: 'DataIntegrityProof' },
  ...overrides,
})

const serving = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  jest.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch

const agent = {} as never

describe('guardStatusListUrl', () => {
  it('accepts a public HTTPS URL', () => {
    expect(guardStatusListUrl('https://community.example/v1/status-lists/revocation')).toBeUndefined()
  })

  it.each([
    ['http://community.example/l', 'plain HTTP'],
    ['https://user:pw@community.example/l', 'userinfo'],
    ['https://127.0.0.1/l', 'loopback'],
    ['https://10.1.2.3/l', 'private range'],
    ['https://192.168.0.9/l', 'private range'],
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['https://[::1]/l', 'IPv6 loopback'],
    ['ftp://community.example/l', 'unsupported scheme'],
    ['not a url', 'unparseable'],
  ])('rejects %s (%s)', (url) => {
    expect(guardStatusListUrl(url)).toBeDefined()
  })

  it('allows plain HTTP to a local address only when the caller opts in', () => {
    expect(guardStatusListUrl('http://10.0.2.2:8080/l', true)).toBeUndefined()
    expect(guardStatusListUrl('http://10.0.2.2:8080/l')).toBeDefined()
    // The opt-in is for the local fixture, not a licence to fetch anything over HTTP.
    expect(guardStatusListUrl('http://community.example/l', true)).toBeDefined()
  })
})

describe('statusEntryOf', () => {
  it('reads a single entry, with a string index', () => {
    expect(
      statusEntryOf({
        credentialStatus: { statusListCredential: 'https://c.example/l', statusListIndex: '42' },
      })
    ).toEqual({ url: 'https://c.example/l', index: 42, purpose: 'revocation' })
  })

  it('picks the entry matching the purpose when several are carried', () => {
    const credential = {
      credentialStatus: [
        { statusPurpose: 'suspension', statusListCredential: 'https://c.example/s', statusListIndex: 1 },
        { statusPurpose: 'revocation', statusListCredential: 'https://c.example/r', statusListIndex: 2 },
      ],
    }
    expect(statusEntryOf(credential)).toMatchObject({ url: 'https://c.example/r', index: 2 })
    expect(statusEntryOf(credential, 'suspension')).toMatchObject({ url: 'https://c.example/s', index: 1 })
  })

  it('distinguishes absent from unreadable', () => {
    expect(statusEntryOf({})).toBeUndefined()
    expect(statusEntryOf({ credentialStatus: { statusListIndex: 3 } })).toBe('malformed')
    expect(statusEntryOf({ credentialStatus: { statusListCredential: 'https://c/l' } })).toBe('malformed')
  })
})

describe('decodeEncodedList', () => {
  it('round-trips a multibase-prefixed GZIP bitstring', () => {
    const bits = decodeEncodedList(encodeList(1024))
    expect(bits).toBeInstanceOf(Uint8Array)
    expect((bits as Uint8Array).length).toBe(128)
  })

  it('accepts a bare base64url string without the multibase prefix', () => {
    const prefixed = encodeList(1024)
    expect(decodeEncodedList(prefixed.slice(1))).toBeInstanceOf(Uint8Array)
  })

  it('reports rather than throws on garbage', () => {
    expect(typeof decodeEncodedList('')).toBe('string')
    expect(typeof decodeEncodedList('u!!!!')).toBe('string')
    expect(typeof decodeEncodedList('uAAAA')).toBe('string')
  })
})

describe('bitAt', () => {
  it('counts from the most significant bit of each byte', () => {
    // 0b1000_0001 → index 0 and index 7 set, nothing between.
    const bits = Uint8Array.from([0x81, 0x00])
    expect(bitAt(bits, 0)).toBe(true)
    expect(bitAt(bits, 7)).toBe(true)
    for (const i of [1, 2, 3, 4, 5, 6, 8, 15]) expect(bitAt(bits, i)).toBe(false)
  })

  it('crosses byte boundaries', () => {
    const bits = Uint8Array.from([0x00, 0x80])
    expect(bitAt(bits, 8)).toBe(true)
    expect(bitAt(bits, 7)).toBe(false)
  })

  it('reports an index past the end rather than reading undefined', () => {
    expect(typeof bitAt(Uint8Array.from([0x00]), 8)).toBe('string')
  })
})

describe('checkStatusEntry', () => {
  const entry = { url: 'https://community.example/l', index: 9, purpose: 'revocation' }

  beforeEach(() => (verifyDocumentProof as jest.Mock).mockResolvedValue(true))

  it('reads a clear bit as ok', async () => {
    const fetchImpl = serving(listCredential(encodeList(1024)))
    await expect(checkStatusEntry(agent, entry, ISSUER, { fetchImpl })).resolves.toMatchObject({
      state: 'ok',
      index: 9,
    })
  })

  it('reads a set bit as revoked', async () => {
    const fetchImpl = serving(listCredential(encodeList(1024, [9])))
    await expect(checkStatusEntry(agent, entry, ISSUER, { fetchImpl })).resolves.toMatchObject({ state: 'revoked' })
  })

  it('reads only the nominated index', async () => {
    const fetchImpl = serving(listCredential(encodeList(1024, [8, 10])))
    await expect(checkStatusEntry(agent, entry, ISSUER, { fetchImpl })).resolves.toMatchObject({ state: 'ok' })
  })

  it('refuses a list signed by anyone but the credential issuer', async () => {
    const fetchImpl = serving(listCredential(encodeList(1024, [9]), { issuer: 'did:webvh:someone.else' }))
    const result = await checkStatusEntry(agent, entry, ISSUER, { fetchImpl })
    expect(result.state).toBe('unknown')
    // A forged list must not be able to state a revocation OR conceal one.
    expect(result).toMatchObject({ reason: expect.stringContaining('is not the credential') })
  })

  it('refuses a list whose signature does not verify', async () => {
    ;(verifyDocumentProof as jest.Mock).mockResolvedValue(false)
    const fetchImpl = serving(listCredential(encodeList(1024)))
    await expect(checkStatusEntry(agent, entry, ISSUER, { fetchImpl })).resolves.toMatchObject({
      state: 'unknown',
      reason: expect.stringContaining('signature'),
    })
  })

  it('never reads a bit before the signature is checked', async () => {
    const order: string[] = []
    ;(verifyDocumentProof as jest.Mock).mockImplementation(async () => {
      order.push('verify')
      return true
    })
    const body = listCredential(encodeList(1024, [9]))
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        order.push('fetch')
        return JSON.stringify(body)
      },
    })) as unknown as typeof fetch
    await checkStatusEntry(agent, entry, ISSUER, { fetchImpl })
    expect(order).toEqual(['fetch', 'verify'])
  })

  it('refuses a list published for a different purpose', async () => {
    const body = listCredential(encodeList(1024))
    ;(body.credentialSubject as Record<string, unknown>).statusPurpose = 'suspension'
    const fetchImpl = serving(body)
    await expect(checkStatusEntry(agent, entry, ISSUER, { fetchImpl })).resolves.toMatchObject({
      state: 'unknown',
      reason: expect.stringContaining('suspension'),
    })
  })

  it('reports an index past the end of the list', async () => {
    const fetchImpl = serving(listCredential(encodeList(64)))
    await expect(
      checkStatusEntry(agent, { ...entry, index: 1_000 }, ISSUER, { fetchImpl })
    ).resolves.toMatchObject({ state: 'unknown', reason: expect.stringContaining('exceeds') })
  })

  it('calls an unreachable list unknown, never revoked', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    await expect(checkStatusEntry(agent, entry, ISSUER, { fetchImpl })).resolves.toMatchObject({ state: 'unknown' })
  })

  it('calls a non-200 unknown', async () => {
    const fetchImpl = serving({}, { ok: false, status: 503 })
    await expect(checkStatusEntry(agent, entry, ISSUER, { fetchImpl })).resolves.toMatchObject({
      state: 'unknown',
      reason: expect.stringContaining('503'),
    })
  })

  it('never follows a redirect off the guarded host', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{}' })) as unknown as typeof fetch
    await checkStatusEntry(agent, entry, ISSUER, { fetchImpl })
    expect((fetchImpl as jest.Mock).mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })

  it('rejects the URL before dialling it', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch
    const result = await checkStatusEntry(agent, { ...entry, url: 'http://127.0.0.1/l' }, ISSUER, { fetchImpl })
    expect(result.state).toBe('unknown')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
