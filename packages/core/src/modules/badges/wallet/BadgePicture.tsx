/**
 * A badge's picture in a circle, or the card's own mark (a medal) while there is none. Only a picture
 * useBadgePicture hands over is drawn: a data URI, never a location the image view would fetch.
 *
 * @module badges/wallet/BadgePicture
 */
import React from 'react'
import { Image, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../../contexts/theme'

import { isDrawablePicture } from './useBadgePicture'

export const BadgePicture: React.FC<{ uri?: string; size: number; testID?: string }> = ({ uri, size, testID }) => {
  const { ColorPalette } = useTheme()
  const round = { width: size, height: size, borderRadius: size / 2 }
  return isDrawablePicture(uri) ? (
    <Image source={{ uri }} style={round} accessibilityIgnoresInvertColors testID={testID} />
  ) : (
    <View
      style={[
        round,
        { alignItems: 'center', justifyContent: 'center', backgroundColor: ColorPalette.brand.primaryLight },
      ]}
      testID={testID ? `${testID}Mark` : undefined}
    >
      <Icon name="medal-outline" size={size * 0.55} color={ColorPalette.brand.primary} />
    </View>
  )
}

export default BadgePicture
