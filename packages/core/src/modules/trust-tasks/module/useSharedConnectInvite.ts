/**
 * useSharedConnectInvite — what the "Show a code" screen calls (relationship-over-tsp plan WP9): one live code per
 * mounted screen, made on mount, followed through its states, and ended when the screen goes.
 *
 * The contract agreed with the screen (SharedConnectInvite in sharedConnectInviteTypes.ts):
 *  - `minting` until the code shows, then `waiting` with `link` and `expiresAt` (epoch seconds);
 *  - `proposed`, `connecting`, `connected`, `expired`, `failed` (with `failure`) and `cancelled`, as the inviter
 *    reports them. Expiry is the core's, never the screen's: the screen only formats the time left;
 *  - `cancel()` ends the code, idempotently, in any state; unmounting does too, so a code never outlives its screen;
 *  - `renew()` ends the code and makes a fresh one (a new DID and `_id`).
 *
 * A code left `waiting` by an app that was closed while it showed is swept to `cancelled` on mount, so the store holds
 * no record that claims a code nobody listens on. The sweep never touches a code live in this process: the one the
 * person is looking at is live until its screen unmounts, and unmounting ends it, so a remount shows a new code
 * rather than finding the old one swept from under it.
 *
 * With the inviter switched off, nothing is made and the state is `cancelled`; the screen's own wrapper does not mount
 * this hook while the switch is off, so this is a backstop.
 *
 * @module trust-tasks/module/useSharedConnectInvite
 */

import { useAgent } from '@bifold/react-hooks'
import type { Agent } from '@credo-ts/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ENCOUNTER_LOG_PREFIX } from './sharedConnectEncounter'
import {
  createSharedConnectInvite,
  sweepStaleInvites,
  type CreateInviteResult,
  type SharedConnectInviter,
} from './sharedConnectInvite'
import type {
  SharedConnectInvite,
  SharedConnectInviteFailure,
  SharedConnectInviteState,
} from './sharedConnectInviteTypes'

type View = Pick<SharedConnectInvite, 'link' | 'expiresAt' | 'state' | 'failure'>

/** The effects the hook uses, for tests. */
export interface UseSharedConnectInviteDeps {
  create: (agent: Agent, options: { ttlSeconds?: number }) => Promise<CreateInviteResult>
  sweep: (agent: Agent) => Promise<number>
}

const defaultDeps: UseSharedConnectInviteDeps = {
  create: (agent, options) => createSharedConnectInvite(agent, options),
  sweep: sweepStaleInvites,
}

export function useSharedConnectInvite(
  options: { ttlSeconds?: number; deps?: Partial<UseSharedConnectInviteDeps> } = {}
): SharedConnectInvite {
  const { agent } = useAgent()
  const deps = { ...defaultDeps, ...options.deps }
  const depsRef = useRef(deps)
  depsRef.current = deps
  const ttlSeconds = options.ttlSeconds
  const [view, setView] = useState<View>({ state: 'minting' })
  const [generation, setGeneration] = useState(0)
  /** The live code of the current generation, once made. */
  const inviterRef = useRef<SharedConnectInviter | undefined>(undefined)
  /** Set when the current generation is cancelled or replaced: a code still being made is ended as soon as it shows. */
  const abandonedRef = useRef(false)
  /** The previous code's teardown: a renewed code is made only after the old one has ended (relay closed, written). */
  const teardownRef = useRef<Promise<void> | undefined>(undefined)

  useEffect(() => {
    if (!agent) return
    let current = true
    abandonedRef.current = false
    inviterRef.current = undefined
    setView({ state: 'minting' })
    let unsubscribe: (() => void) | undefined
    const run = async () => {
      // The old code first: on renew (or a remount) it is ended before a new one is made, never alongside it.
      await teardownRef.current?.catch(() => undefined)
      if (!current) return
      // Sweeping is housekeeping: a failure here must not stop a code from showing.
      await depsRef.current.sweep(agent).catch(() => 0)
      const made = await depsRef.current.create(agent, { ttlSeconds })
      // A cancel while minting already showed `cancelled`: a late result does not overwrite it.
      if (made.kind === 'off') {
        if (current && !abandonedRef.current) setView({ state: 'cancelled' })
        return
      }
      if (made.kind === 'failed') {
        if (current && !abandonedRef.current) setView({ state: 'failed', failure: made.failure })
        return
      }
      const inviter = made.inviter
      // The screen went away, or asked for a new code, while this one was being made: end it at once.
      if (!current || abandonedRef.current) {
        await inviter.cancel()
        return
      }
      inviterRef.current = inviter
      const follow = (state: SharedConnectInviteState) => {
        if (!current) return
        setView({
          link: made.link,
          expiresAt: made.exp,
          state,
          ...(state === 'failed' ? { failure: inviter.failure ?? ('unknown' as SharedConnectInviteFailure) } : {}),
        })
      }
      unsubscribe = inviter.subscribe(follow)
      follow(inviter.state)
    }
    run().catch((error) => {
      agent.config.logger.debug(`${ENCOUNTER_LOG_PREFIX} invite hook: ${error instanceof Error ? error.name : 'error'}`)
      if (current) setView({ state: 'failed', failure: 'unknown' })
    })
    return () => {
      current = false
      abandonedRef.current = true
      unsubscribe?.()
      const inviter = inviterRef.current
      inviterRef.current = undefined
      teardownRef.current = inviter?.cancel()
    }
  }, [agent, generation, ttlSeconds])

  const cancel = useCallback(async () => {
    abandonedRef.current = true
    const inviter = inviterRef.current
    if (inviter) {
      await inviter.cancel()
      return
    }
    // Still minting: the code is ended the moment it shows, and the screen sees `cancelled` now.
    setView((v) => (v.state === 'minting' ? { ...v, state: 'cancelled' } : v))
  }, [])

  const renew = useCallback(() => {
    // The effect's cleanup ends the current code; the next run makes a fresh one.
    setGeneration((g) => g + 1)
  }, [])

  return { ...view, cancel, renew }
}
