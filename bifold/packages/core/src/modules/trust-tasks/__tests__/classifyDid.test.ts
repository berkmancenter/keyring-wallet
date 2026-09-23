import { bareDid, classifyDid, classifyDidDocument } from '../module/classifyDid'

/** The services the VTA Farm publishes, as read on 2026-09-23. */
const RUNNER_VTA = {
  id: 'did:webvh:QmS4:dids.ic3.dev:keyring-runner-vta',
  service: [{ type: 'TSPTransport' }, { type: 'DIDCommMessaging' }, { type: 'VTARest' }],
}
const TEST_COMMUNITY = {
  id: 'did:webvh:Qmde:dids-keyring-stack.ic3.dev:keyring-test-vtc',
  service: [{ type: 'TSPTransport' }, { type: 'DIDCommMessaging' }, { type: 'VTCRest' }, { type: 'VTCStatusList' }],
}
const FARM_MEDIATOR = {
  id: 'did:webvh:QmagB:dids.ic3.dev:firstperson-mediator',
  service: [{ type: 'TSPTransport' }, { type: ['DIDCommMessaging'] }, { type: ['Authentication'] }],
}
const PERSONA = {
  id: 'did:webvh:QmcQ:dids.ic3.dev:focus-opinion',
  service: [{ type: 'TSPTransport' }, { type: 'DIDCommMessaging' }],
}

describe('classifyDidDocument', () => {
  it('reads a VTA as an agent to link', () => {
    expect(classifyDidDocument(RUNNER_VTA)).toEqual({ kind: 'agent', did: RUNNER_VTA.id })
  })

  it('reads a VTC as a community to join', () => {
    expect(classifyDidDocument(TEST_COMMUNITY)).toEqual({ kind: 'community', did: TEST_COMMUNITY.id })
  })

  it('reads a community by its status list alone', () => {
    expect(classifyDidDocument({ id: 'did:x:c', service: [{ type: 'VTCStatusList' }] }).kind).toBe('community')
  })

  it('reads a mediator as a relay, with service types written as lists', () => {
    expect(classifyDidDocument(FARM_MEDIATOR)).toEqual({ kind: 'relay', did: FARM_MEDIATOR.id })
  })

  it('reads a persona, which is reached but neither linked nor joined, as other', () => {
    expect(classifyDidDocument(PERSONA)).toEqual({ kind: 'other', did: PERSONA.id })
  })

  it('reads a document with no services — a did:key — as other', () => {
    expect(classifyDidDocument({ id: 'did:key:z6Mk' })).toEqual({ kind: 'other', did: 'did:key:z6Mk' })
    expect(classifyDidDocument({ id: 'did:key:z6Mk', service: null }).kind).toBe('other')
  })

  it('leaves a DID that is both an agent and a community to the person', () => {
    const both = { id: 'did:x:both', service: [{ type: 'VTARest' }, { type: 'VTCRest' }] }
    expect(classifyDidDocument(both)).toEqual({ kind: 'ambiguous', did: 'did:x:both' })
  })

  it('does not take DIDComm messaging alone for a relay', () => {
    expect(classifyDidDocument({ id: 'did:x:d', service: [{ type: 'DIDCommMessaging' }] }).kind).toBe('other')
  })

  it('names the DID it was asked about over the document id', () => {
    expect(classifyDidDocument(RUNNER_VTA, 'did:webvh:asked').did).toBe('did:webvh:asked')
  })

  it('ignores malformed service entries', () => {
    const doc = { id: 'did:x:m', service: [undefined, {}, { type: 42 as never }, { type: 'VTARest' }] }
    expect(classifyDidDocument(doc).kind).toBe('agent')
  })
})

describe('bareDid', () => {
  it('takes a DID as scanned, trimmed', () => {
    expect(bareDid('  did:webvh:QmS4:dids.ic3.dev:keyring-runner-vta\n')).toBe('did:webvh:QmS4:dids.ic3.dev:keyring-runner-vta')
  })

  it('drops a fragment, query or path', () => {
    expect(bareDid('did:webvh:Qm:host:x#key-0')).toBe('did:webvh:Qm:host:x')
    expect(bareDid('did:webvh:Qm:host:x?versionId=2')).toBe('did:webvh:Qm:host:x')
    expect(bareDid('did:web:example.com/path')).toBe('did:web:example.com')
  })

  it('refuses what is not a DID', () => {
    expect(bareDid('https://example.com')).toBeUndefined()
    expect(bareDid('keyring://vti/community?d=did:x:y')).toBeUndefined()
    expect(bareDid('did:')).toBeUndefined()
  })
})

describe('classifyDid', () => {
  const agentWith = (resolve: jest.Mock) => ({ dids: { resolve } })
  const quick = { attempts: 2, timeoutMs: 5000 }

  it('resolves and classifies, using the bare DID', async () => {
    const resolve = jest.fn(async () => ({ didDocument: TEST_COMMUNITY }))
    const kind = await classifyDid(agentWith(resolve), `  ${TEST_COMMUNITY.id}#key-0 `, quick)
    expect(kind).toEqual({ kind: 'community', did: TEST_COMMUNITY.id })
    expect(resolve).toHaveBeenCalledWith(TEST_COMMUNITY.id)
  })

  it('calls text that is not a DID invalid, without resolving anything', async () => {
    const resolve = jest.fn()
    expect(await classifyDid(agentWith(resolve), 'https://example.com', quick)).toEqual({
      kind: 'unresolvable',
      did: 'https://example.com',
      reason: 'invalid',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('calls a method this wallet cannot resolve invalid, and does not retry it', async () => {
    const resolve = jest.fn(async () => ({ didDocument: null, didResolutionMetadata: { error: 'unsupportedDidMethod' } }))
    expect(await classifyDid(agentWith(resolve), 'did:nope:x', quick)).toMatchObject({ reason: 'invalid' })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('says not found when the host says so, as notFound or as an HTTP 404', async () => {
    const byCode = jest.fn(async () => ({ didDocument: null, didResolutionMetadata: { error: 'notFound' } }))
    expect(await classifyDid(agentWith(byCode), 'did:webvh:Qm:host:gone', quick)).toMatchObject({ reason: 'notFound' })
    const by404 = jest.fn(async () => ({
      didDocument: null,
      didResolutionMetadata: { error: 'unknownError', message: 'HTTP 404 fetching did.jsonl' },
    }))
    expect(await classifyDid(agentWith(by404), 'did:webvh:Qm:host:gone', quick)).toMatchObject({ reason: 'notFound' })
  })

  it('retries a failure that may pass, and classifies once it does', async () => {
    const resolve = jest
      .fn()
      .mockRejectedValueOnce(new Error('JSON Parse error: Unexpected character: R'))
      .mockResolvedValueOnce({ didDocument: RUNNER_VTA })
    expect(await classifyDid(agentWith(resolve), RUNNER_VTA.id, quick)).toMatchObject({ kind: 'agent' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('calls a host that never answers offline, after its attempts', async () => {
    const resolve = jest.fn(async () => {
      throw new Error('Network request failed')
    })
    expect(await classifyDid(agentWith(resolve), RUNNER_VTA.id, quick)).toMatchObject({ reason: 'offline' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('never takes longer than its deadline', async () => {
    const resolve = jest.fn(() => new Promise(() => undefined))
    const started = Date.now()
    expect(await classifyDid(agentWith(resolve), RUNNER_VTA.id, { timeoutMs: 50 })).toMatchObject({ reason: 'offline' })
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
