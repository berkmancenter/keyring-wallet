/**
 * Guard: the app builds bifold's MainContainer with its logger.
 *
 * MainContainer logs through `this.log?.info(...)`, and its logger is an
 * optional constructor argument. Built without one, every line it logs at
 * start-up is silently skipped: the Askar scan shim's "Askar scan list free:
 * <result>" never reached a single log or problem report, so a device could not
 * show whether the shim installed (2026-10-26, OTA 1). Nothing fails when the
 * argument is missing, so a test has to say so.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

const APP = resolve(__dirname, '..', 'App.tsx')

/** The argument lists of every `new MainContainer(...)` in a source, one level of nested parentheses allowed. */
const mainContainerArgs = (source: string): string[] =>
  [...source.matchAll(/new MainContainer\(((?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1])

/** Top-level arguments in an argument list. */
const argCount = (args: string): number =>
  args.trim() === ''
    ? 0
    : args
        .replace(/\([^()]*\)/g, '()')
        .split(',')
        .filter((a) => a.trim() !== '').length

describe('MainContainer is built with a logger', () => {
  it('App.tsx passes a logger as the second argument to every new MainContainer', () => {
    const calls = mainContainerArgs(readFileSync(APP, 'utf8'))
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) expect(argCount(args)).toBeGreaterThanOrEqual(2)
  })

  it('the scan sees a call without a logger (control)', () => {
    const calls = mainContainerArgs('const c = new MainContainer(container.createChildContainer()).init()')
    expect(calls).toHaveLength(1)
    expect(argCount(calls[0])).toBe(1)
  })
})
