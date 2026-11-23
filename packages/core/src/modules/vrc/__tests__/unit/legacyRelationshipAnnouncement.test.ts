/**
 * The dual-accept gate (trust_tasks_subtask.md §7.3): a sub-v4 peer's legacy
 * `vrc:relationshipDid:… vrc:rceVersion:N` announcement must both drive the
 * untouched legacy dance (parseLegacyRelationshipAnnouncement always returns
 * a version, however old) and suppress the Trust Task dialect
 * (maybeOpenRelationshipExchange no-ops below TRUST_TASKS_MIN_RCE_VERSION).
 * §9 step 6 recorded this as "true by construction... not yet evidenced" —
 * these tests run the real parsing regex against real wire-format strings for
 * every RCE generation, and chain the result into the real gate, rather than
 * hand-constructing a version number.
 */
import { parseLegacyRelationshipAnnouncement, RCE_PROTOCOL_VERSION } from '../../vrc-manager'
import { maybeOpenRelationshipExchange, TRUST_TASKS_MIN_RCE_VERSION } from '../../../trust-tasks/ceremony'

describe('parseLegacyRelationshipAnnouncement', () => {
  test('a v1 peer (no rceVersion suffix at all) defaults to version 1', () => {
    const result = parseLegacyRelationshipAnnouncement(
      'This is my relationship DID: vrc:relationshipDid:did:peer:4v1peer'
    )
    expect(result).toEqual({ relationshipDid: 'did:peer:4v1peer', counterpartyRceVersion: 1 })
  })

  test.each([1, 2, 3, 4, 5])('parses an announced rceVersion %i verbatim', (version) => {
    const result = parseLegacyRelationshipAnnouncement(
      `This is my relationship DID: vrc:relationshipDid:did:peer:4peer vrc:rceVersion:${version}`
    )
    expect(result).toEqual({ relationshipDid: 'did:peer:4peer', counterpartyRceVersion: version })
  })

  test('content with no relationshipDid marker at all is not an announcement', () => {
    expect(parseLegacyRelationshipAnnouncement('just a normal chat message')).toBeUndefined()
  })

  test('a malformed announcement (marker present, no DID captured) is rejected', () => {
    expect(parseLegacyRelationshipAnnouncement('vrc:relationshipDid: vrc:rceVersion:4')).toBeUndefined()
  })

  test('todays RCE_PROTOCOL_VERSION round-trips through the real send-side format', () => {
    // Mirrors the literal template vrc-manager.ts sends on connection.
    const sent = `This is my relationship DID: vrc:relationshipDid:did:peer:4me vrc:rceVersion:${RCE_PROTOCOL_VERSION}`
    expect(parseLegacyRelationshipAnnouncement(sent)).toEqual({
      relationshipDid: 'did:peer:4me',
      counterpartyRceVersion: RCE_PROTOCOL_VERSION,
    })
  })
})

describe('dual-accept: a real sub-v4 wire announcement never opens the Trust Task dialect', () => {
  test.each([1, 2, 3])('rceVersion %i (legacy dance only, no Trust Task traffic)', async (version) => {
    const announcement = parseLegacyRelationshipAnnouncement(
      `This is my relationship DID: vrc:relationshipDid:did:peer:4legacy vrc:rceVersion:${version}`
    )
    expect(announcement?.counterpartyRceVersion).toBe(version)

    const sentMessages: unknown[] = []
    const agent = {
      context: {},
      config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
      dependencyManager: {
        container: {
          isRegistered: () => false,
          register: () => undefined,
          resolve: () => ({
            send: async (message: unknown) => {
              sentMessages.push(message)
            },
          }),
        },
      },
      modules: { didcomm: { connections: { getById: async () => ({ id: 'conn-1' }) } } },
    }

    await maybeOpenRelationshipExchange(
      agent as never,
      'conn-1',
      announcement!.counterpartyRceVersion,
      TRUST_TASKS_MIN_RCE_VERSION
    )

    expect(sentMessages).toHaveLength(0)
  })
})
