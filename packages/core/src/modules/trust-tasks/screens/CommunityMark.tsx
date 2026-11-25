/**
 * A community's mark at the top of its screen: its logo, the same one its Wallet card shows (useCommunityBrand), or the
 * people icon where it has none. The tile stays empty until that is settled, so the icon never shows first and the logo
 * a moment later.
 *
 * On the first open the phone has heard nothing of the community's look. It hears just after the screen's read ends
 * (the look is kept in the background, and waits for the public profile when the manifest gives no logo), so the tile
 * waits for that. A read that fails or says nothing never gets there, so the wait is bounded.
 *
 * @module trust-tasks/screens/CommunityMark
 */
import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { useCommunityBrand, useCommunityBrandHeard } from '../module/useCommunityBrand'

import { VtiCommunityIds } from './VtiCommunity.ids'

/** How long after the read the look may still land: past the public profile's answer, its wait when busy and a retry. */
export const LOOK_WAIT_MS = 5000

export interface CommunityMarkProps {
  communityDid: string
  /** The screen's read of this community is under way. */
  reading: boolean
}

export const CommunityMark: React.FC<CommunityMarkProps> = ({ communityDid, reading }) => {
  const { ColorPalette } = useTheme()
  const brand = useCommunityBrand(communityDid)
  const heard = useCommunityBrandHeard(communityDid)
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (reading || heard) return
    const timer = setTimeout(() => setGaveUp(true), LOOK_WAIT_MS)
    return () => clearTimeout(timer)
  }, [reading, heard])
  const logo = brand.known ? brand.value.logo : undefined
  const settled = brand.known && (heard || gaveUp)
  return (
    <View style={[styles.tile, { backgroundColor: ColorPalette.brand.primaryLight }]}>
      {logo ? (
        <Image
          source={{ uri: logo }}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          testID={testIdWithKey(VtiCommunityIds.logo)}
        />
      ) : settled ? (
        <Icon
          name="account-group-outline"
          size={36}
          color={ColorPalette.brand.primary}
          testID={testIdWithKey(VtiCommunityIds.markIcon)}
        />
      ) : null}
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
