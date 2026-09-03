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
        // PickUpV2, matching the runtime start in configureMessagePickup. This
        // said Implicit until 2026-08-31 — harmless here only because the runtime
        // override happened to correct it, but it meant the declared config was a
        // lie, and copying this block into a new agent (as the witness-server
        // effectively had) produced an agent that could never receive anything.
        mediatorPickupStrategy: DidCommMediatorPickupStrategy.PickUpV2,
        // Pickup V2 polling cadence (see configureMessagePickup): each poll is
        // a status-request the mediator answers from its queue, so delivery is
        // request/ack'd instead of live-pushed into a websocket that may have
        // died silently (docs/spikes/e2e-vrc-connect-findings.md).
        // 1s, MEASURED. A non-witnessed v4 exchange is four mediated round
        // trips (didexchange, discovery, propose, issue-receipt). A send is an
        // immediate HTTP POST, but the peer only *discovers* it on its next
        // poll and its reply only reaches us on ours, so one round trip costs
        // up to TWO intervals and the exchange is bounded by ~8x the interval,
        // not 4x. Device logs 2026-08-26, full exchange end to end:
        //   10s interval → ~41s (four waits of 9.85 + 9.6 + 10.8 + 8.0s
        //                        against <1s of local work)
        //    2s interval → 16.1-19.4s, hops ~3-4s
        //    1s interval → targets ~10-12s
        // (An earlier reading that 5s "wasn't faster" came from witnessed
        // runs, where the direct-HTTP witness ceremony dominated and masked
        // this.) Hardware attestation adds ~2s on top, nearly all of it the
        // passcode/biometric prompt, which is user time anyway.
        //
        // This is a FLAT interval for the life of the agent, not adaptive —
        // at 1s that is ~86k mediator requests/day per idle wallet, which is
        // fine for demo/testing but wants an idle/active split before it
        // ships (see the parked adaptive-polling work).
        //
        // The witness-server carried this same bug on Implicit until 2026-08-31 and
        // received nothing at all through the mediator — the wallet's runtime
        // override is the ONLY reason this side was unaffected. Anything new that
        // talks to this mediator must start pickup explicitly too; the reusable
        // guard is startMediatorMessagePickup in @bifold/vrc-shared (src/mediation.ts),
        // and the diagnosis is docs/spikes/e2e-vrc-connect-findings.md.
        //
        // Safe since the mediator pickup queue moved off askar to postgres on
        // 2026-08-26; before that a faster cadence tripped rate-correlated
        // queue failures. Note mediatorPickupStrategy above is overridden at
        // runtime by configureMessagePickup (useBCAgentSetup), which starts
        // PickUpV2 explicitly — this interval is what governs.
        mediatorPollingInterval: 1_000,
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
