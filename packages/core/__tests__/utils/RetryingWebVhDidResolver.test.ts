import { WebVhDidResolver } from '@credo-ts/webvh'

import { RetryingWebVhDidResolver, isMisdirected } from '../../src/utils/RetryingWebVhDidResolver'

const DID = 'did:webvh:QmZWzvvtjYuWm74Bdy2Z2dRPh95RhHn6TGtcN1h9zFbrUf:keyring-vti-bob.ngrok.app'
// Verbatim shape of the failure met on 2026-09-22.
const misdirected = {
  didDocument: null,
  didDocumentMetadata: {},
  didResolutionMetadata: {
    error: 'invalidDid',
    message: `resolver_error: Unable to resolve did '${DID}': HTTP error! status: 421`,
  },
}
const notFound = {
  didDocument: null,
  didDocumentMetadata: {},
  didResolutionMetadata: { error: 'notFound', message: `resolver_error: Unable to resolve did '${DID}': HTTP error! status: 404` },
}
const resolved = { didDocument: { id: DID }, didDocumentMetadata: {}, didResolutionMetadata: {} }
const agentContext = { config: { logger: { debug: jest.fn() } } } as never

describe('RetryingWebVhDidResolver', () => {
  afterEach(() => jest.restoreAllMocks())

  it('recognizes a 421 and nothing else', () => {
    expect(isMisdirected(misdirected as never)).toBe(true)
    expect(isMisdirected(notFound as never)).toBe(false)
    expect(isMisdirected(resolved as never)).toBe(false)
  })

  it('retries a misdirected resolution once and returns the retry', async () => {
    const spy = jest
      .spyOn(WebVhDidResolver.prototype, 'resolve')
      .mockResolvedValueOnce(misdirected as never)
      .mockResolvedValueOnce(resolved as never)
    const result = await new RetryingWebVhDidResolver().resolve(agentContext, DID)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(result.didDocument).toEqual({ id: DID })
  })

  it('does not retry other failures, and retries a 421 only once', async () => {
    const spy = jest.spyOn(WebVhDidResolver.prototype, 'resolve').mockResolvedValue(notFound as never)
    await new RetryingWebVhDidResolver().resolve(agentContext, DID)
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockReset().mockResolvedValue(misdirected as never)
    const result = await new RetryingWebVhDidResolver().resolve(agentContext, DID)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(isMisdirected(result)).toBe(true)
  })
})
