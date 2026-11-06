/**
 * @jest-environment node
 *
 * The shared-connect VRC on a real agent (plan WP8): a did:peer relationship DID made the way
 * getOrCreateRelationshipDid makes it, the eddsa-jcs-2022 proof signed through the KMS and verified from the
 * DID document, and the signed credential stored as a Credo W3cCredentialRecord and read back.
 *
 * Same real-Askar setup, and the same dependency note, as __tests__/modules/vrc/continuityCrypto.test.ts.
 */
import '../../helpers/realAskar'

// This tree carries two copies of @credo-ts/core (root, which @bifold/trust-tasks resolves, and core's own nested one).
// The KMS API is registered with the copy the agent was built from, so documentProof's
// `resolve(Kms.KeyManagementApi)` failed ("TypeInfo not known") across copies. One copy for this suite: the nested
// path is served by the root copy.
jest.mock('@credo-ts/core', () =>
  jest.requireActual(
    require.resolve('@credo-ts/core', { paths: [require('path').resolve(__dirname, '../../../../..')] })
  )
)

import { AskarModule } from '@credo-ts/askar'
import { Agent, JsonTransformer, PeerDidNumAlgo, W3cCredentialsModule } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { createVrcDocumentLoader } from '../../../src/modules/vrc/createVrcDocumentLoader'
import { digestMultibase, signDocumentProof, verifyDocumentProof } from '../../../src/modules/trust-tasks/documentProof'
import {
  issueSharedConnectVrc,
  verifySharedConnectVrc,
} from '../../../src/modules/trust-tasks/module/sharedConnectCredential'
import { storeReceivedVrc } from '../../../src/modules/trust-tasks/module/sharedConnectStore'

async function relationshipDid(agent: Agent): Promise<string> {
  const result = await agent.dids.create({
    method: 'peer',
    options: { numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc, createKey: { type: { kty: 'OKP', crv: 'Ed25519' } } },
  } as never)
  if (!result.didState.did) throw new Error(`test setup: ${JSON.stringify(result.didState)}`)
  return result.didState.did
}

describe('shared-connect VRC on a real KMS', () => {
  let agent: Agent
  let mine: string
  let theirs: string
  const storeDir = mkdtempSync(join(tmpdir(), 'shared-connect-'))

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: {},
      dependencies: agentDependencies,
      modules: {
        // As the app configures it (bc-agent-modules): Credo expands a JSON-LD credential when it stores one,
        // through this loader, so the DTG and VC 2.0 contexts resolve from the bundled copies, not the network.
        w3cCredentials: new W3cCredentialsModule({ documentLoader: createVrcDocumentLoader }),
        askar: new AskarModule({
          askar,
          store: {
            id: `shared-connect-${process.pid}-${Math.random().toString(36).slice(2)}`,
            key: 'test-key',
            database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
          },
        }),
      },
    })
    await agent.initialize()
    mine = await relationshipDid(agent)
    theirs = await relationshipDid(agent)
  }, 60000)

  afterAll(async () => {
    await agent?.shutdown()
    rmSync(storeDir, { recursive: true, force: true })
  })

  test('signDocumentProof / verifyDocumentProof round-trip on a did:peer, and tampering fails', async () => {
    const doc = { hello: 'world', n: 1 }
    const signed = await signDocumentProof(agent, doc, mine)
    expect(await verifyDocumentProof(agent, signed, mine)).toBe(true)
    expect(await verifyDocumentProof(agent, signed, theirs)).toBe(false)
    expect(await verifyDocumentProof(agent, { ...signed, n: 2 }, mine)).toBe(false)
  })

  test('the profiled VRC is JCS-proofed and verifies by suite', async () => {
    const vc = await issueSharedConnectVrc(agent, mine, theirs)
    const proof = vc.proof as { cryptosuite: string; verificationMethod: string }
    expect(proof.cryptosuite).toBe('eddsa-jcs-2022')
    expect(proof.verificationMethod.startsWith(mine)).toBe(true)
    expect(vc).not.toHaveProperty('validUntil')
    expect(vc).not.toHaveProperty('evidence')
    expect(await verifySharedConnectVrc(agent, vc)).toBe(true)
    expect(await verifySharedConnectVrc(agent, { ...vc, issuer: theirs })).toBe(false)
  })

  test('the JCS VRC is stored as a W3cCredentialRecord, read back intact, and a redelivery stores nothing', async () => {
    const vc = await issueSharedConnectVrc(agent, theirs, mine)
    expect(await storeReceivedVrc(agent, vc)).toBe(true)
    const records = await agent.w3cCredentials.getAll()
    expect(records).toHaveLength(1)
    const back = JsonTransformer.toJSON(records[0].firstCredential) as Record<string, unknown>
    expect(digestMultibase(back)).toBe(digestMultibase(vc))
    expect(await verifySharedConnectVrc(agent, back)).toBe(true)
    expect(await storeReceivedVrc(agent, vc)).toBe(false)
    expect(await agent.w3cCredentials.getAll()).toHaveLength(1)
  })
})
