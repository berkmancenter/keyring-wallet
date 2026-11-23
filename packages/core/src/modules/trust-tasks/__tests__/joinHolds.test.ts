/**
 * What the Join screen counts as held towards a community. Statements count
 * only for the identity they were gathered for (IN-104): an application left
 * by an earlier identity holds nothing for the current one.
 */
const mockInvitations = jest.fn(async (): Promise<unknown[]> => [])
const mockApplication = jest.fn(async (): Promise<unknown> => undefined)
const mockPersona = jest.fn(async (): Promise<unknown> => undefined)
jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: jest.fn().mockImplementation(() => ({ listInvitations: mockInvitations })),
}))
jest.mock('../module/vtiVetting', () => ({
  GenericRecordsVettingStore: jest.fn().mockImplementation(() => ({ getApplication: mockApplication })),
}))
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: jest.fn().mockImplementation(() => ({ getPersona: mockPersona })),
}))

import { readJoinHolds } from '../screens/joinHolds'

const COMMUNITY = 'did:webvh:Qm:vtc.example:c'
const application = (joinDid: string) => ({
  communityDid: COMMUNITY,
  joinDid,
  requests: [{ status: 'attested' }, { status: 'attested' }, { status: 'sent' }],
})

describe('statements held towards a community', () => {
  it('counts the attested statements of the current identity’s application', async () => {
    mockPersona.mockResolvedValueOnce({ did: 'did:x:current', communityDid: COMMUNITY })
    mockApplication.mockResolvedValueOnce(application('did:x:current'))
    await expect(readJoinHolds({} as never, COMMUNITY)).resolves.toMatchObject({ statements: 2 })
  })

  it('counts none from an application an earlier identity gathered', async () => {
    mockPersona.mockResolvedValueOnce({ did: 'did:x:current', communityDid: COMMUNITY })
    mockApplication.mockResolvedValueOnce(application('did:x:earlier'))
    await expect(readJoinHolds({} as never, COMMUNITY)).resolves.toMatchObject({ statements: 0 })
  })

  it('counts none when the phone holds no identity for the community', async () => {
    mockPersona.mockResolvedValueOnce(undefined)
    mockApplication.mockResolvedValueOnce(application('did:x:earlier'))
    await expect(readJoinHolds({} as never, COMMUNITY)).resolves.toMatchObject({ statements: 0 })
  })
})
