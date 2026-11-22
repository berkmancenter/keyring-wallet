/** Whether the framework pipeline takes shared-connect documents carrying a `ceremony` member (plan WP7, was UNVERIFIED). */
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import { digestMultibase } from '../documentProof'
import { TrustTasksService } from '../services/TrustTasksService'

const service = new TrustTasksService({ save: jest.fn() } as never)
const ceremony = {
  enactment: 'XOcGXOQTCHb5iz4T2JD2RQ',
  step: 2,
  definition: 'https://trusttasks.org/ceremony/shared-connect/0.1',
}
const doc = (type: string, payload: unknown) => ({
  id: 'r1',
  type,
  threadId: 'XOcGXOQTCHb5iz4T2JD2RQ',
  issuer: 'did:peer:2.inviter',
  recipient: 'did:peer:2.me',
  issuedAt: new Date(Date.now()).toISOString(),
  ceremony,
  payload,
  proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022' },
})
const consume = (spec: unknown, document: Record<string, unknown>) =>
  service.consume({} as never, {
    spec: spec as never,
    document,
    myDid: 'did:peer:2.me',
    senderDid: 'did:peer:2.inviter',
    proofPolicy: { kind: 'verify', verify: { verify: async () => true } },
    handler: async () => undefined,
  })

it('takes a propose#response with a ceremony member', async () => {
  const out = await consume(
    propose.RESPONSE_SPEC,
    doc(`${propose.TYPE_URI}#response`, { accept: true, relationshipDid: 'did:peer:0x' })
  )
  expect(out.kind).not.toBe('rejected')
})

it('takes an issue with a ceremony member', async () => {
  const out = await consume(issue.SPEC, doc(issue.TYPE_URI, { vrc: { a: 1 } }))
  expect(out.kind).not.toBe('rejected')
})
it('takes an issue receipt with a ceremony member', async () => {
  const out = await consume(
    issue.RESPONSE_SPEC,
    doc(`${issue.TYPE_URI}#response`, { vrcDigestMultibase: digestMultibase({ a: 1 }) })
  )
  expect(out.kind).not.toBe('rejected')
})
