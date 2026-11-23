/**
 * What a writer may put in a room's record, and what it writes: a record's `kind`, what it answers, and when it was
 * written and edited (`SealedRecordBody`, rooms/_shared 0.2; trust-tasks-tf #1027).
 *
 * The rule is the writer's, and nobody else applies it: `rooms/keys/seal/0.3` does not check the room's profile, and no
 * host can on a sealed tier. "A writer MUST NOT write `kind`, `inReplyTo`, `writtenAt`, `editedAt`, `width`, `height` or
 * `preview` into a room unless the room's current profile" lists that member; no profile, one that doesn't list it, or
 * one that can't be read permits none.
 *
 * **Sending is a release's switch.** `RoomsBackend.recordSending` is what the real backend reads, on every send, from
 * `recordSendingSwitch.ts`: a release turns it on, and a release can turn it off again for everyone.
 *
 * @module rooms/real/recordWrites
 */
import { reactionValueOfBody } from '../roomPosts'
import type { RecordFeatures } from '../types'
import type { RecordMembers } from './wire'

export type { RecordFeatures, RecordWrite } from '../types'

/** The body members `recordMembers` governs. */
export const GOVERNED_BODY_MEMBERS = ['kind', 'inReplyTo', 'writtenAt', 'editedAt'] as const
/** The members of a record's `file` it governs, listed under these names. */
export const GOVERNED_FILE_MEMBERS = ['width', 'height', 'preview'] as const

/** Every governed member this body uses, by the name the profile lists it under. */
export function governedMembersIn(body: RecordMembers & { file?: object }): string[] {
  const file = (body.file ?? {}) as Record<string, unknown>
  return [
    ...GOVERNED_BODY_MEMBERS.filter((m) => body[m] !== undefined),
    ...GOVERNED_FILE_MEMBERS.filter((m) => file[m] !== undefined),
  ]
}

/** The room or the agent won't take these members, so nothing was sealed or sent. */
export class RecordMembersNotPermitted extends Error {
  public constructor(
    public readonly refused: string[],
    public readonly features: RecordFeatures
  ) {
    super(
      `this room can't take ${refused.join(', ')}: ${
        features.canSeal
          ? features.unresolved
            ? "its profile couldn't be read"
            : "its profile doesn't list it"
          : "this agent doesn't seal it"
      }`
    )
    this.name = 'RecordMembersNotPermitted'
  }
}

/** Sending these records isn't switched on in this build. */
export class RecordSendingOff extends Error {
  public constructor() {
    super('sending replies and reactions is not switched on')
    this.name = 'RecordSendingOff'
  }
}

/** The writer's rule: throws before anything is sealed or sent when this body uses what the room or agent won't take. */
export function requirePermitted(members: RecordMembers, features: RecordFeatures): void {
  const refused = governedMembersIn(members).filter((m) => !features.canSeal || !features.listed.includes(m))
  if (refused.length > 0) throw new RecordMembersNotPermitted(refused, features)
}

/** A value a reader would show, or a refusal: empty means a withdrawal, which has its own write. */
export function requireReactionValue(value: string): void {
  if (reactionValueOfBody(value) === undefined) throw new RangeError('not a reaction value a reader would show')
}

/** An instant as the schema spells it. */
export const recordTime = (ms: number): string => new Date(ms).toISOString()

/** What a new version of a record carries from the one it rewrites, and when it says it was edited. */
export function keptMembers(prior: RecordMembers, features: RecordFeatures, now: number): RecordMembers {
  return {
    ...(prior.kind !== undefined ? { kind: prior.kind } : {}),
    ...(prior.inReplyTo ? { inReplyTo: prior.inReplyTo } : {}),
    ...(prior.writtenAt ? { writtenAt: prior.writtenAt } : {}),
    ...(features.listed.includes('editedAt') ? { editedAt: recordTime(now) } : {}),
  }
}

/** A message's members: a plain message drops what the room doesn't take, as today; a reply can't lose its target. */
export function messageMembers(
  inReplyTo: RecordMembers['inReplyTo'],
  features: RecordFeatures,
  now: number
): RecordMembers {
  const listed = features.canSeal ? features.listed : []
  return {
    ...(listed.includes('kind') ? { kind: 'message' } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(listed.includes('writtenAt') ? { writtenAt: recordTime(now) } : {}),
  }
}
