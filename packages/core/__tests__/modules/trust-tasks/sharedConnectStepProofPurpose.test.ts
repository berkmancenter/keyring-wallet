/**
 * @jest-environment node
 *
 * Shared-connect STEP documents are proved for `authentication`. Keyring's encounter DID is a did:peer:2 with a
 * `.V` segment only, so its key is listed under `authentication` and nowhere else; a counterpart's verifier
 * (real-life-org/trust-protocol's shared-connect inviter) refused a step signed for `assertionMethod` for that
 * reason, and signs its own steps for `authentication`. The inviter fixture models did:peer:2 as the DIF method
 * spec does (V is authentication only) and checks the proof's stated purpose, so it is strict in the same way. The
 * VRC credential is a separate proof, covered by sharedConnectVrcProofPurpose.test.ts.
 */
import '../../helpers/realAskar'

jest.mock('@credo-ts/core', () =>
  jest.requireActual(
    require.resolve('@credo-ts/core', { paths: [require('path').resolve(__dirname, '../../../../..')] })
  )
)
jest.mock('@credo-ts/askar', () =>
  jest.requireActual(
    require.resolve('@credo-ts/askar', { paths: [require('path').resolve(__dirname, '../../../../..')] })
  )
)

import { AskarModule } from '@credo-ts/askar'
import { Agent } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Inviter, signJcs, verifyJcs } from '../../../src/modules/trust-tasks/__tests__/fixtures/shared-connect/inviter'
import { signDocumentProof, verifyDocumentProof } from '../../../src/modules/trust-tasks/documentProof'
import { defaultSharedConnectDeps } from '../../../src/modules/trust-tasks/module/sharedConnect'
import { createEncounterDid } from '../../../src/modules/trust-tasks/module/sharedConnectEncounter'
import { signSharedConnectDocument } from '../../../src/modules/trust-tasks/module/sharedConnectCeremony'
import type { VtiMediatorEndpoints } from '../../../src/modules/trust-tasks/module/VtiMediatorTransport'

const MEDIATOR = { did: 'did:web:relay.example.org', wsEndpoint: 'wss://relay.example.org/ws' } as VtiMediatorEndpoints

describe('shared-connect step documents are proved for authentication', () => {
  let agent: Agent
  const storeDir = mkdtempSync(join(tmpdir(), 'shared-connect-step-purpose-'))

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: {},
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: `shared-connect-step-purpose-${process.pid}-${Math.random().toString(36).slice(2)}`,
            key: 'test-key',
            database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
          },
        }),
      },
    })
    await agent.initialize()
  }, 60000)

  afterAll(async () => {
    await agent?.shutdown()
    rmSync(storeDir, { recursive: true, force: true })
  })

  const step = (issuer: string, recipient: string) => ({
    id: 'step-1',
    type: 'https://trusttasks.org/spec/vrc/relationships/propose/0.1',
    threadId: 'step-1',
    issuer,
    recipient,
    issuedAt: '2026-11-06T00:00:00Z',
    payload: {},
  })
  const inviter = new Inviter('did:web:relay.example.org')

  it('signs a step over a .V-only did:peer:2 for authentication, and the strict fixture accepts it', async () => {
    const did = await createEncounterDid(agent, MEDIATOR, { tsp: true })
    expect(did).toMatch(/^did:peer:2\./)
    const signed = await signSharedConnectDocument(agent, step(did, inviter.vid))
    expect((signed.proof as { proofPurpose: string }).proofPurpose).toBe('authentication')
    expect(verifyJcs(signed, did, 'authentication')).toBe(true)
    expect(await verifyDocumentProof(agent, signed, did, { proofPurpose: 'authentication' })).toBe(true)
  })

  it('refuses a step proved for assertionMethod over a .V-only did:peer:2', async () => {
    const did = await createEncounterDid(agent, MEDIATOR, { tsp: true })
    // signDocumentProof's default purpose: what the unfixed code sent.
    const signed = await signDocumentProof(agent, step(did, inviter.vid), did)
    expect((signed.proof as { proofPurpose: string }).proofPurpose).toBe('assertionMethod')
    expect(verifyJcs(signed, did, 'authentication')).toBe(false)
    expect(verifyJcs(signed, did, 'assertionMethod')).toBe(false)
    expect(await verifyDocumentProof(agent, signed, did, { proofPurpose: 'authentication' })).toBe(false)
    expect(await defaultSharedConnectDeps(agent).verifyProof(signed, [did])).toBe(false)
  })

  it('accepts an inbound authentication step proof from the fixture inviter', async () => {
    const mine = await createEncounterDid(agent, MEDIATOR, { tsp: true })
    const doc = step(inviter.vid, mine)
    const signed = signJcs(doc, inviter.keys.edSk, `${inviter.vid}#key-2`, 'authentication')
    expect(await defaultSharedConnectDeps(agent).verifyProof(signed, [inviter.vid])).toBe(true)

    const wrongPurpose = signJcs(doc, inviter.keys.edSk, `${inviter.vid}#key-2`, 'assertionMethod')
    expect(await defaultSharedConnectDeps(agent).verifyProof(wrongPurpose, [inviter.vid])).toBe(false)
  })

  it('puts the document @context in the proof only when asked (carryContext), and never for a document without one', async () => {
    const did = await createEncounterDid(agent, MEDIATOR, { tsp: true })
    const context = ['https://www.w3.org/ns/credentials/v2', 'https://example.org/vrc/v1']
    const document = { '@context': context, id: 'urn:uuid:1', type: ['VerifiableCredential'] }
    const withContext = await signDocumentProof(agent, document, did, {
      proofPurpose: 'authentication',
      carryContext: true,
    })
    expect((withContext.proof as Record<string, unknown>)['@context']).toEqual(context)
    expect(verifyJcs(withContext, did, 'authentication')).toBe(true)
    expect(await verifyDocumentProof(agent, withContext, did, { proofPurpose: 'authentication' })).toBe(true)

    // The default is unchanged: cards, statements and eligibility proofs sign exactly as before.
    const byDefault = await signDocumentProof(agent, document, did, { proofPurpose: 'authentication' })
    expect(Object.keys(byDefault.proof as object)).not.toContain('@context')
    expect(await verifyDocumentProof(agent, byDefault, did, { proofPurpose: 'authentication' })).toBe(true)

    const bare = await signDocumentProof(agent, step(did, inviter.vid), did, {
      proofPurpose: 'authentication',
      carryContext: true,
    })
    expect(Object.keys(bare.proof as object)).not.toContain('@context')
  })
})
