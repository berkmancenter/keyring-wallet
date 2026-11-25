import {
  buildVtiInvitationLink,
  describeInvitation,
  parseVtiInvitationLink,
} from '../../../src/modules/trust-tasks/module/vtiInvitation'

// The shape VTC 0.11.58 issues (vtc-service credentials/invitation.rs): a role grant rides in
// credentialSubject.scopes as "role:<name>", and an invitation issued without a role has a subject of { id } only.
// A parser that closed the subject's shape would refuse every role invitation a community sends, as openvtc 0.5.0
// (dtg-credentials 0.13, deny_unknown_fields) does: these pin that Keyring reads both.
const COMMUNITY = 'did:webvh:QmCommunity:dids.example:hv-lab-vtc'
const PERSONA = 'did:webvh:QmPersona:dids.example:punch-boss'

function vic(subject: Record<string, unknown>): Record<string, unknown> {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://registry.trustoverip.org/dtg/context/v1'],
    id: 'urn:uuid:7e2da293-6c8a-49f3-8e68-a3e50ba61d56',
    type: ['VerifiableCredential', 'DTGCredential', 'InvitationCredential'],
    issuer: COMMUNITY,
    validFrom: '2026-10-16T22:58:13Z',
    validUntil: '2026-11-15T22:58:13Z',
    credentialSubject: subject,
  }
}

describe('vtiInvitation: the role a community grants rides in credentialSubject.scopes', () => {
  it('reads role:member', () => {
    const inv = describeInvitation(vic({ id: PERSONA, scopes: ['role:member'] }))
    expect(inv.role).toBe('member')
    expect(inv.subjectDid).toBe(PERSONA)
    expect(inv.communityDid).toBe(COMMUNITY)
  })

  it('reads role:vetter', () => {
    expect(describeInvitation(vic({ id: PERSONA, scopes: ['role:vetter'] })).role).toBe('vetter')
  })

  it('an invitation with no role (subject { id } only) is a member invitation', () => {
    const inv = describeInvitation(vic({ id: PERSONA }))
    expect(inv.role).toBe('member')
    expect(inv.validUntil).toBe('2026-11-15T22:58:13Z')
  })

  it('a role invitation survives the keyring://vti/invitation link', () => {
    const credential = vic({ id: PERSONA, scopes: ['role:vetter'] })
    const inv = parseVtiInvitationLink(buildVtiInvitationLink(credential))
    expect(inv.role).toBe('vetter')
    expect(inv.credential).toEqual(credential)
  })

  it('still refuses a credential that is not an invitation', () => {
    const notInvitation = { ...vic({ id: PERSONA }), type: ['VerifiableCredential', 'MembershipCredential'] }
    expect(() => describeInvitation(notInvitation)).toThrow(/not an InvitationCredential/)
  })
})
