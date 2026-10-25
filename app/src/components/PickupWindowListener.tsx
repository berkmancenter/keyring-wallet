/**
 * Mounted with the main tabs (bifold's app-global listener slot), where the
 * agent exists: opens the 1 s pickup window (utils/pickupBoost.ts) for this
 * agent, at once, since the person has just unlocked, and again each time the
 * app returns to the foreground. Sends to and messages from a contact reopen it
 * on their own. It renders nothing.
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useEffect } from 'react'
import { AppState } from 'react-native'

import BCLogger from '@/utils/logger'
import { startPickupBoost } from '@/utils/pickupBoost'

const PickupWindowListener: React.FC = () => {
  const { agent } = useAgent()

  useEffect(() => {
    if (!agent) return
    const pickup = startPickupBoost(agent, BCLogger)
    pickup.boost()
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') pickup.boost()
    })
    return () => {
      subscription.remove()
      pickup.stop()
    }
  }, [agent])

  return null
}

export default PickupWindowListener
