/**
 * A room host's HTTPS door. What a host may be sent there is sealed, but the door is still held to HTTPS: a DID
 * document naming anything else is refused before a byte leaves the phone.
 */
const mockResolve = jest.fn()
jest.mock('../../trust-tasks/module/VtiMediatorTransport', () => ({
  resolveDidDocumentRetrying: (...a: unknown[]) => mockResolve(...a),
}))
jest.mock('../../trust-tasks/module/oobSignIn', () => ({ TRUST_TASK_HTTPS: 'TrustTaskHTTPS' }))
jest.mock('../../trust-tasks/module/triggerLink', () => ({
  serviceEndpointOfType: (d: { base?: string }) => d.base,
}))

import type { Agent } from '@credo-ts/core'

import { createRoomDoors } from '../real/files/door'

const HOST = 'did:webvh:QmHost:lab.example:host'
const agent = {} as Agent
const hostAt = (base: string | undefined) => mockResolve.mockResolvedValue({ toJSON: () => ({ base }) })
const answer = (status: number, body: unknown, retryAfter?: string) => ({
  status,
  json: async () => body,
  headers: { get: (name: string) => (name === 'retry-after' ? (retryAfter ?? null) : null) },
})

const mockFetch = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = mockFetch as unknown as typeof fetch
  mockFetch.mockResolvedValue(answer(200, { version: '0.17.0' }))
})

describe('finding the door', () => {
  it('takes the HTTPS base and the host’s version from its health', async () => {
    hostAt('https://lab.example/v1')
    expect(await createRoomDoors(agent).hostDoor(HOST)).toEqual({ base: 'https://lab.example/v1', version: '0.17.0' })
    expect(mockFetch).toHaveBeenCalledWith('https://lab.example/health', expect.anything())
  })

  it.each(['http://lab.example/v1', 'ws://lab.example/v1', 'ftp://lab.example', 'https://'])(
    'refuses %s, and asks it nothing',
    async (base) => {
      hostAt(base)
      await expect(createRoomDoors(agent).hostDoor(HOST)).rejects.toThrow('not HTTPS')
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('a host with no door says so', async () => {
    hostAt(undefined)
    await expect(createRoomDoors(agent).hostDoor(HOST)).rejects.toThrow('names no TrustTaskHTTPS')
  })

  it('a health that cannot be read leaves the version unknown, the door still found', async () => {
    hostAt('https://lab.example/v1')
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    expect(await createRoomDoors(agent).hostDoor(HOST)).toEqual({ base: 'https://lab.example/v1' })
  })

  it('a host is looked up once, and again after it could not be reached', async () => {
    hostAt('https://lab.example/v1')
    mockResolve.mockRejectedValueOnce(new Error('unreachable'))
    const doors = createRoomDoors(agent)
    await expect(doors.hostDoor(HOST)).rejects.toThrow('unreachable')
    await doors.hostDoor(HOST)
    await doors.hostDoor(HOST)
    expect(mockResolve).toHaveBeenCalledTimes(2)
  })
})

describe('posting to the door', () => {
  const doors = () => createRoomDoors(agent)

  it('posts the document as JSON to the trust-tasks path', async () => {
    await doors().postToDoor('https://lab.example/v1/', { id: 'urn:uuid:1' })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://lab.example/v1/trust-tasks',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'urn:uuid:1' }) })
    )
  })

  it('never posts to a base that is not HTTPS', async () => {
    await expect(doors().postToDoor('http://lab.example/v1', { id: 'urn:uuid:1' })).rejects.toThrow('HTTPS')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('gives the host’s wait in seconds, and only in seconds', async () => {
    mockFetch.mockResolvedValueOnce(answer(429, {}, '7'))
    expect(await doors().postToDoor('https://lab.example/v1', {})).toMatchObject({ status: 429, retryAfterSeconds: 7 })
    mockFetch.mockResolvedValueOnce(answer(429, {}, 'Wed, 21 Oct 2026 07:28:00 GMT'))
    const dated = await doors().postToDoor('https://lab.example/v1', {})
    expect(dated).not.toHaveProperty('retryAfterSeconds')
  })

  it('a body that is not JSON comes back as no body', async () => {
    mockFetch.mockResolvedValueOnce({ ...answer(502, undefined), json: () => Promise.reject(new Error('html')) })
    expect(await doors().postToDoor('https://lab.example/v1', {})).toEqual({ status: 502, body: undefined })
  })

  it('a cancelled post says it was cancelled', async () => {
    const controller = new AbortController()
    mockFetch.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    await expect(doors().postToDoor('https://lab.example/v1', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
