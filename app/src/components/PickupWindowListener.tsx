/**
 * Mounted with the main tabs (bifold's app-global listener slot), where the
 * agent exists: opens the 1 s pickup window (utils/pickupBoost.ts) for this
 * agent, at once, since the person has just unlocked, and again each time the
 * app returns to the foreground. Sends to and messages from a contact reopen it
 * on their own. While a screen where the person waits on a peer is in front,
 * the window is held open (createPickupHold). It renders nothing.
 */
import { Screens } from '@bifold/core'
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useEffect } from 'react'
import { AppState } from 'react-native'

import BCLogger from '@/utils/logger'
import { createPickupHold, focusedRouteName, startPickupBoost } from '@/utils/pickupBoost'

/**
 * Where a peer's next message is awaited: a chat, the scanner, the connection a
 * scan opens, and a contact's page, where a relationship exchange runs.
 */
export const PICKUP_HELD_SCREENS: readonly string[] = [
  Screens.Chat,
  Screens.Scan,
  Screens.Connection,
  Screens.ContactDetails,
]

const PickupWindowListener: React.FC = () => {
  const { agent } = useAgent()
  const navigation = useNavigation()

  useEffect(() => {
    if (!agent) return
    const pickup = startPickupBoost(agent, BCLogger)
    pickup.boost()
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') pickup.boost()
    })
    // The root navigator's state carries every nested one, so its changes say which screen is in front.
    let root = navigation
    while (root.getParent()) root = root.getParent()
    const hold = createPickupHold(pickup.boost, PICKUP_HELD_SCREENS)
    hold.focus(focusedRouteName(root.getState()))
    const unsubscribeState = root.addListener('state', (event) => hold.focus(focusedRouteName(event.data.state)))
    return () => {
      unsubscribeState()
      hold.stop()
      subscription.remove()
      pickup.stop()
    }
  }, [agent, navigation])

  return null
}

export default PickupWindowListener
