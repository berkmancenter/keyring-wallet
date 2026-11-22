import { useEffect, useState, useSyncExternalStore } from 'react'

import { lateStepStore, type HeldStep, type PeerCheck } from '../lateStep'

const subscribe = (listener: () => void) => {
  lateStepStore.on('change', listener)
  return () => {
    lateStepStore.off('change', listener)
  }
}

/** This connection's held step, if any (lateStep.ts). */
export function useHeldStep(connectionId: string): HeldStep | undefined {
  return useSyncExternalStore(subscribe, () => lateStepStore.get(connectionId))
}

/** The first ready-check from another phone that waits on this person: what the global sheet shows. */
export function useAnyPeerCheck(): PeerCheck | undefined {
  return useSyncExternalStore(subscribe, () => lateStepStore.getAnyPeerCheck())
}

/** A clock ticking each second while `on`: "Asked 20 s ago", "Sent 12 min ago". */
export function useTickingNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now
}
