/**
 * VCDM 2.0 sign/verify conformance — full cryptographic round-trip.
 *
 * Proves that the patched @credo-ts/core (relaxed @context validator +
 * optional issuanceDate) together with the bundled VCDM 2.0 context lets us
 * sign AND verify a v2-context JSON-LD credential with Ed25519Signature2018,
 * exactly the shape Task 4 flips VRC issuance to. A v1.1 round-trip runs
 * alongside as a regression guard for stored legacy credentials.
 *
 * No DIDComm connections are involved — a single agent with an in-memory
 * wallet does both sides.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import {
  Agent,
  CacheModule,
  ClaimFormat,
  ConsoleLogger,
  DidsModule,
  InMemoryLruCache,
  JsonTransformer,
  KeyDidRegistrar,
  KeyDidResolver,
  LogLevel,
  PeerDidNumAlgo,
  PeerDidRegistrar,
  PeerDidResolver,
  W3cCredential,
  W3cCredentialsModule,
  W3cJsonLdVerifiableCredential,
} from '@credo-ts/core'
import { AskarModule } from '@credo-ts/askar'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { demoDocumentLoader, deleteWallet, walletExists } from '@bifold/vrc-shared'
import { CREDENTIALS_V2_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL } from '@bifold/vrc-contexts'

import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from '../../src/relationshipContext'

const CREDENTIALS_V1_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1'
const WALLET_ID = `vc20-conformance-${process.env.JEST_WORKER_ID ?? '0'}`

// Wrap the demo loader so a context-resolution failure names the URL instead
// of surfacing as an opaque jsonld.InvalidUrl deep inside the signature suite.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tracingDocumentLoader = (agentContext: any) => {
  const inner = demoDocumentLoader(agentContext)
  return async (url: string) => {
    try {
      return await inner(url)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`documentLoader failed for URL: ${url} — ${(error as Error).message}`)
      throw new Error(`documentLoader failed for URL: ${url} — ${(error as Error).message}`)
    }
  }
}

function buildAgent() {
  return new Agent({
    config: { logger: new ConsoleLogger(LogLevel.error) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: WALLET_ID,
          key: WALLET_ID,
          database: { type: 'sqlite', config: { inMemory: true } },
        },
      }),
      w3cCredentials: new W3cCredentialsModule({ documentLoader: tracingDocumentLoader }),
      cache: new CacheModule({ cache: new InMemoryLruCache({ limit: 50 }) }),
      dids: new DidsModule({
        resolvers: [new KeyDidResolver(), new PeerDidResolver()],
        registrars: [new KeyDidRegistrar(), new PeerDidRegistrar()],
      }),
    },
  })
}

describe('VCDM 2.0 sign/verify conformance (Ed25519Signature2018)', () => {
  let agent: ReturnType<typeof buildAgent>
  let issuerDid: string
  let verificationMethodId: string

  beforeAll(async () => {
    if (walletExists(WALLET_ID)) deleteWallet(WALLET_ID)

    agent = buildAgent()
    await agent.initialize()

    const result = await agent.dids.create({
      method: 'peer',
      options: {
        numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
        createKey: { type: { kty: 'OKP', crv: 'Ed25519' } },
      },
    })
    if (result.didState?.state !== 'finished' || !result.didState.did || !result.didState.didDocument) {
      throw new Error('Failed to create issuer DID')
    }
    issuerDid = result.didState.did
    const assertionOrAuth = result.didState.didDocument.assertionMethod?.[0] ?? result.didState.didDocument.authentication?.[0]
    verificationMethodId = typeof assertionOrAuth === 'string' ? assertionOrAuth : (assertionOrAuth?.id as string)
  }, 30000)

  afterAll(async () => {
    await agent?.shutdown()
  }, 15000)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function signAndVerify(credentialJson: Record<string, unknown>): Promise<{ vcJson: any; isValid: boolean }> {
    const unsigned = JsonTransformer.fromJSON(credentialJson, W3cCredential)
    const signed = await agent.w3cCredentials.signCredential({
      format: ClaimFormat.LdpVc,
      credential: unsigned,
      verificationMethod: verificationMethodId,
      proofType: 'Ed25519Signature2018',
    })

    const vcJson = JsonTransformer.toJSON(signed)
    // Re-parse from JSON, as a receiving wallet would after DIDComm transport
    const received = JsonTransformer.fromJSON(vcJson, W3cJsonLdVerifiableCredential)
    const verification = await agent.w3cCredentials.verifyCredential({ credential: received })

    return { vcJson, isValid: verification.isValid }
  }

  test('signs and verifies a VCDM 2.0 VRC (v2 context, validFrom/validUntil, no issuanceDate)', async () => {
    // Same @context shape the wallet's buildVrcCredential produces: the Ed25519
    // suite context is included at build time so signing doesn't append it —
    // otherwise the signed credential's @context wouldn't equal the offer's and
    // credo's DIDComm holder-side equality check would reject the credential.
    const inputContext = [CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL]
    const { vcJson, isValid } = await signAndVerify({
      '@context': inputContext,
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: issuerDid,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      credentialSubject: { id: 'did:peer:2.Ez6LScounterparty0000' },
    })

    expect(isValid).toBe(true)
    // @context untouched by signing — required for the DIDComm offer/credential match
    expect(vcJson['@context']).toEqual(inputContext)
    expect(vcJson.issuanceDate).toBeUndefined()
    expect(vcJson.proof?.type ?? vcJson.proof?.[0]?.type).toBe('Ed25519Signature2018')
  }, 30000)

  test('still signs and verifies a VCDM 1.1 VRC (regression: stored legacy credentials)', async () => {
    const { vcJson, isValid } = await signAndVerify({
      '@context': [CREDENTIALS_V1_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: issuerDid,
      issuanceDate: new Date(Date.now() - 60_000).toISOString(),
      expirationDate: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      credentialSubject: { id: 'did:peer:2.Ez6LScounterparty0000' },
    })

    expect(isValid).toBe(true)
    expect(vcJson['@context'][0]).toBe(CREDENTIALS_V1_CONTEXT_URL)
  }, 30000)

  test('rejects a tampered VCDM 2.0 credential', async () => {
    const { vcJson } = await signAndVerify({
      '@context': [CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: issuerDid,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      credentialSubject: { id: 'did:peer:2.Ez6LScounterparty0000' },
    })

    // Tamper with the subject after signing
    const tampered = { ...vcJson, credentialSubject: { id: 'did:peer:2.Ez6LSattacker00000000' } }
    const received = JsonTransformer.fromJSON(tampered, W3cJsonLdVerifiableCredential)
    const verification = await agent.w3cCredentials.verifyCredential({ credential: received })

    expect(verification.isValid).toBe(false)
  }, 30000)
})
