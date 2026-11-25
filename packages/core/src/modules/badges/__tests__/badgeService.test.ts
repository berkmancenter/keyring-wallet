import { TypedArrayEncoder } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { createBadgeService, type BadgesBackend } from '../badgeService'
import { MEMBER_BADGES } from '../badgesSwitch'
import { BADGE_TASK, HOLDER_TASKS, parseMine, parseShow, parseWall } from '../wire'

import imagesGet from './fixtures/images-get.response.json'
import mineList from './fixtures/mine-list.response.json'
import show from './fixtures/show.response.json'
import wallShow from './fixtures/wall-show.response.json'

const COMMUNITY = 'did:example:community'
const SHIPPED = { ...MEMBER_BADGES }
afterEach(() => Object.assign(MEMBER_BADGES, SHIPPED))

const refusal = (code: string) => Object.assign(new Error(`refused: ${code}`), { name: 'VtiRefusal', code })

function backend(answer: (type: string, payload: Record<string, unknown>) => unknown) {
  const calls: { type: string; payload: Record<string, unknown> }[] = []
  const b: BadgesBackend = {
    communityTask: async (_c, type, payload) => {
      calls.push({ type, payload })
      return answer(type, payload)
    },
  }
  return { b, calls }
}
const throws = (e: Error) => () => {
  throw e
}

describe("the parsers, on upstream's own answers (trust-tasks-tf 4fddc096a)", () => {
  it('reads mine/list: two held, one of them hidden, one offer with its giver by name', () => {
    const mine = parseMine(mineList, COMMUNITY)
    expect(mine.held.map((b) => [b.name, b.kind, b.count, b.hidden, b.pinned])).toEqual([
      ['Workshop host', 'community', 2, false, true],
      ['Clamp whisperer', 'kudos', 3, true, false],
    ])
    expect(mine.held[0].credentialValidUntil).toBe('2028-10-19T18:30:00Z')
    expect(mine.held[0].image).toEqual({
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      mediaType: 'image/png',
    })
    expect(mine.offers).toHaveLength(1)
    expect(mine.offers[0]).toMatchObject({
      awardId: 'awd_H7q2Lm9Xc4Vt1Bz8',
      name: 'One year aboard',
      note: 'A year of Saturdays. Thank you.',
      givenBy: 'Ben',
      expiresAt: '2026-12-05T20:00:00Z',
    })
    expect(mine.kudosTotal).toBe(0)
    expect(mine.visibility).toBe('members')
  })

  it("never carries the giver's entry id or a DID into an offer", () => {
    const offer = parseMine(mineList, COMMUNITY).offers[0] as unknown as Record<string, unknown>
    // The community's own DID is the one DID an offer carries.
    const { communityDid, ...rest } = offer
    expect(communityDid).toBe(COMMUNITY)
    expect(JSON.stringify(rest)).not.toMatch(/dir_|did:/)
  })

  it('reads wall/show', () => {
    const wall = parseWall(wallShow, COMMUNITY)
    expect(wall.map((b) => [b.name, b.count, b.pinned])).toEqual([
      ['Workshop host', 3, true],
      ['Clamp whisperer', 5, false],
    ])
  })

  it('reads show', () => {
    expect(parseShow(show, COMMUNITY)).toMatchObject({ badgeId: 'bdg_W5k2N8xRb3Qz7TpL', name: 'Workshop host' })
  })

  it('drops an offer no longer offered, and one whose badge is not the award’s', () => {
    const p = JSON.parse(JSON.stringify(mineList))
    p.offers.push({ ...p.offers[0], award: { ...p.offers[0].award, state: 'withdrawn' } })
    p.offers.push({ ...p.offers[0], award: { ...p.offers[0].award, badgeId: 'bdg_SomeOtherBadge0000' } })
    expect(parseMine(p, COMMUNITY).offers).toHaveLength(1)
  })

  it('drops a badge with no valid id, kind or name, and keeps the rest', () => {
    const p = JSON.parse(JSON.stringify(mineList))
    p.badges.push({ ...p.badges[0], badge: { ...p.badges[0].badge, badgeId: 'not-a-badge' } })
    p.badges.push({ ...p.badges[0], badge: { ...p.badges[0].badge, kind: 'medal' } })
    p.badges.push({ ...p.badges[0], badge: { ...p.badges[0].badge, name: '' } })
    expect(parseMine(p, COMMUNITY).held).toHaveLength(2)
  })

  it('answers nothing for an answer that is not one', () => {
    expect(parseMine(undefined, COMMUNITY)).toEqual({ held: [], offers: [] })
    expect(parseWall({ entries: 'x' }, COMMUNITY)).toEqual([])
  })
})

describe('the badge service', () => {
  it('asks mine/list with nothing in it, as the member', async () => {
    const { b, calls } = backend(() => mineList)
    const mine = await createBadgeService(b).mine(COMMUNITY)
    expect(calls).toEqual([{ type: BADGE_TASK.mineList, payload: {} }])
    expect(mine).not.toBe('notServed')
  })

  it('reads a community that does not serve badges as notServed', async () => {
    for (const code of ['unsupportedType', 'unsupportedVersion']) {
      const { b } = backend(throws(refusal(code)))
      await expect(createBadgeService(b).mine(COMMUNITY)).resolves.toBe('notServed')
    }
  })

  it('lets any other refusal through (control)', async () => {
    const { b } = backend(throws(refusal('permissionDenied')))
    await expect(createBadgeService(b).mine(COMMUNITY)).rejects.toMatchObject({ code: 'permissionDenied' })
  })

  it('accepts and declines by the award id alone', async () => {
    const { b, calls } = backend(() => ({}))
    const s = createBadgeService(b)
    await s.accept(COMMUNITY, 'awd_H7q2Lm9Xc4Vt1Bz8')
    await s.decline(COMMUNITY, 'awd_H7q2Lm9Xc4Vt1Bz8')
    expect(calls).toEqual([
      { type: BADGE_TASK.mineAccept, payload: { awardId: 'awd_H7q2Lm9Xc4Vt1Bz8' } },
      { type: BADGE_TASK.mineDecline, payload: { awardId: 'awd_H7q2Lm9Xc4Vt1Bz8' } },
    ])
  })

  it('reads a wall it may not see as hidden, the same for a refused one and an unknown one', async () => {
    for (const code of ['permissionDenied', 'notFound']) {
      const { b } = backend(throws(refusal(code)))
      await expect(createBadgeService(b).wall(COMMUNITY, 'dir_x')).resolves.toBe('hidden')
    }
  })

  it('asks a wall by the directory entry', async () => {
    const { b, calls } = backend(() => wallShow)
    await createBadgeService(b).wall(COMMUNITY, 'dir_Tm4sV3g4K9xQ2bLp')
    expect(calls).toEqual([{ type: BADGE_TASK.wallShow, payload: { entryId: 'dir_Tm4sV3g4K9xQ2bLp' } }])
  })

  describe('pictures', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
    const digest = bytesToHex(sha256(bytes))
    const good = {
      image: { sha256: digest, mediaType: 'image/png', size: bytes.length },
      data: TypedArrayEncoder.toBase64Url(bytes),
    }

    it('shows a picture whose bytes are the digest asked for, and asks for it once', async () => {
      const { b, calls } = backend(() => good)
      const s = createBadgeService(b)
      const first = await s.image(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL', digest)
      const again = await s.image(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL', digest)
      expect(first).toMatch(/^data:image\/png;base64,/)
      expect(again).toBe(first)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        type: BADGE_TASK.imagesGet,
        payload: { badgeId: 'bdg_W5k2N8xRb3Qz7TpL', sha256: digest },
      })
    })

    it("shows no picture when the bytes are not the digest (upstream's example names one its bytes do not hash to)", async () => {
      const { b } = backend(() => imagesGet)
      await expect(
        createBadgeService(b).image(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL', imagesGet.image.sha256)
      ).resolves.toBeUndefined()
    })

    it('shows no picture for a refusal', async () => {
      const { b } = backend(throws(refusal('notFound')))
      await expect(createBadgeService(b).image(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL', digest)).resolves.toBeUndefined()
    })
  })

  describe('while badges are off', () => {
    it('asks nothing, and every read answers as a community that serves none', async () => {
      MEMBER_BADGES.remoteOff = true
      const { b, calls } = backend(() => mineList)
      const s = createBadgeService(b)
      await expect(s.mine(COMMUNITY)).resolves.toBe('notServed')
      await expect(s.wall(COMMUNITY, 'dir_x')).resolves.toBe('notServed')
      await expect(s.show(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL')).resolves.toBe('notServed')
      await expect(s.image(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL', 'a'.repeat(64))).resolves.toBeUndefined()
      await expect(s.accept(COMMUNITY, 'awd_H7q2Lm9Xc4Vt1Bz8')).rejects.toMatchObject({ code: 'off' })
      expect(calls).toEqual([])
    })
  })
})

describe('show', () => {
  it('answers a badge it may not see as one that is not there', async () => {
    for (const code of ['permissionDenied', 'notFound', 'unsupportedType']) {
      const { b } = backend(throws(refusal(code)))
      await expect(createBadgeService(b).show(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL')).resolves.toBe('notServed')
    }
  })

  it('lets any other refusal through (control)', async () => {
    const { b } = backend(throws(refusal('rateLimited')))
    await expect(createBadgeService(b).show(COMMUNITY, 'bdg_W5k2N8xRb3Qz7TpL')).rejects.toMatchObject({
      code: 'rateLimited',
    })
  })
})

// Two guards, each needing the other: this one pins which task URIs may exist, by LITERAL pattern; the per-method rows
// above pin which one each method sends, by the constant. Those rows mean something only because this pins the
// constant's value, so neither may be dropped as redundant.
describe('what the client may send', () => {
  it('is holder tasks only: never a share, an offer, or an owner’s or administrator’s task', () => {
    for (const type of HOLDER_TASKS) {
      expect(type).toMatch(
        /^https:\/\/trusttasks\.org\/spec\/vtc\/badges\/(mine\/(list|accept|decline)|wall\/show|show|images\/get)\/0\.1$/
      )
      expect(type).not.toMatch(/awards\/|claims\/|settings\/|create|update|retire|promote|kudos\/give/)
    }
  })
})
