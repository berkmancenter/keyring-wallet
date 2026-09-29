import { purposeForDocumentType } from '../module/proofPurpose'

// The cases vta-sdk's own classifier is tested with (VTI afcf2470
// vta-sdk/tests/proof_purpose_classifier.rs): only an approver's decision is
// an attestation; everything else is operational and signed for authentication.
describe('the proof purpose a Trust Task document is signed for', () => {
  it('is assertionMethod for an approver decision', () => {
    for (const uri of [
      'https://trusttasks.org/spec/auth/step-up/approve-response/0.5',
      'https://trusttasks.org/spec/auth/step-up/approve-response/0.3#request',
      'https://trusttasks.org/spec/task-consent/decision/0.1',
      'https://trusttasks.org/spec/confirm/response/0.1',
    ]) {
      expect({ uri, purpose: purposeForDocumentType(uri) }).toEqual({ uri, purpose: 'assertionMethod' })
    }
  })

  it('is authentication for everything else, a reply and a look-alike included', () => {
    for (const uri of [
      'https://trusttasks.org/spec/acl/grant/0.1',
      'https://trusttasks.org/spec/auth/step-up/start/0.1',
      'https://trusttasks.org/spec/auth/step-up/approve-request/0.3',
      'https://trusttasks.org/spec/did-management/did/list/0.2',
      'https://trusttasks.org/spec/task-consent/decision/0.1#response',
      'https://registry.example/spec/task-consent/decision/0.1',
      'https://trusttasks.org/prefix/spec/confirm/response/0.1',
      'https://trusttasks.org.example/spec/task-consent/decision/0.1',
      'https://TrustTasks.org/spec/task-consent/decision/0.1',
      'https://trusttasks.org:443/spec/task-consent/decision/0.1',
      'https://user@trusttasks.org/spec/task-consent/decision/0.1',
      'https://trusttasks.org/spec/x/task-consent/decision/0.1',
      'https://trusttasks.org/spec/task-consent/decision-extra/0.1',
      'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2',
      'https://trusttasks.org/spec/vetting/request/0.1',
    ]) {
      expect({ uri, purpose: purposeForDocumentType(uri) }).toEqual({ uri, purpose: 'authentication' })
    }
  })
})
