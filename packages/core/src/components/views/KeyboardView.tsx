import { useHeaderHeight } from '@react-navigation/elements'
import React, { RefObject } from 'react'
import { ScrollView, ScrollViewProps } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import { KeyboardSpace } from './KeyboardPaddedView'

const useSafeHeaderHeight = (): number => {
  try {
    return useHeaderHeight()
  } catch {
    return 100
  }
}

/**
 * A wrapper component that provides keyboard-aware scrolling and safe area handling
 *
 * This component creates a full-screen container with safe area insets and optional
 * keyboard avoidance behavior. It's designed to be used as a top-level wrapper for
 * screen content that may contain input fields or other interactive elements.
 *
 * @param children - The content to render inside the keyboard view
 * @param scrollViewProps - Additional props to pass to the internal KeyboardAwareScrollView component
 */
const KeyboardView: React.FC<{
  children: React.ReactNode
  scrollViewProps?: ScrollViewProps
  scrollViewRef?: RefObject<ScrollView | null>
}> = ({ children, scrollViewProps, scrollViewRef }) => {
  const safeHeaderHeight = useSafeHeaderHeight()

  return (
    // On iOS the padding is capped at what the keyboard covers (KeyboardPaddedView): React Native's own
    // KeyboardAvoidingView here can pad the PIN screens' content out of sight on a keyboard report like IN-525's.
    <KeyboardSpace style={{ flex: 1 }} android={{ keyboardVerticalOffset: safeHeaderHeight }}>
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps={'handled'}
        contentContainerStyle={[{ flexGrow: 1 }, scrollViewProps?.contentContainerStyle]}
        showsVerticalScrollIndicator={false}
        ref={scrollViewRef}
        {...scrollViewProps}
      >
        {children}
      </KeyboardAwareScrollView>
    </KeyboardSpace>
  )
}

export default KeyboardView
