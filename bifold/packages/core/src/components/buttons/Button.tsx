import React, { forwardRef, useMemo, useState } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { useTheme } from '../../contexts/theme'

import { Button, ButtonType, ButtonProps } from './Button-api'
import { ThemedText } from '../texts/ThemedText'

const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const filledButtonTypes = new Set([
  ButtonType.Critical,
  ButtonType.Primary,
  ButtonType.ModalCritical,
  ButtonType.ModalPrimary,
])

const ButtonImplComponent = (
  {
    title,
    buttonType,
    accessibilityLabel,
    accessibilityHint,
    testID,
    onPress,
    disabled = false,
    maxfontSizeMultiplier,
    children,
  }: ButtonProps,
  ref: React.LegacyRef<View>
) => {
  const { Buttons, heavyOpacity, ColorPalette } = useTheme()
  const buttonStyles = {
    [ButtonType.Critical]: {
      color: Buttons.critical,
      colorDisabled: Buttons.criticalDisabled,
      text: Buttons.criticalText,
      textDisabled: Buttons.criticalTextDisabled,
    },
    [ButtonType.Primary]: {
      color: Buttons.primary,
      colorDisabled: Buttons.primaryDisabled,
      text: Buttons.primaryText,
      textDisabled: Buttons.primaryTextDisabled,
    },
    [ButtonType.Secondary]: {
      color: Buttons.secondary,
      colorDisabled: Buttons.secondaryDisabled,
      text: Buttons.secondaryText,
      textDisabled: Buttons.secondaryTextDisabled,
    },
    [ButtonType.Tertiary]: {
      color: Buttons.tertiary,
      colorDisabled: Buttons.tertiaryDisabled,
      text: Buttons.tertiaryText,
      textDisabled: Buttons.tertiaryTextDisabled,
    },
    [ButtonType.ModalCritical]: {
      color: Buttons.modalCritical,
      colorDisabled: Buttons.modalCriticalDisabled,
      text: Buttons.modalCriticalText,
      textDisabled: Buttons.modalCriticalTextDisabled,
    },
    [ButtonType.ModalPrimary]: {
      color: Buttons.modalPrimary,
      colorDisabled: Buttons.modalPrimaryDisabled,
      text: Buttons.modalPrimaryText,
      textDisabled: Buttons.modalPrimaryTextDisabled,
    },
    [ButtonType.ModalSecondary]: {
      color: Buttons.modalSecondary,
      colorDisabled: Buttons.modalSecondaryDisabled,
      text: Buttons.modalSecondaryText,
      textDisabled: Buttons.modalSecondaryTextDisabled,
    },
    [ButtonType.ModalTertiary]: {
      color: Buttons.modalTertiary,
      colorDisabled: Buttons.modalTertiaryDisabled,
      text: Buttons.modalTertiaryText,
      textDisabled: Buttons.modalTertiaryTextDisabled,
    },
  }
  const [isActive, setIsActive] = useState<boolean>(false)

  const androidRipple = useMemo(() => {
    if (disabled) return undefined
    const rippleColor = filledButtonTypes.has(buttonType)
      ? 'rgba(255, 255, 255, 0.3)'
      : hexToRgba(ColorPalette.brand.primary, 0.2)
    return { color: rippleColor, borderless: false }
  }, [buttonType, disabled, ColorPalette.brand.primary])

  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={'button'}
      onPressIn={() => setIsActive(!disabled && true)}
      onPressOut={() => setIsActive(false)}
      testID={testID}
      android_ripple={androidRipple}
      style={({ pressed }) => [
        { overflow: 'hidden' as const },
        buttonStyles[buttonType].color,
        disabled && buttonStyles[buttonType].colorDisabled,
        isActive &&
          (buttonType === ButtonType.Secondary || buttonType === ButtonType.Tertiary) && {
            backgroundColor: Buttons.primary.backgroundColor,
          },
        Platform.OS === 'ios' && pressed && !disabled && { opacity: heavyOpacity },
      ]}
      disabled={disabled}
      ref={ref}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {children}
        <ThemedText
          maxFontSizeMultiplier={maxfontSizeMultiplier}
          style={[
            buttonStyles[buttonType].text,
            disabled && buttonStyles[buttonType].textDisabled,
            isActive && { textDecorationLine: 'underline' },
            isActive && buttonType === ButtonType.Secondary && { color: Buttons.primaryText.color },
          ]}
        >
          {title}
        </ThemedText>
      </View>
    </Pressable>
  )
}

const ButtonImpl = forwardRef<View, ButtonProps>(ButtonImplComponent)
export default ButtonImpl
export { ButtonType, ButtonImpl }
export type { Button, ButtonProps }
