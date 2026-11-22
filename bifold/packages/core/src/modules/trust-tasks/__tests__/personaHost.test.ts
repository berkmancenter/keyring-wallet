import { PersonaHostMissing, VtaClient } from '../module/VtaClient'
import { plainError } from '../screens/plainError'

// A persona is a did:webvh and has to be served from somewhere. A store build
// names no serverless base URL, so an agent with no DID-hosting server used to
// mint at "/<label>" — a DID nobody can resolve — and the join failed later,
// elsewhere, with no word of why (2026-09-23).

const COMMUNITY = 'did:webvh:c:host:community'

function client(servers: { id: string }[], existing?: unknown) {
  const store = {
    getPersona: jest.fn(async () => existing),
    setPersona: jest.fn(async () => undefined),
  }
  const vta = new VtaClient({} as never, 'did:webvh:agent', store as never)
  jest.spyOn(vta, 'connect').mockResolvedValue(undefined)
  jest.spyOn(vta, 'listContexts').mockResolvedValue([{ id: 'vta' }] as never)
  jest.spyOn(vta, 'listServers').mockResolvedValue(servers)
  const mint = jest
    .spyOn(vta, 'mintPersona')
    .mockResolvedValue({ did: 'did:webvh:minted', signingKeyId: 'did:webvh:minted#key-0', kaKeyId: 'did:webvh:minted#key-1' } as never)
  jest.spyOn(vta, 'borrowKey').mockResolvedValue({ keyId: 'kms-1', curve: 'Ed25519' })
  return { vta, mint, store }
}

describe('minting a persona needs somewhere to publish it', () => {
  it('refuses, naming what the agent lacks, when it has no DID host and no base URL is given', async () => {
    const { vta, mint } = client([])
    await expect(vta.ensurePersona({ communityDid: COMMUNITY })).rejects.toBeInstanceOf(PersonaHostMissing)
    expect(mint).not.toHaveBeenCalled()
  })

  it('mints on the registered DID host', async () => {
    const { vta, mint } = client([{ id: 'dids.ic3.dev' }])
    await vta.ensurePersona({ communityDid: COMMUNITY, label: 'x' })
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'dids.ic3.dev' }))
  })

  it('mints serverlessly when a base URL is given', async () => {
    const { vta, mint } = client([])
    await vta.ensurePersona({ communityDid: COMMUNITY, label: 'x', personaBaseUrl: 'https://agent.example/personas' })
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ didUrl: 'https://agent.example/personas/x' }))
  })

  it('leaves a persona that already exists alone, host or not', async () => {
    const existing = {
      did: 'did:webvh:kept',
      contextId: 'vta',
      vtaKeyIds: { signing: 'did:webvh:kept#key-0', keyAgreement: 'did:webvh:kept#key-1' },
      kmsKeyIds: { signing: 's', keyAgreement: 'k' },
    }
    const { vta, mint } = client([], existing)
    await expect(vta.ensurePersona({ communityDid: COMMUNITY })).resolves.toBe(existing)
    expect(mint).not.toHaveBeenCalled()
  })

  it('tells a person that only the agent\'s admin can fix it, and not to keep retrying', () => {
    expect(plainError(new PersonaHostMissing('did:webvh:agent'))).toMatchObject({ line: 'Errors.NoDidHost', retry: false })
  })
})
