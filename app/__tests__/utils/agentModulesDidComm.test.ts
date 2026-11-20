/**
 * The DIDComm part of the app's real agent modules: v2 accepted beside v1 by default, and the options only an inviter
 * of v2 invitations needs (a phone with the v2 mailbox) left off otherwise. v1 stays in every configuration: existing
 * contacts, the mediator and credentials speak it.
 */
import { getBCAgentModules } from '../../src/utils/bc-agent-modules'

jest.mock('@credo-ts/react-native', () => ({
  SecureEnvironmentKeyManagementService: class {
    public readonly backend = 'secureEnvironment'
  },
}))

const didcommOf = (options: { enableDidCommV2?: boolean; enableV2Mailbox?: boolean }) => {
  const didcomm = getBCAgentModules({
    walletSecret: { id: 'test-wallet', key: 'test-key' },
    indyNetworks: [],
    mediatorInvitationUrl: 'https://mediator.example/invite?oob=e30',
    ...options,
  } as unknown as Parameters<typeof getBCAgentModules>[0]).didcomm
  return {
    versions: didcomm.config.didcommVersions,
    autoCreate: didcomm.modules.connections.config.autoCreateConnectionOnFirstMessage,
    mediationVersions: didcomm.modules.mediationRecipient?.config.mediationProtocolVersions,
  }
}

describe("the app's DIDComm configuration", () => {
  test('v2 on, no v2 mailbox (as shipped): accepts v1 and v2; no v2 inviter options, no v2 mediation', () => {
    expect(didcommOf({ enableDidCommV2: true, enableV2Mailbox: false })).toEqual({
      versions: ['v1', 'v2'],
      autoCreate: false,
      mediationVersions: ['v1'],
    })
  })

  test('CONTROL: with the v2 mailbox too, the v2 inviter options and Coordinate Mediation 2.0 are on', () => {
    expect(didcommOf({ enableDidCommV2: true, enableV2Mailbox: true })).toEqual({
      versions: ['v1', 'v2'],
      autoCreate: true,
      mediationVersions: ['v1', 'v2'],
    })
  })

  test('the opt-out: v1 only, and the mailbox switch alone changes nothing', () => {
    const v1Only = { versions: ['v1'], autoCreate: false, mediationVersions: ['v1'] }
    expect(didcommOf({ enableDidCommV2: false })).toEqual(v1Only)
    expect(didcommOf({ enableDidCommV2: false, enableV2Mailbox: true })).toEqual(v1Only)
  })
})
