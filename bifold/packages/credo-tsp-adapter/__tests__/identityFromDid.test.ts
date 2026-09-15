/**
 * identityFromDid — the shape TspCarriage needs: derive a TspIdentity from
 * one of the WALLET'S OWN existing DIDs (e.g. a DIDComm connection's own
 * DID), reusing that DID's existing signing key rather than minting a new
 * one for TSP.
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
import { convertPublicKeyToX25519 } from '@stablelib/ed25519'

import { identityFromDid } from '../src/identity'
import { createCredoVidResolver } from '../src/vidResolver'

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
    const publicKey = TypedArrayEncoder.fromBase64Url(publicJwk.x)

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

  test('uses the INDEPENDENT X25519 keyAgreement key of a did:peer:2 (DIDComm v2 connection DID shape)', async () => {
    // The shape Credo's DIDComm v2 mints for every v2 connection (credo-ts PR
    // #2704 createPeerDidForV2OOB): #key-1 Ed25519 authentication, #key-2 a
    // separately generated X25519 keyAgreement key, each with its own KMS key.
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

    const signingPublicKey = TypedArrayEncoder.fromBase64Url(signing.publicJwk.x as string)
    const agreementPublicKey = TypedArrayEncoder.fromBase64Url(agreement.publicJwk.x as string)
    // Precondition: the document's keyAgreement key is NOT derivable from the signing key.
    expect(eq(agreementPublicKey, convertPublicKeyToX25519(signingPublicKey))).toBe(false)

    const identity = await identityFromDid(agent, did)
    const resolved = await createCredoVidResolver(agent).resolve(did)
    expect(eq(identity.signingKey.publicKey, signingPublicKey)).toBe(true)
    expect(eq(identity.keyAgreement.publicKey, agreementPublicKey)).toBe(true)
    expect(eq(identity.keyAgreement.publicKey, resolved.encryptionPublicKey)).toBe(true)

    // And the private half is the X25519 key itself: an agreement with a peer
    // key equals the peer's agreement with ours.
    const peer = await kms.createKey({ type: { kty: 'OKP', crv: 'X25519' }, backend: 'askar' })
    const peerPublicKey = TypedArrayEncoder.fromBase64Url(peer.publicJwk.x as string)
    const ours = await identity.keyAgreement.agree(peerPublicKey)
    const { keyAgreementFromAskarKey } = await import('../src/identity')
    const theirs = await keyAgreementFromAskarKey(agent, peer.keyId, peerPublicKey).agree(agreementPublicKey)
    expect(eq(ours, theirs)).toBe(true)
  }, 30000)
})
