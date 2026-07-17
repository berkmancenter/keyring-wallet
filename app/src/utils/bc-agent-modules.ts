import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsDidCommProofFormatService,
  AnonCredsModule,
  DataIntegrityDidCommCredentialFormatService,
  DidCommCredentialV1Protocol,
  DidCommProofV1Protocol,
  LegacyIndyDidCommCredentialFormatService,
  LegacyIndyDidCommProofFormatService,
} from '@credo-ts/anoncreds'
import { AskarKeyManagementService, AskarModule } from '@credo-ts/askar'
import {
  Agent,
  DidsModule,
  JwkDidResolver,
  KeyDidResolver,
  Kms,
  PeerDidResolver,
  W3cCredentialsModule,
  WebDidResolver,
} from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommCredentialV2Protocol,
  DidCommDifPresentationExchangeProofFormatService,
  DidCommJsonLdCredentialFormatService,
  DidCommMediatorPickupStrategy,
  DidCommModule,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'
import { IndyVdrAnonCredsRegistry, IndyVdrModule, IndyVdrPoolConfig } from '@credo-ts/indy-vdr'
import { SecureEnvironmentKeyManagementService } from '@credo-ts/react-native'
import { WebVhAnonCredsRegistry, WebVhDidResolver } from '@credo-ts/webvh'
import { anoncreds } from '@hyperledger/anoncreds-react-native'
import { indyVdr } from '@hyperledger/indy-vdr-react-native'
import { askar } from '@openwallet-foundation/askar-react-native'
import * as BifoldCore from '@bifold/core'

export type BCAgent = Agent<ReturnType<typeof getBCAgentModules>>

interface GetBCAgentModulesOptions {
  walletSecret: { id: string; key: string }
  indyNetworks: IndyVdrPoolConfig[]
  mediatorInvitationUrl?: string
  txnCache?: { capacity: number; expiryOffsetMs: number; path?: string }
}

/**
 * Constructs the modules to be used in the agent setup (credo 0.6).
 * Mirrors @bifold/core getAgentModules, plus the Keyring additions:
 * JSON-LD credential format (VRC), VRC document loader, RelationshipDidModule
 * and AttestationStorageModule.
 * @returns modules to be used in agent setup
 */
export function getBCAgentModules({
  walletSecret,
  indyNetworks,
  mediatorInvitationUrl,
  txnCache,
}: GetBCAgentModulesOptions) {
  const indyCredentialFormat = new LegacyIndyDidCommCredentialFormatService()
  const indyProofFormat = new LegacyIndyDidCommProofFormatService()

  if (txnCache) {
    indyVdr.setLedgerTxnCache({
      capacity: txnCache.capacity,
      expiry_offset_ms: txnCache.expiryOffsetMs,
      path: txnCache.path,
    })
  }

  const { RelationshipDidModule, AttestationStorageModule, DataIntegritySuiteModule } = BifoldCore as any

  const modules = {
    askar: new AskarModule({
      enableKms: false,
      askar,
      store: { id: walletSecret.id, key: walletSecret.key },
    }),
    kms: new Kms.KeyManagementModule({
      backends: [
        new AskarKeyManagementService(),
        new SecureEnvironmentKeyManagementService({ biometricsBacked: false }),
      ],
      defaultBackend: 'askar',
    }),
    anoncreds: new AnonCredsModule({
      anoncreds,
      registries: [new IndyVdrAnonCredsRegistry(), new WebVhAnonCredsRegistry()],
    }),
    indyVdr: new IndyVdrModule({
      indyVdr,
      networks: indyNetworks as [IndyVdrPoolConfig],
    }),
    didcomm: new DidCommModule({
      useDidSovPrefixWhereAllowed: true,
      connections: {
        autoAcceptConnections: true,
      },
      credentials: {
        autoAcceptCredentials: DidCommAutoAcceptCredential.ContentApproved,
        credentialProtocols: [
          new DidCommCredentialV1Protocol({ indyCredentialFormat }),
          new DidCommCredentialV2Protocol({
            credentialFormats: [
              indyCredentialFormat,
              new AnonCredsDidCommCredentialFormatService(),
              new DataIntegrityDidCommCredentialFormatService(),
              new DidCommJsonLdCredentialFormatService(),
            ],
          }),
        ],
      },
      proofs: {
        autoAcceptProofs: DidCommAutoAcceptProof.ContentApproved,
        proofProtocols: [
          new DidCommProofV1Protocol({ indyProofFormat }),
          new DidCommProofV2Protocol({
            proofFormats: [
              indyProofFormat,
              new AnonCredsDidCommProofFormatService(),
              new DidCommDifPresentationExchangeProofFormatService(),
            ],
          }),
        ],
      },
      mediationRecipient: {
        mediatorInvitationUrl: mediatorInvitationUrl,
        mediatorPickupStrategy: DidCommMediatorPickupStrategy.Implicit,
      },
    }),
    dids: new DidsModule({
      resolvers: [
        new WebVhDidResolver(),
        new WebDidResolver(),
        new JwkDidResolver(),
        new KeyDidResolver(),
        new PeerDidResolver(),
      ],
    }),
    w3cCredentials: new W3cCredentialsModule({
      documentLoader: (BifoldCore as any).createVrcDocumentLoader,
    }),
    relationshipDid: new RelationshipDidModule(),
    attestationStorage: new AttestationStorageModule(),
    // Registers DataIntegrityProof/eddsa-rdfc-2022 in the signature suite
    // registry (verify + w3cCredentials sign). DIDComm issuance stays on
    // Ed25519Signature2018 until the format-service work lands
    // (docs/CRYPTO_SUITE_FOLLOWUP.md, Decision 5).
    dataIntegritySuite: new DataIntegritySuiteModule(),
  }

  return modules
}
