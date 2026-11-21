/**
 * Which invitation `createRelationshipInvitation` mints (canMintV2Invitation, ceremony.ts).
 *
 * DIDComm v2 is on as shipped, so a phone ACCEPTS v2. It MINTS out-of-band/2.0 only through its wallet mailbox
 * (trust-tasks/module/walletMailbox.ts), on a fresh contact DID that names it. Without an open mailbox a v2 invitation
 * would name an endpoint no peer can deliver to (a phone holds outbound transports only; the v1 default cannot route
 * a did:peer:2, tsp-reference/ref-17 finding 1), so the phone mints v1. Coordinate Mediation 2.0 is not a route any
 * more: the Affinidi mediator has none, and its provisioning is retired (v2Routing.ts). The agent's own capability is
 * still checked: its didcommVersions is fixed at construction, so a v2 setting turned on without a restart cannot mint.
 *
 * The mailbox is stood in for here (walletMailboxOf, mintContactDid); real agents minting and connecting through one
 * are __tests__/modules/trust-tasks/walletMailbox.credo.test.ts.
 */
import { createRelationshipInvitation } from '../../vrc-manager'
import {
  DIDCOMM_V2_MINT_REMOTE_OFF,
  DIDCOMM_V2_ON_BY_DEFAULT,
  canMintV2Invitation,
  isDidCommV2Enabled,
  setDidCommV2Enabled,
} from '../../../trust-tasks/ceremony'
import * as walletMailbox from '../../../trust-tasks/module/walletMailbox'
import { setV2MediationEnabled } from '../../../trust-tasks/v2Routing'

const V2_RECORD = { id: 'mediation-v2', protocolVersion: 'v2', state: 'granted' }
const MAILBOX = { did: 'did:peer:2.mailbox', mediatorDid: 'did:peer:2.mediator', session: {} }
const CONTACT_DID = 'did:peer:2.contact-for-this-invitation'

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

function mailboxOpen(open = true) {
  jest.spyOn(walletMailbox, 'walletMailboxOf').mockReturnValue((open ? MAILBOX : undefined) as never)
  return jest.spyOn(walletMailbox, 'mintContactDid').mockResolvedValue(CONTACT_DID)
}

describe('createRelationshipInvitation: v2 accepted by default, minted only through the wallet mailbox', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    setDidCommV2Enabled(DIDCOMM_V2_ON_BY_DEFAULT)
    setV2MediationEnabled(false)
    DIDCOMM_V2_MINT_REMOTE_OFF.off = false
  })

  test('as shipped: DIDComm v2 on', () => {
    jest.isolateModules(() => {
      const ceremony = require('../../../trust-tasks/ceremony') as typeof import('../../../trust-tasks/ceremony')
      expect(ceremony.DIDCOMM_V2_ON_BY_DEFAULT).toBe(true)
      expect(ceremony.isDidCommV2Enabled()).toBe(true)
    })
    expect(isDidCommV2Enabled()).toBe(true)
  })

  test('DEFAULT: v2 on, no mailbox open → a v1 invitation, through the default mediator, and the log says why', async () => {
    const mint = mailboxOpen(false)
    const { agent, createInvitation, getRouting, logger } = fakeAgent()

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1', routing: undefined }))
    expect(mint).not.toHaveBeenCalled()
    expect(getRouting).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('no wallet mailbox is open'))
  })

  test('CONTROL: the mailbox open → out-of-band/2.0 on a fresh contact DID that names it, with no routing', async () => {
    const mint = mailboxOpen()
    const { agent, createInvitation, getRouting } = fakeAgent()

    await createRelationshipInvitation(agent, 'wallet')

    expect(mint).toHaveBeenCalledWith(agent, MAILBOX)
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ didCommVersion: 'v2', ourDid: CONTACT_DID, routing: undefined })
    )
    expect(getRouting).not.toHaveBeenCalled()
    await expect(canMintV2Invitation(agent)).resolves.toEqual(expect.objectContaining({ v2: true, via: 'mailbox' }))
  })

  test('RETIRED: the old switch on with a granted Coordinate Mediation 2.0 record, no mailbox → v1, not routed through it', async () => {
    mailboxOpen(false)
    setV2MediationEnabled(true)
    const { agent, createInvitation, getRouting } = fakeAgent({ v2Record: true })

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1', routing: undefined }))
    expect(getRouting).not.toHaveBeenCalled()
  })

  test('the mailbox closes between the check and the mint → v1 (a v2 invitation would name nothing)', async () => {
    jest
      .spyOn(walletMailbox, 'walletMailboxOf')
      .mockReturnValueOnce(MAILBOX as never)
      .mockReturnValueOnce(undefined)
    const mint = jest.spyOn(walletMailbox, 'mintContactDid').mockResolvedValue(CONTACT_DID)
    const { agent, createInvitation, logger } = fakeAgent()

    await createRelationshipInvitation(agent, 'wallet')

    expect(mint).not.toHaveBeenCalled()
    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('the mailbox closed'))
  })

  test('the agent was constructed without v2 (no restart since the setting) → v1, and the log says so', async () => {
    mailboxOpen()
    const { agent, createInvitation, logger } = fakeAgent({ agentSupportsV2: false })

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('restart required'))
  })

  test('DIDComm v2 off (the opt-out) → v1, whatever the mailbox', async () => {
    mailboxOpen()
    setDidCommV2Enabled(false)
    const { agent, createInvitation } = fakeAgent()

    await createRelationshipInvitation(agent, 'wallet')

    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({ didCommVersion: 'v1' }))
  })

  test('the release kill → v1, whatever is set', async () => {
    mailboxOpen()
    DIDCOMM_V2_MINT_REMOTE_OFF.off = true
    const { agent, createInvitation } = fakeAgent()

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
