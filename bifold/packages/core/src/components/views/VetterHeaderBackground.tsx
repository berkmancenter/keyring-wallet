import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { useTheme } from '../../contexts/theme'

/**
 * The header behind the vetter's side of vetting: the theme's own header
 * gradient with its far end changed, so a vetter and an applicant can tell
 * at a glance whose side of the exchange they are on, and the brand stays
 * (Alberto, 10-06: "two headers that look the same but with different text").
 *
 * The far end is the theme's `vetterHeaderEnd` when it sets one, else its
 * focus colour. Drawn with react-native-svg, which core already ships.
 */
export const VetterHeaderBackground: React.FC<{ style?: StyleProp<ViewStyle> }> = ({ style }) => {
  const { GradientTheme, ColorPalette } = useTheme()
  const gradient = GradientTheme?.headerGradient
  const colors = gradient?.colors?.length ? [...gradient.colors] : [ColorPalette.brand.primary]
  const end = GradientTheme?.vetterHeaderEnd ?? ColorPalette.semantic.focus
  if (colors.length === 1) colors.push(end)
  else colors[colors.length - 1] = end
  const locations = gradient?.locations?.length === colors.length ? gradient.locations : undefined
  const from = gradient?.start ?? { x: 0, y: 0 }
  const to = gradient?.end ?? { x: 1, y: 0 }
  return (
    <View style={[StyleSheet.absoluteFillObject, style]} pointerEvents="none" testID="VetterHeaderBackground">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="vetterHeader" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
            {colors.map((color, i) => (
              <Stop
                key={`${color}-${i}`}
                offset={locations ? locations[i] : colors.length === 1 ? 0 : i / (colors.length - 1)}
                stopColor={color}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vetterHeader)" />
      </Svg>
    </View>
  )
}

/** The `headerVariant` screen option that asks the header for this background. */
export const VETTER_HEADER = 'vetter'

export default VetterHeaderBackground
