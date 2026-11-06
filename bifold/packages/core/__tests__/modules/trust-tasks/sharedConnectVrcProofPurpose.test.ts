/**
 * @jest-environment node
 *
 * The JCS VRC verify binds the named key to the issuer's assertionMethod (Alberto's decision 2 on bifold #947:
 * required before the shared-connect switch is turned on for anyone). Before it, a proof naming
 * `<issuer>#does-not-exist` matched no key, fell back to the issuer's first signing key, and verified: the sender
 * chose that outcome. The credentials here are signed by the independent spec fixture (its own eddsa-jcs-2022),
 * not by Keyring, and the issuer's did:peer:0 is resolved by a real agent.
 */
import '../../helpers/realAskar'

jest.mock('@credo-ts/core', () =>
  jest.requireActual(
    require.resolve('@credo-ts/core', { paths: [require('path').resolve(__dirname, '../../../../..')] })
  )
)
jest.mock('@credo-ts/askar', () =>
  jest.requireActual(
    require.resolve('@credo-ts/askar', { paths: [require('path').resolve(__dirname, '../../../../..')] })
  )
)

import { AskarModule } from '@credo-ts/askar'
import { Agent } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Inviter, signJcs } from '../../../src/modules/trust-tasks/__tests__/fixtures/shared-connect/inviter'
import { verifySharedConnectVrc } from '../../../src/modules/trust-tasks/module/sharedConnectCredential'

describe('the JCS VRC verify names a key under the issuer assertionMethod', () => {
  let agent: Agent
  const storeDir = mkdtempSync(join(tmpdir(), 'shared-connect-purpose-'))

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: {},
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: `shared-connect-purpose-${process.pid}-${Math.random().toString(36).slice(2)}`,
            key: 'test-key',
            database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
          },
        }),
      },
    })
    await agent.initialize()
  }, 60000)

  afterAll(async () => {
    await agent?.shutdown()
    rmSync(storeDir, { recursive: true, force: true })
  })

  const issuer = new Inviter('did:web:relay.example.org')
  const credential = () => ({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'RelationshipCredential'],
    issuer: issuer.relDid,
    validFrom: '2026-11-06T00:00:00Z',
    credentialSubject: { id: 'did:peer:0z6MkSomeoneElse' },
  })
  // did:peer:0's one key, as its document names it: `<did>#<multibase>`.
  const ownKey = `${issuer.relDid}#${issuer.relDid.slice('did:peer:0'.length)}`

  it('verifies a credential whose proof names the key the issuer lists', async () => {
    expect(await verifySharedConnectVrc(agent, signJcs(credential(), issuer.relSk, ownKey))).toBe(true)
  })

  it('refuses a proof that names a key the issuer does not list, though the signature is by its own key', async () => {
    const signed = signJcs(credential(), issuer.relSk, `${issuer.relDid}#does-not-exist`)
    expect(await verifySharedConnectVrc(agent, signed)).toBe(false)
  })
})
