import { encodeTicketUri } from '@bifold/trust-tasks'

import { VettingTicketError, VtiApplicant, checkTicketFor, type VtiVettingStore } from '../module/vtiVetting'

// p220 item 3: a vetter's ticket for another community is refused before
// anything is signed or sent — using it would hand this person's request, and
// so reveal them, to that community's vetter. The refusal is typed, so the
// screen words it (openvtc's TicketUriError: Unreadable, OtherCommunity).

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:Qm:vtc.example:mine'
const OTHER = 'did:webvh:Qm:vtc.example:theirs'
const VETTER = 'did:webvh:Qm:vta.example:vetter'
const ticketFor = (community: string) =>
  encodeTicketUri({ community, vetter: VETTER, presentation: { code: { code: 'ABCD-EFGH' } } })

describe('checking a ticket against the application', () => {
  it('accepts a ticket for this community, and says who the vetter is', () => {
    const checked = checkTicketFor(ticketFor(COMMUNITY), COMMUNITY)
    expect(checked).toMatchObject({ ok: true, vetterDid: VETTER, presentation: { code: { code: 'ABCD-EFGH' } } })
  })

  it('refuses a ticket for another community, naming it', () => {
    const checked = checkTicketFor(ticketFor(OTHER), COMMUNITY)
    expect(checked.ok).toBe(false)
    const error = (checked as { error: VettingTicketError }).error
    expect(error).toBeInstanceOf(VettingTicketError)
    expect(error.reason).toBe('otherCommunity')
    expect(error.ticketCommunityDid).toBe(OTHER)
  })

  it.each([['not a link'], ['https://example.com/?ticket=1'], ['vetting-ticket:?v=1&vetter=x']])(
    'calls %s unreadable',
    (link) => {
      const checked = checkTicketFor(link, COMMUNITY)
      expect(checked.ok).toBe(false)
      expect((checked as { error: VettingTicketError }).error.reason).toBe('unreadable')
    }
  )
})

describe('asking a vetter with a ticket for another community', () => {
  it('throws the typed refusal before anything is signed or sent', async () => {
    const application = {
      communityDid: COMMUNITY,
      joinDid: 'did:webvh:persona',
      minStatements: 1,
      requiredClaims: [],
      acceptedMethods: ['inPerson'],
      commitmentSalt: 's',
      claims: {},
      requests: [],
      startedAt: 't',
    }
    const saveApplication = jest.fn(async () => undefined)
    const store = { getApplication: async () => application, saveApplication } as unknown as VtiVettingStore
    // An agent with nothing on it: any attempt to sign would fail differently.
    const applicant = new VtiApplicant({} as never, { communityDid: COMMUNITY } as never, store, {} as never)
    const attempt = applicant.requestVetter({ link: ticketFor(OTHER) })
    await expect(attempt).rejects.toBeInstanceOf(VettingTicketError)
    await expect(applicant.requestVetter({ link: ticketFor(OTHER) })).rejects.toMatchObject({
      reason: 'otherCommunity',
      ticketCommunityDid: OTHER,
    })
    expect(saveApplication).not.toHaveBeenCalled()
  })
})
