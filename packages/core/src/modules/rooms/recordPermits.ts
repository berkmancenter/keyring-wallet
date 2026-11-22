/**
 * Which writes a room's profile permits its member: one rule, read by the screen (`useRecordSending`) and by the service
 * when it notices a room that stopped taking them (`recordsWereOn`), so the two can't come to differ.
 *
 * @module rooms/recordPermits
 */
import type { RecordFeatures } from './types'

/** What a member needs listed, and sealed, for each write (`messageMembers`, `keptMembers`, a reaction's members). */
export const NEEDS = {
  reply: ['inReplyTo'],
  reaction: ['kind', 'inReplyTo', 'writtenAt'],
  typed: ['kind'],
} as const

/** The profile lists every one of these members, and the member's agent seals them. */
export const permits = (features: RecordFeatures | undefined, members: readonly string[]): boolean =>
  !!features && features.canSeal && members.every((m) => features.listed.includes(m))

/** The room takes replies or reactions: what the sheet offers beyond Copy. */
export const takesRepliesOrReactions = (features: RecordFeatures | undefined): boolean =>
  permits(features, NEEDS.reply) || permits(features, NEEDS.reaction)
