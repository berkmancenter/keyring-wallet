import React, { useState, useEffect } from 'react'
import { Pressable, Animated } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialIcons'
import { useTheme } from '../../contexts/theme'
import { useTranslation } from 'react-i18next'

interface ToggleButtonProps {
  isEnabled: boolean
  isAvailable: boolean
  toggleAction: () => void
  testID?: string
  enabledIcon?: string
  disabledIcon?: string
  disabled?: boolean
}

const ToggleButton: React.FC<ToggleButtonProps> = ({
  isEnabled,
  isAvailable,
  toggleAction,
  testID,
  enabledIcon = 'check',
  disabledIcon = 'close',
  disabled = false,
}) => {
  const { ColorPalette } = useTheme()
  const [toggleAnim] = useState(new Animated.Value(isEnabled ? 1 : 0))
  const { t } = useTranslation()

  useEffect(() => {
    Animated.timing(toggleAnim, {
      toValue: isEnabled ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start()
  }, [isEnabled, toggleAnim])

  // Off is a mid grey, not a light one: a light-grey track on a white or very light card all but vanished, so people
  // could not tell there was a switch to turn on (IN-550). Mid grey is about 5:1 against either; on stays the brand
  // colour, and the thumb's cross or tick says which it is without relying on colour.
  const backgroundColor = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [ColorPalette.grayscale.mediumGrey, ColorPalette.brand.primary],
  })

  const translateX = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 24],
  })

  return (
    <Pressable
      accessible
      testID={testID}
      accessibilityLabel={isEnabled ? t('Biometry.On') : t('Biometry.Off')}
      accessibilityRole="switch"
      accessibilityState={{
        checked: isEnabled,
      }}
      onPress={isAvailable && !disabled ? toggleAction : undefined} // Prevent onPress if not available or disabled
      disabled={!isAvailable || disabled}
    >
      <Animated.View
        style={{
          width: 55,
          height: 30,
          borderRadius: 25,
          backgroundColor,
          padding: 3,
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1, // Visual feedback for disabled state
        }}
      >
        <Animated.View
          style={{
            transform: [{ translateX }],
            width: 25,
            height: 25,
            borderRadius: 20,
            backgroundColor: '#FFFFFF',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Icon
            name={isEnabled ? enabledIcon : disabledIcon}
            size={15}
            color={isEnabled ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  )
}

export default ToggleButton
