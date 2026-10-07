/**
 * IN-132: an agent this phone already has is matched by its DID, never by a
 * name, on every way of adding one — and refused, whatever the link is now
 * (an "Add" leaves the current agent first). Linking it again replaced its
 * entry, its name and this phone's key on it.
 */
import type { EnrolmentOffer } from '@bifold/trust-tasks'

import { AgentAlreadyOnPhone, VtaAgentController } from '../module/vtaAgent'
import type { AgentHostOffer } from '../module/agentHostConnection'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  ManagerKeyUnresolved: jest.requireActual('../module/VtaClient').ManagerKeyUnresolved,
  SwapDoneSignInFailed: jest.requireActual('../module/VtaClient').SwapDoneSignInFailed,
  VtaClient: jest.fn(() => ({})),
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.temporary'),
  createVtiTemporaryDidKey: jest.fn(async () => 'did:key:z6Mktemporary'),
}))

type Setter = { set(next: Record<string, unknown>): void }
const HOME = 'did:webvh:Qm:home'
const WORK = 'did:webvh:Qm:work'

function controller() {
  const vta = new VtaAgentController()
  const submit = jest.fn(async () => ({ did: 'did:peer:2.temp', code: 'ABCD-EFGH' }))
  const setManager = jest.fn(async () => undefined)
  vta.configure({
    now: () => 1_000,
    linkStore: () => ({ get: async () => undefined, set: async () => undefined, clear: async () => undefined }),
    identityStore: () => ({ setManager }) as never,
    enrol: { submit: submit as never, waitForGrant: jest.fn(async () => undefined) as never },
    deviceCanOwn: async () => true,
  })
  // As after "Add": HOME left (not linked), and still among this phone's agents.
  ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' }, agents: [{ vtaDid: HOME, label: 'Home' }] })
  return { vta, submit, setManager }
}

describe('an agent this phone already has', () => {
  it('is known by its DID, whatever the link is now; a removed phone may link its agent again', () => {
    const { vta } = controller()
    expect(vta.hasAgent(HOME)).toBe(true)
    expect(vta.hasAgent(WORK)).toBe(false)
    ;(vta as unknown as Setter).set({
      link: { kind: 'revoked', vtaDid: HOME, label: 'Home', reason: 'removed', cause: 'notInAcl' },
    })
    expect(vta.hasAgent(HOME)).toBe(false)
  })

  it('by its address (setting up, or the link screen): refused, and no key is made for it', async () => {
    const { vta, setManager } = controller()
    await expect(vta.startCreateAgent({} as never, HOME)).rejects.toBeInstanceOf(AgentAlreadyOnPhone)
    await expect(vta.startManualLink({} as never, HOME, 'Home')).rejects.toBeInstanceOf(AgentAlreadyOnPhone)
    expect(setManager).not.toHaveBeenCalled()
    expect(vta.getState().link.kind).toBe('notLinked')
  })

  it("by an enrolment offer: refused, said why, and nothing is sent to the agent's page", async () => {
    const { vta, submit } = controller()
    const offer: EnrolmentOffer = {
      v: 1,
      t: 'vta-enrol',
      vta: HOME,
      label: 'Home',
      url: 'http://page/api/offers/n',
      n: 'NONCE0123456789ABCD',
      exp: 2_000_000_000,
    }
    vta.scanOffer(offer)
    await vta.confirmOffer({} as never)
    expect(submit).not.toHaveBeenCalled()
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason: 'alreadyLinked' } })
  })

  it("by an agent host's connection: refused, said why", async () => {
    const { vta, setManager } = controller()
    const hostOffer: AgentHostOffer = { vtaDid: HOME, callbackUrl: 'https://host/cb', host: 'host.example' }
    vta.scanHostOffer(hostOffer)
    await vta.confirmOffer({} as never)
    expect(setManager).not.toHaveBeenCalled()
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason: 'alreadyLinked' } })
  })

  it('a switch to it gives the adding up and makes it current', async () => {
    const { vta } = controller()
    ;(vta as unknown as Setter).set({ addingAgent: true })
    const use = jest.spyOn(vta, 'useAgent').mockResolvedValue(undefined)
    await vta.switchToExisting({} as never, HOME)
    expect(vta.getState().addingAgent).toBe(false)
    expect(use).toHaveBeenCalledWith(expect.anything(), HOME)
  })
})
