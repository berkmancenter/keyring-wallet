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
 * Who needs the update is read from the refusal where it says. The member's agent passes a host's refusal on as its
 * own `hostRefused` with the host's code in `details.code` (vta-service `room_group.rs` `host_failure`); a refusal
 * whose own code is the version code is the agent's. For a version, the side asked serves either only older versions
 * than the one asked for (it is behind) or only newer (the one asking is behind); anything else, or a refusal that
 * names no versions, is not guessed at.
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
 * The versions a refusal names: the task asked for, at which version, and the versions the refuser serves. Read from
 * the framework's `details` (`requestedType`, `servedVersions`) where the refusal has them, else from the specification
 * URIs in the words a host's refusal was passed on with (the first is the one asked for). Only what has the form of a
 * specification URI is read, so nothing else a refusal says is ever repeated.
 */
export function refusedVersions(e: unknown): RefusedVersions | undefined {
  const details = record((e as { details?: unknown } | null | undefined)?.details)
  const [asked] = urisIn(details?.requestedType)
  if (asked) {
    const served = (Array.isArray(details?.servedVersions) ? details.servedVersions : []).flatMap(urisIn)
    return {
      task: asked.task,
      asked: asked.version,
      served: served.filter((s) => s.task === asked.task).map((s) => s.version),
    }
  }
  const said = [...urisIn(details?.reason), ...urisIn((e as { message?: unknown } | null | undefined)?.message)]
  const [first, ...rest] = said
  if (!first) return undefined
  const served = rest.filter((s) => s.task === first.task && s.version !== first.version).map((s) => s.version)
  return { task: first.task, asked: first.version, served: [...new Set(served)] }
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
 * What a log line adds to a version refusal, so a report says who is behind: who refused, the task and version asked
 * for, and the versions served. Empty for any other failure, and for a refusal that names no versions only who
 * refused. Task names and version numbers only.
 */
export function refusedVersionsWords(e: unknown): string {
  const code = refusalCode(e)
  if (code !== 'unsupportedVersion' && code !== 'unsupportedType') return ''
  const who = refusedByHost(e) ? "by the room's host" : 'by the agent'
  const versions = refusedVersions(e)
  if (!versions) return ` ${who}`
  const serves = versions.served.length > 0 ? `, it serves ${versions.served.join(', ')}` : ''
  return ` ${who}: asked ${versions.task} ${versions.asked}${serves}`
}

/** The row's words for each reason (`Rooms.*` in the localisation files). */
export const ROW_CANNOT_READ_KEY: Record<RowCannotRead, string> = {
  communityNeedsUpdate: 'Rooms.RowCommunityNeedsUpdate',
  agentNeedsUpdate: 'Rooms.RowAgentNeedsUpdate',
  appNeedsUpdate: 'Rooms.RowAppNeedsUpdate',
  cannotTell: 'Rooms.RowCannotRead',
}
