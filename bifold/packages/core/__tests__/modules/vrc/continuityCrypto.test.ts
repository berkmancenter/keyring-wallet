/**
 * @jest-environment node
 *
 * The continuity check's cryptography on a real agent: Askar's KMS, relationship DIDs made the way
 * getOrCreateRelationshipDid makes them (did:peer:0, one Ed25519 key). A challenge sealed to one relationship DID opens
 * with that DID's key and no other.
 *
 * DEPENDENCY: @credo-ts/node and @openwallet-foundation/askar-nodejs are NOT declared by core; they resolve because
 * credo-tsp-adapter declares them and the workspace hoists them (its tests build a real agent the same way). If that
 * package stops declaring them, this suite fails at import — declare them in core's devDependencies then; do not skip
 * the suite, which is the only proof the sealed box works on a real KMS.
 *
 * Why it is set up the way it is — the only real-Askar test in core, whose jest runs the react-native preset:
 * - core's jest.config.js maps @openwallet-foundation/askar-shared to one copy. @credo-ts/askar is nested under core
 *   and decides whether to provision a new store with `instanceof AskarError`; across two copies that check failed and
 *   the store was opened instead ("database path was not found").
 * - The store gets an explicit sqlite file in a temporary directory, removed afterwards, rather than the default under
 *   the agent's data path; and not an in-memory database, which is per connection ("no such table: config").
 */
import '@openwallet-foundation/askar-nodejs'

import { AskarModule } from '@credo-ts/askar'
import { Agent, PeerDidNumAlgo } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { openChallenge, sameChallenge, sealChallenge } from '../../../src/modules/vrc/contacts/continuityCrypto'

async function relationshipDid(agent: Agent): Promise<string> {
  const result = await agent.dids.create({
    method: 'peer',
    options: { numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc, createKey: { type: { kty: 'OKP', crv: 'Ed25519' } } },
  } as never)
  if (!result.didState.did) throw new Error(`test setup: ${JSON.stringify(result.didState)}`)
  return result.didState.did
}

describe('continuity crypto on a real KMS', () => {
  let agent: Agent
  let first: string
  let second: string
  let third: string
  const storeDir = mkdtempSync(join(tmpdir(), 'continuity-'))

  beforeAll(async () => {
    // jestSetup.js freezes Date.now for screen tests; a real Askar store needs the real clock.
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: { label: 'continuity-crypto-test' },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({
          askar,
          store: {
            id: `continuity-${process.pid}-${Math.random().toString(36).slice(2)}`,
            key: 'test-key',
            database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
          },
        }),
      },
    })
    await agent.initialize()
    first = await relationshipDid(agent)
    second = await relationshipDid(agent)
    third = await relationshipDid(agent)
  }, 60000)

  afterAll(async () => {
    await agent?.shutdown()
    rmSync(storeDir, { recursive: true, force: true })
  })

  test('a challenge sealed to one relationship DID opens with its key, and says which', async () => {
    const { challenge, sealed } = await sealChallenge(agent, second)
    const opened = await openChallenge(agent, sealed, [first, second, third])
    expect(opened).toEqual({ challenge, openedWith: second })
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('without that DID among the keys offered, it does not open', async () => {
    const { sealed } = await sealChallenge(agent, second)
    expect(await openChallenge(agent, sealed, [first, third])).toBeUndefined()
    expect(await openChallenge(agent, sealed, [])).toBeUndefined()
  })

  test('a DID this agent did not create is skipped, not an error', async () => {
    const { sealed } = await sealChallenge(agent, first)
    const notOurs = 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
    expect(await openChallenge(agent, sealed, [notOurs, first])).toEqual(expect.objectContaining({ openedWith: first }))
  })

  test('every seal is fresh: the same DID twice gives two challenges and two boxes', async () => {
    const a = await sealChallenge(agent, first)
    const b = await sealChallenge(agent, first)
    expect(a.challenge).not.toBe(b.challenge)
    expect(a.sealed).not.toBe(b.sealed)
  })

  test('challenges compare equal only when they are', () => {
    expect(sameChallenge('abcDEF_-', 'abcDEF_-')).toBe(true)
    expect(sameChallenge('abcDEF_-', 'abcDEF_x')).toBe(false)
    expect(sameChallenge('abc', 'abcd')).toBe(false)
  })
})
