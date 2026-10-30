import type {
  OperationStatus,
  RoomCapabilities,
  RoomOperation,
  RoomsCapabilities,
  RoomsOperation,
  RoomsReason,
  RoomsStatus,
  RoomSummary,
  RoomVerb,
} from './types'

const SPEC = 'https://trusttasks.org/spec/'

/**
 * What each operation needs, and from whom. The capability comes from the person's own agent at
 * runtime: `trust-task-discovery/0.1` answers with exactly the tasks the agent dispatches (VTI
 * `vta-service/src/trust_tasks/mod.rs`, `dispatched_uris()`). The source pin Keyring reads
 * upstream at is not the version people's agents run.
 *
 * - `agent`: Trust Task types, any of which the agent must serve. The versions listed are the ones
 *   this client speaks.
 * - `community`: served by the community (VTC), which the agent's discovery does not cover. It is
 *   gated on the client alone until the client asks the community.
 * - `local`: needs nothing from anyone.
 * - `nowhere`: nothing upstream serves it.
 * - `adminOnly`: served, but only to a community's administrators.
 */
// rooms/keys/act, newest first: the same request at each version (`real/wire.ts` KEYS_ACT_TYPES). VTAs from 0.68
// serve only 0.8; older ones 0.5 and 0.6.
const KEYS_ACT = ['0.9', '0.8', '0.6', '0.5'].map((v) => `${SPEC}rooms/keys/act/${v}`)

type Requirement =
  | { from: 'agent'; anyOf: string[] }
  | { from: 'community' }
  | { from: 'local' }
  | { from: 'nowhere'; why: string }
  | { from: 'adminOnly'; why: string }

export const ROOMS_REQUIREMENTS: Record<RoomsOperation, Requirement> = {
  listMyRooms: { from: 'agent', anyOf: [`${SPEC}rooms/keys/list/0.2`, `${SPEC}rooms/keys/list/0.1`] },
  getRoom: { from: 'agent', anyOf: [`${SPEC}rooms/keys/list/0.2`, `${SPEC}rooms/keys/list/0.1`] },
  listNotes: { from: 'agent', anyOf: [`${SPEC}rooms/keys/browse/0.3`, `${SPEC}rooms/keys/browse/0.1`] },
  readNote: { from: 'agent', anyOf: [`${SPEC}rooms/keys/read/0.1`] },
  // The agent signs host-bound requests as the member's persona (rooms/keys/act).
  write: { from: 'agent', anyOf: KEYS_ACT },
  curate: { from: 'agent', anyOf: KEYS_ACT },
  listOffers: { from: 'community' },
  // Accepting stores the offer's membership and authority in the agent's vault, where its presentations
  // find them. A sealed room also needs rooms/keys/key-package/0.2 and rooms/keys/welcome/0.1: checked per
  // offer, since an open room needs neither.
  acceptOffer: { from: 'agent', anyOf: [`${SPEC}vault/credentials/receive/0.1`] },
  hideOffer: { from: 'local' },
  // A record's file is described in its sealed body, so listing reads each record; opening needs the file key.
  listFiles: { from: 'agent', anyOf: [`${SPEC}rooms/keys/read/0.1`] },
  openFile: { from: 'agent', anyOf: [`${SPEC}rooms/keys/file-key/0.2`] },
  listCommunityMembers: {
    from: 'adminOnly',
    why: 'vtc/rooms/community/members/list needs vtc.rooms.manage; a member can list only their own memberships',
  },
  agentAccess: { from: 'agent', anyOf: [`${SPEC}rooms/keys/present/0.2`] },
  leaveViaCommunity: { from: 'community' },
  groupChat: { from: 'nowhere', why: 'no upstream service delivers messages to a group yet' },
  requestToJoin: { from: 'nowhere', why: 'admission is by invitation or offer; a join request is only a proposal' },
}

export const ROOMS_OPERATIONS = Object.keys(ROOMS_REQUIREMENTS) as RoomsOperation[]

const STATUS_OF: Record<RoomsReason, RoomsStatus> = {
  ok: 'available',
  sample: 'available',
  clientNotBuilt: 'comingSoon',
  notBuiltUpstream: 'comingSoon',
  agentDoesNotServe: 'unavailable',
  adminOnly: 'unavailable',
  noAgentLinked: 'unavailable',
  agentUnknown: 'unavailable',
  communityDoesNotServe: 'unavailable',
  detailsNotLoaded: 'unavailable',
  noRight: 'unavailable',
  communityUnreachable: 'unavailable',
  tierNotYet: 'comingSoon',
  notOnThisTier: 'unavailable',
}

const status = (reason: RoomsReason, detail: string): OperationStatus => ({ status: STATUS_OF[reason], reason, detail })

export interface CapabilityInputs {
  /** Whether the phone has an agent to ask. */
  agentLinked: boolean
  /** The agent's discovery answer: undefined when it could not be asked, which is never read as "serves nothing". */
  servedTypes?: readonly string[]
  /** The operations this build of Keyring implements. */
  built: ReadonlySet<RoomsOperation>
}

/** One status per operation, from what the agent serves and what Keyring has built. */
export function deriveCapabilities({ agentLinked, servedTypes, built }: CapabilityInputs): RoomsCapabilities {
  const served = servedTypes ? new Set(servedTypes) : undefined
  const out = {} as RoomsCapabilities
  for (const op of ROOMS_OPERATIONS) {
    const need = ROOMS_REQUIREMENTS[op]
    if (need.from === 'nowhere') out[op] = status('notBuiltUpstream', need.why)
    else if (need.from === 'adminOnly') out[op] = status('adminOnly', need.why)
    else if (!built.has(op)) out[op] = status('clientNotBuilt', 'not built in this version of Keyring')
    else if (need.from === 'local') out[op] = status('ok', 'on this phone')
    else if (!agentLinked) out[op] = status('noAgentLinked', 'no agent is linked to this phone')
    else if (need.from === 'community') out[op] = status('ok', 'through the community')
    else if (!served) out[op] = status('agentUnknown', 'the agent could not be asked what it serves')
    else if (!need.anyOf.some((type) => served.has(type)))
      out[op] = status('agentDoesNotServe', `the agent serves none of ${need.anyOf.join(', ')}`)
    else out[op] = status('ok', 'served by the agent')
  }
  return out
}

/** The fixture service's statuses: everything works on sample data, except what no one can do. */
export function sampleCapabilities(): RoomsCapabilities {
  const out = {} as RoomsCapabilities
  for (const op of ROOMS_OPERATIONS) {
    const need = ROOMS_REQUIREMENTS[op]
    if (need.from === 'nowhere') out[op] = status('notBuiltUpstream', need.why)
    else if (need.from === 'adminOnly') out[op] = status('adminOnly', need.why)
    else out[op] = status('sample', 'sample data, nothing is sent')
  }
  return out
}

/** The right each room operation needs, from the room's authority credential (vti-rooms `Action`). */
const ROOM_OPERATION_RIGHT: Record<RoomOperation, RoomVerb | undefined> = {
  listNotes: 'read',
  readNote: 'read',
  write: 'write',
  curate: 'curate',
  listFiles: 'read',
  openFile: 'read',
  agentAccess: 'read',
  // Its status is already adminOnly service-wide; a room cannot widen it.
  listCommunityMembers: undefined,
}

export const ROOM_OPERATIONS = Object.keys(ROOM_OPERATION_RIGHT) as RoomOperation[]

/**
 * A room's operation statuses: the service-wide status where that already says no; otherwise
 * `detailsNotLoaded` for a custody-only room, `noRight` where the member's rights lack the one needed,
 * and the service-wide status (ok or sample) where they have it.
 */
export function deriveRoomCapabilities(
  service: RoomsCapabilities,
  room: Pick<RoomSummary, 'source' | 'verbs'>
): RoomCapabilities {
  const out = {} as RoomCapabilities
  for (const op of ROOM_OPERATIONS) {
    const base = service[op]
    const right = ROOM_OPERATION_RIGHT[op]
    if (base.status !== 'available' || right === undefined) out[op] = base
    else if (room.source === 'custody' || room.verbs === undefined)
      out[op] = status('detailsNotLoaded', 'the community’s record of this room has not been loaded')
    else if (!room.verbs.includes(right)) out[op] = status('noRight', `this member's rights do not include ${right}`)
    else out[op] = base
  }
  return out
}
