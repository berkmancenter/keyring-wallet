/**
 * Persona key copies held in memory only (#10, plan part C), over real Askar:
 * the app's in-memory KMS backend holds a key the wallet's store never sees,
 * Credo signs with it by key id alone, this adapter's key agreement finds it,
 * and once the backend is cleared nothing can use it.
 */
// MUST be the first import — see README.md's "import-order gotcha".
import '@openwallet-foundation/askar-nodejs'

import { Agent, Kms, TypedArrayEncoder } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { AskarKeyManagementService, AskarModule, AskarStoreManager } from '@credo-ts/askar'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { Key, KeyAlgorithm } from '@openwallet-foundation/askar-shared'

import { EphemeralKeyManagementService } from '../../core/src/modules/trust-tasks/module/EphemeralKeyManagementService'
import { keyAgreementFromAskarKey } from '../src/identity'

async function makeAgent(): Promise<{ agent: Agent; memory: EphemeralKeyManagementService }> {
  const memory = new EphemeralKeyManagementService()
  const agent = new Agent({
    config: { label: 'in-memory-keys' },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        enableKms: false,
        store: { id: `in-memory-keys-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: 'test-key' },
      }),
      kms: new Kms.KeyManagementModule({ backends: [new AskarKeyManagementService(), memory], defaultBackend: 'askar' }),
    },
  })
  await agent.initialize()
  return { agent, memory }
}

/** A fresh X25519 key pair as a private JWK, the shape a VTA export decodes to. */
function x25519Jwk(kid: string) {
  const key = Key.generate(KeyAlgorithm.X25519)
  return {
    jwk: {
      kty: 'OKP' as const,
      crv: 'X25519' as const,
      d: TypedArrayEncoder.toBase64Url(key.secretBytes),
      x: TypedArrayEncoder.toBase64Url(key.publicBytes),
      kid,
    },
    publicBytes: key.publicBytes,
  }
}

describe('persona keys held in memory only', () => {
  let agent: Agent
  let memory: EphemeralKeyManagementService

  beforeAll(async () => {
    ;({ agent, memory } = await makeAgent())
  })

  afterAll(async () => {
    await memory.clear()
    await agent.shutdown()
  })

  test('a key imported into memory signs by its id, and the wallet store never holds it', async () => {
    const kid = 'vta-copy:did:webvh:agent:did:webvh:persona#key-0'
    const signer = Key.generate(KeyAlgorithm.Ed25519)
    await agent.kms.importKey({
      backend: 'ephemeral',
      privateJwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        d: TypedArrayEncoder.toBase64Url(signer.secretBytes),
        x: TypedArrayEncoder.toBase64Url(signer.publicBytes),
        kid,
      },
    })

    const data = new TextEncoder().encode('a vetting statement')
    const { signature } = await agent.kms.sign({ keyId: kid, algorithm: 'EdDSA', data })
    expect(signer.verifySignature({ message: data, signature: new Uint8Array(signature) })).toBe(true)

    const inWallet = await agent.dependencyManager
      .resolve(AskarStoreManager)
      .withSession(agent.context, (session) => session.fetchKey({ name: kid }))
    expect(inWallet).toBeNull()
  })

  test('TSP key agreement finds the in-memory key, and agrees with the peer', async () => {
    const kid = 'vta-copy:did:webvh:agent:did:webvh:persona#key-1'
    const mine = x25519Jwk(kid)
    await agent.kms.importKey({ backend: 'ephemeral', privateJwk: mine.jwk })
    const peer = Key.generate(KeyAlgorithm.X25519)

    const port = keyAgreementFromAskarKey(agent, kid, mine.publicBytes)
    const ours = await port.agree(peer.publicBytes)
    const theirs = peer.keyFromKeyExchange({
      algorithm: KeyAlgorithm.Chacha20C20P,
      publicKey: Key.fromPublicBytes({ algorithm: KeyAlgorithm.X25519, publicKey: mine.publicBytes }),
    }).secretBytes
    expect(Array.from(ours)).toEqual(Array.from(theirs))
  })

  test('new keys are still created in the wallet store, never in memory', async () => {
    const created = await agent.kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
    const inWallet = await agent.dependencyManager
      .resolve(AskarStoreManager)
      .withSession(agent.context, (session) => session.fetchKey({ name: created.keyId }))
    expect(inWallet).not.toBeNull()
  })

  test('after clearing, nothing can use the key, and fetching it again works', async () => {
    const kid = 'vta-copy:did:webvh:agent:did:webvh:persona#key-2'
    const signer = Key.generate(KeyAlgorithm.Ed25519)
    const privateJwk = {
      kty: 'OKP' as const,
      crv: 'Ed25519' as const,
      d: TypedArrayEncoder.toBase64Url(signer.secretBytes),
      x: TypedArrayEncoder.toBase64Url(signer.publicBytes),
      kid,
    }
    await agent.kms.importKey({ backend: 'ephemeral', privateJwk })
    await memory.clear()

    const data = new TextEncoder().encode('after the lock')
    await expect(agent.kms.sign({ keyId: kid, algorithm: 'EdDSA', data })).rejects.toThrow()
    await expect(memory.withKey(kid, () => true)).resolves.toBeUndefined()

    await agent.kms.importKey({ backend: 'ephemeral', privateJwk })
    const { signature } = await agent.kms.sign({ keyId: kid, algorithm: 'EdDSA', data })
    expect(signer.verifySignature({ message: data, signature: new Uint8Array(signature) })).toBe(true)
  })
})
