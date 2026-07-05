import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useRef } from 'react'
import { TouchableOpacity, StyleSheet, View, Animated, Easing } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ContactStackParams, Screens } from '../../../types/navigators'
import { useWitnessConnection } from '../context/WitnessConnectionProvider'

const BlinkingDot: React.FC = () => {
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [opacity])

  return (
    <Animated.View style={[styles.activeDot, { opacity }]} />
  )
}

const WitnessHeaderButton: React.FC = () => {
  const navigation = useNavigation<StackNavigationProp<ContactStackParams>>()
  const { connectedWitness } = useWitnessConnection()

  const isActive = !!connectedWitness

  const handlePress = () => {
    navigation.navigate(Screens.WitnessConnections)
  }

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={handlePress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={isActive ? `Witnesses — ${connectedWitness!.name} active` : 'View witness connections'}
    >
      <View style={styles.iconWrapper}>
        <Icon
          name="shield-account"
          size={24}
          color="#FFFFFF"
        />
        {isActive && <BlinkingDot />}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    marginRight: 16,
    padding: 4,
  },
  iconWrapper: {
    position: 'relative',
  },
  activeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
})

export default WitnessHeaderButton
