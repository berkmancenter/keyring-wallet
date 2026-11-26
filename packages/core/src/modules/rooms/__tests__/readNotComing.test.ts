/**
 * A room read refused over a version will be refused again until someone updates, so its row stops reading and says
 * who (IN-814). Which refusals count, how the side that needs the update is told, and what the log line adds.
 */
import { readNotComing, refusedByHost, refusedVersions, refusedVersionsWords } from '../readNotComing'

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

describe('who needs the update', () => {
  test('the host serves only older versions than the agent asked for: the community', () => {
    expect(readNotComing(hostServes('0.8', ['0.5', '0.6']))).toBe('communityNeedsUpdate')
    expect(readNotComing(hostServes('1.0', ['0.9']))).toBe('communityNeedsUpdate')
  })

  test('the host serves only newer versions than the agent asked for: the agent', () => {
    expect(readNotComing(hostServes('0.6', ['0.8', '0.9']))).toBe('agentNeedsUpdate')
    expect(readNotComing(hostServes('0.10', ['1.0']))).toBe('agentNeedsUpdate')
  })

  test('versions compare as numbers, not as text: 0.10 is newer than 0.9', () => {
    expect(readNotComing(hostServes('0.10', ['0.9']))).toBe('communityNeedsUpdate')
    expect(readNotComing(hostServes('0.9', ['0.10']))).toBe('agentNeedsUpdate')
  })

  test('the agent serves only older versions than Keyring asked for: the agent', () => {
    expect(readNotComing(byAgent('0.6', ['0.4', '0.5']))).toBe('agentNeedsUpdate')
  })

  test('the agent serves only newer versions than Keyring asked for: Keyring', () => {
    expect(readNotComing(byAgent('0.6', ['0.7']))).toBe('appNeedsUpdate')
  })

  test('a task the one asked does not serve at all: that one is behind', () => {
    expect(readNotComing(byHost('unsupportedType', 'unknown task'))).toBe('communityNeedsUpdate')
    expect(readNotComing(refusal('unsupportedType', 'unknown task'))).toBe('agentNeedsUpdate')
  })

  test('not guessed at: no versions named, versions on both sides of the one asked, or another task', () => {
    expect(readNotComing(byHost('unsupportedVersion', 'this version is not served'))).toBe('cannotTell')
    expect(readNotComing(refusal('unsupportedVersion', 'no'))).toBe('cannotTell')
    expect(readNotComing(hostServes('0.6', ['0.5', '0.8']))).toBe('cannotTell')
    expect(
      readNotComing(
        byHost('unsupportedVersion', `${SPEC}rooms/records/list/0.8 is not served; ${SPEC}rooms/records/read/0.4 is`)
      )
    ).toBe('cannotTell')
  })
})

describe('the versions a refusal names', () => {
  test('from the framework details', () => {
    expect(refusedVersions(byAgent('0.6', ['0.4', '0.5']))).toEqual({
      task: 'rooms/keys/browse',
      asked: '0.6',
      served: ['0.4', '0.5'],
    })
  })

  test("from the words a host's refusal was passed on with: the first is the one asked for", () => {
    expect(refusedVersions(hostServes('0.8', ['0.5', '0.6']))).toEqual({
      task: 'rooms/records/list',
      asked: '0.8',
      served: ['0.5', '0.6'],
    })
  })

  test('only what has the form of a specification URI is read', () => {
    const e = byHost(
      'unsupportedVersion',
      `ask ${SPEC}Rooms/Records/list/0.8 or http://evil.example/spec/rooms/records/list/9.9 or ${SPEC}rooms/records/list/v8`
    )
    expect(refusedVersions(e)).toBeUndefined()
    expect(refusedVersions(new Error('x'))).toBeUndefined()
    expect(refusedVersions(undefined)).toBeUndefined()
  })

  test('who refused is read from the agent’s own code, never from the code it passed on', () => {
    expect(refusedByHost(hostServes('0.8', ['0.6']))).toBe(true)
    expect(refusedByHost(byAgent('0.6', ['0.5']))).toBe(false)
    expect(refusedByHost(refusal('unsupportedVersion', 'x', { code: 'hostRefused' }))).toBe(false)
  })
})

describe('what the log line adds, so a report says who is behind', () => {
  test('who refused, the task and version asked for, and the versions served', () => {
    expect(refusedVersionsWords(hostServes('0.8', ['0.5', '0.6']))).toBe(
      " by the room's host: asked rooms/records/list 0.8, it serves 0.5, 0.6"
    )
    expect(refusedVersionsWords(byAgent('0.6', ['0.7']))).toBe(
      ' by the agent: asked rooms/keys/browse 0.6, it serves 0.7'
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
    expect(words).toBe(" by the room's host: asked rooms/records/list 0.8, it serves 0.6")
  })
})
