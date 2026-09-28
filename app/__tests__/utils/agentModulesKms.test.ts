/**
 * Every key-management backend @bifold/core relies on is registered in the
 * app's REAL agent modules. Core registers its backends in its own default
 * modules, which Keyring doesn't use; the app builds its own. When #10 added
 * the in-memory backend to core only, unit tests passed and a device refused
 * every in-memory key ("No key management service is configured for backend
 * 'ephemeral'"). This guard reads the list from core, so a new required
 * backend fails here first.
 */
import { REQUIRED_KMS_BACKENDS } from '@bifold/core'

import { getBCAgentModules } from '../../src/utils/bc-agent-modules'

// The app's tests stub the React Native Credo package; its backend only needs a name here.
jest.mock('@credo-ts/react-native', () => ({
  SecureEnvironmentKeyManagementService: class {
    public readonly backend = 'secureEnvironment'
  },
}))

const kmsOf = () =>
  getBCAgentModules({
    walletSecret: { id: 'test-wallet', key: 'test-key' },
    indyNetworks: [],
    mediatorInvitationUrl: 'https://mediator.example/invite?oob=e30',
  } as unknown as Parameters<typeof getBCAgentModules>[0]).kms.config

describe("the app's key-management backends", () => {
  test('cover every backend @bifold/core relies on', () => {
    const registered = kmsOf().backends.map((b) => b.backend)
    for (const required of REQUIRED_KMS_BACKENDS) expect(registered).toContain(required)
  })

  test('keep new keys in the wallet store: askar first and the default, the in-memory one last', () => {
    const kms = kmsOf()
    const registered = kms.backends.map((b) => b.backend)
    expect(registered[0]).toBe('askar')
    expect(kms.defaultBackend.backend).toBe('askar')
    expect(registered[registered.length - 1]).toBe('ephemeral')
  })
})
