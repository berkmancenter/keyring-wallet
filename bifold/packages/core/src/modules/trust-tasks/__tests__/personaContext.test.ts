/**
 * IN-259: a new persona was minted in the agent's FIRST context, whatever it
 * was. A tester's agent listed "did-git-sign" first, so a community identity
 * landed beside their git-signing key. New personas go in a context named for
 * Keyring if there is one, else the agent's default ("vta"); a persona already
 * recorded stays where it is. The phone makes no context itself: contexts/create
 * is an offered task it never sends (approvalRules.test.ts holds that).
 */
import { PERSONA_CONTEXT_ID, VtaClient } from '../module/VtaClient'

const COMMUNITY = 'did:webvh:c:host:community'

function client(contexts: { id: string }[]) {
  const store = {
    getPersona: jest.fn(async () => undefined),
    setPersona: jest.fn(async () => undefined),
  }
  const vta = new VtaClient({} as never, 'did:webvh:agent', store as never)
  jest.spyOn(vta, 'connect').mockResolvedValue(undefined)
  jest.spyOn(vta, 'listContexts').mockResolvedValue(contexts as never)
  jest.spyOn(vta, 'listServers').mockResolvedValue([{ id: 'dids.ic3.dev' }])
  const task = jest.spyOn(vta, 'task')
  const mint = jest
    .spyOn(vta, 'mintPersona')
    .mockResolvedValue({
      did: 'did:webvh:minted',
      signingKeyId: 'did:webvh:minted#key-0',
      kaKeyId: 'did:webvh:minted#key-1',
    } as never)
  jest.spyOn(vta, 'borrowKey').mockResolvedValue({ keyId: 'kms-1', curve: 'Ed25519' })
  return { vta, mint, task, store }
}

describe("a new persona's context on the agent", () => {
  it('the tester agent, with did-git-sign listed first: the default vta context, not the first', async () => {
    const { vta, mint, task } = client([{ id: 'did-git-sign' }, { id: 'openvtc' }, { id: 'vta' }])
    await vta.ensurePersona({ communityDid: COMMUNITY, label: 'x' })
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'vta' }))
    // Nothing is made on the agent.
    expect(task).not.toHaveBeenCalled()
  })

  it('a context named for Keyring wins over the default', async () => {
    const { vta, mint } = client([{ id: 'did-git-sign' }, { id: 'vta' }, { id: PERSONA_CONTEXT_ID }])
    await vta.ensurePersona({ communityDid: COMMUNITY, label: 'x' })
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ contextId: PERSONA_CONTEXT_ID }))
  })

  it('an agent with neither: the first context, as before', async () => {
    const { vta, mint } = client([{ id: 'only-one' }])
    await vta.ensurePersona({ communityDid: COMMUNITY, label: 'x' })
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'only-one' }))
  })

  it('a persona already recorded keeps its context', async () => {
    const { vta, mint, store } = client([{ id: 'did-git-sign' }, { id: 'vta' }])
    store.getPersona.mockResolvedValue({
      did: 'did:webvh:kept',
      contextId: 'did-git-sign',
      vtaKeyIds: { signing: 'did:webvh:kept#key-0', keyAgreement: 'did:webvh:kept#key-1' },
    } as never)
    const persona = await vta.ensurePersona({ communityDid: COMMUNITY, label: 'x' })
    expect(mint).not.toHaveBeenCalled()
    expect(persona.contextId).toBe('did-git-sign')
  })
})
