/**
 * Which invitation `createRelationshipInvitation` mints (canMintV2Invitation, ceremony.ts).
 *
 * DIDComm v2 is on as shipped, so a phone ACCEPTS v2. It MINTS out-of-band/2.0 only through a v2 mailbox: the switch
 * on (off as shipped) and a granted v2 mediation record. Without one, a v2 invitation would name an endpoint no peer
 * can deliver to (a phone holds outbound transports only; the v1 default cannot route a did:peer:2,
 * tsp-reference/ref-17 finding 1), so the phone mints v1, which every build can read. The agent's own capability is
 * still checked: its didcommVersions is fixed at construction, so a v2 setting turned on without a restart cannot mint.
 *
 * Unit-level only for the v2 row: no store build has a v2 mailbox (MEDIATOR_V2_URL is empty there).
 */
import { createRelationshipInvitation } from '../../vrc-manager'
import {
  DIDCOMM_V2_MINT_REMOTE_OFF,
  DIDCOMM_V2_ON_BY_DEFAULT,
  canMintV2Invitation,
  isDidCommV2Enabled,
  setDidCommV2Enabled,
} from '../../../trust-tasks/ceremony'
import { isV2MediationEnabled, setV2MediationEnabled } from '../../../trust-tasks/v2Routing'

const V2_RECORD = { id: 'mediation-v2', protocolVersion: 'v2', state: 'granted' }

function fakeAgent({
  agentSupportsV2 = true,
  v2Record = false,
}: { agentSupportsV2?: boolean; v2Record?: boolean } = {}) {
  const createInvitation = jest.fn(async () => ({
    id: 'oob-1',
    outOfBandInvitation: { toUrl: () => 'https://example.test/invite' },
  }))
  const getRouting = jest.fn(async (options: unknown) => ({ via: options }))
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    modules: {
      didcomm: {
        config: { isSupported: (v: string) => (v === 'v2' ? agentSupportsV2 : true) },
        oob: { createInvitation },
        mediationRecipient: {
          getMediators: jest.fn().mockResolvedValue(v2Record ? [V2_RECORD] : []),
          getRouting,
        },
      },
    },
  }
  return { agent: agent as never, createInvitation, getRouting, logger: agent.config.logger }
}

describe('createRelationshipInvitation: v2 accepted by default, minted only through a v2 mailbox', () => {
  afterEach(() => {
    setDidCommV2Enabled(DIDCOMM_V2_ON_BY_DEFAULT)
    setV2MediationEnabled(false)
    DIDCOMM_V2_MINT_REMOTE_OFF.off = false
  })

  test('as shipped: DIDComm v2 on, the v2 mailbox off', () => {
    jest.isolateModules(() => {
      const ceremony = require('../../../trust-tasks/ceremony') as typeof import('../../../trust-tasks/ceremony')
      const routing = require('../../../trust-tasks/v2Routing') as typeof import('../../../trust-tasks/v2Routing')
      expect(ceremony.DIDCOMM_V2_ON_BY_DEFAULT).toBe(true)
      expect(ceremony.isDidCommV2Enabled()).toBe(true)
      expect(routing.isV2MediationEnabled()).toBe(false)
    })
    expect(isDidCommV2Enabled()).toBe(true)
    expect(isV2MediationEnabled()).toBe(false)
  })

  test('DEFAULT: v2 on, no v2 mailbox → a v1 invitation, through the default mediator, and the log says why', async () => {
    const { agent, createInvitation, getRouting, logger } = fakeAgent({ v2Record: true })

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1', routing: undefined }))
    expect(getRouting).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('the v2 mailbox is off'))
  })

  test('CONTROL: the v2 mailbox on with a granted record → out-of-band/2.0, routed through that record', async () => {
    setV2MediationEnabled(true)
    const { agent, createInvitation, getRouting } = fakeAgent({ v2Record: true })

    await createRelationshipInvitation(agent, 'wallet')

    expect(getRouting).toHaveBeenCalledWith({ mediatorId: V2_RECORD.id })
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ didCommVersion: 'v2', routing: { via: { mediatorId: V2_RECORD.id } } })
    )
  })

  test('the v2 mailbox on but none provisioned → v1 (an unmediated v2 invitation could not be answered)', async () => {
    setV2MediationEnabled(true)
    const { agent, createInvitation, getRouting } = fakeAgent({ v2Record: false })

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
    expect(getRouting).not.toHaveBeenCalled()
  })

  test('the agent was constructed without v2 (no restart since the setting) → v1, and the log says so', async () => {
    setV2MediationEnabled(true)
    const { agent, createInvitation, logger } = fakeAgent({ agentSupportsV2: false, v2Record: true })

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('restart required'))
  })

  test('DIDComm v2 off (the opt-out) → v1, whatever the mailbox', async () => {
    setDidCommV2Enabled(false)
    setV2MediationEnabled(true)
    const { agent, createInvitation } = fakeAgent({ v2Record: true })

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
  })

  test('the release kill → v1, whatever is set', async () => {
    DIDCOMM_V2_MINT_REMOTE_OFF.off = true
    setV2MediationEnabled(true)
    const { agent, createInvitation } = fakeAgent({ v2Record: true })

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
    await expect(canMintV2Invitation(agent)).resolves.toEqual({
      v2: false,
      why: 'v2 invitations are turned off in this release',
    })
  })
})

describe('DIDCOMM_V2_MINT_REMOTE_OFF beats what DIDComm v2 ships as', () => {
  afterEach(() => {
    DIDCOMM_V2_MINT_REMOTE_OFF.off = false
    setDidCommV2Enabled(DIDCOMM_V2_ON_BY_DEFAULT)
  })

  test('with nothing having set it, the kill is the only way it goes off (control: kill lifted, it is on again)', () => {
    jest.isolateModules(() => {
      const fresh = require('../../../trust-tasks/ceremony') as typeof import('../../../trust-tasks/ceremony')
      expect(fresh.isDidCommV2Enabled()).toBe(true)
      fresh.DIDCOMM_V2_MINT_REMOTE_OFF.off = true
      expect(fresh.isDidCommV2Enabled()).toBe(false)
      fresh.DIDCOMM_V2_MINT_REMOTE_OFF.off = false
      expect(fresh.isDidCommV2Enabled()).toBe(true)
    })
  })

  test('the kill beats a run that turned v2 on, and never turns it on', () => {
    setDidCommV2Enabled(true)
    DIDCOMM_V2_MINT_REMOTE_OFF.off = true
    expect(isDidCommV2Enabled()).toBe(false)
    setDidCommV2Enabled(false)
    DIDCOMM_V2_MINT_REMOTE_OFF.off = false
    expect(isDidCommV2Enabled()).toBe(false)
  })
})
