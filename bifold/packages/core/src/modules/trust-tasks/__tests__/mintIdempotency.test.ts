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
  const requests = new Map<string, unknown>()
  return {
    keys,
    requests,
    getPersona: jest.fn(async () => undefined),
    setPersona: jest.fn(async () => undefined),
    getMintKey: jest.fn(async (c: string) => keys.get(c)),
    setMintKey: jest.fn(async (c: string, k: string, r?: unknown) => {
      keys.set(c, k)
      if (r) requests.set(c, r)
      else requests.delete(c)
    }),
    getMintRequest: jest.fn(async (c: string) => requests.get(c) as never),
    clearMintKey: jest.fn(async (c: string) => {
      keys.delete(c)
      requests.delete(c)
    }),
  }
}

/**
 * The VTA's keyed dispatch (vta-service trust_tasks/idempotency.rs): the first
 * request under a key is recorded; a retry with the same payload gets the first
 * answer; a different payload under the same key is refused for 24 h.
 */
function keyedVta(vta: VtaClient, { loseFirstAnswer = false } = {}) {
  const seen = new Map<string, string>()
  let lost = loseFirstAnswer
  return jest.spyOn(vta, 'mintPersona').mockImplementation(async (args) => {
    const { idempotencyKey, ...payload } = args
    const body = JSON.stringify(payload)
    const first = seen.get(idempotencyKey!)
    if (first !== undefined && first !== body)
      throw new Error('task failed: idempotency key reused for a different request')
    seen.set(idempotencyKey!, body)
    if (lost) {
      lost = false
      throw new Error('the VTA did not answer')
    }
    return MINTED as never
  })
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

describe('a retried mint is the same request, not only the same key', () => {
  it("re-sends the first attempt's label after a lost answer, though time has moved on", async () => {
    const store = storeWithMintKeys()
    const vta = client(store)
    const mint = keyedVta(vta, { loseFirstAnswer: true })
    const now = jest.spyOn(Date, 'now')

    now.mockReturnValue(Date.parse('2026-09-25T16:00:00Z'))
    await expect(vta.ensurePersona({ communityDid: COMMUNITY })).rejects.toThrow(/did not answer/)
    // The person taps Try again a minute later.
    now.mockReturnValue(Date.parse('2026-09-25T16:01:00Z'))
    await expect(vta.ensurePersona({ communityDid: COMMUNITY })).resolves.toMatchObject({ did: MINTED.did })

    const [first, retry] = mint.mock.calls.map((c) => c[0])
    expect(retry).toEqual(first)
    expect(store.keys.has(COMMUNITY)).toBe(false)
  })

  it('a phone stuck on a key saved without its request starts over once with a new key', async () => {
    const store = storeWithMintKeys()
    const vta = client(store)
    const mint = keyedVta(vta)
    // Up to 224: the key was saved alone, and the VTA holds a mint under it
    // with a label this phone can no longer rebuild.
    store.keys.set(COMMUNITY, 'urn:uuid:stuck')
    await vta.mintPersona({
      contextId: 'vta',
      serverId: 'control',
      label: 'keyring-old',
      idempotencyKey: 'urn:uuid:stuck',
    })
    mint.mockClear()

    await expect(vta.ensurePersona({ communityDid: COMMUNITY })).resolves.toMatchObject({ did: MINTED.did })
    const keys = mint.mock.calls.map((c) => c[0].idempotencyKey)
    expect(keys[0]).toBe('urn:uuid:stuck')
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe('urn:uuid:stuck')
  })

  it('does not start over for any other refusal', async () => {
    const store = storeWithMintKeys()
    const vta = client(store)
    const mint = jest.spyOn(vta, 'mintPersona').mockRejectedValue(new Error('task failed: forbidden'))
    await expect(vta.ensurePersona({ communityDid: COMMUNITY })).rejects.toThrow(/forbidden/)
    expect(mint).toHaveBeenCalledTimes(1)
  })
})
