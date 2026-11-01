/**
 * A community's mark at the top of its screen: its logo, the same one its Wallet card shows (useCommunityBrand), or the
 * people icon where it has none. The tile stays empty until that is settled, so the icon never shows first and the logo
 * a moment later.
 *
 * @module trust-tasks/screens/CommunityMark
 */
import React, { useRef } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { useCommunityBrand, useCommunityBrandHeard } from '../module/useCommunityBrand'

import { VtiCommunityIds } from './VtiCommunity.ids'

export interface CommunityMarkProps {
  communityDid: string
  /** The screen's read of this community is under way: its answer may be the first the phone hears of the look. */
  reading: boolean
}

export const CommunityMark: React.FC<CommunityMarkProps> = ({ communityDid, reading }) => {
  const { ColorPalette } = useTheme()
  const brand = useCommunityBrand(communityDid)
  const heard = useCommunityBrandHeard(communityDid)
  // A logo stays once drawn. One only the public profile gives is cleared by every manifest read until the profile
  // answers, and this screen reads the manifest each time it opens.
  const drawn = useRef<string | undefined>(undefined)
  if (brand.known && brand.value.logo) drawn.current = brand.value.logo
  const unsettled = !brand.known || (!heard && reading)
  return (
    <View style={[styles.tile, { backgroundColor: ColorPalette.brand.primaryLight }]}>
      {drawn.current ? (
        <Image
          source={{ uri: drawn.current }}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          testID={testIdWithKey(VtiCommunityIds.logo)}
        />
      ) : unsettled ? null : (
        <Icon
          name="account-group-outline"
          size={36}
          color={ColorPalette.brand.primary}
          testID={testIdWithKey(VtiCommunityIds.markIcon)}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: {
    width: 72,
    height: 72,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 72, height: 72 },
})

export default CommunityMark
