/**
 * Outcome-evidence verification tests — the cred-spec pairing algorithm,
 * each check failing independently under its own tamper (the ref-06p3 style):
 * a genuine bundle passes; a counterfeit initiating document (right id,
 * wrong bytes) fails on the digest, not the id; a minted-threadId pairing
 * survives; an error terminal is failure evidence; a proofless terminal is
 * rejected. Digest math is REAL (taskDigestMultibase / digestBytesEqual);
 * credential/presentation crypto and document-proof verification are mocked.
 */
import { digestMultibase, taskDigestMultibase, digestBytesEqual } from '../documentProof'
import { verifyVwcPresentationBundle, type VwcPresentationBundle } from '../outcomeEvidence'

jest.mock('../documentProof', () => ({
  ...jest.requireActual('../documentProof'),
  verifyDocumentProof: jest.fn(async () => true),
}))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyDocumentProof: mockedDocVerify } = require('../documentProof') as { verifyDocumentProof: jest.Mock }

function makeFakeAgent(options?: { vpValid?: boolean; vcValid?: boolean }) {
  return {
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    w3cCredentials: {
      verifyPresentation: jest.fn(async () => ({ isValid: options?.vpValid ?? true })),
      verifyCredential: jest.fn(async () => ({ isValid: options?.vcValid ?? true })),
    },
  } as never
}

const SESSION_ID = 'aaaa1111-0000-4000-8000-000000000001'

function genuineBundle(mutate?: (b: VwcPresentationBundle) => void): VwcPresentationBundle {
  const initiating: Record<string, unknown> = {
    id: SESSION_ID,
    type: 'https://trusttasks.org/spec/witness/session/0.1',
    threadId: SESSION_ID,
    issuer: 'did:peer:4wallet',
    recipient: 'did:peer:4witness',
    issuedAt: '2026-08-19T00:00:00Z',
    payload: { parties: ['did:peer:0zA', 'did:peer:0zB'] },
  }
  const vwc: Record<string, unknown> = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
    issuer: 'did:example:witness',
    credentialSubject: {
      id: 'did:peer:0zA',
      parties: ['did:peer:0zA', 'did:peer:0zB'],
      taskContext: SESSION_ID,
      taskDigestMultibase: taskDigestMultibase(initiating),
    },
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created: '2026-08-19T00:00:04Z',
      verificationMethod: 'did:example:witness#key-1',
      proofPurpose: 'assertionMethod',
      proofValue: 'zvwc',
    },
  }
  const terminal: Record<string, unknown> = {
    id: 'bbbb2222-0000-4000-8000-000000000002',
    type: 'https://trusttasks.org/spec/witness/session/submit/0.1#response',
    threadId: SESSION_ID,
    issuer: 'did:peer:4witness',
    recipient: 'did:peer:4wallet',
    issuedAt: '2026-08-19T00:00:05Z',
    payload: { vwc, vwcDigestMultibase: digestMultibase(vwc) },
    proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofValue: 'zsig' },
  }
  const bundle: VwcPresentationBundle = {
    presentation: {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      holder: 'did:peer:0zA',
      verifiableCredential: [vwc],
      proof: {
        type: 'Ed25519Signature2018',
        created: '2026-08-19T00:00:06Z',
        verificationMethod: 'did:peer:0zA#key-1',
        proofPurpose: 'authentication',
        challenge: 'c',
        domain: 'd',
        jws: 'eyJhbGciOiJFZERTQSJ9..zvp',
      },
    },
    outcomeEvidence: { initiating, terminal },
  }
  if (mutate) mutate(bundle)
  return bundle
}

const verify = (agent: never, bundle: VwcPresentationBundle) =>
  verifyVwcPresentationBundle(agent, { bundle, challenge: 'c', domain: 'd' })

describe('verifyVwcPresentationBundle', () => {
  test('a genuine bundle evidences completion, with residuals named', async () => {
    const verdict = await verify(makeFakeAgent(), genuineBundle())
    expect(verdict.failures).toEqual([])
    expect(verdict.completionEvidenced).toBe(true)
    expect(verdict.credentialValid).toBe(true)
    expect(verdict.residuals.length).toBeGreaterThan(0)
  })

  test('a counterfeit initiating document (right id, wrong bytes) fails on the digest', async () => {
    const bundle = genuineBundle((b) => {
      b.outcomeEvidence.initiating = { ...b.outcomeEvidence.initiating, payload: { parties: ['did:peer:0zX', 'did:peer:0zB'] } }
    })
    const verdict = await verify(makeFakeAgent(), bundle)
    expect(verdict.completionEvidenced).toBe(false)
    expect(verdict.failures).toContain('taskDigestMultibase does not reproduce over the initiating document')
    // and specifically NOT on the id — the counterfeit kept it
    expect(verdict.failures).not.toContain('initiating document id does not equal taskContext')
  })

  test('the digest is proof-invariant: a proofed initiating document still pairs', async () => {
    const bundle = genuineBundle((b) => {
      b.outcomeEvidence.initiating = {
        ...b.outcomeEvidence.initiating,
        proof: { type: 'DataIntegrityProof', proofValue: 'zlater' },
      }
    })
    const verdict = await verify(makeFakeAgent(), bundle)
    expect(verdict.completionEvidenced).toBe(true)
  })

  test('a minted threadId pairs through the initiating document', async () => {
    const bundle = genuineBundle((b) => {
      b.outcomeEvidence.initiating = { ...b.outcomeEvidence.initiating, threadId: 'minted-thread-1' }
      b.outcomeEvidence.terminal = { ...b.outcomeEvidence.terminal, threadId: 'minted-thread-1' }
      // taskDigest must reproduce over the minted-thread form
      const subject = ((b.presentation.verifiableCredential as Record<string, unknown>[])[0]
        .credentialSubject as Record<string, unknown>)
      subject.taskDigestMultibase = taskDigestMultibase(b.outcomeEvidence.initiating)
    })
    const verdict = await verify(makeFakeAgent(), bundle)
    expect(verdict.completionEvidenced).toBe(true)
  })

  test('a terminal on the wrong thread does not pair', async () => {
    const bundle = genuineBundle((b) => {
      b.outcomeEvidence.terminal = { ...b.outcomeEvidence.terminal, threadId: 'someone-elses-thread' }
    })
    const verdict = await verify(makeFakeAgent(), bundle)
    expect(verdict.failures).toContain('terminal document threadId does not pair with the initiating document')
  })

  test('an error terminal is failure evidence, never completion', async () => {
    const bundle = genuineBundle((b) => {
      b.outcomeEvidence.terminal = {
        ...b.outcomeEvidence.terminal,
        type: 'https://trusttasks.org/spec/trust-task-error/0.3',
        payload: { code: 'taskFailed', message: 'x', retryable: false },
      }
    })
    const verdict = await verify(makeFakeAgent(), bundle)
    expect(verdict.failures).toContain('terminal document is an error response — failure evidence, not completion')
  })

  test('a proofless terminal is rejected — evidence must be integrity-protected', async () => {
    const bundle = genuineBundle((b) => {
      const { proof: _p, ...bare } = b.outcomeEvidence.terminal
      b.outcomeEvidence.terminal = bare
    })
    const verdict = await verify(makeFakeAgent(), bundle)
    expect(verdict.failures).toContain('terminal document carries no proof — outcome evidence must be integrity-protected')
  })

  test('a terminal whose proof fails verification is rejected', async () => {
    mockedDocVerify.mockResolvedValueOnce(false)
    const verdict = await verify(makeFakeAgent(), genuineBundle())
    expect(verdict.failures).toContain('terminal document proof did not verify under its issuer')
  })

  test('an invalid credential is reported independently of the pairing', async () => {
    const verdict = await verify(makeFakeAgent({ vcValid: false }), genuineBundle())
    expect(verdict.credentialValid).toBe(false)
    expect(verdict.completionEvidenced).toBe(false)
  })
})

describe('digest helpers (spec conformance)', () => {
  test('taskDigestMultibase excludes the top-level proof', () => {
    const doc = { id: 'x', payload: { a: 1 } }
    const proofed = { ...doc, proof: { proofValue: 'zsig' } }
    expect(taskDigestMultibase(proofed)).toBe(taskDigestMultibase(doc))
  })

  test('digestBytesEqual compares decoded bytes, not encoded strings', () => {
    const d = digestMultibase({ hello: 'world' })
    expect(digestBytesEqual(d, d)).toBe(true)
    expect(digestBytesEqual(d, digestMultibase({ hello: 'tampered' }))).toBe(false)
    expect(digestBytesEqual(d, 'not-multibase')).toBe(false)
  })
})
