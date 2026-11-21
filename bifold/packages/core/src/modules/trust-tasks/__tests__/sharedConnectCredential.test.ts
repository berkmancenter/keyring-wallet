/** Verifying a received VRC by the suite its proof names (plan WP8). */
const mockVerifyDocumentProof = jest.fn()
jest.mock('../documentProof', () => ({
  ...jest.requireActual('../documentProof'),
  verifyDocumentProof: (...args: unknown[]) => mockVerifyDocumentProof(...args),
  signDocumentProof: jest.fn(async (_a: unknown, doc: Record<string, unknown>) => ({
    ...doc,
    proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022' },
  })),
}))
jest.mock('../../vrc/vrc-manager', () => ({
  buildVrcCredential: jest.fn(async (_a: unknown, mine: string, theirs: string) => ({
    credential: { issuer: mine, credentialSubject: { id: theirs } },
  })),
}))

import { issueSharedConnectVrc, verifySharedConnectVrc } from '../module/sharedConnectCredential'

const verifyCredential = jest.fn()
const agent = { w3cCredentials: { verifyCredential } } as never
const jcsVc = {
  issuer: 'did:peer:0abc',
  credentialSubject: { id: 'did:peer:0def' },
  proof: { cryptosuite: 'eddsa-jcs-2022' },
}

describe('sharedConnectCredential', () => {
  beforeEach(() => jest.clearAllMocks())

  it('signs with eddsa-jcs-2022 under the profile default', async () => {
    const vc = await issueSharedConnectVrc(agent, 'did:peer:0abc', 'did:peer:0def')
    expect((vc.proof as { cryptosuite: string }).cryptosuite).toBe('eddsa-jcs-2022')
  })

  it('verifies a JCS credential under its issuer, not through Credo', async () => {
    mockVerifyDocumentProof.mockResolvedValue(true)
    await expect(verifySharedConnectVrc(agent, jcsVc)).resolves.toBe(true)
    expect(mockVerifyDocumentProof).toHaveBeenCalledWith(agent, jcsVc, 'did:peer:0abc', {
      proofPurpose: 'assertionMethod',
    })
    expect(verifyCredential).not.toHaveBeenCalled()
  })

  it('refuses a JCS credential whose proof fails, and a throw is false', async () => {
    mockVerifyDocumentProof.mockResolvedValueOnce(false)
    await expect(verifySharedConnectVrc(agent, jcsVc)).resolves.toBe(false)
    mockVerifyDocumentProof.mockRejectedValueOnce(new Error('x'))
    await expect(verifySharedConnectVrc(agent, jcsVc)).resolves.toBe(false)
  })

  it('sends any other suite to Credo', async () => {
    verifyCredential.mockResolvedValue({ isValid: false })
    const rdfc = {
      ...jcsVc,
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022' },
    }
    await expect(verifySharedConnectVrc(agent, rdfc)).resolves.toBe(false)
    expect(mockVerifyDocumentProof).not.toHaveBeenCalled()
  })
})
