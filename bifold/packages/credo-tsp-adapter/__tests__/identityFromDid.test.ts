/**
 * identityFromDid — the shape TspCarriage needs: derive a TspIdentity from
 * one of the WALLET'S OWN existing DIDs (e.g. a DIDComm connection's own
 * DID), reusing that DID's existing signing key rather than minting a new
 * one for TSP.
 */
import '@openwallet-foundation/askar-nodejs'

import { Agent, Kms, TypedArrayEncoder } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { convertPublicKeyToX25519 } from '@stablelib/ed25519'

import { identityFromDid } from '../src/identity'

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

describe('identityFromDid', () => {
  let agent: Agent

  beforeAll(async () => {
    agent = new Agent({
      config: { label: 'identityFromDid-test' },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: { id: `credo-tsp-adapter-identityFromDid-${Date.now()}`, key: 'test-key' },
        }),
      },
    })
    await agent.initialize()
  })

  afterAll(async () => {
    await agent.shutdown()
  })

  test('derives SigningKey/KeyAgreement from an EXISTING did:key, matching the key it was created from', async () => {
    const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
    const { keyId, publicJwk } = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' }, backend: 'askar' })
    if (!publicJwk.x) throw new Error('test setup: created key has no public x coordinate')
    const publicKey = TypedArrayEncoder.fromBase64(publicJwk.x)

    const created = await agent.dids.create({ method: 'key', options: { keyId } })
    if (created.didState.state !== 'finished' || !created.didState.did) {
      throw new Error(`test setup: did:key creation failed: ${JSON.stringify(created.didState)}`)
    }

    const identity = await identityFromDid(agent, created.didState.did)
    expect(eq(identity.signingKey.publicKey, publicKey)).toBe(true)
    expect(eq(identity.keyAgreement.publicKey, convertPublicKeyToX25519(publicKey))).toBe(true)

    const message = new TextEncoder().encode('signed via identityFromDid')
    const signature = await identity.signingKey.sign(message)
    expect(signature.length).toBe(64)
  }, 30000)
})
