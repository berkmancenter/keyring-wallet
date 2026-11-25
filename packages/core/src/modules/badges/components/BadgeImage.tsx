/**
 * A badge's picture: fetched from the member's own community with `images/get` (`service.image`), never from a URL, so
 * showing a badge contacts nothing but that community. A badge with no picture, or one that doesn't come, is a plain
 * tile with the badge's first letter: never a broken image and never a placeholder that reads as a check.
 *
 * @module badges/components/BadgeImage
 */
import React, { useEffect, useState } from 'react'
import { Image, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { BadgeSummary } from '../types'
import { useBadgeService } from '../useBadges'

import { BadgesIds } from './Badges.ids'

/** The first letter of a badge's name, for the tile that stands in for its picture. */
export const badgeInitial = (name: string): string => Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '•'

export const BadgeImage: React.FC<{
  badge: Pick<BadgeSummary, 'badgeId' | 'communityDid' | 'name' | 'image'>
  size?: number
}> = ({ badge, size = 44 }) => {
  const { ColorPalette } = useTheme()
  const service = useBadgeService()
  const [uri, setUri] = useState<string>()
  const sha256 = badge.image?.sha256

  useEffect(() => {
    setUri(undefined)
    if (!service || !sha256) return
    let live = true
    service
      .image(badge.communityDid, badge.badgeId, sha256)
      .then((got) => {
        // Only a data URI is shown: the picture is the community's bytes, never a link to load.
        if (live && typeof got === 'string' && got.startsWith('data:image/')) setUri(got)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [service, badge.communityDid, badge.badgeId, sha256])

  const frame = { width: size, height: size, borderRadius: size / 4 }
  if (uri)
    return (
      <Image
        source={{ uri }}
        style={frame}
        accessibilityIgnoresInvertColors
        accessible={false}
        testID={testIdWithKey(BadgesIds.image)}
      />
    )
  return (
    <View
      style={{
        ...frame,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: ColorPalette.brand.secondaryBackground,
        borderWidth: 1,
        borderColor: ColorPalette.grayscale.lightGrey,
      }}
      accessible={false}
      testID={testIdWithKey(BadgesIds.imageStandIn)}
    >
      <ThemedText variant="bold" style={{ fontSize: size * 0.42, color: ColorPalette.brand.primary }}>
        {badgeInitial(badge.name)}
      </ThemedText>
    </View>
  )
}

export default BadgeImage
