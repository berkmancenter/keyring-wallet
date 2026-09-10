/**
 * Real Askar-backed proof that this package's ports satisfy
 * @bifold/trust-tasks's tsp module — the production-shaped continuation of
 * tsp-reference/ref-10 through ref-12's proof. Two real @credo-ts/node +
 * Askar agents, real did:key VIDs, full TSP envelope round trip both
 * directions, both failure modes. No mocking of the crypto: real Askar
 * wallets throughout, the same rigor the reference ladder established.
 */

// MUST be the first import — see README.md's "import-order gotcha" (the
// same one tsp-reference/ref-10/ref-11/ref-12 document).
import '@openwallet-foundation/askar-nodejs'

import { Agent } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { tsp } from '@bifold/trust-tasks'

import { createAskarIdentity } from '../src/identity'
import { createCredoVidResolver } from '../src/vidResolver'

const utf8 = (s: string) => new TextEncoder().encode(s)
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

async function makeAgent(name: string): Promise<Agent> {
  const agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `credo-tsp-adapter-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: `test-key-${name}` },
      }),
    },
  })
  await agent.initialize()
  return agent
}

describe('credo-tsp-adapter: real Askar identity + real Credo VidResolver', () => {
  let alice: Agent
  let bob: Agent

  beforeAll(async () => {
    alice = await makeAgent('alice')
    bob = await makeAgent('bob')
  })

  afterAll(async () => {
    await alice.shutdown()
    await bob.shutdown()
  })

  test('a full TSP envelope round-trips both directions over real Askar custody', async () => {
    const aliceIdentity = await createAskarIdentity(alice)
    const bobIdentity = await createAskarIdentity(bob)

    // did:key is self-certifying — either agent's resolver can resolve
    // either VID with no network and no prior relationship.
    const resolver = createCredoVidResolver(bob)

    const aliceToBob = utf8('hello bob, from a real Askar identity resolved only by VID')
    const sealed1 = await tsp.pack(aliceToBob, aliceIdentity.vid, bobIdentity.vid, aliceIdentity, resolver)
    const opened1 = await tsp.unpack(sealed1.bytes, bobIdentity, resolver)
    expect(eq(opened1.payload, aliceToBob)).toBe(true)
    expect(opened1.sender).toBe(aliceIdentity.vid)
    expect(opened1.receiver).toBe(bobIdentity.vid)
    expect(eq(opened1.threadDigest, sealed1.threadDigest)).toBe(true)

    const bobToAlice = utf8('hello alice, replying the same way')
    const sealed2 = await tsp.pack(bobToAlice, bobIdentity.vid, aliceIdentity.vid, bobIdentity, resolver)
    const opened2 = await tsp.unpack(sealed2.bytes, aliceIdentity, resolver)
    expect(eq(opened2.payload, bobToAlice)).toBe(true)
  }, 30000)

  test('a tampered message is rejected', async () => {
    const aliceIdentity = await createAskarIdentity(alice)
    const bobIdentity = await createAskarIdentity(bob)
    const resolver = createCredoVidResolver(bob)

    const sealed = await tsp.pack(utf8('tamper me'), aliceIdentity.vid, bobIdentity.vid, aliceIdentity, resolver)
    const tampered = sealed.bytes.slice()
    tampered[tampered.length - 1] ^= 0xff
    await expect(tsp.unpack(tampered, bobIdentity, resolver)).rejects.toThrow()
  }, 30000)

  test('a real Askar identity cannot open a message not addressed to it', async () => {
    const aliceIdentity = await createAskarIdentity(alice)
    const bobIdentity = await createAskarIdentity(bob)
    const resolver = createCredoVidResolver(bob)

    const sealed = await tsp.pack(utf8('for bob only'), aliceIdentity.vid, bobIdentity.vid, aliceIdentity, resolver)
    // alice trying to open a message she addressed to bob
    await expect(tsp.unpack(sealed.bytes, aliceIdentity, resolver)).rejects.toThrow()
  }, 30000)
})
