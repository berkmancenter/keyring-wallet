/**
 * `createRelationshipInvitation` must not mint an out-of-band/2.0 invitation
 * from an agent that was never actually constructed with v2 support. The
 * developer toggle (setDidCommV2Enabled) is a live in-memory flag, but the
 * agent's own DidCommModule `didcommVersions` is fixed at construction
 * (bc-agent-modules.ts) — toggling on without a restart used to produce a
 * v2 invitation this same agent could never process. The fix checks the
 * agent's real capability (`agent.modules.didcomm.config.isSupported('v2')`)
 * before trusting the flag.
 */
import { createRelationshipInvitation } from '../../vrc-manager'
import { setDidCommV2Enabled } from '../../../trust-tasks/ceremony'

function fakeAgent(agentSupportsV2: boolean) {
  const createInvitation = jest.fn(async () => ({
    id: 'oob-1',
    outOfBandInvitation: { toUrl: () => 'https://example.test/invite' },
  }))
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    modules: {
      didcomm: {
        config: { isSupported: (v: string) => (v === 'v2' ? agentSupportsV2 : true) },
        oob: { createInvitation },
        // Only reached when a v2 invitation is actually minted (getRoutingForV2
        // → findV2MediationRecord): no v2 mediation record provisioned in this test.
        mediationRecipient: {
          getMediators: jest.fn().mockResolvedValue([]),
          getRouting: jest.fn().mockResolvedValue({}),
        },
      },
    },
  }
  return { agent: agent as never, createInvitation }
}

describe('createRelationshipInvitation — DIDComm v2 developer-flag vs. agent-capability gate', () => {
  afterEach(() => {
    setDidCommV2Enabled(false)
  })

  test('flag on, agent actually built with v2 support: mints a v2 invitation', async () => {
    setDidCommV2Enabled(true)
    const { agent, createInvitation } = fakeAgent(true)

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v2' }))
  })

  test('flag on, but the agent was constructed BEFORE the toggle (no restart): falls back to v1 and warns', async () => {
    setDidCommV2Enabled(true)
    const { agent, createInvitation } = fakeAgent(false)

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
    expect((agent as unknown as { config: { logger: { warn: jest.Mock } } }).config.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('restart required')
    )
  })

  test('flag off: mints a v1 invitation regardless of agent capability', async () => {
    setDidCommV2Enabled(false)
    const { agent, createInvitation } = fakeAgent(true)

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
  })
})
