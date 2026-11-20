/**
 * v2Routing: the second (Coordinate Mediation 2.0) mediation record beside
 * the v1 default — didcomm_v2_subtask.md V2 step 4 / §7.1.
 */
import { DidCommMediationState, DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

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

describe('provisionV2Mediation', () => {
  it('is idempotent: an existing grant is returned without touching the mediator', async () => {
    const { agent, recipient, oob } = fakeAgent([v1, v2])
    expect(await provisionV2Mediation(agent, 'https://m/?_oob=x')).toBe(v2)
    expect(oob.receiveInvitation).not.toHaveBeenCalled()
    expect(recipient.provision).not.toHaveBeenCalled()
  })

  it('accepts the invitation unmediated, provisions, and restores the v1 default mediator', async () => {
    const { agent, recipient, oob } = fakeAgent([v1])
    expect(await provisionV2Mediation(agent, 'https://m/?_oob=x')).toBe(v2)

    expect(recipient.getRouting).toHaveBeenCalledWith({ useDefaultMediator: false })
    expect(oob.receiveInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ v2Invitation: expect.anything() }),
      expect.objectContaining({ routing: { options: { useDefaultMediator: false } } })
    )
    expect(recipient.provision).toHaveBeenCalledWith({ id: 'c-med', didcommVersion: 'v2' })
    // provision() made the v2 grant the default; the v1 mediator gets the role back.
    expect(recipient.setDefaultMediator).toHaveBeenCalledWith(v1)
  })

  it('leaves the v2 grant as default when the wallet had no mediator before', async () => {
    const { agent, recipient } = fakeAgent([], { defaultMediator: null })
    await provisionV2Mediation(agent, 'https://m/?_oob=x')
    expect(recipient.setDefaultMediator).not.toHaveBeenCalled()
  })

  it('refuses a v1 invitation in MEDIATOR_V2_URL', async () => {
    const { agent } = fakeAgent([v1], { v2Invitation: false })
    await expect(provisionV2Mediation(agent, 'https://m/?oob=x')).rejects.toThrow(/out-of-band\/2\.0/)
  })
})

describe('startV2MessagePickup', () => {
  afterEach(() => setV2MediationEnabled(false))

  it('the v2 mailbox is off as shipped', () => {
    jest.isolateModules(() => {
      expect((require('../v2Routing') as typeof import('../v2Routing')).isV2MediationEnabled()).toBe(false)
    })
    expect(isV2MediationEnabled()).toBe(false)
  })

  it('with the v2 mailbox off, no Pickup 4.0 loop starts, even for a v2 record provisioned while it was on', async () => {
    const { agent, recipient } = fakeAgent([v1, v2])
    expect(await startV2MessagePickup(agent)).toBe(false)
    expect(recipient.initiateMessagePickup).not.toHaveBeenCalled()
  })

  it('CONTROL: with the v2 mailbox on, it starts Pickup 4.0 for the v2 record and reports whether it did', async () => {
    setV2MediationEnabled(true)
    const { agent, recipient } = fakeAgent([v1, v2])
    expect(await startV2MessagePickup(agent)).toBe(true)
    expect(recipient.initiateMessagePickup).toHaveBeenCalledWith(v2, DidCommMediatorPickupStrategy.PickUpV4)

    const none = fakeAgent([v1])
    expect(await startV2MessagePickup(none.agent)).toBe(false)
    expect(none.recipient.initiateMessagePickup).not.toHaveBeenCalled()
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
