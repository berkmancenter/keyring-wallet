/**
 * What a rooms log line may say about a community and about why a read did not happen.
 *
 * A read refused because a step keeps the community session as another of this phone's identities (vtiAgent
 * `VtiSessionHeld`) carries that step's reason ("signed in for a step just now", "polls"). Beside a community's DID
 * that pairs a step, possibly a hidden-vetting persona's, with a community, which the hold's own rule forbids. A
 * tester's 277.8 report logged it every 30 s (34VR-Y58H, 11-03). Any other error's words can name an identity too. So
 * the community is named by short id, and why a read failed by its kind alone.
 *
 * @module rooms/roomsLogWords
 */
import { refusalCode } from './real/wire'
import { RoomsRefused, RoomsUnavailable } from './types'

/** vtiAgent's `VtiSessionHeld`, by name, as the rooms backend and the persona inbox read it. */
const isSessionHeld = (e: unknown): boolean => e instanceof Error && e.name === 'VtiSessionHeld'

/**
 * A community or room in a log line: enough to tell it apart, never the whole DID. The short form the screens use
 * (communityName `shortDid`), kept here so the rooms hooks import no screen.
 */
export const logRef = (did: string | undefined): string =>
  !did ? 'none' : did.length <= 28 ? did : `${did.slice(0, 16)}…${did.slice(-8)}`

/**
 * The refusal codes a log line may repeat, and no others. A community writes a refusal's code and details as well as
 * its message, so a code is only a kind while it is one this list knows: anything else reads as `other`, whatever it
 * says. An unlisted code loses a word in a report, never more.
 *
 * **`refused (other)` in a report means a code missing from this list: find out what it was, and add it.** The list
 * can't find its own gaps, because a code an agent sends and no specification declares reaches here only from a device.
 * So regenerating the specifications' part must keep what is listed apart from it.
 */
const LOGGED_REFUSAL_CODES = new Set([
  // The framework's own (trust-tasks-rs StandardCode, SPEC 8.3).
  'malformedRequest',
  'unsupportedType',
  'unsupportedVersion',
  'unsupportedExtension',
  'expired',
  'proofRequired',
  'proofInvalid',
  'permissionDenied',
  'wrongRecipient',
  'identityMismatch',
  'idConflict',
  'cancelled',
  'taskFailed',
  'unavailable',
  'internalError',
  'indeterminate',
  // A room task's own: every code any version of the rooms and community rooms specifications declares (vti-specs-rooms
  // at VTI 4614eabb9), and those their docs name beside them.
  'aboveCeiling',
  'actionNotHeld',
  'admissionPending',
  'alreadyAccepted',
  'alreadyExists',
  'alreadyJoined',
  'alreadyMember',
  'alreadyRetracted',
  'authorNotPrincipal',
  'blobNotFound',
  'bodyInvalid',
  'cannotOpen',
  'capacityExceeded',
  'chainTooDeep',
  'chunkMismatch',
  'chunkOutOfRange',
  'commitInvalid',
  'configNotActive',
  'configNotFound',
  'contended',
  'credentialRequired',
  'didNotOpen',
  'digestMismatch',
  'earlierRemovalRefused',
  'emptyActions',
  'entryNotPermitted',
  'epochConflict',
  'epochGap',
  'epochMismatch',
  'filesDisabled',
  'forbidden',
  'hostRefused',
  'hostUnreachable',
  'incomplete',
  'invalidCombination',
  'invalidCursor',
  'invalidManifest',
  'invalidParts',
  'invalidRange',
  'invalidSettings',
  'issuerNotPrincipal',
  'keyHolderRefused',
  'keyHolderUnavailable',
  'keyPackageInvalid',
  'keyPackageNotExpected',
  'keyPackageNotHeld',
  'keyPackageRequired',
  'lastAdmin',
  'limitExceeded',
  'listInvalid',
  'locationMismatch',
  'memberLimitsUnavailable',
  'memberUsageUnavailable',
  'noAuthority',
  'noGroup',
  'noKeyHolder',
  'noList',
  'nonSequential',
  'noRetention',
  'noSigningKey',
  'notAhead',
  'notAMember',
  'notAppendOnly',
  'notAttempted',
  'notAvailable',
  'notDelivered',
  'notFound',
  'notHeld',
  'notInRoom',
  'notInvited',
  'notMember',
  'notNominated',
  'noTransferMode',
  'notTheOwner',
  'notWitnessed',
  'offerExpired',
  'offerWithdrawn',
  'ownLeaf',
  'principalAmbiguous',
  'privateRoom',
  'rateLimited',
  'recordTooLarge',
  'retentionConflict',
  'retentionNotPermitted',
  'roomNotFound',
  'roomNotLive',
  'roomStillLive',
  'roomSubject',
  'sealedRoomMint',
  'sequenceConflict',
  'stale',
  'subjectBindingMissing',
  'tierUnknown',
  'tooManyUploads',
  'typeNotActable',
  'unknownEpoch',
  'unknownStorageConfig',
  'uploadKeyInUse',
  'versionConflict',
  'visibilityNotPermitted',
  'welcomeInvalid',
  'wrongState',
  // Sent by an agent though no specification declares it: `rooms/keys/seal:conflict`, more than one credential for a
  // room (277.8). Why this refusal needs a word of its own is the reason this list exists at all.
  'conflict',
  // Keyring's own, for a step that went wrong between a room's tasks.
  'empty',
  'fileTooLarge',
  'joinFailed',
  'roomKeptMoving',
  'senderRefused',
  'tooLarge',
  'tooLong',
  'welcomeMissing',
])

/**
 * What a VTA says in `details.reason` when everything else reads `taskFailed` (vta-sdk `trust_task_reject_reasons`).
 * It is the only thing that tells "no persona holds this room" (`not_found`) from "more than one does" (`conflict`).
 */
const LOGGED_REFUSAL_REASONS = new Set([
  'not_found',
  'conflict',
  'gone',
  'upstream_unavailable',
  'no_matching_protocol',
])

const loggedCode = (code: string | undefined): string => (code && LOGGED_REFUSAL_CODES.has(code) ? code : 'other')

/** A `VtiRefusal` by its closed code and reason. Its message is the community's and is never read here. */
function refusalKind(e: Error): string {
  const reason = (e as Error & { details?: { reason?: unknown } }).details?.reason
  const code = loggedCode(refusalCode(e))
  return typeof reason === 'string' && LOGGED_REFUSAL_REASONS.has(reason)
    ? `refused (${code}, ${reason})`
    : `refused (${code})`
}

/**
 * Why a read failed, by kind only: no persona, step or task detail. The only form a line that names a community or room
 * may use. An error's own words can name an identity ("did:key:…'s agent is no longer linked"), and beside a
 * community that is the pairing the hold's rule forbids, whatever the error.
 */
export function failureCategory(e: unknown): string {
  if (isSessionHeld(e)) return 'the session is kept for another identity'
  if (e instanceof RoomsUnavailable) return `unavailable (${e.reason})`
  if (e instanceof RoomsRefused) return `refused (${loggedCode(e.code)})`
  if (e instanceof Error && e.name === 'VtiRefusal') return refusalKind(e)
  if (e instanceof Error && e.name === 'VtiSentNoAnswer') return 'no answer yet'
  return e instanceof Error && e.name && e.name !== 'Error' ? e.name : 'failed'
}
