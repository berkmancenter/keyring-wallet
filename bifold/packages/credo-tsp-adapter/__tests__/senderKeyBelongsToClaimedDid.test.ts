/**
 * `senderKeyBelongsToClaimedDid` (@bifold/trust-tasks, v2Binding.ts) is the
 * fix for the DIDComm v2 first-contact security gap: `ensureV2ConnectionForFirstContact`
 * used to bind a connection's `theirDid` straight from the plaintext `from`
 * header, with nothing checking that the key which actually authenticated
 * the envelope belongs to that claimed DID at all. Tested here (not in
 * @bifold/trust-tasks itself, which has no Askar-backed test infra) because
 * it needs a real resolved DID document and real KMS key material — the
 * same fixtures `identityFromDid.test.ts`'s did:peer:2 case already builds.
 */
import '@openwallet-foundation/askar-nodejs'

import {
  Agent,
  DidDocumentBuilder,
  getEd25519VerificationKey2018,
  getX25519KeyAgreementKey2019,
  Kms,
  PeerDidNumAlgo,
  TypedArrayEncoder,
} from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { senderKeyBelongsToClaimedDid } from '@bifold/trust-tasks'

describe('senderKeyBelongsToClaimedDid', () => {
  let agent: Agent

  beforeAll(async () => {
    agent = new Agent({
      config: { label: 'senderKeyBelongsToClaimedDid-test' },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: { id: `credo-tsp-adapter-senderKeyBelongsToClaimedDid-${Date.now()}`, key: 'test-key' },
        }),
      },
    })
    await agent.initialize()
  })

  afterAll(async () => {
    await agent.shutdown()
  })

  async function createV2StyleDid() {
    const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
    const signing = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' }, backend: 'askar' })
    const agreement = await kms.createKey({ type: { kty: 'OKP', crv: 'X25519' }, backend: 'askar' })
    const signingJwk = Kms.PublicJwk.fromPublicJwk(signing.publicJwk)
    const agreementJwk = Kms.PublicJwk.fromPublicJwk(agreement.publicJwk)
    const didDocument = new DidDocumentBuilder('')
      .addAuthentication(
        getEd25519VerificationKey2018({ id: '#key-1', publicJwk: signingJwk as never, controller: '#id' })
      )
      .addKeyAgreement(
        getX25519KeyAgreementKey2019({ id: '#key-2', publicJwk: agreementJwk as never, controller: '#id' })
      )
      .build()
    const created = await agent.dids.create({
      method: 'peer',
      didDocument,
      options: {
        numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc,
        keys: [
          { didDocumentRelativeKeyId: '#key-1', kmsKeyId: signing.keyId },
          { didDocumentRelativeKeyId: '#key-2', kmsKeyId: agreement.keyId },
        ],
      },
    } as never)
    const did = created.didState.did
    if (created.didState.state !== 'finished' || !did) {
      throw new Error(`test setup: did:peer:2 creation failed: ${JSON.stringify(created.didState)}`)
    }
    const agreementPublicKey = TypedArrayEncoder.fromBase64Url(agreement.publicJwk.x as string)
    return { did, agreementJwk: Kms.PublicJwk.fromPublicJwk(agreement.publicJwk), agreementPublicKey }
  }

  test('the key that actually authenticated the envelope matches the claimed DID: verified', async () => {
    const { did, agreementJwk } = await createV2StyleDid()
    expect(await senderKeyBelongsToClaimedDid(agent, did, agreementJwk)).toBe(true)
  })

  test('an unrelated key claiming to be that DID: refused (the vulnerability this closes)', async () => {
    const { did } = await createV2StyleDid()
    const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
    const unrelated = await kms.createKey({ type: { kty: 'OKP', crv: 'X25519' }, backend: 'askar' })
    const unrelatedJwk = Kms.PublicJwk.fromPublicJwk(unrelated.publicJwk)
    // This is exactly the attack the fix closes: an authenticated sender
    // (some real key) plaintext-claims to be `did`, whose document does not
    // list this key. Must be refused, not trusted.
    expect(await senderKeyBelongsToClaimedDid(agent, did, unrelatedJwk)).toBe(false)
  })

  test('a claimed DID that fails to resolve: fails closed, not open', async () => {
    const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
    const someKey = await kms.createKey({ type: { kty: 'OKP', crv: 'X25519' }, backend: 'askar' })
    const someJwk = Kms.PublicJwk.fromPublicJwk(someKey.publicJwk)
    expect(await senderKeyBelongsToClaimedDid(agent, 'did:peer:2.doesNotResolveAtAll', someJwk)).toBe(false)
  })

  test('no senderKey at all: fails closed', async () => {
    const { did } = await createV2StyleDid()
    expect(await senderKeyBelongsToClaimedDid(agent, did, undefined)).toBe(false)
  })
})
