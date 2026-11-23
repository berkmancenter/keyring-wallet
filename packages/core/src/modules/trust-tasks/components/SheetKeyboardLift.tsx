/**
 * Lifts a bottom sheet that fills a Modal's window by the keyboard's full height.
 *
 * iOS: keyboard-controller's KeyboardAvoidingView, padding, offset 0 (it works there: the keyboard's frames are
 * system-wide).
 *
 * Android: that view never moves inside a Modal opened from the chat (278.20, K2 run on a Pixel 6, API 33: the
 * keyboard covered the note and Send, and the sheet sat exactly where it was with the keyboard down). A Modal is its own
 * dialog window. keyboard-controller follows a dialog's keyboard by hooking it from each KeyboardProvider on screen,
 * and the last provider to hook it gets the keyboard's frames. On the chat that is gifted-chat's own provider (it wraps
 * itself in one), not the app's, so a KeyboardAvoidingView reading the app's provider is never told. keyboard-
 * controller's keyboard events (KeyboardEvents) are app-wide, whichever provider hooked the dialog, so on Android the
 * lift is padding set from them: the keyboard's height once it starts to show, 0 once it starts to hide.
 *
 * @module trust-tasks/components/SheetKeyboardLift
 */
import React, { useEffect, useState } from 'react'
import { Platform, StyleProp, View, ViewStyle } from 'react-native'
import { KeyboardAvoidingView, KeyboardEvents } from 'react-native-keyboard-controller'

interface Props {
  style?: StyleProp<ViewStyle>
  testID?: string
  children: React.ReactNode
}

const AndroidLift: React.FC<Props> = ({ style, testID, children }) => {
  const [lift, setLift] = useState(0)
  useEffect(() => {
    const shown = KeyboardEvents.addListener('keyboardWillShow', (e) => setLift(e.height))
    const hidden = KeyboardEvents.addListener('keyboardWillHide', () => setLift(0))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  return (
    <View style={[style, { paddingBottom: lift }]} testID={testID}>
      {children}
    </View>
  )
}

const SheetKeyboardLift: React.FC<Props> = ({ style, testID, children }) =>
  Platform.OS === 'android' ? (
    <AndroidLift style={style} testID={testID}>
      {children}
    </AndroidLift>
  ) : (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={style} testID={testID}>
      {children}
    </KeyboardAvoidingView>
  )

export default SheetKeyboardLift
