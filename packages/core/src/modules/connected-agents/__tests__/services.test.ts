import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { administratorSigner, connectedAgentsServices, vtaPorts, type VtaSession } from '../services'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))
jest.mock('../../trust-tasks/documentProof', () => ({
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>, did: string, opts: unknown) => ({
    ...doc,
    proof: { by: did, opts },
  })),
  verifyDocumentProof: jest.fn(async () => true),
}))

const VTA = 'did:webvh:QmVta:vta.example.org'

function fakeSession(managerDid?: string) {
  const calls: { vtaDid: string; method: string; args: unknown[] }[] = []
  const client = new Proxy(
    {},
    {
      get:
        (_t, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ vtaDid: '', method, args })
          if (method === 'listContexts') return [{ id: 'keyring-memory-educat1on', name: 'Education' }, { id: 'vta' }]
          if (method === 'findAgentEntries') return { complete: true, matches: [] }
          return {}
        },
    }
  )
  const session: VtaSession = {
    async withAgentSession(_agent, vtaDid, use) {
      const out = await use(client as never)
      calls[calls.length - 1].vtaDid = vtaDid
      return out
    },
    getState: () => ({ managerDid }),
  }
  return { session, calls }
}

const agent = () =>
  ({
    genericRecords: memoryGenericRecords(),
    kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(7) },
  }) as unknown as Agent

describe('vtaPorts: every call on a signed-in session to the administered VTA', () => {
  it('routes the access, signing and memory calls through withAgentSession for that VTA', async () => {
    const { session, calls } = fakeSession('did:peer:2.admin')
    const ports = vtaPorts(agent(), VTA, session)
    await ports.access.grantApplication({ subject: 'did:key:z', contexts: [], capabilities: [], purposes: [] })
    await ports.access.findAgentEntries({ subject: 'did:key:z' })
    await ports.vdcSign.task('t', {})
    await ports.memory.whoAmI()
    expect(calls.map((c) => `${c.method}@${c.vtaDid}`)).toEqual([
      `grantApplication@${VTA}`,
      `findAgentEntries@${VTA}`,
      `task@${VTA}`,
      `whoAmI@${VTA}`,
    ])
  })
})

describe('connectedAgentsServices', () => {
  it("names memories by their context's name, never a context with none", async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect(await services.memoryNames()).toEqual({ 'keyring-memory-educat1on': 'Education' })
  })

  it('keeps the count of the last opening per agent and memory', async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect(await services.lastCount('a', 'm')).toBeUndefined()
    await services.saveCount('a', 'm', 12)
    await services.saveCount('a', 'm', 15)
    expect(await services.lastCount('a', 'm')).toBe(15)
    expect(await services.lastCount('b', 'm')).toBeUndefined()
  })

  it("offers only this VTA's personas, named by their label", async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [
      { did: 'did:p:1', vtaDid: VTA, label: 'Ada at work' },
      { did: 'did:p:2', vtaDid: 'did:webvh:other', label: 'Elsewhere' },
      { did: 'did:p:3', label: 'No VTA named' },
    ])
    expect(await services.personas()).toEqual([
      { did: 'did:p:1', name: 'Ada at work' },
      { did: 'did:p:3', name: 'No VTA named' },
    ])
  })

  it('a driver is made over these services, idle until started', async () => {
    const { session } = fakeSession('did:peer:2.admin')
    const services = connectedAgentsServices(agent(), VTA, session, async () => [])
    expect((await services.driver(() => undefined)).state.phase).toBe('idle')
  })
})

describe('a memory create an approval rule holds (#1060 finding 20)', () => {
  it("is heldForApproval with the client's own consent classifier; any other refusal is failed", async () => {
    const { VtiRefusal } = jest.requireActual('../../trust-tasks/module/vtiAgent') as {
      VtiRefusal: new (code: string, message: string, details?: unknown) => Error
    }
    const run = async (refusal: Error) => {
      const { session } = fakeSession('did:peer:2.admin')
      const wrapped: VtaSession = {
        ...session,
        withAgentSession: async (a, did, use) =>
          session.withAgentSession(a, did, (client) =>
            use(
              new Proxy(client, {
                get: (target, method: string) =>
                  method === 'createContext'
                    ? async () => {
                        throw refusal
                      }
                    : (target as Record<string, unknown>)[method],
              })
            )
          ),
      }
      return connectedAgentsServices(agent(), VTA, wrapped, async () => []).createMemory('Travel')
    }
    const held = new VtiRefusal('auth:consent_required', 'held', {
      reason: 'auth:consent_required',
      consentRequests: [],
    })
    expect(await run(held)).toEqual({ ok: false, code: 'heldForApproval' })
    expect(await run(new VtiRefusal('permissionDenied', 'no'))).toEqual({ ok: false, code: 'failed' })
  })
})

describe('administratorSigner (§7.5): the phone signs as its administrator DID', () => {
  it("signs as the session's manager DID, read at each signature, so a rotated key is followed", async () => {
    let manager: string | undefined = 'did:peer:2.first'
    const signer = administratorSigner(agent(), { getState: () => ({ managerDid: manager }) })
    expect(signer.did).toBe('did:peer:2.first')
    const first = await signer.sign({ a: 1 }, 'authentication')
    manager = 'did:peer:2.rotated'
    const second = await signer.sign({ a: 2 }, 'assertionMethod')
    expect(first.proof).toEqual({ by: 'did:peer:2.first', opts: { proofPurpose: 'authentication' } })
    expect(second.proof).toEqual({ by: 'did:peer:2.rotated', opts: { proofPurpose: 'assertionMethod' } })
  })

  it('with no administrator key it refuses, rather than sign as anyone else', async () => {
    const signer = administratorSigner(agent(), { getState: () => ({}) })
    expect(() => signer.did).toThrow(/no administrator key/)
    await expect(signer.sign({ a: 1 }, 'authentication')).rejects.toThrow(/no administrator key/)
  })
})
