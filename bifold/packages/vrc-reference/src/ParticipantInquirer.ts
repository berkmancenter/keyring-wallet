import type { CredentialExchangeRecord, ProofExchangeRecord } from '@credo-ts/core'

import { clear } from 'console'
import { textSync } from 'figlet'
import { prompt } from 'inquirer'

import { Participant, createParticipant } from './Participant'
import { BaseInquirer, ConfirmOptions } from './BaseInquirer'
import { Listener } from './Listener'

enum PromptOptions {
  CreateConnection = 'Create connection invitation',
  ReceiveConnection = 'Receive connection invitation',
  OfferCredential = 'Offer credential',
  SubmitVrcToWitness = 'Submit VP to Witness',
  RequestProof = 'Request proof',
  SendMessage = 'Send message',
  ListCredentials = 'List stored credentials',
  Exit = 'Exit',
  Restart = 'Restart',
}

export class ParticipantInquirer extends BaseInquirer {
  public participant: Participant
  public promptOptionsString: string[]
  public listener: Listener
  public name: string
  private runFn: () => Promise<void>

  public constructor(participant: Participant, name: string, runFn: () => Promise<void>) {
    super()
    this.participant = participant
    this.name = name
    this.runFn = runFn
    this.listener = new Listener()
    this.promptOptionsString = Object.values(PromptOptions)
    this.listener.messageListener(this.participant.agent, this.participant.name)
    this.listener.registerCredentialStateLogger(this.participant.agent, this.participant.name)
    // Register credential/proof listeners once at startup (not per-connection)
    this.listener.credentialOfferListener(this.participant, this)
    this.listener.proofRequestListener(this.participant, this)
  }

  public static async build(port: number, name: string, runFn: () => Promise<void>): Promise<ParticipantInquirer> {
    const participant = await createParticipant(port, name)
    return new ParticipantInquirer(participant, name, runFn)
  }

  private async getPromptChoice() {
    if (this.participant.outOfBandId) return prompt([this.inquireOptions(this.promptOptionsString)])

    const reducedOption = [
      PromptOptions.CreateConnection,
      PromptOptions.ReceiveConnection,
      PromptOptions.Exit,
      PromptOptions.Restart,
    ]
    return prompt([this.inquireOptions(reducedOption)])
  }

  public async processAnswer() {
    const choice = await this.getPromptChoice()
    if (this.listener.on) return

    switch (choice.options) {
      case PromptOptions.CreateConnection:
        await this.createConnection()
        break
      case PromptOptions.ReceiveConnection:
        await this.receiveConnection()
        break
      case PromptOptions.OfferCredential:
        await this.credential()
        return
      case PromptOptions.SubmitVrcToWitness:
        await this.submitVrcToWitness()
        break
      case PromptOptions.RequestProof:
        await this.proof()
        return
      case PromptOptions.SendMessage:
        await this.message()
        break
      case PromptOptions.ListCredentials:
        await this.listCredentials()
        break
      case PromptOptions.Exit:
        await this.exit()
        break
      case PromptOptions.Restart:
        await this.restart()
        return
    }
    await this.processAnswer()
  }

  public async createConnection() {
    await this.participant.setupConnection()
  }

  public async receiveConnection() {
    const title = Title.InvitationTitle
    const getUrl = await prompt([this.inquireInput(title)])
    if (getUrl.input) {
      await this.participant.acceptConnection(getUrl.input)
    }
  }

  public async acceptCredentialOffer(credentialRecord: CredentialExchangeRecord) {
    const confirm = await prompt([this.inquireConfirmation(Title.CredentialOfferTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.participant.agent.credentials.declineOffer(credentialRecord.id)
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.participant.acceptCredentialOffer(credentialRecord)
    }
  }

  public async acceptProofRequest(proofRecord: ProofExchangeRecord) {
    const confirm = await prompt([this.inquireConfirmation(Title.ProofRequestTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.participant.agent.proofs.declineRequest({ proofRecordId: proofRecord.id })
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.participant.acceptProofRequest(proofRecord)
    }
  }

  public async exitUseCase(title: string) {
    const confirm = await prompt([this.inquireConfirmation(title)])
    if (confirm.options === ConfirmOptions.No) {
      return false
    }
    if (confirm.options === ConfirmOptions.Yes) {
      return true
    }
  }

  public async credential() {
    await this.participant.issueCredential()
    const title = 'Is the credential offer accepted?'
    await this.listener.newAcceptedPrompt(title, this)
  }

  public async proof() {
    await this.participant.sendProofRequest()
    const title = 'Is the proof request accepted?'
    await this.listener.newAcceptedPrompt(title, this)
  }

  public async message() {
    const message = await this.inquireMessage()
    if (!message) return

    await this.participant.sendMessage(message)
  }

  public async listCredentials() {
    await this.participant.listStoredCredentials()
  }

  public async submitVrcToWitness() {
    // Check if we have a session challenge
    if (!this.participant.hasSessionChallenge()) {
      console.log(redText('\nNo active witnessed session. Wait for a Witness to send you a session challenge.\n'))
      return
    }

    const sessionData = this.participant.getSessionChallenge()!
    console.log(greenText('\n=== Submit VP to Witness ==='))
    console.log(purpleText(`Session ID: ${sessionData.sessionId}`))
    console.log(purpleText(`Challenge: ${sessionData.challenge}`))
    console.log(purpleText(`Domain: ${sessionData.domain}\n`))

    // Get all connections to find counterparty
    const connections = await this.participant.agent.connections.getAll()
    const otherConnections = connections.filter((c) => c.id !== sessionData.witnessConnectionId)

    if (otherConnections.length === 0) {
      console.log(redText('No counterparty connection found. Connect with the counterparty first.\n'))
      return
    }

    let counterpartyConn
    if (otherConnections.length === 1) {
      // Only one counterparty, auto-select
      counterpartyConn = otherConnections[0]
      console.log(greenText(`Auto-selected counterparty: ${counterpartyConn.theirLabel || counterpartyConn.id}`))
    } else {
      // Multiple connections, ask which one
      console.log('Select the counterparty for your VRC:')
      otherConnections.forEach((conn, index) => {
        console.log(`[${index + 1}] ${conn.theirLabel || conn.id}`)
      })

      const answer = await prompt([
        {
          type: 'input',
          name: 'counterpartyNum',
          message: 'Enter counterparty number:',
          validate: (input: string) => {
            const num = parseInt(input)
            if (isNaN(num) || num < 1 || num > otherConnections.length) {
              return 'Please enter a valid number'
            }
            return true
          },
        },
      ])
      counterpartyConn = otherConnections[parseInt(answer.counterpartyNum) - 1]
    }

    // Try to get counterparty's R-DID (received via basic message when connecting)
    const counterpartyDid = this.participant.getCounterpartyRDid(counterpartyConn.id)
    if (!counterpartyDid) {
      console.log(redText(`\nNo R-DID found for ${counterpartyConn.theirLabel || 'counterparty'}.`))
      console.log(redText('The counterparty should have shared their R-DID when connecting.\n'))
      return
    }

    const counterpartyName = counterpartyConn.theirLabel || 'counterparty'
    console.log(greenText(`Using ${counterpartyName}'s R-DID: ${counterpartyDid.substring(0, 40)}...`))

    // Confirm before submitting
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      console.log(purpleText('Submission cancelled.\n'))
      return
    }

    try {
      await this.participant.createAndSubmitPresentation(
        sessionData.witnessConnectionId,
        counterpartyDid,
        counterpartyName,
        sessionData.challenge,
        sessionData.domain
      )
      console.log(greenText('\n✓ VP submitted to Witness successfully!\n'))
      this.participant.clearSessionChallenge()
    } catch (error) {
      console.log(redText(`\nError submitting VRC: ${(error as Error).message}\n`))
    }
  }

  public async exit() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      return
    }
    if (confirm.options === ConfirmOptions.Yes) {
      await this.participant.exit()
    }
  }

  public async restart() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.processAnswer()
      return
    }
    if (confirm.options === ConfirmOptions.Yes) {
      await this.participant.restart()
      await this.runFn()
    }
  }
}

/**
 * Create and run a participant inquirer
 */
export async function runParticipantInquirer(port: number, name: string): Promise<void> {
  const run = async () => {
    clear()
    console.log(textSync(name.charAt(0).toUpperCase() + name.slice(1), { horizontalLayout: 'full' }))
    const inquirer = await ParticipantInquirer.build(port, name, run)
    await inquirer.processAnswer()
  }
  await run()
}
