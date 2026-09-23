import { consentPendingOf } from '../module/VtaClient'
import { VtiRefusal } from '../module/vtiAgent'

// A task the approvals policy holds is refused with `auth:consent_required`.
// The challenge — the digest and one signed request per approver — rides in
// `details`, but a VTA drops `details` past the framework's size bound and
// sends the code alone. Three approvers were enough to cross it (2026-09-21),
// and the phone then reported the borrow as failed instead of held.

const request = (recipient: string) => ({ recipient, payload: { payloadDigest: 'digest-1' } })

describe('reading a refusal as consent pending', () => {
  it('reads the challenge from details', () => {
    const refusal = new VtiRefusal('taskFailed', 'task failed: auth:consent_required', {
      reason: 'auth:consent_required',
      consentRequests: [request('did:peer:2.approver')],
    })
    expect(consentPendingOf(refusal)).toEqual({ payloadDigest: 'digest-1', requests: [request('did:peer:2.approver')] })
  })

  it('reads a refusal whose details were dropped as held, with nothing to relay', () => {
    const refusal = new VtiRefusal('taskFailed', 'task failed: auth:consent_required')
    expect(consentPendingOf(refusal)).toEqual({ requests: [] })
  })

  it('reads the reason from the code when that is where it is', () => {
    expect(consentPendingOf(new VtiRefusal('auth:consent_required', 'the VTA refused the task'))).toEqual({
      requests: [],
    })
  })

  it('leaves every other refusal alone', () => {
    expect(consentPendingOf(new VtiRefusal('taskFailed', 'task failed: auth:unauthorized'))).toBeUndefined()
    expect(
      consentPendingOf(new VtiRefusal('taskFailed', 'task failed: auth:consent_required', { reason: 'other' }))
    ).toBeUndefined()
    expect(consentPendingOf(new Error('task failed: auth:consent_required'))).toBeUndefined()
  })

  // vti #1680: the core members always come; the signed requests are omitted
  // whole when they do not fit, with a count.
  it('reads the digest from details when the signed requests were omitted', () => {
    const refusal = new VtiRefusal('taskFailed', 'task failed: auth:consent_required', {
      reason: 'auth:consent_required',
      payloadDigest: 'digest-core',
      correlator: 'c-1',
      consentRequestsOmitted: 3,
    })
    expect(consentPendingOf(refusal)).toEqual({ payloadDigest: 'digest-core', requests: [], omitted: 3 })
  })

  it('prefers the core payloadDigest over the first request', () => {
    const refusal = new VtiRefusal('taskFailed', 'task failed: auth:consent_required', {
      reason: 'auth:consent_required',
      payloadDigest: 'digest-core',
      consentRequests: [request('did:peer:2.approver')],
    })
    expect(consentPendingOf(refusal)).toMatchObject({
      payloadDigest: 'digest-core',
      requests: [request('did:peer:2.approver')],
    })
  })
})
