/**
 * Agent start-up's DIDComm v2 wiring (useBCAgentSetup.ts): which switches bifold is told, when the wallet mailbox
 * opens, and that nothing calls the retired Coordinate Mediation 2.0 entry points any more (bifold v2Routing.ts:
 * provisionV2Mediation, startV2MessagePickup and setV2MediationEnabled are wrappers until the wallet stops calling
 * them, which is this change).
 */
import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'
import { readFileSync } from 'fs'
import { join } from 'path'
import Config from 'react-native-config'

import {
  applyDidCommSwitches,
  openWalletMailboxIfConfigured,
  restartPickupOnReturn,
  v2MailboxOn,
} from './useBCAgentSetup'
import { initialState } from '../store'

const mockOpenWalletMailbox = jest.fn()
const mockSetTsp = jest.fn()
const mockSetV2 = jest.fn()
// The retired entry points, mocked so a call to any of them would be seen.
const mockRetired = {
  provisionV2Mediation: jest.fn(),
  startV2MessagePickup: jest.fn(),
  setV2MediationEnabled: jest.fn(),
}

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  openWalletMailbox: (...args: unknown[]) => mockOpenWalletMailbox(...args),
  setTspCarriageEnabled: (on: boolean) => mockSetTsp(on),
  setDidCommV2Enabled: (on: boolean) => mockSetV2(on),
  provisionV2Mediation: (...args: unknown[]) => mockRetired.provisionV2Mediation(...args),
  startV2MessagePickup: (...args: unknown[]) => mockRetired.startV2MessagePickup(...args),
  setV2MediationEnabled: (...args: unknown[]) => mockRetired.setV2MediationEnabled(...args),
}))

jest.mock('react-native-config', () => ({ MAILBOX_MEDIATOR_DID: undefined }))

// The mocked Config, typed so a case can set the DID. Cast once into a name:
// assigning through `(Config as ...)` at the start of a line needs a leading
// semicolon under prettier and forbids one under eslint's no-extra-semi, so
// the two tools reformat each other forever (2026-09-16).
const mockedConfig = Config as unknown as { MAILBOX_MEDIATOR_DID?: string }

const MEDIATOR = 'did:peer:2.keyring-affinidi-mediator'

function fakeAgent() {
  return {
    config: { logger: { info: jest.fn(), warn: jest.fn() } },
  } as unknown as { config: { logger: { info: jest.Mock; warn: jest.Mock } } }
}

describe('openWalletMailboxIfConfigured: testers first, and never in the way of start-up', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedConfig.MAILBOX_MEDIATOR_DID = undefined
  })

  it('as every build ships today (switch off, no mediator): nothing opens, and the log says why', async () => {
    const agent = fakeAgent()
    await openWalletMailboxIfConfigured(agent as never, false)
    expect(mockOpenWalletMailbox).not.toHaveBeenCalled()
    expect(agent.config.logger.info).toHaveBeenCalledWith(
      '[WalletMailbox] not opening: switch=off, MAILBOX_MEDIATOR_DID=unset'
    )
  })

  it('the switch on, but no mediator configured: nothing opens', async () => {
    await openWalletMailboxIfConfigured(fakeAgent() as never, true)
    expect(mockOpenWalletMailbox).not.toHaveBeenCalled()
  })

  it('a mediator configured, but the switch off (not a tester): nothing opens', async () => {
    mockedConfig.MAILBOX_MEDIATOR_DID = MEDIATOR
    await openWalletMailboxIfConfigured(fakeAgent() as never, false)
    expect(mockOpenWalletMailbox).not.toHaveBeenCalled()
  })

  it('CONTROL: the switch on and a mediator configured: the mailbox opens at that mediator', async () => {
    mockedConfig.MAILBOX_MEDIATOR_DID = MEDIATOR
    mockOpenWalletMailbox.mockResolvedValueOnce({ did: 'did:peer:2.mailbox', mediatorDid: MEDIATOR })
    const agent = fakeAgent()
    await openWalletMailboxIfConfigured(agent as never, true)
    expect(mockOpenWalletMailbox).toHaveBeenCalledWith(agent, MEDIATOR)
  })

  it('a mediator that cannot be reached is one warning; the phone carries on over v1', async () => {
    mockedConfig.MAILBOX_MEDIATOR_DID = MEDIATOR
    mockOpenWalletMailbox.mockRejectedValueOnce(new Error('mediator unreachable'))
    const agent = fakeAgent()
    await expect(openWalletMailboxIfConfigured(agent as never, true)).resolves.toBeUndefined()
    expect(agent.config.logger.warn).toHaveBeenCalledWith(
      '[WalletMailbox] could not open, continuing on v1 only: mediator unreachable'
    )
  })
})

describe('the retired Coordinate Mediation 2.0 entry points are gone from start-up, not just unreachable', () => {
  const source = readFileSync(join(__dirname, 'useBCAgentSetup.ts'), 'utf8')

  it.each(['provisionV2Mediation', 'startV2MessagePickup', 'setV2MediationEnabled', 'MEDIATOR_V2_URL'])(
    'useBCAgentSetup.ts names %s nowhere',
    (name) => {
      expect(source).not.toContain(name)
    }
  )

  it('CONTROL: the check reads the real module (it names what replaced them)', () => {
    expect(source).toContain('openWalletMailbox')
    expect(source).toContain('MAILBOX_MEDIATOR_DID')
  })
})

// The one restart on a return to the foreground, run by whichever handler owns the return (utils/livePickup.ts
// appRestartsPickupOnReturn). Polling here: the live switch is off by default.
describe('restartPickupOnReturn', () => {
  const pickupAgent = (stop: () => Promise<void> = async () => undefined) => {
    const calls: string[] = []
    const mediationRecipient = {
      stopMessagePickup: jest.fn(async () => {
        calls.push('stop')
        await stop()
      }),
      initiateMessagePickup: jest.fn(async (_record: unknown, strategy: string) => {
        calls.push(`initiate ${strategy}`)
      }),
    }
    return { agent: { modules: { didcomm: { mediationRecipient } } } as never, calls }
  }
  const logger = { info: jest.fn(), warn: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("stops, then starts the app's own pickup (PickUpV2 named explicitly), and no Pickup 4.0 loop", async () => {
    const { agent, calls } = pickupAgent()
    await restartPickupOnReturn(agent, logger)
    expect(calls).toEqual(['stop', 'stop', `initiate ${DidCommMediatorPickupStrategy.PickUpV2}`])
    expect(mockRetired.startV2MessagePickup).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('Message pickup restarted after returning to the foreground')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('never throws: a store closing under it is one warning, nothing else', async () => {
    const { agent, calls } = pickupAgent(async () => {
      throw new Error('Error executing query. Invalid store handle')
    })
    await expect(restartPickupOnReturn(agent, logger)).resolves.toBeUndefined()
    expect(calls).toEqual(['stop'])
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not restart message pickup on foreground: Error executing query. Invalid store handle'
    )
    expect(logger.info).not.toHaveBeenCalled()
  })
})

describe('applyDidCommSwitches: what bifold is told at every agent start', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('as shipped (nothing saved): TSP on, DIDComm v2 on; the mailbox switch is not bifold’s to know', () => {
    applyDidCommSwitches(initialState.developer)
    expect(mockSetTsp).toHaveBeenLastCalledWith(true)
    expect(mockSetV2).toHaveBeenLastCalledWith(true)
    expect(mockRetired.setV2MediationEnabled).not.toHaveBeenCalled()
  })

  test('CONTROL: the opt-outs reach bifold as off', () => {
    applyDidCommSwitches({ enableTspCarriage: false, enableDidCommV2: false, enableV2Mailbox: false })
    expect(mockSetTsp).toHaveBeenLastCalledWith(false)
    expect(mockSetV2).toHaveBeenLastCalledWith(false)
  })

  test.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('v2 %s, mailbox switch %s → the mailbox may open: %s (never without v2)', (v2, mailbox, expected) => {
    expect(v2MailboxOn({ enableDidCommV2: v2, enableV2Mailbox: mailbox })).toBe(expected)
  })
})
