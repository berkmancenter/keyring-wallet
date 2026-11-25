/**
 * A persona's key copies go to the in-memory backend, under an id that is the
 * same every session (#10, plan part C); erasing finds them there. The backend
 * itself is exercised over real Askar in credo-tsp-adapter's inMemoryKeys test.
 */
import { TypedArrayEncoder } from '@credo-ts/core'

import {
  EPHEMERAL_KMS_BACKEND,
  forgetKeyCopy,
  importVtaKey,
  inMemoryKeyId,
  isInMemoryKeyId,
} from '../module/vtaKeys'

const bare = (fill: number) => `z${TypedArrayEncoder.toBase58(new Uint8Array(32).fill(fill))}`
const exported = { keyId: 'k', keyType: 'ed25519', publicKeyMultibase: bare(2), privateKeyMultibase: bare(1) }

function fakeAgent() {
  const calls: { op: string; options: Record<string, unknown> }[] = []
  const agent = {
    kms: {
      deleteKey: async (options: Record<string, unknown>) => void calls.push({ op: 'delete', options }),
      importKey: async (options: { privateJwk: { kid?: string } }) => {
        calls.push({ op: 'import', options })
        return { keyId: options.privateJwk.kid ?? 'random-uuid' }
      },
    },
  }
  return { agent: agent as never, calls }
}

describe("a persona's key copies", () => {
  const vta = 'did:webvh:QmAgent:agent.example'
  const kid = inMemoryKeyId(vta, 'did:webvh:QmP:dids.example:p#key-0')

  it('are named the same every session, and recognised as in-memory copies', () => {
    expect(kid).toBe(inMemoryKeyId(vta, 'did:webvh:QmP:dids.example:p#key-0'))
    expect(isInMemoryKeyId(kid)).toBe(true)
    expect(isInMemoryKeyId('3f1c0e2a-uuid-from-the-wallet')).toBe(false)
  })

  it('go to the in-memory backend under that id, replacing an earlier copy', async () => {
    const { agent, calls } = fakeAgent()
    const imported = await importVtaKey(agent, exported, { backend: EPHEMERAL_KMS_BACKEND, keyId: kid })
    expect(imported).toEqual({ keyId: kid, curve: 'Ed25519' })
    expect(calls.map((c) => c.op)).toEqual(['delete', 'import'])
    expect(calls[0].options).toEqual({ keyId: kid, backend: EPHEMERAL_KMS_BACKEND })
    expect(calls[1].options).toMatchObject({ backend: EPHEMERAL_KMS_BACKEND, privateJwk: { kid, crv: 'Ed25519' } })
  })

  it('without a destination, go to the wallet as before', async () => {
    const { agent, calls } = fakeAgent()
    await importVtaKey(agent, exported)
    expect(calls.map((c) => c.op)).toEqual(['import'])
    expect(calls[0].options).not.toHaveProperty('backend')
  })

  it('are erased from where they are held', async () => {
    const { agent, calls } = fakeAgent()
    await forgetKeyCopy(agent, kid)
    await forgetKeyCopy(agent, 'wallet-key')
    expect(calls.map((c) => c.options)).toEqual([{ keyId: kid, backend: EPHEMERAL_KMS_BACKEND }, { keyId: 'wallet-key' }])
  })
})
