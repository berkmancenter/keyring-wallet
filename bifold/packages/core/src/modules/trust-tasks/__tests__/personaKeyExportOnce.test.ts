/**
 * A persona's key copy is fetched from the agent once however many ask for it at the same moment. A tester's 277.4
 * log (11-02): the session-open sweep and the community sign-in that needed the key both found it missing, and each
 * exported both keys, four keys/export-secret one after another in the agent's queue for one sign-in. The copies are
 * still held in memory only, for as long as before: only the fetch is shared.
 */
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  tsp: { CODEC_FORMS_RELATIONSHIPS: true, peekRevision: () => ({ minor: 0 }) },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/VtiMediatorTransport', () => ({
  advertisedMediatorDid: jest.fn(async () => undefined),
  advertisedTspMediatorDid: jest.fn(async () => undefined),
  createVtiClientDid: jest.fn(async () => 'did:peer:client'),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did, wsEndpoint: `wss://${did}` })),
  resolveDidDocumentRetrying: jest.fn(),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  vtiClientIdentityFromPersona: jest.fn(async (_a: unknown, did: string) => ({ did })),
  VtiMediatorSession: class {},
}))
jest.mock('../module/vtiTsp', () => ({
  getPeerLegCarriage: () => 'didcomm',
  LOG_PREFIX: '[tsp]',
  tspSessionForPersona: jest.fn(async () => ({ identity: {}, resolver: {} })),
}))

import { VtaClient } from '../module/VtaClient'
import type { VtiPersona } from '../module/VtiIdentityStore'
import { EPHEMERAL_KMS_BACKEND, inMemoryKeyId } from '../module/vtaKeys'

const VTA = 'did:webvh:QmVta:dids.example:keyring-al-vta'
const PERSONA = 'did:webvh:QmPersona:dids.example:al-first'

/**
 * This phone's in-memory backend: which copies it holds now. `canSay: false` is a backend that can't answer whether
 * it holds one (heldInMemory gives undefined), so only getPublicKey can tell.
 */
function phone({ canSay = true } = {}) {
  const held = new Set<string>()
  const backend = canSay
    ? { backend: EPHEMERAL_KMS_BACKEND, isHeld: async (id: string) => held.has(id) }
    : { backend: EPHEMERAL_KMS_BACKEND }
  const agent = {
    dependencyManager: { resolve: () => ({ backends: [backend] }) },
    kms: {
      getPublicKey: async ({ keyId }: { keyId: string }) =>
        held.has(keyId) ? { publicJwk: {} } : Promise.reject(new Error('not held')),
    },
  }
  return { held, agent }
}

const persona: VtiPersona = {
  did: PERSONA,
  communityDid: 'did:webvh:QmCommunity:example.org:first-vtc',
  vtaDid: VTA,
  vtaKeyIds: { signing: `${PERSONA}#key-0`, keyAgreement: `${PERSONA}#key-1` },
  kmsKeyIds: {
    signing: inMemoryKeyId(VTA, `${PERSONA}#key-0`),
    keyAgreement: inMemoryKeyId(VTA, `${PERSONA}#key-1`),
  },
} as unknown as VtiPersona

/** A client of the persona's agent whose exports land in `held` after a turn, as the agent's queue answers them. */
function client(held: Set<string>, agent: object, exports: string[], fail = false) {
  const c = new VtaClient(agent as never, VTA, {} as never)
  jest.spyOn(c, 'connect').mockResolvedValue(undefined)
  jest.spyOn(c, 'borrowKey').mockImplementation(async (vtaKeyId: string) => {
    exports.push(vtaKeyId)
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (fail) throw new Error('the agent did not answer keys/export-secret')
    held.add(inMemoryKeyId(VTA, vtaKeyId))
    return { keyId: inMemoryKeyId(VTA, vtaKeyId), curve: 'Ed25519', publicKeyMultibase: 'z' }
  })
  return c
}

describe("a persona's key copies, asked for twice at the same moment", () => {
  it('are exported once each: the sweep and the sign-in share the fetch (2 exports, not 4)', async () => {
    const { held, agent } = phone()
    const exports: string[] = []
    const sweep = client(held, agent, exports)
    const signIn = client(held, agent, exports)
    const [a, b] = await Promise.all([sweep.holdPersonaKeys(persona), signIn.holdPersonaKeys(persona)])
    expect(exports.sort()).toEqual([`${PERSONA}#key-0`, `${PERSONA}#key-1`])
    expect([a, b]).toEqual([true, true])
    expect(held.size).toBe(2)
  })

  it('a caller that joined a fetch made for another agent (one that locked) fetches its own copy', async () => {
    // Before a lock: the sweep starts on the agent that is about to lock. After the unlock: a new agent, the same ids.
    const before = phone()
    const after = phone()
    const exports: string[] = []
    const sweep = client(before.held, before.agent, exports)
    const signIn = client(after.held, after.agent, exports)
    await Promise.all([sweep.holdPersonaKeys(persona), signIn.holdPersonaKeys(persona)])
    // The joined fetch landed in the locked agent's store, so the new agent fetched its own: held in both.
    expect(after.held.size).toBe(2)
    expect(before.held.size).toBe(2)
    expect(exports).toHaveLength(4)
  })

  it("the same, when the new agent's backend can't say whether it holds the copy: can't tell is never held", async () => {
    const before = phone()
    const after = phone({ canSay: false })
    const exports: string[] = []
    await Promise.all([
      client(before.held, before.agent, exports).holdPersonaKeys(persona),
      client(after.held, after.agent, exports).holdPersonaKeys(persona),
    ])
    expect(after.held.size).toBe(2)
    expect(exports).toHaveLength(4)
  })

  it('once held, a later ask fetches nothing (control: the copies are kept for the session, as before)', async () => {
    const { held, agent } = phone()
    const exports: string[] = []
    await client(held, agent, exports).holdPersonaKeys(persona)
    await expect(client(held, agent, exports).holdPersonaKeys(persona)).resolves.toBe(false)
    expect(exports).toHaveLength(2)
  })

  it('a fetch that fails fails for both, and the next ask fetches again: nothing is kept from it', async () => {
    const { held, agent } = phone()
    const exports: string[] = []
    const failing = [client(held, agent, exports, true), client(held, agent, exports, true)]
    const results = await Promise.allSettled(failing.map((c) => c.holdPersonaKeys(persona)))
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(exports).toEqual([`${PERSONA}#key-0`])
    await expect(client(held, agent, exports).holdPersonaKeys(persona)).resolves.toBe(true)
    expect(exports).toEqual([`${PERSONA}#key-0`, `${PERSONA}#key-0`, `${PERSONA}#key-1`])
  })
})
