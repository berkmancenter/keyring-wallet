import { Participant, createParticipant } from './Participant'

/**
 * Bob is a type alias for Participant.
 * Both Alice and Bob have identical capabilities - the naming is just for clarity in demos/tests.
 */
export type Bob = Participant
export const Bob = Participant

/**
 * Build a Bob participant with default port 9001
 */
export async function buildBob(port: number = 9001, name: string = 'bob'): Promise<Participant> {
  return createParticipant(port, name)
}

// Re-export for backwards compatibility with existing code that imports { Bob } from './Bob'
export { Participant, createParticipant }
