import {
  deriveCapabilities,
  deriveRoomCapabilities,
  ROOMS_OPERATIONS,
  ROOMS_REQUIREMENTS,
  sampleCapabilities,
} from '../capabilities'
import { KEYS_ACT_TYPES } from '../real/wire'
import type { RoomsOperation } from '../types'

const SPEC = 'https://trusttasks.org/spec/'
const all = new Set<RoomsOperation>(ROOMS_OPERATIONS)

describe('deriveCapabilities', () => {
  it('gives every operation a status, and nothing is available before Keyring builds it', () => {
    const caps = deriveCapabilities({ agentLinked: true, servedTypes: [], built: new Set() })
    expect(Object.keys(caps).sort()).toEqual([...ROOMS_OPERATIONS].sort())
    expect(Object.values(caps).filter((c) => c.status === 'available')).toEqual([])
    expect(caps.listMyRooms).toMatchObject({ status: 'comingSoon', reason: 'clientNotBuilt' })
  })

  it('keeps upstream gaps and admin-only operations apart from Keyring’s own gaps', () => {
    const caps = deriveCapabilities({ agentLinked: true, servedTypes: [], built: all })
    expect(caps.groupChat).toMatchObject({ status: 'comingSoon', reason: 'notBuiltUpstream' })
    expect(caps.requestToJoin).toMatchObject({ status: 'comingSoon', reason: 'notBuiltUpstream' })
    expect(caps.listCommunityMembers).toMatchObject({ status: 'unavailable', reason: 'adminOnly' })
  })

  it('reads the agent’s own discovery answer: served is available, not served needs an update', () => {
    const caps = deriveCapabilities({
      agentLinked: true,
      servedTypes: [`${SPEC}rooms/keys/list/0.1`, `${SPEC}rooms/keys/browse/0.1`],
      built: all,
    })
    expect(caps.listMyRooms).toMatchObject({ status: 'available', reason: 'ok' })
    expect(caps.listNotes).toMatchObject({ status: 'available', reason: 'ok' })
    expect(caps.readNote).toMatchObject({ status: 'unavailable', reason: 'agentDoesNotServe' })
    expect(caps.openFile).toMatchObject({ status: 'unavailable', reason: 'agentDoesNotServe' })
  })

  it('never reads an unanswered discovery as "serves nothing"', () => {
    const caps = deriveCapabilities({ agentLinked: true, servedTypes: undefined, built: all })
    expect(caps.listMyRooms).toMatchObject({ status: 'unavailable', reason: 'agentUnknown' })
  })

  it('without an agent, agent and community operations say so, and local ones still work', () => {
    const caps = deriveCapabilities({ agentLinked: false, built: all })
    expect(caps.readNote.reason).toBe('noAgentLinked')
    expect(caps.leaveViaCommunity.reason).toBe('noAgentLinked')
    expect(caps.hideOffer).toMatchObject({ status: 'available', reason: 'ok' })
  })

  it('names only Trust Task types under the rooms and vault spec families', () => {
    for (const need of Object.values(ROOMS_REQUIREMENTS)) {
      if (need.from === 'agent')
        for (const type of need.anyOf)
          expect(type).toMatch(/^https:\/\/trusttasks\.org\/spec\/(rooms\/keys|vault\/credentials)\/[a-z-]+\/0\.\d+$/)
    }
  })
})

describe('posting needs rooms/keys/act at a version Keyring speaks', () => {
  const at = (...versions: string[]) =>
    deriveCapabilities({
      agentLinked: true,
      servedTypes: versions.map((v) => `${SPEC}rooms/keys/act/${v}`),
      built: all,
    })

  it.each([['0.8'], ['0.9'], ['0.6'], ['0.5']])('an agent serving only act %s may post and curate', (v) => {
    expect(at(v).write).toMatchObject({ status: 'available', reason: 'ok' })
    expect(at(v).curate).toMatchObject({ status: 'available', reason: 'ok' })
  })

  it('control: an agent serving only act 0.1 and 0.7 may not', () => {
    expect(at('0.1', '0.7').write).toMatchObject({ status: 'unavailable', reason: 'agentDoesNotServe' })
    expect(at('0.1', '0.7').curate).toMatchObject({ status: 'unavailable', reason: 'agentDoesNotServe' })
  })

  // The ladder the client sends from is the set asked for, so a version added to it is never missing here.
  it.each(KEYS_ACT_TYPES.map((type) => [type]))(
    'an agent serving only %s, which the client sends, may post',
    (type) => {
      const caps = deriveCapabilities({ agentLinked: true, servedTypes: [type], built: all })
      expect(caps.write).toMatchObject({ status: 'available', reason: 'ok' })
      expect(caps.curate).toMatchObject({ status: 'available', reason: 'ok' })
    }
  )
})

describe('sampleCapabilities', () => {
  it('marks everything that works as sample data, and still shows what no one can do', () => {
    const caps = sampleCapabilities()
    expect(caps.listMyRooms).toMatchObject({ status: 'available', reason: 'sample' })
    expect(caps.groupChat.reason).toBe('notBuiltUpstream')
    expect(caps.listCommunityMembers.reason).toBe('adminOnly')
  })
})

describe('deriveRoomCapabilities', () => {
  const served = deriveCapabilities({
    agentLinked: true,
    servedTypes: [`${SPEC}rooms/keys/browse/0.1`, `${SPEC}rooms/keys/read/0.1`, `${SPEC}rooms/keys/act/0.5`],
    built: all,
  })

  it('keeps the service-wide "no" whatever the room says', () => {
    const caps = deriveRoomCapabilities(served, { source: 'community', verbs: ['read', 'write', 'curate'] })
    expect(caps.openFile.reason).toBe('agentDoesNotServe')
    expect(caps.listCommunityMembers.reason).toBe('adminOnly')
  })

  it('separates "not known yet" from "known, and none"', () => {
    expect(deriveRoomCapabilities(served, { source: 'custody' }).readNote.reason).toBe('detailsNotLoaded')
    expect(deriveRoomCapabilities(served, { source: 'community', verbs: undefined }).readNote.reason).toBe(
      'detailsNotLoaded'
    )
    expect(deriveRoomCapabilities(served, { source: 'community', verbs: [] }).readNote.reason).toBe('noRight')
  })

  it('narrows by the right each operation needs', () => {
    const caps = deriveRoomCapabilities(served, { source: 'community', verbs: ['read'] })
    expect(caps.readNote).toMatchObject({ status: 'available', reason: 'ok' })
    expect(caps.write).toMatchObject({ status: 'unavailable', reason: 'noRight' })
    expect(caps.curate.reason).toBe('noRight')
  })
})
