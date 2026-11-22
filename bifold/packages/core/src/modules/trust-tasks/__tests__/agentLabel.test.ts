import { VtaClient } from '../module/VtaClient'
import { chooseAgentLabel, claimedAgentNames, nameLeadsTo, verifiedAgentName, vtaNameFrom } from '../module/agentLabel'

// VTI-Q20, answered 2026-09-23: an agent's display name is its verified agent
// name (an alsoKnownAs claim that resolves forward to the same DID), else the
// operator's vta_name from config/show, else nothing — the caller shows the host.

const DID = 'did:webvh:Qm1:dids.example:agent'
const NAME = 'https://dids.example/@agent'

function redirect(location: string | null, status = 302) {
  return jest.fn(async () => ({ status, headers: { get: (h: string) => (h === 'location' ? location : null) } }))
}

describe('claimedAgentNames', () => {
  it('keeps only https://host/@name entries, in order, and at most three', () => {
    const doc = {
      alsoKnownAs: [
        'did:web:dids.example',
        NAME,
        'http://dids.example/@plain',
        'https://dids.example/people/@x',
        42,
        'https://a.example/@a',
        'https://b.example/@b',
        'https://c.example/@c',
      ],
    }
    expect(claimedAgentNames(doc)).toEqual([NAME, 'https://a.example/@a', 'https://b.example/@b'])
  })

  it('is empty for a document without alsoKnownAs', () => {
    expect(claimedAgentNames({})).toEqual([])
    expect(claimedAgentNames({ alsoKnownAs: null })).toEqual([])
  })
})

describe('nameLeadsTo', () => {
  it('is true only for a redirect to exactly this DID, asked without following it', async () => {
    const fetchImpl = redirect(DID)
    await expect(nameLeadsTo(NAME, DID, fetchImpl)).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(NAME, { method: 'GET', redirect: 'manual' })
  })

  it.each([
    ['a redirect to another DID', redirect('did:webvh:Qm2:elsewhere')],
    ['a 404', redirect(null, 404)],
    ['a followed redirect that hides the Location', redirect(null, 200)],
    ['a network error', jest.fn(async () => Promise.reject(new Error('offline')))],
  ])('is false for %s', async (_, fetchImpl) => {
    await expect(nameLeadsTo(NAME, DID, fetchImpl as never)).resolves.toBe(false)
  })
})

describe('verifiedAgentName', () => {
  it('returns the first claim that leads back, skipping one that does not', async () => {
    const fetchImpl = jest.fn(async (url: string) => ({
      status: 302,
      headers: { get: () => (url === NAME ? DID : 'did:webvh:other') },
    }))
    const doc = { alsoKnownAs: ['https://squat.example/@agent', NAME] }
    await expect(verifiedAgentName(DID, doc, fetchImpl)).resolves.toBe(NAME)
  })

  it('returns nothing for an unverified claim', async () => {
    await expect(verifiedAgentName(DID, { alsoKnownAs: [NAME] }, redirect('did:webvh:other'))).resolves.toBeUndefined()
  })
})

describe('vtaNameFrom', () => {
  it('reads vta_name from config/show fields', () => {
    const answer = {
      fields: [
        { key: 'public_url', value: 'x' },
        { key: 'vta_name', value: ' runner ', source: 'config' },
      ],
    }
    expect(vtaNameFrom(answer)).toBe('runner')
  })

  it.each([
    [undefined],
    [{}],
    [{ fields: [] }],
    [{ fields: [{ key: 'vta_name', value: '' }] }],
    [{ fields: [{ key: 'vta_name', value: null }] }],
  ])('is undefined for %j', (answer) => expect(vtaNameFrom(answer)).toBeUndefined())
})

describe('chooseAgentLabel', () => {
  it('prefers the verified name, then vta_name, then nothing', () => {
    expect(chooseAgentLabel(NAME, 'runner')).toEqual({ label: NAME, source: 'agentName' })
    expect(chooseAgentLabel(undefined, 'runner')).toEqual({ label: 'runner', source: 'vtaName' })
    expect(chooseAgentLabel(undefined, undefined)).toBeUndefined()
  })
})

describe('VtaClient.agentLabel', () => {
  function client(doc: object | Error) {
    const agent = {
      dids: { resolveDidDocument: jest.fn(async () => (doc instanceof Error ? Promise.reject(doc) : doc)) },
    }
    return new VtaClient(agent as never, DID, {} as never)
  }

  it('asks config/show for vta_name only', async () => {
    const vta = client({})
    const task = jest.spyOn(vta, 'task').mockResolvedValue({ fields: [{ key: 'vta_name', value: 'runner' }] } as never)
    await expect(vta.agentLabel()).resolves.toEqual({ label: 'runner', source: 'vtaName' })
    expect(task).toHaveBeenCalledWith('https://trusttasks.org/spec/config/show/0.1', { keys: ['vta_name'] })
  })

  it('returns the verified agent name over vta_name', async () => {
    const vta = client({ alsoKnownAs: [NAME] })
    jest.spyOn(vta, 'task').mockResolvedValue({ fields: [{ key: 'vta_name', value: 'runner' }] } as never)
    await expect(vta.agentLabel({ fetchImpl: redirect(DID) })).resolves.toEqual({ label: NAME, source: 'agentName' })
  })

  it('never throws: an unresolvable DID and an unanswered task are no label', async () => {
    const vta = client(new Error('unresolvable'))
    jest.spyOn(vta, 'task').mockRejectedValue(new Error('the VTA did not answer'))
    await expect(vta.agentLabel()).resolves.toBeUndefined()
  })
})
