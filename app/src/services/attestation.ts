import {
  AbstractBifoldLogger,
  AttestationEventTypes,
  AttestationMonitor as AttestationMonitorI,
  BifoldAgent,
  BifoldError,
} from '@bifold/core'
import { Agent, BaseEvent } from '@credo-ts/core'
import {
  DidCommCredentialEventTypes,
  DidCommCredentialExchangeRecord,
  DidCommCredentialState,
  DidCommProofEventTypes,
  DidCommProofExchangeRecord,
  DidCommProofState,
} from '@credo-ts/didcomm'
import { DeviceEventEmitter } from 'react-native'

import { AttestationRestrictions } from '@/constants'
import { credentialsMatchForProof } from '@utils/credentials'

// subscription type from agent events (TODO: add type export from Credo)
type AgentSubscription = ReturnType<ReturnType<Agent['events']['observable']>['subscribe']>

export type AttestationMonitorOptions = {
  shouldHandleProofRequestAutomatically?: boolean
}

type AttestationEventTypeKeys = keyof typeof AttestationEventTypes
type AttestationEventTypeValues = (typeof AttestationEventTypes)[AttestationEventTypeKeys]
type AttestationRestrictionsType = typeof AttestationRestrictions

export interface AttestationCredentialFormat {
  attributes: {
    attestationInfo: []
  }
}

interface IndyRequest {
  indy: {
    requested_attributes?: {
      attestationInfo?: {
        names: string[]
        restrictions: { cred_def_id: string }[]
      }
    }
  }
}

interface AnonCredsRequest {
  anoncreds: {
    requested_attributes?: {
      attestationInfo?: {
        names: string[]
        restrictions: { cred_def_id: string }[]
      }
    }
  }
}

interface AttestationProofRequestFormat {
  request: IndyRequest & AnonCredsRequest
}

const AttestationErrorCodes = {
  BadInvitation: 2027,
  ReceiveInvitationError: 2028,
  GeneralProofError: 2029,
  FailedToConnectToAttestationAgent: 2030,
  FailedToFetchNonceForAttestation: 2031,
  FailedToGenerateAttestation: 2032,
  FailedToRequestAttestation: 2033,
  FailedToValidateAttestation: 2034,
  IntegrityUnavailable: 2035,
} as const

type Restriction = {
  schema_id?: string
  issuer_did?: string
  cred_def_id?: string
  schema_version?: string
}

const findCredDefIDs = (restrictions: [Restriction]): Array<string> => {
  return restrictions.map((rstr) => rstr.cred_def_id).filter((credDefId) => credDefId !== undefined) as string[]
}

const invitationUrlFromRestrictions = async (
  proof: DidCommProofExchangeRecord,
  agent: BifoldAgent,
  restrictions: AttestationRestrictionsType
): Promise<string | undefined> => {
  const format = (await agent.modules.didcomm.proofs.getFormatData(
    proof.id
  )) as unknown as AttestationProofRequestFormat
  const formatToUse = format.request?.anoncreds ? 'anoncreds' : 'indy'
  const restrictionsArePresent = format.request?.[formatToUse]?.requested_attributes?.attestationInfo?.restrictions

  if (!formatToUse || !restrictionsArePresent) {
    return undefined
  }

  const pRestrictions = format.request?.[formatToUse]?.requested_attributes?.attestationInfo?.restrictions
  const cred_def_ids = findCredDefIDs(pRestrictions as [Restriction])

  for (const env in restrictions) {
    for (const credDefId of cred_def_ids) {
      if (restrictions[env].credDefIDs.includes(credDefId)) {
        return restrictions[env].invitationUrl
      }
    }
  }

  return undefined
}

export const isProofRequestingAttestation = async (
  proof: DidCommProofExchangeRecord,
  agent: BifoldAgent,
  restrictions: AttestationRestrictionsType
): Promise<boolean> => {
  return (await invitationUrlFromRestrictions(proof, agent, restrictions)) !== undefined
}

export const allCredDefIds = (restrictions: AttestationRestrictionsType): string[] => {
  const allCredDefIds: string[] = []

  for (const env in restrictions) {
    allCredDefIds.push(...restrictions[env].credDefIDs)
  }

  return allCredDefIds
}

export const isOfferingAttestation = (credDefId: string, restrictions: AttestationRestrictionsType) => {
  return allCredDefIds(restrictions).includes(credDefId)
}

export class AttestationMonitor implements AttestationMonitorI {
  private proofSubscription?: AgentSubscription
  private offerSubscription?: AgentSubscription
  private agent?: Agent
  private options: AttestationMonitorOptions
  private log?: AbstractBifoldLogger
  private _attestationWorkflowInProgress = false
  private _shouldHandleProofRequestAutomatically = false
  private _proofRequest?: DidCommProofExchangeRecord
  // private _currentWorkflowState?: typeof AttestationEventTypes

  // take in options, agent, and logger. Options should include the attestation service URL
  // and the proof to watch for along with the cred_ef_id of the attestation credentials.
  public constructor(logger: AbstractBifoldLogger, options: AttestationMonitorOptions) {
    this.log = logger
    this.options = options
    const { shouldHandleProofRequestAutomatically } = options
    this._shouldHandleProofRequestAutomatically = shouldHandleProofRequestAutomatically ?? false
  }

  public get attestationWorkflowInProgress() {
    return this._attestationWorkflowInProgress
  }

  public set shouldHandleProofRequestAutomatically(value: boolean) {
    this._shouldHandleProofRequestAutomatically = value
  }

  public get shouldHandleProofRequestAutomatically() {
    return this._shouldHandleProofRequestAutomatically
  }

  public start(agent: Agent): void {
    this.agent = agent

    this.proofSubscription = this.agent?.events
      .observable(DidCommProofEventTypes.ProofStateChanged)
      .subscribe(this.handleProofStateChanged)

    this.offerSubscription = this.agent?.events
      .observable(DidCommCredentialEventTypes.DidCommCredentialStateChanged)
      .subscribe(this.handleCredentialStateChanged)
  }

  public stop(): void {
    this.proofSubscription?.unsubscribe()
    this.offerSubscription?.unsubscribe()
  }

  public requestAttestationCredential = async (): Promise<void> => {
    // The BC Wallet implementation fetched a fresh attestation credential from
    // BC's attestation service over DRPC. Keyring does not run that service
    // (and @credo-ts/drpc has no stable credo 0.6 release), so we surface a
    // failure event instead. Keyring hardware attestation for VRC lives in
    // @bifold/react-native-attestation and the VRC module.
    this.log?.warn('Remote attestation credential issuance is not available in Keyring')
    this.stopWorkflow(
      AttestationEventTypes.FailedRequestCredential,
      new BifoldError(
        'Attestation Service',
        'Remote attestation credential issuance is not available.',
        'This wallet does not use the BC attestation service.',
        AttestationErrorCodes.FailedToRequestAttestation
      )
    )
  }

  private startWorkflow = () => {
    this._attestationWorkflowInProgress = true
    DeviceEventEmitter.emit(AttestationEventTypes.Started)
  }

  private stopWorkflow = (eventType: AttestationEventTypeValues, error?: Error) => {
    this._attestationWorkflowInProgress = false
    this._proofRequest = undefined
    DeviceEventEmitter.emit(eventType, error)
  }

  private handleProofRequest = async (proofRequest: DidCommProofExchangeRecord): Promise<boolean> => {
    if (!this.agent) {
      return false
    }

    this.log?.info('Selecting credentials for attestation proof request')
    // This will throw if we don't have the necessary credentials
    const credentials = await this.agent.modules.didcomm.proofs.selectCredentialsForRequest({
      proofExchangeRecordId: proofRequest.id,
    })

    this.log?.info('Accepting attestation proof request')
    await this.agent.modules.didcomm.proofs.acceptRequest({
      proofExchangeRecordId: proofRequest.id,
      proofFormats: credentials.proofFormats,
    })

    return true
  }

  private handleCredentialStateChanged = async (event: BaseEvent) => {
    if (!this.agent) {
      throw new BifoldError(
        'Attestation Service',
        'There was a problem with the remote attestation service.',
        'The agent cannot be undefined.',
        AttestationErrorCodes.FailedToFetchNonceForAttestation
      )
    }

    const { credentialExchangeRecord } = event.payload
    const credential = credentialExchangeRecord as DidCommCredentialExchangeRecord

    this.log?.info('Handling credential offer')

    try {
      const { offer } = await this.agent.modules.didcomm.credentials.getFormatData(credential.id)
      const offerData = (offer?.anoncreds ?? offer?.indy) as { cred_def_id?: string } | undefined

      // do nothing if not an attestation credential
      const offerIsForAttestation = await isOfferingAttestation(offerData?.cred_def_id ?? '', AttestationRestrictions)
      if (!offerIsForAttestation) {
        return
      }

      // if it's a new offer, automatically accept
      if (credential.state === DidCommCredentialState.OfferReceived) {
        this.log?.info('Accepting credential offer')
        await this.agent.modules.didcomm.credentials.acceptOffer({
          credentialExchangeRecordId: credential.id,
        })
      }

      // only finish loading state once credential is fully accepted
      if (credential.state === DidCommCredentialState.Done) {
        // TODO: credential.offer in flight completed
        this.log?.info('Credential accepted')

        if (this._shouldHandleProofRequestAutomatically && this._proofRequest) {
          if (this._proofRequest.state === DidCommProofState.RequestReceived) {
            const result = await this.handleProofRequest(this._proofRequest)
            if (result) {
              this.stopWorkflow(AttestationEventTypes.Completed)
            }
          } else {
            this.stopWorkflow(AttestationEventTypes.Completed)
          }
        }
      }
    } catch (error) {
      this.log?.error('Failed to handle credential offer', error as Error)

      this.stopWorkflow(AttestationEventTypes.FailedHandleOffer, error as Error)
    }
  }

  private handleProofStateChanged = async (event: BaseEvent) => {
    if (!this.agent) {
      throw new BifoldError(
        'Attestation Service',
        'There was a problem with the remote attestation service.',
        'The agent cannot be undefined.',
        AttestationErrorCodes.FailedToFetchNonceForAttestation
      )
    }

    const { proofRecord } = event.payload
    const proof = proofRecord as DidCommProofExchangeRecord

    this.log?.info('Handling proof received')

    if (proof.state !== DidCommProofState.RequestReceived) {
      return
    }

    this.log?.info('Checking if proof is requesting attestation')

    try {
      // 1. Is the proof requesting an attestation credential
      if (!(await isProofRequestingAttestation(proof, this.agent, AttestationRestrictions))) {
        return
      }

      this.log?.info('Proof is requesting attestation')

      if (this._shouldHandleProofRequestAutomatically) {
        this._proofRequest = proof

        this.startWorkflow()
      }

      // 2. Does the wallet have a valid attestation credential that will
      // satisfy the proof request?
      const required = await this.attestationCredentialRequired(this.agent, proof.id)

      // 3. If yes, do nothing
      if (!required) {
        this.log?.info('Valid credentials already exist, checking automatic handling')

        if (this._shouldHandleProofRequestAutomatically && this._proofRequest) {
          this.log?.info('Handling proof request automatically')

          const result = await this.handleProofRequest(proof)
          if (result) {
            this.stopWorkflow(AttestationEventTypes.Completed)
          }
        }

        return
      }

      // 4. If no, get a new attestation credential
      await this.requestAttestationCredential()
    } catch (error) {
      this.log?.error('Failed to handle proof', error as Error)

      this.stopWorkflow(AttestationEventTypes.FailedHandleProof, error as Error)
    }
  }

  private attestationCredentialRequired = async (agent: BifoldAgent, proofId: string): Promise<boolean> => {
    agent.config.logger.info('Fetching proof by id')
    const proof = await agent?.modules.didcomm.proofs.getById(proofId)
    agent.config.logger.info('Second check if proof is requesting attestation')

    agent.config.logger.info('Checking if credentials match for proof request')
    const credentials = await credentialsMatchForProof(agent, proof)

    if (!credentials) {
      return true
    }

    // TODO:(jl) Should we be checking the length of the attributes matches some
    // expected length in the proof request?
    const format = (credentials.proofFormats.anoncreds ?? credentials.proofFormats.indy) as AttestationCredentialFormat
    if (format) {
      return format.attributes.attestationInfo.length === 0
    }

    return false
  }
}
