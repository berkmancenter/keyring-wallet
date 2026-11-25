import { NavigationContainer } from '@react-navigation/native'
import type { useNavigationContainerRef } from '@react-navigation/native'
import React, { useEffect } from 'react'

import { noteNavigationState, setReturnNavigationRef } from '../utils/navReturn'
import { useTheme } from './theme'

export interface NavContainerProps extends React.PropsWithChildren {
  navigationRef: ReturnType<typeof useNavigationContainerRef> | null
}

const NavContainer = ({ navigationRef, children }: NavContainerProps) => {
  const { NavigationTheme } = useTheme()

  // Where the person is, so an inactivity lock can bring them back to it (utils/navReturn.ts).
  useEffect(() => setReturnNavigationRef(navigationRef), [navigationRef])

  return (
    <NavigationContainer ref={navigationRef} theme={NavigationTheme} onStateChange={noteNavigationState}>
      {children}
    </NavigationContainer>
  )
}

export default NavContainer
