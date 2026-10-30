import React, { useCallback } from 'react'
import { StyleSheet, Pressable, View } from 'react-native'
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons'
import MaterialIcon from 'react-native-vector-icons/MaterialIcons'
import { hitSlop } from '../../constants'
import { useTheme } from '../../contexts/theme'
import { ThemedText } from '../texts/ThemedText'
import { TOKENS, useServices } from '../../container-api'

const defaultIconSize = 26

/**
 * An IconButton's touch area reaches only 12 below its icon, so a header button stays inside the header. On Android a
 * hit slop reaches past its parent and wins the touch there, so the shared 44 below took taps meant for the screen
 * under the header: Messages' search Clear, 30 points down, opened New message (276.9).
 *
 * - Android's header is 56 points (@react-navigation/elements' default, in portrait and landscape; the app sets no
 *   height), with the 26-point icon centred, 15 below it: 12 stays inside. iOS's is 44 (32 in landscape), but iOS
 *   doesn't give a touch past the header to a button in it (Clear worked there under the old 44).
 * - Every IconButton gets it, not only a header's: nearly all are (headerRight, Chat's menu, the scanner, FauxHeader's
 *   drawn header), and the one in a screen's content, Settings' section edit pencil, keeps a target of 26 plus 44
 *   above and 12 below, well over the 44-point minimum. The only loss is reach from below, where nothing overlapped.
 *
 * Above and to the sides it is still the shared 44, read as the button renders: `constants` can still be loading when
 * this module is (a cycle through it), and a copy made here would have none of it.
 */
export const ICON_BUTTON_HIT_SLOP_BOTTOM = 12

export enum ButtonLocation {
  Left,
  Right,
}

interface IconButtonProps {
  buttonLocation: ButtonLocation
  accessibilityLabel: string
  testID: string
  onPress: () => void
  icon: string
  text?: string
  iconTintColor?: string
}

const IconButton: React.FC<IconButtonProps> = ({
  buttonLocation,
  icon,
  text,
  accessibilityLabel,
  testID,
  onPress,
  iconTintColor,
}) => {
  const { ColorPalette } = useTheme()
  const [logger] = useServices([TOKENS.UTIL_LOGGER])

  const style = StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: buttonLocation === ButtonLocation.Left ? 0 : 15,
      marginLeft: buttonLocation === ButtonLocation.Right ? 0 : 15,
      minWidth: defaultIconSize,
      minHeight: defaultIconSize,
    },
    title: {
      color: ColorPalette.brand.headerText,
      marginRight: 4,
    },
  })

  const myIcon = useCallback(() => {
    const iconColor = iconTintColor ?? ColorPalette.brand.headerIcon

    // First, check if the icon exists in MaterialCommunityIcons
    if (MaterialCommunityIcon.hasIcon(icon)) {
      return <MaterialCommunityIcon name={icon} size={defaultIconSize} color={iconColor} />
    }

    // Next, check if the icon exists in MaterialIcons
    if (MaterialIcon.hasIcon(icon)) {
      return <MaterialIcon name={icon} size={defaultIconSize} color={iconColor} />
    }

    // Otherwise, render default icon (?) and log a warning
    logger.warn(`IconButton: Icon "${icon}" not found in MaterialIcons or MaterialCommunityIcons. Defaulting to (?).`)
    return <MaterialIcon name={'question-mark'} size={defaultIconSize} color={iconColor} />
  }, [ColorPalette.brand.headerIcon, icon, iconTintColor, logger])

  const myText = () =>
    text ? (
      <ThemedText maxFontSizeMultiplier={1} variant="label" style={style.title}>
        {text}
      </ThemedText>
    ) : null

  const layoutForButtonLocation = (buttonLocation: ButtonLocation) => {
    switch (buttonLocation) {
      case ButtonLocation.Left:
        return (
          <>
            {myIcon()}
            {myText()}
          </>
        )
      case ButtonLocation.Right:
        return (
          <>
            {myText()}
            {myIcon()}
          </>
        )
    }
  }
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={'button'}
      testID={testID}
      onPress={onPress}
      hitSlop={{ ...hitSlop, bottom: ICON_BUTTON_HIT_SLOP_BOTTOM }}
    >
      <View style={style.container}>{layoutForButtonLocation(buttonLocation)}</View>
    </Pressable>
  )
}

export default IconButton
