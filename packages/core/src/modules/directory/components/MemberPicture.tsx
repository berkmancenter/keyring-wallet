/**
 * A member's round picture where their card shows one to you, else their initials on the brand colour, as the
 * directory drew every member before pictures. The picture is read and checked by `useDirectoryPicture`; until it is
 * there, and whenever there is none to show, the initials stay.
 *
 * @module directory/components/MemberPicture
 */
import React from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { initialsOf } from '../../../utils/initials'
import { testIdWithKey } from '../../../utils/testable'
import { useDirectoryPicture } from '../pictures'
import type { CardPicture, DirectoryService } from '../types'

export interface MemberPictureProps {
  service: DirectoryService | undefined
  communityDid: string
  /** The entry the picture is read from; none (a card read by DID) shows initials. */
  entryId?: string
  picture?: CardPicture
  name?: string
  size: number
  initialsSize: number
  /** The most the initials grow with the phone's text size; the text default when not given. */
  initialsMaxScale?: number
  testID?: string
}

export const MemberPicture: React.FC<MemberPictureProps> = ({
  service,
  communityDid,
  entryId,
  picture,
  name,
  size,
  initialsSize,
  initialsMaxScale,
  testID,
}) => {
  const { ColorPalette } = useTheme()
  const uri = useDirectoryPicture(service, communityDid, entryId, picture)
  const round = { width: size, height: size, borderRadius: size / 2 }
  if (uri)
    return (
      <Image
        source={{ uri }}
        style={round}
        accessibilityIgnoresInvertColors
        testID={testID ? testIdWithKey(`${testID}Photo`) : undefined}
      />
    )
  return (
    <View
      style={[round, styles.disc, { backgroundColor: ColorPalette.brand.primary }]}
      testID={testID ? testIdWithKey(`${testID}Initials`) : undefined}
    >
      <ThemedText
        variant="bold"
        style={{ color: ColorPalette.grayscale.white, fontSize: initialsSize }}
        maxFontSizeMultiplier={initialsMaxScale}
      >
        {initialsOf(name)}
      </ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center' },
})

export default MemberPicture
