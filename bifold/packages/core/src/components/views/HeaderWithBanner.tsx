import React, { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { StackHeaderProps, Header } from '@react-navigation/stack'
import { useServices, TOKENS } from '../../container-api'
import { useTheme } from '../../contexts/theme'

const HeaderWithBanner: React.FC<StackHeaderProps> = (props) => {
  const [NotificationBanner] = useServices([TOKENS.COMPONENT_NOTIFICATION_BANNER])
  const { GradientTheme } = useTheme()
  const GradientBg = GradientTheme?.HeaderBackground

  const gradientProps = useMemo(() => {
    if (!GradientBg) return props
    return {
      ...props,
      options: {
        ...props.options,
        headerStyle: {
          ...(typeof props.options.headerStyle === 'object' ? props.options.headerStyle : {}),
          backgroundColor: 'transparent',
        },
        headerBackground: () => <View style={{ flex: 1, backgroundColor: 'transparent' }} />,
      },
    }
  }, [props, GradientBg])

  return (
    <View>
      {GradientBg && <GradientBg style={StyleSheet.absoluteFillObject} />}
      <Header {...gradientProps} />
      <NotificationBanner />
    </View>
  )
}

export default HeaderWithBanner
