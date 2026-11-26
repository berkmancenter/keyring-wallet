/**
 * The member badges client: the holder's tasks to a community, over the identity the phone joined it with
 * (`agentBadgesBackend`), as the directory and polls ask theirs.
 *
 * A community that does not serve badges answers `unsupportedType` (or `unsupportedVersion`): that is `'notServed'`,
 * and the screens show nothing. One that serves them with badges switched off answers `mine/list` empty (VTI-BDG-004).
 * A wall the community does not show this member is `permissionDenied`, or `notFound` for an entry it does not show:
 * that is `'hidden'`, the same answer either way, so nothing tells a member which. A badge it may not see and one that
 * is not there are both `'notServed'` from `show`, and a picture refused for any reason is no picture: no read here
 * tells "there is none" from "you may not see it".
 *
 * Nothing is asked while badges are off (`badgesSwitch`): every call answers as a community that serves none.
 *
 * @module badges/badgeService
 */
import { refusalCode } from '../rooms/real/wire'

import { isMemberBadgesOn } from './badgesSwitch'
import type { BadgeService, BadgeSummary, MyBadges, NotServed, WallBadge, WallHidden } from './types'
import { BADGE_TASK, parseBadgeImage, parseMine, parseShow, parseWall } from './wire'

/** What the client needs of the app: one task to a community, as the member's identity there. */
export interface BadgesBackend {
  communityTask(communityDid: string, type: string, payload: Record<string, unknown>): Promise<unknown>
}

/** A refusal of a badge task, by the task's own code. */
export class BadgeRefused extends Error {
  public constructor(
    public readonly operation: string,
    public readonly code: string
  ) {
    super(`badges: ${operation} was refused (${code})`)
    this.name = 'BadgeRefused'
  }
}

const NOT_SERVED = new Set(['unsupportedType', 'unsupportedVersion'])
const WALL_HIDDEN = new Set(['permissionDenied', 'notFound'])
/** The pictures a session has read, by digest: a picture is the same bytes wherever it is shown. */
const IMAGE_CACHE_MAX = 64

export function createBadgeService(backend: BadgesBackend): BadgeService {
  const images = new Map<string, string>()

  const ask = async (operation: string, communityDid: string, type: string, payload: Record<string, unknown>) => {
    try {
      return await backend.communityTask(communityDid, type, payload)
    } catch (e) {
      const code = refusalCode(e)
      if (code) throw new BadgeRefused(operation, code)
      throw e
    }
  }
  const notServed = (e: unknown): boolean => e instanceof BadgeRefused && NOT_SERVED.has(e.code)

  return {
    async mine(communityDid): Promise<MyBadges | NotServed> {
      if (!isMemberBadgesOn()) return 'notServed'
      try {
        return parseMine(await ask('mine', communityDid, BADGE_TASK.mineList, {}), communityDid)
      } catch (e) {
        if (notServed(e)) return 'notServed'
        throw e
      }
    },

    async accept(communityDid, awardId) {
      if (!isMemberBadgesOn()) throw new BadgeRefused('accept', 'off')
      await ask('accept', communityDid, BADGE_TASK.mineAccept, { awardId })
    },

    async decline(communityDid, awardId) {
      if (!isMemberBadgesOn()) throw new BadgeRefused('decline', 'off')
      await ask('decline', communityDid, BADGE_TASK.mineDecline, { awardId })
    },

    async wall(communityDid, entryId): Promise<WallBadge[] | NotServed | WallHidden> {
      if (!isMemberBadgesOn()) return 'notServed'
      try {
        return parseWall(await ask('wall', communityDid, BADGE_TASK.wallShow, { entryId }), communityDid)
      } catch (e) {
        if (notServed(e)) return 'notServed'
        if (e instanceof BadgeRefused && WALL_HIDDEN.has(e.code)) return 'hidden'
        throw e
      }
    },

    async show(communityDid, badgeId): Promise<BadgeSummary | NotServed> {
      if (!isMemberBadgesOn()) return 'notServed'
      try {
        return parseShow(await ask('show', communityDid, BADGE_TASK.show, { badgeId }), communityDid) ?? 'notServed'
      } catch (e) {
        // As a wall: a badge that is not there and one this member may not see answer the same.
        if (notServed(e) || (e instanceof BadgeRefused && WALL_HIDDEN.has(e.code))) return 'notServed'
        throw e
      }
    },

    async image(communityDid, badgeId, sha256) {
      if (!isMemberBadgesOn()) return undefined
      const held = images.get(sha256)
      if (held) return held
      let answer: unknown
      try {
        answer = await ask('image', communityDid, BADGE_TASK.imagesGet, { badgeId, sha256 })
      } catch (e) {
        // Not shown to you, gone, or a community before badges: no picture, all the same.
        if (e instanceof BadgeRefused) return undefined
        throw e
      }
      const media = (answer as { image?: { mediaType?: unknown } } | undefined)?.image?.mediaType
      const uri = parseBadgeImage(answer, { sha256, mediaType: typeof media === 'string' ? media : '' })
      if (uri) {
        if (images.size >= IMAGE_CACHE_MAX) images.delete(images.keys().next().value as string)
        images.set(sha256, uri)
      }
      return uri
    },
  }
}
