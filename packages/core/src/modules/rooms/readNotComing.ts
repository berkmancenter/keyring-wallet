/**
 * A room read refused for a reason that asking again will not change, and what a row then says in place of a spinner.
 *
 * A row whose room has not been read shows a spinner, and its read is tried again: on a cold launch the agent may not
 * be ready, and a moment later it is. A refusal over a version is not like that. A room whose host does not serve the
 * version the member's agent asks it in is refused the same way on every read until one of them is updated, and its
 * row span for ever and said nothing of why (IN-814: a tester's room on a community running an older build).
 *
 * Two refusals count, and no others:
 *   unsupportedVersion  the one asked serves the task, at other versions than the one asked for
 *   unsupportedType     the one asked does not serve the task at all
 * Every other refusal can change without anyone updating anything (a host that could not be reached, keys that have
 * not arrived, a membership that is on its way), so its row keeps reading and its read is tried again, as before.
 *
 * Who needs the update is said only where the refusal says it in a form that MEANS it. The member's agent passes a
 * host's refusal on as its own `hostRefused` with the host's code in `details.code` (vta-service `room_group.rs`
 * `host_failure`); a refusal whose own code is the version code is the agent's. The framework's `details` name the
 * version asked for (`requestedType`) and the versions served (`servedVersions`): then the side asked serves either
 * only older versions than the one asked for (it is behind) or only newer (the one asking is behind).
 *
 * A host's refusal passed on carries no such details today, only the host's words, and words are not read for who is
 * behind. A first draft took the first specification address in them as the version asked for and the rest as those
 * served. The same refusal worded another way (the agent naming what it asked for in its own sentence, the host
 * naming what it serves in its own) then named the OPPOSITE side, with numbers in the log to back it: a member told
 * to update their agent for a room that waits on its community. Position in a sentence does not mean "asked", so
 * such a row says only that it can't be read yet, and the log line repeats the versions named without saying which
 * was which.
 *
 * Two limits of what is claimed, so a wrong row is not taken for a new bug:
 *
 * `servedVersions` is a hint, not the whole list (trust-tasks `taskVersions.ts`, its header). An agent builds it
 * from its dispatch table, and some agents also answer OLDER versions the table does not list (vta-service v0.60.0
 * to v0.66.0, for `device/*` and `vault/*`). That cannot turn the side round here. The version asked for was
 * refused, so it is not served. An unlisted version is older than the listed ones it is rewritten to. So where
 * every listed version is older than the one asked for, every served one is; and where every listed version is
 * newer, updating the one that asked still gets it answered, whatever older version is also served.
 *
 * `unsupportedType` says only that the one asked serves no version of the task, which has two causes the refusal
 * cannot tell apart: it never had the task (it is behind, which is what the row says, as the rooms listing reads a
 * community that answers so), or it has dropped the task (it is ahead, and the row then names the wrong side).
 * Likewise the member's own agent answering `unsupportedType` is named as the one behind, when it may be Keyring
 * asking for a task the agent has yet to gain or has retired. There are no versions to compare, so this is a guess
 * from the code and from who refused; it is right for a host or an agent older than rooms, the case seen.
 *
 * @module rooms/readNotComing
 */
import { refusalCode } from './real/wire'

/** Why a row can't be read, by who has to update: the room's community, the member's agent, Keyring, or unknown. */
export type RowCannotRead = 'communityNeedsUpdate' | 'agentNeedsUpdate' | 'appNeedsUpdate' | 'cannotTell'

/** A task and a version, as a specification URI names them: lower-case path segments, then `major.minor`. */
const SPEC_URI = /https:\/\/trusttasks\.org\/spec\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\/(\d{1,3}\.\d{1,3})(?![\d.])/g

export interface RefusedVersions {
  /** The task asked for, without its version: `rooms/records/list`. */
  task: string
  asked: string
  /** The versions of that task the refuser says it serves; empty when it named none. */
  served: string[]
}

const urisIn = (text: unknown): { task: string; version: string }[] =>
  typeof text !== 'string' ? [] : [...text.matchAll(SPEC_URI)].map((m) => ({ task: m[1], version: m[2] }))

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

/** Whether the member's agent is passing on what the room's host said, rather than refusing itself. */
export function refusedByHost(e: unknown): boolean {
  const own = (e as { code?: unknown } | null | undefined)?.code
  return typeof own === 'string' && own.slice(own.lastIndexOf(':') + 1) === 'hostRefused'
}

/**
 * The version a refusal says was asked for and the versions it says are served, from the framework's `details`
 * (`requestedType`, `servedVersions`): the one source that means which is which. Undefined when the refusal has no
 * such details, whatever its words name.
 */
export function refusedVersions(e: unknown): RefusedVersions | undefined {
  const details = record((e as { details?: unknown } | null | undefined)?.details)
  const [asked] = urisIn(details?.requestedType)
  if (!asked) return undefined
  const served = (Array.isArray(details?.servedVersions) ? details.servedVersions : []).flatMap(urisIn)
  return {
    task: asked.task,
    asked: asked.version,
    served: served.filter((s) => s.task === asked.task).map((s) => s.version),
  }
}

/**
 * The tasks and versions a refusal's words name, in the order named and each once: what a host's refusal passed on
 * gives (`details.reason`, and the agent's own sentence). For a log line only. Nothing here says which version was
 * asked for and which are served, and nothing is read from their order.
 */
export function versionsNamed(e: unknown): string[] {
  const details = record((e as { details?: unknown } | null | undefined)?.details)
  const named = [...urisIn((e as { message?: unknown } | null | undefined)?.message), ...urisIn(details?.reason)]
  return [...new Set(named.map((n) => `${n.task} ${n.version}`))]
}

const parts = (version: string): [number, number] => {
  const [major, minor] = version.split('.').map(Number)
  return [major, minor]
}
const older = (a: string, b: string): boolean => {
  const [aMajor, aMinor] = parts(a)
  const [bMajor, bMinor] = parts(b)
  return aMajor < bMajor || (aMajor === bMajor && aMinor < bMinor)
}

/**
 * Why a read will not come, or undefined for a failure a retry may get past. See the module's notes for the two
 * refusals that count and how the side that needs an update is told.
 */
export function readNotComing(e: unknown): RowCannotRead | undefined {
  const code = refusalCode(e)
  if (code !== 'unsupportedVersion' && code !== 'unsupportedType') return undefined
  const byHost = refusedByHost(e)
  // The one asked does not know the task at all: it is the one behind, as the rooms listing reads a community that
  // answers so (agentRoomsService: "too old for rooms").
  if (code === 'unsupportedType') return byHost ? 'communityNeedsUpdate' : 'agentNeedsUpdate'
  const versions = refusedVersions(e)
  if (!versions || versions.served.length === 0) return 'cannotTell'
  const askedIsNewer = versions.served.every((served) => older(served, versions.asked))
  const askedIsOlder = versions.served.every((served) => older(versions.asked, served))
  if (askedIsNewer) return byHost ? 'communityNeedsUpdate' : 'agentNeedsUpdate'
  if (askedIsOlder) return byHost ? 'agentNeedsUpdate' : 'appNeedsUpdate'
  return 'cannotTell'
}

/**
 * What a log line adds to a version refusal, so a report says who is behind: who refused, and where the refusal's
 * details say so, the task and version asked for and the versions served. Where it has only words, the tasks and
 * versions those words name, without saying which was asked for. Empty for any other failure. Task names and version
 * numbers only.
 */
export function refusedVersionsWords(e: unknown): string {
  const code = refusalCode(e)
  if (code !== 'unsupportedVersion' && code !== 'unsupportedType') return ''
  const who = refusedByHost(e) ? "by the room's host" : 'by the agent'
  const versions = refusedVersions(e)
  if (versions) {
    const serves = versions.served.length > 0 ? `, it serves ${versions.served.join(', ')}` : ''
    return ` ${who}: asked ${versions.task} ${versions.asked}${serves}`
  }
  // Words only: the versions they name, unattributed. A reader of the report can tell more than the app may claim.
  const named = versionsNamed(e)
  return named.length > 0 ? ` ${who}; its words name ${named.join(', ')}` : ` ${who}`
}

/** The row's words for each reason (`Rooms.*` in the localisation files). */
export const ROW_CANNOT_READ_KEY: Record<RowCannotRead, string> = {
  communityNeedsUpdate: 'Rooms.RowCommunityNeedsUpdate',
  agentNeedsUpdate: 'Rooms.RowAgentNeedsUpdate',
  appNeedsUpdate: 'Rooms.RowAppNeedsUpdate',
  cannotTell: 'Rooms.RowCannotRead',
}
