import { clear } from 'console'
import figlet from 'figlet'
import { prompt } from 'inquirer'

import { BaseInquirer, ConfirmOptions } from './BaseInquirer'
import { Witness } from './Witness'
import { Listener } from './Listener'

export const runWitness = async () => {
  clear()
  console.log(figlet.textSync('Witness', { horizontalLayout: 'full' }))
  const witness = await WitnessInquirer.build()
  await witness.processAnswer()
}

enum PromptOptions {
  CreateConnection = 'Create connection invitation',
  ListConnections = 'List connections',
  CreateSession = 'Create witnessed session',
  ListSessions = 'List active sessions',
  IssueVWCs = 'Issue VWCs (manual)',
  SendMessage = 'Send message',
  Exit = 'Exit',
  Restart = 'Restart',
}

export class WitnessInquirer extends BaseInquirer {
  public witness: Witness
  public promptOptionsString: string[]
  public listener: Listener

  public constructor(witness: Witness) {
    super()
    this.witness = witness
    this.listener = new Listener()
    this.promptOptionsString = Object.values(PromptOptions)
    this.listener.messageListener(this.witness.agent, this.witness.name)
    this.listener.registerCredentialStateLogger(this.witness.agent, this.witness.name)
  }

  public static async build(): Promise<WitnessInquirer> {
    const witness = await Witness.build()
    return new WitnessInquirer(witness)
  }

  private async getPromptChoice() {
    return prompt([this.inquireOptions(this.promptOptionsString)])
  }

  public async processAnswer() {
    const choice = await this.getPromptChoice()
    if (this.listener.on) return

    switch (choice.options) {
      case PromptOptions.CreateConnection:
        await this.createConnection()
        break
      case PromptOptions.ListConnections:
        await this.listConnections()
        break
      case PromptOptions.CreateSession:
        await this.createSession()
        break
      case PromptOptions.ListSessions:
        await this.listSessions()
        break
      case PromptOptions.IssueVWCs:
        await this.issueVWCs()
        break
      case PromptOptions.SendMessage:
        await this.message()
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
    await this.witness.createConnectionInvitation()
  }

  public async listConnections() {
    const connections = await this.witness.agent.connections.getAll()

    if (connections.length === 0) {
      console.log('\nNo connections yet.\n')
      return
    }

    console.log(`\nConnections (${connections.length}):\n`)
    connections.forEach((conn, index) => {
      console.log(`[${index + 1}] ID: ${conn.id}`)
      console.log(`    State: ${conn.state}`)
      console.log(`    Their Label: ${conn.theirLabel || 'N/A'}`)
      console.log(`    Created: ${conn.createdAt.toISOString()}\n`)
    })
  }

  public async createSession() {
    const connections = await this.witness.agent.connections.getAll()

    if (connections.length < 2) {
      console.log('\nNeed at least 2 connections to create a witnessed session.\n')
      return
    }

    console.log('\nAvailable connections:')
    connections.forEach((conn, index) => {
      console.log(`[${index + 1}] ${conn.theirLabel || conn.id} (${conn.state})`)
    })

    const participantAnswers = await prompt([
      {
        type: 'input',
        name: 'participant1',
        message: 'Enter number for first participant (e.g., Alice):',
        validate: (input: string) => {
          const num = parseInt(input)
          if (isNaN(num) || num < 1 || num > connections.length) {
            return 'Please enter a valid connection number'
          }
          return true
        },
      },
      {
        type: 'input',
        name: 'participant2',
        message: 'Enter number for second participant (e.g., Bob):',
        validate: (input: string) => {
          const num = parseInt(input)
          if (isNaN(num) || num < 1 || num > connections.length) {
            return 'Please enter a valid connection number'
          }
          return true
        },
      },
    ])

    const conn1Index = parseInt(participantAnswers.participant1) - 1
    const conn2Index = parseInt(participantAnswers.participant2) - 1

    if (conn1Index === conn2Index) {
      console.log('\nError: Cannot create a session with the same participant twice.\n')
      return
    }

    const conn1 = connections[conn1Index]
    const conn2 = connections[conn2Index]

    try {
      const sessionId = await this.witness.createWitnessedSession(conn1.id, conn2.id)
      console.log(`\nWitnessed session created successfully!`)
      console.log(`Session ID: ${sessionId}`)
      console.log('\nParticipants have been sent the session challenge via basic message.')
      console.log('They can now create and submit their VRC presentations.\n')
    } catch (error) {
      console.log(`\nError creating session: ${(error as Error).message}\n`)
    }
  }

  public async listSessions() {
    await this.witness.listActiveSessions()
  }

  public async issueVWCs() {
    // Get list of active sessions
    const sessions = this.witness.getActiveSessions()

    if (sessions.length === 0) {
      console.log(redText('\nNo active sessions. Create a session first.\n'))
      return
    }

    console.log(greenText('\n=== Issue VWCs Manually ===\n'))
    console.log('Active sessions:')
    sessions.forEach((session, index) => {
      const presentationCount = session.receivedPresentations.size
      const status = presentationCount >= 2 ? '✓ Ready' : `${presentationCount}/2 presentations`
      console.log(`[${index + 1}] Session ${session.sessionId} - ${status}`)
    })

    const answer = await prompt([
      {
        type: 'input',
        name: 'sessionNum',
        message: 'Enter session number to issue VWCs for:',
        validate: (input: string) => {
          const num = parseInt(input)
          if (isNaN(num) || num < 1 || num > sessions.length) {
            return 'Please enter a valid session number'
          }
          return true
        },
      },
    ])

    const selectedSession = sessions[parseInt(answer.sessionNum) - 1]

    if (selectedSession.receivedPresentations.size < 2) {
      console.log(redText(`\nSession ${selectedSession.sessionId} only has ${selectedSession.receivedPresentations.size}/2 presentations.`))
      console.log(redText('Wait for both participants to submit their VRCs.\n'))
      return
    }

    // Confirm before issuing
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      console.log(purpleText('VWC issuance cancelled.\n'))
      return
    }

    try {
      await this.witness.issueWitnessCredentials(selectedSession.sessionId)
      console.log(greenText('\n✓ VWCs issued and sent to participants!\n'))
    } catch (error) {
      console.log(redText(`\nError issuing VWCs: ${(error as Error).message}\n`))
    }
  }

  public async message() {
    const connections = await this.witness.agent.connections.getAll()

    if (connections.length === 0) {
      console.log('\nNo connections available to send messages.\n')
      return
    }

    console.log('\nAvailable connections:')
    connections.forEach((conn, index) => {
      console.log(`[${index + 1}] ${conn.theirLabel || conn.id}`)
    })

    const answers = await prompt([
      {
        type: 'input',
        name: 'connectionNum',
        message: 'Enter connection number to send message to:',
        validate: (input: string) => {
          const num = parseInt(input)
          if (isNaN(num) || num < 1 || num > connections.length) {
            return 'Please enter a valid connection number'
          }
          return true
        },
      },
    ])

    const connIndex = parseInt(answers.connectionNum) - 1
    const connection = connections[connIndex]

    const message = await this.inquireMessage()
    if (!message) return

    await this.witness.sendMessage(connection.id, message)
    console.log('\nMessage sent!\n')
  }

  public async exit() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      return
    }
    if (confirm.options === ConfirmOptions.Yes) {
      await this.witness.exit()
    }
  }

  public async restart() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.processAnswer()
      return
    }
    if (confirm.options === ConfirmOptions.Yes) {
      await this.witness.restart()
      await runWitness()
    }
  }
}

if (require.main === module) {
  void runWitness().catch((error) => {
    console.error('Witness failed to start', error)
    process.exit(1)
  })
}
