/**
 * The member's own name in a room: the profile they joined the room's community as, when that was kept; else the
 * active profile (a join from before it was kept, or a profile since removed); none without a profile or a name.
 */
import { renderHook } from '@testing-library/react-native'

import { buildRCardTemplate } from '../../vrc/types/rcard'
import { useMyName } from '../useMyName'

let mockStore: unknown
let mockJoined: string | undefined
jest.mock('../../../contexts/store', () => ({ useStore: () => [mockStore] }))
jest.mock('../../trust-tasks/module/useJoinedProfileId', () => ({ useJoinedProfileId: () => mockJoined }))

const profile = (id: string, firstName: string, lastName = '') =>
  buildRCardTemplate({ firstName, lastName, email: '', organization: '' }, { id })
const PERSONAL = profile('p-personal', 'Alberto', 'L')
const WORK = profile('p-work', 'A.', 'Leon')
const NO_NAME = profile('p-blank', '')

const nameWith = (profiles: unknown[], activeProfileId?: string, joined?: string) => {
  mockStore = { rCard: { profiles, activeProfileId } }
  mockJoined = joined
  return renderHook(() => useMyName('did:webvh:lab')).result.current
}

describe('useMyName', () => {
  test('the profile the community was joined as, not the active one', () => {
    expect(nameWith([PERSONAL, WORK], WORK.id, PERSONAL.id)).toEqual({ name: 'Alberto L', profileId: PERSONAL.id })
  })

  test('no profile kept for the join, or one since removed: the active profile', () => {
    expect(nameWith([PERSONAL, WORK], WORK.id, undefined)).toEqual({ name: 'A. Leon', profileId: WORK.id })
    expect(nameWith([PERSONAL, WORK], WORK.id, 'p-removed')).toEqual({ name: 'A. Leon', profileId: WORK.id })
  })

  test('a profile with no name gives none, but still opens; no profile gives nothing', () => {
    expect(nameWith([NO_NAME], NO_NAME.id)).toEqual({ name: undefined, profileId: NO_NAME.id })
    expect(nameWith([], undefined)).toEqual({})
  })
})
