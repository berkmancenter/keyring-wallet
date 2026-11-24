/**
 * Whether something still running has run long enough to say so. Making an
 * identity can take a minute or two when the agent first reaches a DID host
 * (227 gate, VTA Farm: 31.2 s), where a spinner alone looks stuck.
 *
 * @module trust-tasks/screens/useTakingLong
 */
import { useEffect, useState } from 'react'

/** After this long, "Getting your identity ready…" adds that it can take a minute or two. */
export const TAKING_LONG_MS = 20_000

/** True once `active` has stayed true for `afterMs`; false again as soon as it is not. */
export function useTakingLong(active: boolean, afterMs = TAKING_LONG_MS): boolean {
  const [long, setLong] = useState(false)
  useEffect(() => {
    setLong(false)
    if (!active) return
    const timer = setTimeout(() => setLong(true), afterMs)
    return () => clearTimeout(timer)
  }, [active, afterMs])
  return long
}
