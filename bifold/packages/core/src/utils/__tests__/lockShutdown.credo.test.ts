/**
 * @jest-environment node
 *
 * GUARD: this suite encodes a hazard in credo, not a behaviour anyone wants. oldStoreClosed (utils/lockShutdown.ts)
 * refuses to start a new agent unless the old one's Askar store reads closed, because in the credo this tree pins
 * (0.7.1-pr-2704) a shutdown can fail before the store is closed, and the shutdown helpers swallow that failure. If
 * credo changes how those four methods behave, the rule may be wrong either way: a credo that always closes the store
 * makes the refusal needless, and one that reports or closes it differently can make the check pass on a store still
 * in use. When this suite fails, re-read the four methods and re-derive the rule in lockShutdown.ts; do not edit the
 * assertions to match. The wallet guards another credo shape the same way: app/src/utils/mediatorPickupStrategy.guard.test.ts.
 *
 * A real agent on a real Askar store, set up as __tests__/modules/vrc/continuityCrypto.test.ts is (see its header for
 * why: one askar-shared copy, an explicit sqlite file, the real clock).
 */
import '@openwallet-foundation/askar-nodejs'

import { AskarModule, AskarStoreManager } from '@credo-ts/askar'
import { Agent, Module } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { oldStoreClosed } from '../lockShutdown'

const GUARD =
  "credo's shutdown no longer behaves as utils/lockShutdown.ts assumes. Agent.shutdown (Agent.mjs:67-72), " +
  'DependencyManager.shutdownModules (:45-52), DependencyManager.closeAgentContext (:95-107), and AskarStoreManager ' +
  'isStoreOpen / closeStore (AskarStoreManager.mjs:28-30, :277) must be re-read, and the rule in lockShutdown.ts ' +
  're-derived from them: it may now refuse needlessly, or let a new agent start on a store still in use. Do not ' +
  'adjust this test to pass. Failed: '

/** A guard assertion: fails with the guard's message, naming what no longer holds. */
const holds = (ok: boolean, what: string) => {
  if (!ok) throw new Error(GUARD + what)
}

/** A module whose shutdown fails: credo stops at it, before closing the store. */
class ShutdownFails implements Module {
  register() {}
  async shutdown() {
    throw new Error('module shutdown failed')
  }
}

/** A module whose close hook fails, ahead of Askar's: credo stops at it, before Askar's closes the store. */
class CloseFails implements Module {
  register() {}
  async onCloseContext() {
    throw new Error('module close failed')
  }
}

const dirs: string[] = []
const agents: Agent[] = []

function newAgent(before: Record<string, Module> = {}, storeDir = mkdtempSync(join(tmpdir(), 'lock-shutdown-'))) {
  dirs.push(storeDir)
  const agent = new Agent({
    config: {},
    dependencies: agentDependencies,
    modules: {
      ...before,
      askar: new AskarModule({
        askar,
        store: {
          id: 'lock-shutdown',
          key: 'test-key',
          database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
        },
      }),
    },
  })
  agents.push(agent as unknown as Agent)
  return { agent: agent as unknown as Agent, storeDir }
}

const storeOpen = (agent: Agent) => agent.dependencyManager.resolve(AskarStoreManager).isStoreOpen(agent.context)

describe('GUARD: what credo leaves behind when a shutdown fails, and what oldStoreClosed does about it', () => {
  beforeAll(() => {
    // jestSetup.js freezes Date.now for screen tests; a real Askar store needs the real clock.
    jest.spyOn(Date, 'now').mockRestore()
  })

  afterAll(async () => {
    for (const agent of agents) {
      try {
        const stores = agent.dependencyManager.resolve(AskarStoreManager)
        if (stores.isStoreOpen(agent.context)) await stores.closeStore(agent.context)
      } catch {
        // already closed or never opened
      }
    }
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('a healthy shutdown closes the store, and the store manager says so (the control for the checks below)', async () => {
    const { agent } = newAgent()
    await agent.initialize()
    holds(storeOpen(agent), 'isStoreOpen does not read an initialized agent’s store as open')
    await agent.shutdown()
    holds(!storeOpen(agent), 'isStoreOpen still reads the store open after a healthy shutdown')
    await expect(oldStoreClosed({ agent, done: Promise.resolve() })).resolves.toBe(true)
  }, 60000)

  it('a module whose shutdown throws leaves the store open; oldStoreClosed closes it, and the store opens again', async () => {
    const { agent, storeDir } = newAgent({ shutdownFails: new ShutdownFails() })
    await agent.initialize()
    const done = agent.shutdown()
    const rejected = await done.then(
      () => false,
      () => true
    )
    holds(rejected, 'Agent.shutdown resolved although a module’s shutdown threw')
    holds(storeOpen(agent), 'the store was closed although a module’s shutdown threw before closeAgentContext')

    await expect(oldStoreClosed({ agent, done })).resolves.toBe(true)
    holds(!storeOpen(agent), 'closeStore did not leave the store reading closed')

    // The released store opens for the next agent, as an unlock after the lock-out would.
    const next = newAgent({}, storeDir).agent
    await next.initialize()
    await next.shutdown()
  }, 60000)

  it('a module whose close hook throws ahead of Askar’s leaves the store open; oldStoreClosed closes it', async () => {
    const { agent } = newAgent({ closeFails: new CloseFails() })
    await agent.initialize()
    const done = agent.shutdown()
    const rejected = await done.then(
      () => false,
      () => true
    )
    holds(rejected, 'Agent.shutdown resolved although a module’s onCloseContext threw')
    holds(storeOpen(agent), 'the store was closed although an earlier module’s onCloseContext threw')

    await expect(oldStoreClosed({ agent, done })).resolves.toBe(true)
    holds(!storeOpen(agent), 'closeStore did not leave the store reading closed')
  }, 60000)
})
