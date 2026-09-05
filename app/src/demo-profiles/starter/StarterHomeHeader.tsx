import { testIdWithKey, useTheme } from '@bifold/core'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

/**
 * The worked example for "replace a piece of the app's UI".
 *
 * There is nothing special about this component — it is an ordinary function
 * component. What makes it appear on the home screen is one line in
 * StarterContainer:
 *
 *   registerInstance(TOKENS.COMPONENT_HOME_HEADER, StarterHomeHeader)
 *
 * Every COMPONENT_* and SCREEN_* token works this way, so replacing the scan
 * screen or the splash screen is the same one line with a different token.
 *
 * It reads colours from `useTheme()` rather than hard-coding them, which is
 * what keeps a replacement consistent with whatever theme the app is running
 * — including a theme you supply yourself.
 */
const StarterHomeHeader: React.FC = () => {
  const { ColorPalette, TextTheme } = useTheme()

  const styles = StyleSheet.create({
    container: {
      padding: 16,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    title: {
      ...TextTheme.headingThree,
      color: ColorPalette.brand.text,
    },
    subtitle: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
      marginTop: 4,
    },
  })

  return (
    <View style={styles.container} testID={testIdWithKey('StarterHomeHeader')}>
      <Text style={styles.title}>Starter profile</Text>
      <Text style={styles.subtitle}>
        This header comes from app/src/demo-profiles/starter — edit it, or point the token at your own component.
      </Text>
    </View>
  )
}

export default StarterHomeHeader
