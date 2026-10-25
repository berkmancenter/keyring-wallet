/**
 * Shutting the agent down drops the persona keys borrowed for this session
 * first (#10): they live only in memory and must not outlive the session.
 * bifold core does this in its own agent setup, which Keyring doesn't use.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'

import { dropInMemoryKeys } from '@bifold/core'

import { shutdownAgent } from '../../src/utils/agentShutdown'

jest.mock('@bifold/core', () => ({ dropInMemoryKeys: jest.fn() }))

describe('shutting the agent down', () => {
  beforeEach(() => (dropInMemoryKeys as jest.Mock).mockReset())

  test('drops the in-memory keys before the agent shuts down', async () => {
    const order: string[] = []
    const drop = dropInMemoryKeys as jest.Mock
    drop.mockImplementation(async () => {
      order.push('drop')
    })
    const agent = { shutdown: jest.fn(async () => order.push('shutdown')) }
    await shutdownAgent(agent as never)
    expect(dropInMemoryKeys).toHaveBeenCalledWith(agent)
    expect(order).toEqual(['drop', 'shutdown'])
  })

  test('shuts down even if dropping the keys fails', async () => {
    const drop = dropInMemoryKeys as jest.Mock
    drop.mockRejectedValue(new Error('gone already'))
    const agent = { shutdown: jest.fn(async () => undefined) }
    await shutdownAgent(agent as never)
    expect(agent.shutdown).toHaveBeenCalledTimes(1)
  })

  test('nothing in the app shuts an agent down any other way', () => {
    const src = path.join(__dirname, '../../src')
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f)
        return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
      })
    const direct = files(src).filter(
      (f) =>
        !f.endsWith(path.join('utils', 'agentShutdown.ts')) && /\bagent\??\.shutdown\(/.test(readFileSync(f, 'utf8'))
    )
    expect(direct).toEqual([])
  })
})
