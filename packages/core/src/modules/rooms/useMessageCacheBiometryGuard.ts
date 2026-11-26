import { useEffect, useRef } from 'react'

import { useStore } from '../../contexts/store'
import { noteBiometricUnlock } from './messageCache'

/**
 * Empties the rooms' kept posts the moment the person turns biometric unlock off, wherever they turn it off (onboarding,
 * Settings, or the PIN screen when biometrics stop being available): without it the wallet key is kept
 * ACCESSIBLE.ALWAYS, and no words are kept so (Alberto, 11-18, decision 6). Run once, from the tab navigator
 * (useRoomNotices).
 *
 * @module rooms/useMessageCacheBiometryGuard
 */
export function useMessageCacheBiometryGuard(): void {
  const [store] = useStore()
  const on = store.preferences?.useBiometry === true
  const seen = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (seen.current === on) return
    seen.current = on
    void noteBiometricUnlock(on).catch(() => undefined)
  }, [on])
}
