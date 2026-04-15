import { clear } from 'console'
import { textSync } from 'figlet'


/**
 * AliceInquirer is a type alias for ParticipantInquirer.
 * Both Alice and Bob inquirers have identical capabilities - the naming is just for clarity in demos.
 */
export type AliceInquirer = ParticipantInquirer
export const AliceInquirer = ParticipantInquirer

/**
 * Build an Alice inquirer with default port 9000
 */
export async function buildAliceInquirer(): Promise<ParticipantInquirer> {
  return ParticipantInquirer.build(9000, 'alice', runAlice)
}

/**
 * Run the Alice CLI
 */
export const runAlice = async () => {
  clear()
  console.log(textSync('Alice', { horizontalLayout: 'full' }))
  const alice = await buildAliceInquirer()
  await alice.processAnswer()
}

// Re-export for backwards compatibility
export { ParticipantInquirer }

if (require.main === module) {
  void runAlice().catch((error) => {
    console.error('Alice failed to start', error)
    process.exit(1)
  })
}
