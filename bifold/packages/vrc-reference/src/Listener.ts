import type { Participant } from './Participant'
import type {
  Agent,
  BasicMessageStateChangedEvent,
  CredentialExchangeRecord,
  CredentialStateChangedEvent,
  ProofExchangeRecord,
  ProofStateChangedEvent,
} from '@credo-ts/core'
import type BottomBar from 'inquirer/lib/ui/bottom-bar'

import {
  BasicMessageEventTypes,
  BasicMessageRole,
  CredentialEventTypes,
  CredentialState,
  JsonTransformer,
  ProofEventTypes,
  ProofState,
  W3cCredentialRecord,
} from '@credo-ts/core'
import { ui } from 'inquirer'

import { Color, greenText, purpleText } from './OutputClass'

/**
 * Common interface for inquirers that can accept credential offers
 */
export interface CredentialOfferHandler {
  acceptCredentialOffer(credentialRecord: CredentialExchangeRecord): Promise<void>
  processAnswer(): Promise<void>
}

/**
 * Common interface for inquirers that can accept proof requests
 */
export interface ProofRequestHandler {
  acceptProofRequest(proofRecord: ProofExchangeRecord): Promise<void>
  processAnswer(): Promise<void>
}

/**
 * Common interface for inquirers that can issue credentials and request proofs
 */
export interface ParticipantInquirerInterface {
  exitUseCase(title: string): Promise<boolean | undefined>
  processAnswer(): Promise<void>
}

export class Listener {
  public on: boolean
  private ui: BottomBar

  public constructor() {
    this.on = false
    this.ui = new ui.BottomBar()
  }

  private turnListenerOn() {
    this.on = true
  }

  private turnListenerOff() {
    this.on = false
  }

  private printCredentialAttributes(credentialRecord: CredentialExchangeRecord) {
    if (credentialRecord.credentialAttributes) {
      const attribute = credentialRecord.credentialAttributes
      console.log('\n\nCredential preview:')
      attribute.forEach((element) => {
        console.log(purpleText(`${element.name} ${Color.Reset}${element.value}`))
      })
    }
  }

  private async newCredentialPrompt(credentialRecord: CredentialExchangeRecord, inquirer: CredentialOfferHandler) {
    this.printCredentialAttributes(credentialRecord)
    this.turnListenerOn()
    await inquirer.acceptCredentialOffer(credentialRecord)
    this.turnListenerOff()
    await inquirer.processAnswer()
  }

  private async logCredentialStored(record: CredentialExchangeRecord, participant: Participant) {
    for (const credentialBinding of record.credentials) {
      if (credentialBinding.credentialRecordType !== W3cCredentialRecord.type) continue

      const storedCredential = await participant.agent.w3cCredentials.getCredentialRecordById(
        credentialBinding.credentialRecordId
      )
      const credentialJson = JsonTransformer.toJSON(storedCredential.credential)

      // Log credential stored - R-DID is now exchanged directly via basic message
      const issuerDid = typeof credentialJson.issuer === 'string' ? credentialJson.issuer : credentialJson.issuer?.id
      if (issuerDid) {
        console.log(greenText(`[${participant.name}] ✓ Credential stored from ${issuerDid.substring(0, 30)}...`))
      } else {
        console.log(greenText(`[${participant.name}] ✓ Credential stored`))
      }
    }
  }

  public credentialOfferListener(participant: Participant, inquirer: CredentialOfferHandler) {
    participant.agent.events.on(
      CredentialEventTypes.CredentialStateChanged,
      async ({ payload }: CredentialStateChangedEvent) => {
        const { credentialRecord } = payload
        if (credentialRecord.state === CredentialState.OfferReceived) {
          await this.newCredentialPrompt(credentialRecord, inquirer)
          return
        }

        // After holder receives the issued credential, acknowledge and store it
        if (credentialRecord.state === CredentialState.CredentialReceived) {
          await participant.agent.credentials.acceptCredential({ credentialRecordId: credentialRecord.id })
          return
        }

        if (credentialRecord.state === CredentialState.Done) {
          await this.logCredentialStored(credentialRecord, participant)
        }
      }
    )
  }

  public registerCredentialStateLogger(agent: Agent, name: string) {
    agent.events.on(CredentialEventTypes.CredentialStateChanged, ({ payload }: CredentialStateChangedEvent) => {
      const record = payload.credentialRecord
      console.log(purpleText(`[${name}] credential exchange ${record.id} -> ${record.state}`))

      if (record.errorMessage) {
        console.log(purpleText(`${Color.Reset}[${name}] credential exchange error: ${record.errorMessage}`))
      }
    })
  }

  public messageListener(agent: Agent, name: string) {
    agent.events.on(BasicMessageEventTypes.BasicMessageStateChanged, async (event: BasicMessageStateChangedEvent) => {
      if (event.payload.basicMessageRecord.role === BasicMessageRole.Receiver) {
        this.ui.updateBottomBar(purpleText(`\n${name} received a message: ${event.payload.message.content}\n`))
      }
    })
  }

  private async newProofRequestPrompt(proofRecord: ProofExchangeRecord, inquirer: ProofRequestHandler) {
    this.turnListenerOn()
    await inquirer.acceptProofRequest(proofRecord)
    this.turnListenerOff()
    await inquirer.processAnswer()
  }

  public proofRequestListener(participant: Participant, inquirer: ProofRequestHandler) {
    participant.agent.events.on(ProofEventTypes.ProofStateChanged, async ({ payload }: ProofStateChangedEvent) => {
      if (payload.proofRecord.state === ProofState.RequestReceived) {
        await this.newProofRequestPrompt(payload.proofRecord, inquirer)
      }
    })
  }

  public proofAcceptedListener(participant: Participant, inquirer: ParticipantInquirerInterface) {
    participant.agent.events.on(ProofEventTypes.ProofStateChanged, async ({ payload }: ProofStateChangedEvent) => {
      if (payload.proofRecord.state === ProofState.Done) {
        await inquirer.processAnswer()
      }
    })
  }

  public async newAcceptedPrompt(title: string, inquirer: ParticipantInquirerInterface) {
    this.turnListenerOn()
    await inquirer.exitUseCase(title)
    this.turnListenerOff()
    await inquirer.processAnswer()
  }
}
