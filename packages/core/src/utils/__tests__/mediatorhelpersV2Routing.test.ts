/**
 * setMediationToDefault accepts the mediator's invitation with the routing its version needs (routingForInvitation):
 * with DIDComm v2 accepted by default, a v2 invitation reaching this path through the default (v1) mediator would hit
 * "DIDComm v2 OOB with mediated routing requires Coordinate Mediation 2.0" (tsp-reference/ref-17 finding 1).
 */
import { setMediationToDefault } from '../mediatorhelpers'

function fakeAgent(invitation: Record<string, unknown>) {
  const receiveInvitation = jest.fn(async () => ({ connectionRecord: { id: 'c-med', isReady: true } }))
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    modules: {
      didcomm: {
        oob: {
          parseInvitation: jest.fn(async () => invitation),
          findByReceivedInvitationId: jest.fn(async () => null),
          receiveInvitation,
        },
        connections: { findAllByOutOfBandId: jest.fn(async () => []), returnWhenIsConnected: jest.fn() },
        mediationRecipient: {
          getMediators: jest.fn(async () => []),
          getRouting: jest.fn(async (options: unknown) => ({ options })),
          provision: jest.fn(async () => ({ id: 'm-1', connectionId: 'c-med' })),
          findDefaultMediator: jest.fn(async () => undefined),
          setDefaultMediator: jest.fn(async () => undefined),
        },
      },
    },
  }
  return { agent: agent as never, receiveInvitation }
}

describe('setMediationToDefault: invitation routing by version', () => {
  it('CONTROL: a v1 invitation is accepted with no routing (an empty config), through the default mediator as before', async () => {
    const invitation = { id: 'inv-v1' }
    const { agent, receiveInvitation } = fakeAgent(invitation)
    await setMediationToDefault(agent, 'https://mediator.example/v1')
    expect(receiveInvitation).toHaveBeenCalledWith(invitation, {})
  })

  it('a v2 invitation is accepted with v2 routing, never the v1 default', async () => {
    const invitation = { id: 'inv-v2', v2Invitation: { from: 'did:peer:2.mediator' } }
    const { agent, receiveInvitation } = fakeAgent(invitation)
    await setMediationToDefault(agent, 'https://mediator.example/v2')
    expect(receiveInvitation).toHaveBeenCalledWith(invitation, { routing: { options: { useDefaultMediator: false } } })
  })
})
