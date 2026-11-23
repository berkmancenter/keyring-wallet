/**
 * After a lost phone (#10, plan part D): rotate the persona's keys on the
 * agent, which cancels any copy the lost phone still holds — offered only on an
 * agent that keeps the keys' method ids when it rotates (VTI 83492acf, first in
 * vta-service 0.43.0), since an older one renumbers them and breaks every
 * relationship that names them.
 */
import { agentVersion, ROTATE_KEYS_TASK, rotateEachPersona, rotatePersonaKeys, rotationSupport } from '../module/vtaRotation'
import type { VtiPersona } from '../module/VtiIdentityStore'

const VTA = 'did:webvh:QmVta:agent.example'

describe('whether the agent can rotate without breaking relationships', () => {
  it.each([
    ['0.45.0', 'yes'],
    ['0.43.0', 'yes'],
    ['0.42.0', 'unknown'],
    ['0.41.9', 'agentTooOld'],
    ['not a version', 'unknown'],
    [undefined, 'unknown'],
  ])('version %s → %s', (version, answer) => {
    expect(rotationSupport(version)).toBe(answer)
  })

  it("reads the version from the agent's own REST description", async () => {
    const agent = {
      dids: {
        resolveDidDocument: async () => ({
          service: [{ id: `${VTA}#vta-rest`, type: 'VTARest', serviceEndpoint: 'https://agent.example' }],
        }),
      },
    } as never
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ info: { version: '0.44.0' } }) }
    }) as unknown as typeof fetch
    await expect(agentVersion(agent, VTA, fetchImpl)).resolves.toBe('0.44.0')
    expect(urls).toEqual(['https://agent.example/openapi.json'])
  })

  it('says nothing, rather than guessing, when the agent does not say', async () => {
    const noRest = { dids: { resolveDidDocument: async () => ({ service: [] }) } } as never
    await expect(agentVersion(noRest, VTA, (async () => ({})) as never)).resolves.toBeUndefined()
    const down = {
      dids: {
        resolveDidDocument: async () => ({ service: [{ type: 'VTARest', serviceEndpoint: 'https://agent.example' }] }),
      },
    } as never
    const failing = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    await expect(agentVersion(down, VTA, failing)).resolves.toBeUndefined()
  })
})

describe('rotating a persona', () => {
  const persona: VtiPersona = {
    communityDid: 'did:webvh:QmCommunity:c.example',
    vtaDid: VTA,
    did: 'did:webvh:QmPersona:dids.example:persona',
    contextId: 'ctx',
    vtaKeyIds: { signing: 'vta-sign', keyAgreement: 'vta-ka' },
    kmsKeyIds: { signing: 'kms-old-sign', keyAgreement: 'kms-old-ka' },
    createdAt: '2026-09-01T00:00:00Z',
  }

  it('asks the agent to rotate, then takes fresh copies under the same key ids', async () => {
    const sent: { type: string; payload: Record<string, unknown> }[] = []
    const saved: VtiPersona[] = []
    await rotatePersonaKeys(
      {
        task: async (type, payload) => {
          sent.push({ type, payload })
          return {} as never
        },
        borrowKey: async (id: string) => ({ keyId: `kms-new-${id}`, curve: 'Ed25519' as const }),
      },
      { setPersona: async (p: VtiPersona) => void saved.push(p) },
      persona
    )
    expect(sent[0]).toMatchObject({ type: ROTATE_KEYS_TASK, payload: { did: persona.did } })
    expect(saved).toHaveLength(1)
    expect(saved[0].kmsKeyIds).toEqual({ signing: 'kms-new-vta-sign', keyAgreement: 'kms-new-vta-ka' })
    expect(saved[0].vtaKeyIds).toEqual(persona.vtaKeyIds)
  })

  it('keeps the persona as it was when the agent refuses', async () => {
    const saved: VtiPersona[] = []
    await expect(
      rotatePersonaKeys(
        {
          task: async () => {
            throw new Error('refused')
          },
          borrowKey: async () => ({ keyId: 'x', curve: 'Ed25519' as const }),
        },
        { setPersona: async (p: VtiPersona) => void saved.push(p) },
        persona
      )
    ).rejects.toThrow('refused')
    expect(saved).toEqual([])
  })
})

describe('rotating every identity on this phone', () => {
  const base: Omit<VtiPersona, 'did'> = {
    communityDid: 'did:webvh:QmCommunity:c.example',
    vtaDid: VTA,
    contextId: 'ctx',
    vtaKeyIds: { signing: 'vta-sign', keyAgreement: 'vta-ka' },
    kmsKeyIds: { signing: 'kms-old-sign', keyAgreement: 'kms-old-ka' },
    createdAt: '2026-09-01T00:00:00Z',
  }
  const personas = ['did:webvh:Qa:x:a', 'did:webvh:Qb:x:b', 'did:webvh:Qc:x:c'].map((did) => ({ ...base, did }))

  it('rotates one at a time and carries on past a refusal', async () => {
    let inFlight = 0
    let most = 0
    const saved: string[] = []
    const result = await rotateEachPersona(
      {
        task: async (_type, payload) => {
          most = Math.max(most, ++inFlight)
          await new Promise((resolve) => setTimeout(resolve, 1))
          inFlight--
          if (payload.did === 'did:webvh:Qb:x:b') throw new Error('refused')
          return {} as never
        },
        borrowKey: async (id: string) => ({ keyId: `kms-new-${id}`, curve: 'Ed25519' as const }),
      },
      { setPersona: async (p: VtiPersona) => void saved.push(p.did) },
      personas
    )
    expect(most).toBe(1)
    expect(result.rotated).toEqual(['did:webvh:Qa:x:a', 'did:webvh:Qc:x:c'])
    expect(result.failed.map((f) => f.did)).toEqual(['did:webvh:Qb:x:b'])
    expect(saved).toEqual(['did:webvh:Qa:x:a', 'did:webvh:Qc:x:c'])
  })

  it('does not call a rotation done until the DID resolves with the new keys', async () => {
    const checked: { did: string; keys: string[] }[] = []
    const result = await rotateEachPersona(
      {
        task: async () => ({}) as never,
        borrowKey: async (id: string) => ({ keyId: `kms-${id}`, curve: 'Ed25519' as const, publicKeyMultibase: `z-new-${id}` }),
      },
      { setPersona: async () => undefined },
      personas.slice(0, 2),
      async (did, keys) => {
        checked.push({ did, keys })
        return did === 'did:webvh:Qa:x:a'
      }
    )
    expect(checked[0].keys.sort()).toEqual(['z-new-vta-ka', 'z-new-vta-sign'])
    expect(result).toMatchObject({ rotated: ['did:webvh:Qa:x:a'], unpublished: ['did:webvh:Qb:x:b'], failed: [] })
  })
})
