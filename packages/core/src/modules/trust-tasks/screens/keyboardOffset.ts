/**
 * Where a KeyboardAvoidingView sits on screen, measured, for its
 * `keyboardVerticalOffset`.
 *
 * keyboard-controller lifts a view by (offset + the view's own y + height) −
 * (screen height − keyboard height): the offset has to be where the view's
 * parent starts on screen. The screens passed the navigation header's height,
 * and on an iOS 26 iPhone 17 Pro that came back as the status bar alone (about
 * 62 of the 106 points above the page). So the view was lifted 45 points too
 * little, and the step's filled button stayed under the keyboard (225 gate:
 * Claim's "Continue", 25 pt under it). Measured, the offset holds whatever the
 * header, the tab bar, the phone or the iOS version.
 *
 * On Android it is measured from the top of the app's own view, not the window:
 * `measureInWindow` there leaves out the status bar (RootViewUtil.getViewportOffset),
 * but the app draws under it and keyboard-controller counts the screen from the
 * very top. The view was lifted short by the status bar's height, and in a room
 * the keyboard covered the message box, with "Posting as" just above it (IN-454).
 *
 * @module trust-tasks/screens/keyboardOffset
 */
import { useCallback, useRef, useState } from 'react'
import { type LayoutChangeEvent, Platform, type View } from 'react-native'

export interface MeasuredKeyboardOffset {
  /** For the KeyboardAvoidingView. */
  ref: React.RefObject<View | null>
  /** For the KeyboardAvoidingView: re-measures whenever it is laid out. */
  onLayout: (e: LayoutChangeEvent) => void
  /** Where the view's parent starts on screen; `fallback` until measured. */
  offset: number
}

export function useMeasuredKeyboardOffset(fallback: number): MeasuredKeyboardOffset {
  const ref = useRef<View>(null)
  const [offset, setOffset] = useState(fallback)
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    // The view's y within its parent, from the layout; its y on screen, measured.
    const withinParent = e.nativeEvent.layout.y
    const measured = (onScreen: number) => {
      if (Number.isFinite(onScreen)) setOffset(Math.max(0, onScreen - withinParent))
    }
    if (Platform.OS === 'android') ref.current?.measure((_x, _y, _w, _h, _pageX, pageY) => measured(pageY))
    else ref.current?.measureInWindow((_x, onScreen) => measured(onScreen))
  }, [])
  return { ref, onLayout, offset }
}
