/**
 * A view that makes room for the keyboard with bottom padding, like React
 * Native's KeyboardAvoidingView (behavior "padding"), but whose padding can
 * never be more than the keyboard covers, and always leaves part of the view
 * in sight.
 *
 * React Native's version pads by the view's bottom minus where iOS says the
 * keyboard's top edge is, less a fixed offset. On a tester's iPhone 15 Pro Max
 * (iOS 26.7.2, build 278, IN-525) that padding grew as tall as the whole view
 * on the R-card form's first run: the form vanished, the Continue button was
 * squashed to a thin bar under the header, and with nothing left to scroll or
 * tap, the keyboard could not be closed. Any field did it. A keyboard top
 * reported at or near the top of the screen produces exactly that, and React
 * Native guards only one such case (the cross-fade setting, which was off).
 *
 * Here the padding comes from how much of the screen the keyboard covers,
 * measured against where this view sits on screen, and it is capped twice:
 * at the keyboard's own height, and so that `keepVisible` points of the view
 * stay above it.
 *
 * Two things a caller should know:
 * - Until `measureInWindow` answers, the view is taken to reach the bottom of
 *   the screen, so the padding is what the keyboard covers (still capped). For a
 *   full-height view that is the true answer; a short view sitting high on the
 *   screen gets too much until it is measured.
 * - A view no taller than `keepVisible` gets no padding at all: it is left
 *   under the keyboard rather than padded out of sight. It is meant for views
 *   that fill the screen.
 *
 * @module components/views/KeyboardPaddedView
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardAvoidingViewProps,
  type KeyboardEvent,
  type KeyboardMetrics,
  LayoutAnimation,
  type LayoutChangeEvent,
  Platform,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native'

/** How much of the view stays above the keyboard, at least, in points. */
export const KEEP_VISIBLE = 200

/**
 * The padding that lifts a view's content clear of the keyboard.
 *
 * @param view where the view sits on screen; `top` unmeasured counts the view
 *   as reaching the bottom of the screen, so the keyboard covers it fully
 * @param keyboard where the keyboard ends up, as React Native reports it;
 *   undefined when it is hidden
 */
export function keyboardPadding(
  view: { top?: number; height: number },
  keyboard: Pick<KeyboardMetrics, 'screenY' | 'height'> | undefined,
  windowHeight: number,
  keepVisible: number = KEEP_VISIBLE
): number {
  if (!keyboard || !(view.height > 0) || !(windowHeight > 0)) return 0
  const height = Number.isFinite(keyboard.height) ? Math.max(0, keyboard.height) : 0
  // Where the top edge is read only when it lies on the screen, and never
  // counts for more than the keyboard's own height.
  const onScreen = Number.isFinite(keyboard.screenY) && keyboard.screenY > 0 && keyboard.screenY <= windowHeight
  const covers = onScreen ? Math.min(height, windowHeight - keyboard.screenY) : height
  if (covers <= 0) return 0
  const top = view.top ?? windowHeight - view.height
  const overlap = top + view.height - (windowHeight - covers)
  const most = Math.min(covers, Math.max(0, view.height - keepVisible))
  return Math.max(0, Math.min(overlap, most))
}

export interface KeyboardPaddedViewProps extends ViewProps {
  keepVisible?: number
}

const KeyboardPaddedView: React.FC<KeyboardPaddedViewProps> = ({
  style,
  children,
  keepVisible = KEEP_VISIBLE,
  onLayout,
  ...props
}) => {
  const ref = useRef<View>(null)
  const frame = useRef<{ top?: number; height: number }>({ height: 0 })
  const keyboard = useRef<KeyboardEvent | undefined>(undefined)
  const current = useRef(0)
  const [padding, setPadding] = useState(0)

  const apply = useCallback(() => {
    const event = keyboard.current
    const next = keyboardPadding(frame.current, event?.endCoordinates, Dimensions.get('window').height, keepVisible)
    if (next === current.current) return
    current.current = next
    if (event?.duration && event.easing) {
      const duration = Math.max(event.duration, 10)
      LayoutAnimation.configureNext({
        duration,
        update: { duration, type: LayoutAnimation.Types[event.easing] ?? LayoutAnimation.Types.keyboard },
      })
    }
    setPadding(next)
  }, [keepVisible])

  // Where the view sits on screen. Until it is measured, `apply` counts the view as reaching the bottom of the screen.
  const measure = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, height) => {
      if (!Number.isFinite(y) || !(height > 0)) return
      frame.current = { top: y, height }
      apply()
    })
  }, [apply])

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      frame.current = { top: frame.current.top, height: event.nativeEvent.layout.height }
      apply()
      measure()
      onLayout?.(event)
    },
    [apply, measure, onLayout]
  )

  useEffect(() => {
    const shown = (event: KeyboardEvent) => {
      keyboard.current = event
      apply()
      measure()
    }
    const hidden = () => {
      keyboard.current = undefined
      apply()
    }
    const subscriptions =
      Platform.OS === 'ios'
        ? [Keyboard.addListener('keyboardWillShow', shown), Keyboard.addListener('keyboardWillHide', hidden)]
        : [Keyboard.addListener('keyboardDidShow', shown), Keyboard.addListener('keyboardDidHide', hidden)]
    return () => subscriptions.forEach((subscription) => subscription?.remove())
  }, [apply, measure])

  return (
    <View ref={ref} style={StyleSheet.compose(style, { paddingBottom: padding })} onLayout={handleLayout} {...props}>
      {children}
    </View>
  )
}

/**
 * Room for the keyboard on a screen or sheet: KeyboardPaddedView on iOS, and
 * on Android React Native's KeyboardAvoidingView with the `android` props it
 * had (none: a plain view). Android keeps what it had because nothing has
 * shown the bug there, not because the padding rule differs.
 */
export const KeyboardSpace: React.FC<
  KeyboardPaddedViewProps & { android?: Pick<KeyboardAvoidingViewProps, 'behavior' | 'keyboardVerticalOffset'> }
> = ({ android, keepVisible, ...props }) =>
  Platform.OS === 'ios' ? (
    <KeyboardPaddedView keepVisible={keepVisible} {...props} />
  ) : (
    <KeyboardAvoidingView {...props} {...android} />
  )

export default KeyboardPaddedView
