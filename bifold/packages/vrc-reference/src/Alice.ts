import { Participant, createParticipant } from './Participant'

/**
 * Alice is a type alias for Participant.
 * Both Alice and Bob have identical capabilities - the naming is just for clarity in demos/tests.
 */
export type Alice = Participant
export const Alice = Participant

/**
 * Build an Alice participant with default port 9000
 */
export async function buildAlice(port: number = 9000, name: string = 'alice'): Promise<Participant> {
  return createParticipant(port, name)
}

// Re-export for backwards compatibility with existing code that imports { Alice } from './Alice'
export { Participant, createParticipant }
