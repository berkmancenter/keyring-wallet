/**
 * Bifold's app-global listener slot holds one component, rendered with the
 * main tabs where the agent exists; this one renders each of the app's
 * listeners there. None of them renders anything.
 */
import React from 'react'

import PickupWindowListener from '@/components/PickupWindowListener'
import PushLinkListener from '@/push/PushLinkListener'

const AppGlobalListeners: React.FC = () => (
  <>
    <PushLinkListener />
    <PickupWindowListener />
  </>
)

export default AppGlobalListeners
