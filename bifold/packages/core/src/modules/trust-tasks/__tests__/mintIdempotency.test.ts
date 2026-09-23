import { VtaClient } from '../module/VtaClient'

// VTI-Q17, answered by the maintainers on 2026-09-23: a mint whose answer is
// lost still succeeds at the VTA, and a retry minted an orphan. The VTA takes a
// signed top-level `idempotencyKey` on vta/webvh/dids/create/1.0 and returns the
// first mint for a retry with the same key within 24 h. So a persona mint uses
// one key per community until a persona is recorded, across retries and restarts.

const COMMUNITY = 'did:webvh:c:host:community'
const MINTED = { did: 'did:webvh:minted', signingKeyId: 'did:webvh:minted#key-0', kaKeyId: 'did:webvh:minted#key-1' }

function storeWithMintKeys() {
  const keys = new Map<string, string>()
  return {
    keys,
    getPersona: jest.fn(async () => undefined),
    setPersona: jest.fn(async () => undefined),
    getMintKey: jest.fn(async (c: string) => keys.get(c)),
    setMintKey: jest.fn(async (c: string, k: string) => void keys.set(c, k)),
    clearMintKey: jest.fn(async (c: string) => void keys.delete(c)),
  }
}

function client(store: object) {
  const vta = new VtaClient({} as never, 'did:webvh:agent', store as never)
  jest.spyOn(vta, 'connect').mockResolvedValue(undefined)
  jest.spyOn(vta, 'listContexts').mockResolvedValue([{ id: 'vta' }] as never)
  jest.spyOn(vta, 'listServers').mockResolvedValue([{ id: 'control' }])
  jest.spyOn(vta, 'borrowKey').mockResolvedValue({ keyId: 'kms-1', curve: 'Ed25519' })
  return vta
}

describe('a persona mint is idempotent across retries', () => {
  it('re-asks with the same key after a mint whose answer was lost, then forgets the key', async () => {
    const store = storeWithMintKeys()
    const vta = client(store)
    const mint = jest
      .spyOn(vta, 'mintPersona')
      .mockRejectedValueOnce(new Error('the VTA did not answer'))
      .mockResolvedValueOnce(MINTED as never)

    await expect(vta.ensurePersona({ communityDid: COMMUNITY })).rejects.toThrow(/did not answer/)
    const firstKey = store.keys.get(COMMUNITY)
    expect(firstKey).toMatch(/^urn:uuid:/)

    await vta.ensurePersona({ communityDid: COMMUNITY })
    expect(mint.mock.calls.map((c) => c[0].idempotencyKey)).toEqual([firstKey, firstKey])
    expect(store.keys.has(COMMUNITY)).toBe(false)
  })

  it('carries the key on the signed document itself, not inside the payload', async () => {
    const vta = new VtaClient({} as never, 'did:webvh:agent', storeWithMintKeys() as never)
    const task = jest.spyOn(vta, 'task').mockResolvedValue(MINTED as never)
    await vta.mintPersona({ contextId: 'vta', serverId: 'control', label: 'x', idempotencyKey: 'urn:uuid:k' })
    const [, payload, , extras] = task.mock.calls[0]
    expect(payload).not.toHaveProperty('idempotencyKey')
    expect(extras).toEqual({ idempotencyKey: 'urn:uuid:k' })
  })

  it('still mints with a store that keeps no keys, as before', async () => {
    const store = { getPersona: jest.fn(async () => undefined), setPersona: jest.fn(async () => undefined) }
    const vta = client(store)
    const mint = jest.spyOn(vta, 'mintPersona').mockResolvedValue(MINTED as never)
    await vta.ensurePersona({ communityDid: COMMUNITY })
    expect(mint).toHaveBeenCalledTimes(1)
    expect(mint.mock.calls[0][0].idempotencyKey).toMatch(/^urn:uuid:/)
  })
})
