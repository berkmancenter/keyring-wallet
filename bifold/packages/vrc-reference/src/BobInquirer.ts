import { clear } from 'console'
import { textSync } from 'figlet'


/**
 * BobInquirer is a type alias for ParticipantInquirer.
 * Both Alice and Bob inquirers have identical capabilities - the naming is just for clarity in demos.
 */
export type BobInquirer = ParticipantInquirer
export const BobInquirer = ParticipantInquirer

/**
 * Build a Bob inquirer with default port 9001
 */
export async function buildBobInquirer(): Promise<ParticipantInquirer> {
  return ParticipantInquirer.build(9001, 'bob', runBob)
}

/**
 * Run the Bob CLI
 */
export const runBob = async () => {
  clear()
  console.log(textSync('Bob', { horizontalLayout: 'full' }))
  const bob = await buildBobInquirer()
  await bob.processAnswer()
}

// Re-export for backwards compatibility
export { ParticipantInquirer }

if (require.main === module) {
  void runBob().catch((error) => {
    console.error('Bob failed to start', error)
    process.exit(1)
  })
}
