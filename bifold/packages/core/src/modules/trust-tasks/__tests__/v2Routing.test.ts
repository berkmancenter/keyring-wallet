/**
 * v2Routing: how a v2 invitation is accepted, and what is left of the Coordinate Mediation 2.0 client (retired:
 * the Affinidi mediator has none; the wallet mailbox replaces it, didcomm_v2_subtask.md §7.2).
 */
import { DidCommMediationState } from '@credo-ts/didcomm'

import {
  findV2MediationRecord,
  getRoutingForV2,
  isV2MediationEnabled,
  provisionV2Mediation,
  routingForInvitation,
  setV2MediationEnabled,
  startV2MessagePickup,
} from '../v2Routing'

const v1 = { id: 'm-v1', protocolVersion: 'v1', state: DidCommMediationState.Granted }
const v2 = { id: 'm-v2', protocolVersion: 'v2', state: DidCommMediationState.Granted, routingDid: 'did:peer:2.Ez6…' }

function fakeAgent(mediators: unknown[], { defaultMediator = v1 as unknown, v2Invitation = true } = {}) {
  const recipient = {
    getMediators: jest.fn(async () => mediators),
    findDefaultMediator: jest.fn(async () => defaultMediator),
    getRouting: jest.fn(async (options: unknown) => ({ options })),
    provision: jest.fn(async () => v2),
    setDefaultMediator: jest.fn(async () => undefined),
    initiateMessagePickup: jest.fn(async () => undefined),
  }
  const oob = {
    parseInvitation: jest.fn(async () => ({
      v2Invitation: v2Invitation ? { from: 'did:peer:2.mediator' } : undefined,
    })),
    receiveInvitation: jest.fn(async () => ({ connectionRecord: { id: 'c-med', didcommVersion: 'v2' } })),
  }
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn() } },
    modules: { didcomm: { mediationRecipient: recipient, oob } },
  }
  return { agent: agent as never, recipient, oob }
}

describe('findV2MediationRecord', () => {
  it('returns only a GRANTED v2 record', async () => {
    const requested = { ...v2, id: 'm-v2-req', state: DidCommMediationState.Requested }
    expect(await findV2MediationRecord(fakeAgent([v1, requested]).agent)).toBeUndefined()
    expect(await findV2MediationRecord(fakeAgent([v1, v2]).agent)).toBe(v2)
  })
})

describe('getRoutingForV2', () => {
  it('names the v2 mediator explicitly when provisioned', async () => {
    const { agent, recipient } = fakeAgent([v1, v2])
    await getRoutingForV2(agent)
    expect(recipient.getRouting).toHaveBeenCalledWith({ mediatorId: 'm-v2' })
  })

  it('never falls back to the v1 default: unmediated when there is no v2 record', async () => {
    const { agent, recipient } = fakeAgent([v1])
    await getRoutingForV2(agent)
    expect(recipient.getRouting).toHaveBeenCalledWith({ useDefaultMediator: false })
  })
})

describe('Coordinate Mediation 2.0 is retired (step 1 of 3): the wrappers say so, and touch nothing', () => {
  afterEach(() => setV2MediationEnabled(false))

  it('provisionV2Mediation throws the retirement, and neither parses, accepts nor provisions anything', async () => {
    const { agent, recipient, oob } = fakeAgent([v1])
    await expect(provisionV2Mediation(agent, 'https://m/?_oob=x')).rejects.toThrow(
      'Coordinate Mediation 2.0 is retired in this build; the wallet mailbox replaces it'
    )
    expect(oob.parseInvitation).not.toHaveBeenCalled()
    expect(oob.receiveInvitation).not.toHaveBeenCalled()
    expect(recipient.provision).not.toHaveBeenCalled()
    expect(recipient.setDefaultMediator).not.toHaveBeenCalled()
  })

  it('startV2MessagePickup returns false and starts nothing, even with the switch on and a granted v2 record', async () => {
    setV2MediationEnabled(true)
    const { agent, recipient } = fakeAgent([v1, v2])
    expect(await startV2MessagePickup(agent)).toBe(false)
    expect(recipient.initiateMessagePickup).not.toHaveBeenCalled()
  })

  it('setV2MediationEnabled still records the flag (the pinned wallet calls it), and it is off as shipped', () => {
    jest.isolateModules(() => {
      expect((require('../v2Routing') as typeof import('../v2Routing')).isV2MediationEnabled()).toBe(false)
    })
    setV2MediationEnabled(true)
    expect(isV2MediationEnabled()).toBe(true)
  })

  it('CONTROL: findV2MediationRecord, which the wallet’s already-provisioned guard reads, still finds a granted v2 record', async () => {
    const { agent } = fakeAgent([v1, v2])
    expect(await findV2MediationRecord(agent)).toBe(v2)
  })
})

describe('routingForInvitation: every accept path routes a v2 invitation the v2 way', () => {
  it('a v2 invitation: v2 routing (the v2 record, or unmediated), never the v1 default', async () => {
    const withRecord = fakeAgent([v1, v2])
    await expect(routingForInvitation(withRecord.agent, { v2Invitation: {} })).resolves.toEqual({
      options: { mediatorId: 'm-v2' },
    })
    const without = fakeAgent([v1])
    await expect(routingForInvitation(without.agent, { v2Invitation: {} })).resolves.toEqual({
      options: { useDefaultMediator: false },
    })
  })

  it('CONTROL: a v1 invitation: undefined, so Credo routes through the default mediator exactly as before', async () => {
    const { agent, recipient } = fakeAgent([v1, v2])
    await expect(routingForInvitation(agent, {})).resolves.toBeUndefined()
    expect(recipient.getRouting).not.toHaveBeenCalled()
  })
})
