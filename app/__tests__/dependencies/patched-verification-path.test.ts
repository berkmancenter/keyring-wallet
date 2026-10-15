/**
 * The two dependency patches the wallet's credential path depends on, held in
 * place by their behaviour.
 *
 * Both are `patch:` resolutions in the root `package.json`, so they live in
 * `node_modules` rather than in this repository, and nothing exercised them —
 * the dtg-vocab bump (#470) proved only that the app *bundles* with them, and
 * `e2e/check-vrc-credentials` is an offline shape checker that never verifies a
 * proof. A patch nothing tests is a patch that comes back silently when
 * patch-package is regenerated, or when a dependency bump drops a hunk.
 *
 * **What these tests do not cover, so nobody reads them as more than they
 * are:** no proof is verified here, and no agent is started. They pin the two
 * behaviours the patches exist to produce. Verifying a credential's signature
 * end to end still needs an agent with a KMS and a document loader, and that
 * remains uncovered.
 *
 * Heads for the two patches, as of 2026-10-14 on `main` (86ac5c36):
 *   .yarn/patches/@animo-id-pex-npm-6.1.1-976fb8ed6b.patch
 *   .yarn/patches/@credo-ts-core-npm-0.7.1-pr-2704-20260909134930-b95d84ab27.patch
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'

import { DcqlService, MdocApi, SdJwtVcApi, W3cCredentialRepository, W3cV2CredentialRepository } from '@credo-ts/core'
import { PEX } from '@animo-id/pex'

const VC_1_1_CONTEXT = 'https://www.w3.org/2018/credentials/v1'
const VC_2_0_CONTEXT = 'https://www.w3.org/ns/credentials/v2'

/** A VSC-shaped witnessed credential: the VC 2.0 family, as the DTG shape issues it. */
const witnessedCredential = {
  '@context': [VC_2_0_CONTEXT, 'https://w3id.org/dtg/v1'],
  type: ['VerifiableCredential', 'StatementCredential'],
  issuer: 'did:key:z6MkjipczSHJANbxmYewBEvKy7VQR5cQA4YtkJouD7bqrmsd',
  validFrom: '2026-10-14T00:00:00Z',
  credentialSubject: { id: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', 'dtg:witnessed': true },
  proof: {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-rdfc-2022',
    created: '2026-10-14T00:00:00Z',
    verificationMethod: 'did:key:z6MkjipczSHJANbxmYewBEvKy7VQR5cQA4YtkJouD7bqrmsd#key-1',
    proofPurpose: 'assertionMethod',
    proofValue: 'z2signatureBytes',
  },
}

const holder = witnessedCredential.credentialSubject.id

describe('@animo-id/pex keeps a VC 2.0 presentation context unmixed', () => {
  // `constructPresentations` is where the patched line lives, and
  // `presentationFrom` — the path a presentation request takes — calls it. It
  // is addressed directly so the assertion is about the context rule and not
  // about whether a presentation definition happened to evaluate.
  const pex = new PEX()

  it('does not append the VC 1.1 context to a caller-supplied VC 2.0 one', () => {
    const [presentation] = pex.constructPresentations([witnessedCredential], {
      holderDID: holder,
      basePresentationPayload: { '@context': [VC_2_0_CONTEXT] },
    }) as Array<{ '@context': string[] }>

    // The failure this prevents is not cosmetic: a VP whose context mixes the
    // v1 and v2 credential vocabularies redefines terms the credential's own
    // v2-family context has already fixed, and signing it fails downstream
    // with a JSON-LD "redefine a protected term" error.
    expect(presentation['@context']).toEqual([VC_2_0_CONTEXT])
    expect(presentation['@context']).not.toContain(VC_1_1_CONTEXT)
  })

  it('still defaults to the VC 1.1 context when the caller supplied none', () => {
    // The patch narrowed the default; it did not remove it. A VC 1.1 holder
    // that passes no base context must keep working.
    const [presentation] = pex.constructPresentations([witnessedCredential], { holderDID: holder }) as Array<{
      '@context': string[]
    }>
    expect(presentation['@context']).toEqual([VC_1_1_CONTEXT])
  })

  // Jest loads this package's CommonJS build; Metro ships `browser`/`module`.
  // The patch covers all three, and a partial patch would leave the shipped
  // app broken while this suite stayed green — so the two builds the tests
  // cannot import are checked for the same guard. A content check, named as
  // one, rather than a silent gap.
  it('carries the same guard in the builds Metro ships', () => {
    const root = dirname(require.resolve('@animo-id/pex/package.json'))
    for (const build of ['browser', 'module']) {
      const source = readFileSync(join(root, 'dist', build, 'lib', 'PEX.js'), 'utf8')
      expect({ build, guard: source.includes('if (context.length === 0)') }).toEqual({ build, guard: true })
      expect({ build, unpatched: source.includes(`if (!context.includes('${VC_1_1_CONTEXT}'))`) }).toEqual({
        build,
        unpatched: false,
      })
    }
  })
})

describe("@credo-ts/core's DCQL query finds JSON-LD credentials at all", () => {
  /** Captures what each repository was asked for, and holds nothing. */
  function fakeAgentContext() {
    const asked: { name: string; query: unknown }[] = []
    const stub = (name: string) => ({
      findByQuery: async (_context: unknown, query: unknown) => {
        asked.push({ name, query })
        return []
      },
      findAllByQuery: async (query: unknown) => {
        asked.push({ name, query })
        return []
      },
      getAll: async () => {
        asked.push({ name, query: 'all' })
        return []
      },
    })
    const byToken = new Map<unknown, unknown>([
      [W3cCredentialRepository, stub('w3c')],
      [W3cV2CredentialRepository, stub('w3cV2')],
      [SdJwtVcApi, stub('sdJwtVc')],
      [MdocApi, stub('mdoc')],
    ])
    const agentContext = {
      dependencyManager: { resolve: (token: unknown) => byToken.get(token) ?? stub('other') },
    }
    return { agentContext, asked }
  }

  it('filters an ldp_vc query by the types that query asked for', async () => {
    // Upstream copy-pastes the jwt_vc_json branch's condition into the ldp_vc
    // branch, so the `$or` is always empty there and no W3C JSON-LD credential
    // is ever found. Every VSC witnessed credential is ldp_vc, so unpatched
    // this path cannot see a single one of them.
    const { agentContext, asked } = fakeAgentContext()
    const types = ['VerifiableCredential', 'StatementCredential']

    await new DcqlService().queryCredentialsForDcqlQuery(
      agentContext as never,
      {
        credentials: [{ id: 'vsc', format: 'ldp_vc', meta: { type_values: [types] } }],
      } as never
    )

    const ldp = asked.find((call) => call.name === 'w3c')
    expect(ldp?.query).toEqual({ claimFormat: 'ldp_vc', $or: [{ expandedTypes: types }] })
  })

  it('leaves the jwt_vc_json branch alone', async () => {
    // The patch fixed one branch's condition; the neighbouring branch it was
    // copied from must still filter on its own format.
    const { agentContext, asked } = fakeAgentContext()
    const types = ['VerifiableCredential', 'StatementCredential']

    await new DcqlService().queryCredentialsForDcqlQuery(
      agentContext as never,
      {
        credentials: [{ id: 'jwt', format: 'jwt_vc_json', meta: { type_values: [types] } }],
      } as never
    )

    expect(asked.find((call) => call.name === 'w3c')?.query).toEqual({
      claimFormat: 'jwt_vc',
      $or: [{ types }],
    })
  })
})
