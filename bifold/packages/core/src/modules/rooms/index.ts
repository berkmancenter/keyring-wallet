// The sample service is not exported here on purpose: only the registration that chooses it imports
// sample/sampleRooms.ts, so a store bundle can swap that one module out.
export * from './types'
export { deriveCapabilities, sampleCapabilities, ROOMS_OPERATIONS, ROOMS_REQUIREMENTS } from './capabilities'
export type { CapabilityInputs } from './capabilities'
export { toInertText, inertFlags } from './inertText'
export { registerRoomsService } from './register'
export { AgentRoomsService, R1_BUILT } from './real/agentRoomsService'
export type { RoomsBackend, RoomsCommunity } from './real/agentRoomsService'
export { createAgentRoomsBackend } from './real/agentRoomsBackend'
