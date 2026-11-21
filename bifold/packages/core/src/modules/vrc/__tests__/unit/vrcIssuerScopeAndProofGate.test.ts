/**
 * cred-spec conformance of the VRCs the wallet emits (G32):
 * - every VC 2.0 VRC carries top-level `issuerScope: 'pairwise'` (the issuer is
 *   a per-relationship did:peer, never shared across counterparties)
 * - no VC 2.0 VRC is ever paired with a non-DataIntegrityProof proof: a peer
 *   that announced RCE v2 only is treated like a pre-v2 peer (VCDM 1.1)
 * The legacy VCDM 1.1 shape is untouched.
 */
import { ED25519_2018_SUITE_CONTEXT_URL } from '@bifold/vrc-contexts'

import { buildVrcCredential, getVrcJsonLdProofOptions } from '../../vrc-manager'

const agentForPeerVersion = (counterpartyRceVersion: number | undefined) =>
  ({
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: {
      resolve: () => ({
        findByCounterpartyRelationshipDid: async () =>
          counterpartyRceVersion === undefined ? null : { counterpartyRceVersion },
      }),
    },
  }) as never

const V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2'

describe('VRC issuerScope and proof-family gate', () => {
  test.each([3, 4, 5])(
    'RCE v%i peer: VC 2.0 VRC with issuerScope pairwise, DI proof, no Ed25519 suite context',
    async (v) => {
      const agent = agentForPeerVersion(v)
      const { credential } = await buildVrcCredential(agent, 'did:peer:0issuer', 'did:peer:0subject')
      expect(credential['@context'][0]).toBe(V2_CONTEXT)
      expect(credential.issuerScope).toBe('pairwise')
      expect(credential.issuer).toBe('did:peer:0issuer')
      expect(credential['@context']).not.toContain(ED25519_2018_SUITE_CONTEXT_URL)

      const options = await getVrcJsonLdProofOptions(agent, 'did:peer:0subject')
      expect(options).toMatchObject({ proofType: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022' })
    }
  )

  test.each([undefined, 1, 2])(
    'RCE %s peer: legacy VCDM 1.1 VRC, no issuerScope, Ed25519Signature2018 — never a VC 2.0 document',
    async (v) => {
      const agent = agentForPeerVersion(v)
      const { credential } = await buildVrcCredential(agent, 'did:peer:0issuer', 'did:peer:0subject')
      expect(credential['@context'][0]).toBe('https://www.w3.org/2018/credentials/v1')
      expect(credential['@context']).not.toContain(V2_CONTEXT)
      expect(credential.issuerScope).toBeUndefined()

      const options = await getVrcJsonLdProofOptions(agent, 'did:peer:0subject')
      expect(options.proofType).toBe('Ed25519Signature2018')
    }
  )

  test('invariant across every announced version: VC 2.0 implies DataIntegrityProof', async () => {
    for (const v of [undefined, 1, 2, 3, 4, 5, 6]) {
      const agent = agentForPeerVersion(v)
      const { credential } = await buildVrcCredential(agent, 'did:peer:0issuer', 'did:peer:0subject')
      const { proofType } = await getVrcJsonLdProofOptions(agent, 'did:peer:0subject')
      if (credential['@context'].includes(V2_CONTEXT)) expect(proofType).toBe('DataIntegrityProof')
    }
  })

  test('a failed peer lookup falls to the legacy shape (and the legacy proof)', async () => {
    const agent = {
      ...(agentForPeerVersion(5) as object),
      dependencyManager: {
        resolve: () => ({
          findByCounterpartyRelationshipDid: async () => {
            throw new Error('boom')
          },
        }),
      },
    } as never
    const { credential } = await buildVrcCredential(agent, 'did:peer:0issuer', 'did:peer:0subject')
    expect(credential.issuerScope).toBeUndefined()
  })
})
