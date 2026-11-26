/**
 * A room read refused over a version will be refused again until someone updates, so its row stops reading and says
 * who (IN-814). Which refusals count, how the side that needs the update is told, and what the log line adds.
 */
import { readNotComing, refusedByHost, refusedVersions, refusedVersionsWords, versionsNamed } from '../readNotComing'

const SPEC = 'https://trusttasks.org/spec/'
const refusal = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { name: 'VtiRefusal', code, details })
// The member's agent passing on what the room's host said (vta-service room_group.rs `host_failure`).
const byHost = (hostCode: string, reason: string) =>
  refusal('rooms/keys/browse:hostRefused', `room host \`did:webvh:host\` refused: ${hostCode}: ${reason}`, {
    code: hostCode,
    reason,
  })
const hostServes = (asked: string, served: string[]) =>
  byHost(
    'unsupportedVersion',
    `unsupported version: ${SPEC}rooms/records/list/${asked} — this VTC serves ${served.map((v) => `${SPEC}rooms/records/list/${v}`).join(', ')}`
  )
// The agent's own refusal of what Keyring asked, with the framework's details.
const byAgent = (asked: string, served: string[]) =>
  refusal('unsupportedVersion', 'unsupported version', {
    requestedType: `${SPEC}rooms/keys/browse/${asked}`,
    servedVersions: served.map((v) => `${SPEC}rooms/keys/browse/${v}`),
  })

describe('which refusals end a row for good', () => {
  test.each([
    ['a host unreachable', byHost('hostUnreachable', 'did not answer')],
    ['keys that have not arrived', refusal('rooms/keys/open:unknownEpoch', 'x', { reason: 'notDelivered' })],
    ['a membership not there yet', byHost('notAMember', 'not a member')],
    ['a permission', refusal('permissionDenied', 'no')],
    ['a busy host', byHost('rateLimited', 'slow down')],
    ['an agent that failed inside', refusal('internalError', 'oops')],
    ['an error that is no refusal', new Error('agent not ready')],
    ['nothing at all', undefined],
  ])('%s is tried again: not one of them', (_case, e) => {
    expect(readNotComing(e)).toBeUndefined()
    expect(refusedVersionsWords(e)).toBe('')
  })

  test('a version the host does not serve, and a task the host does not serve, are', () => {
    expect(readNotComing(hostServes('0.8', ['0.6']))).toBeDefined()
    expect(readNotComing(byHost('unsupportedType', 'unknown task'))).toBeDefined()
  })
})

// The agent passing on a host's refusal WITH the framework's details: not what an agent sends today, and read if one does.
const hostDetails = (asked: string, served: string[]) =>
  refusal('rooms/keys/browse:hostRefused', 'room host refused', {
    code: 'unsupportedVersion',
    requestedType: `${SPEC}rooms/records/list/${asked}`,
    servedVersions: served.map((v) => `${SPEC}rooms/records/list/${v}`),
  })

describe('who needs the update, where the refusal says it in details that mean it', () => {
  test('the agent serves only older versions than Keyring asked for: the agent', () => {
    expect(readNotComing(byAgent('0.6', ['0.4', '0.5']))).toBe('agentNeedsUpdate')
  })

  test('the agent serves only newer versions than Keyring asked for: Keyring', () => {
    expect(readNotComing(byAgent('0.6', ['0.7']))).toBe('appNeedsUpdate')
  })

  test('a host whose details say it serves only older versions than the agent asked for: the community; only newer: the agent', () => {
    expect(readNotComing(hostDetails('0.8', ['0.5', '0.6']))).toBe('communityNeedsUpdate')
    expect(readNotComing(hostDetails('0.6', ['0.8', '0.9']))).toBe('agentNeedsUpdate')
  })

  test('versions compare as numbers, not as text: 0.10 is newer than 0.9', () => {
    expect(readNotComing(byAgent('0.10', ['0.9']))).toBe('agentNeedsUpdate')
    expect(readNotComing(byAgent('0.9', ['0.10']))).toBe('appNeedsUpdate')
  })

  test('a task the one asked does not serve at all: that one is behind', () => {
    expect(readNotComing(byHost('unsupportedType', 'unknown task'))).toBe('communityNeedsUpdate')
    expect(readNotComing(refusal('unsupportedType', 'unknown task'))).toBe('agentNeedsUpdate')
  })

  test('not guessed at: no versions served named, versions on both sides of the one asked, or another task', () => {
    expect(readNotComing(refusal('unsupportedVersion', 'no'))).toBe('cannotTell')
    expect(readNotComing(byAgent('0.6', []))).toBe('cannotTell')
    expect(readNotComing(byAgent('0.6', ['0.5', '0.8']))).toBe('cannotTell')
    expect(
      readNotComing(
        refusal('unsupportedVersion', 'no', {
          requestedType: `${SPEC}rooms/keys/browse/0.6`,
          servedVersions: [`${SPEC}rooms/keys/read/0.2`],
        })
      )
    ).toBe('cannotTell')
  })
})

describe("who is behind is never read from a refusal's words (found in review)", () => {
  // One refusal, the same facts, worded two ways. The host serves list 0.1 and 0.2; the agent asked for 0.3. So the
  // community is behind. A reader that took the first address named as the one asked for called A the agent's fault.
  const wordedA = refusal('rooms/keys/browse:hostRefused', `the room's host refused ${SPEC}rooms/records/list/0.3`, {
    code: 'unsupportedVersion',
    reason: `this host serves ${SPEC}rooms/records/list/0.1 and ${SPEC}rooms/records/list/0.2`,
  })
  const wordedB = byHost(
    'unsupportedVersion',
    `asked ${SPEC}rooms/records/list/0.3; this host serves ${SPEC}rooms/records/list/0.1 and ${SPEC}rooms/records/list/0.2`
  )
  const servedFirst = byHost(
    'unsupportedVersion',
    `this host serves ${SPEC}rooms/records/list/0.1 and ${SPEC}rooms/records/list/0.2, not ${SPEC}rooms/records/list/0.3`
  )

  test.each([
    ['the agent names what it asked, the host what it serves', wordedA],
    ['both in the host’s words, the one asked for first', wordedB],
    ['both in the host’s words, the ones served first', servedFirst],
    ['the wording the first draft was written for', hostServes('0.8', ['0.5', '0.6'])],
  ])('%s: the row says only that it can’t be read yet', (_wording, e) => {
    expect(readNotComing(e)).toBe('cannotTell')
    expect(refusedVersions(e)).toBeUndefined()
  })

  test('the three wordings of one refusal give one answer', () => {
    expect(new Set([wordedA, wordedB, servedFirst].map(readNotComing)).size).toBe(1)
  })

  test('the log line repeats the versions named, each once, and never says which was asked for', () => {
    expect(refusedVersionsWords(wordedA)).toBe(
      " by the room's host; its words name rooms/records/list 0.3, rooms/records/list 0.1, rooms/records/list 0.2"
    )
    expect(refusedVersionsWords(servedFirst)).toBe(
      " by the room's host; its words name rooms/records/list 0.1, rooms/records/list 0.2, rooms/records/list 0.3"
    )
    for (const e of [wordedA, wordedB, servedFirst]) {
      expect(refusedVersionsWords(e)).not.toMatch(/asked|serves/)
      expect(versionsNamed(e).sort()).toEqual([
        'rooms/records/list 0.1',
        'rooms/records/list 0.2',
        'rooms/records/list 0.3',
      ])
    }
  })
})

describe('the versions a refusal names', () => {
  test('asked and served, from the framework details and nowhere else', () => {
    expect(refusedVersions(byAgent('0.6', ['0.4', '0.5']))).toEqual({
      task: 'rooms/keys/browse',
      asked: '0.6',
      served: ['0.4', '0.5'],
    })
    expect(refusedVersions(new Error('x'))).toBeUndefined()
    expect(refusedVersions(undefined)).toBeUndefined()
  })

  test('only what has the form of a specification URI is read, from details or from words', () => {
    const odd = `ask ${SPEC}Rooms/Records/list/0.8 or http://evil.example/spec/rooms/records/list/9.9 or ${SPEC}rooms/records/list/v8 or ${SPEC}rooms/records/list/1.2.3`
    expect(versionsNamed(byHost('unsupportedVersion', odd))).toEqual([])
    expect(
      refusedVersions(refusal('unsupportedVersion', 'no', { requestedType: odd, servedVersions: [odd] }))
    ).toBeUndefined()
  })

  test('who refused is read from the agent’s own code, never from the code it passed on', () => {
    expect(refusedByHost(hostServes('0.8', ['0.6']))).toBe(true)
    expect(refusedByHost(byAgent('0.6', ['0.5']))).toBe(false)
    expect(refusedByHost(refusal('unsupportedVersion', 'x', { code: 'hostRefused' }))).toBe(false)
  })
})

describe('what the log line adds, so a report says who is behind', () => {
  test('from details: who refused, the task and version asked for, and the versions served', () => {
    expect(refusedVersionsWords(byAgent('0.6', ['0.7']))).toBe(
      ' by the agent: asked rooms/keys/browse 0.6, it serves 0.7'
    )
    expect(refusedVersionsWords(hostDetails('0.8', ['0.5', '0.6']))).toBe(
      " by the room's host: asked rooms/records/list 0.8, it serves 0.5, 0.6"
    )
  })

  test('with no versions named: who refused, and no more', () => {
    expect(refusedVersionsWords(byHost('unsupportedType', 'unknown task'))).toBe(" by the room's host")
    expect(refusedVersionsWords(refusal('unsupportedVersion', 'no'))).toBe(' by the agent')
  })

  test("none of the refusal's own words are repeated, only task names and version numbers", () => {
    const words = refusedVersionsWords(
      byHost(
        'unsupportedVersion',
        `Dear member Ana, ${SPEC}rooms/records/list/0.8 is refused by did:webvh:secret; we serve ${SPEC}rooms/records/list/0.6`
      )
    )
    expect(words).toBe(" by the room's host; its words name rooms/records/list 0.8, rooms/records/list 0.6")
  })
})
