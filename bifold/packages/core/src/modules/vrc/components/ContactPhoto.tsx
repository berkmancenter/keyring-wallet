/**
 * A contact's photo in a circle, from what this phone knows of them (contacts/useContactFacts): their contact card's
 * photo, filling the circle; else the connection's own image (often an organisation's logo), inset whole as the chat
 * list always showed it; else the first letter of their name; else a person icon. While the facts are not read yet
 * the circle is empty, so a photo arriving a moment later replaces nothing (no letter flashing up first).
 *
 * @module vrc/components/ContactPhoto
 */
import React from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { Known } from '../contacts/useContactFacts'

/** A logo sits inset in the circle, whole (the chat list's 30 in 50). */
const LOGO_INSET = 0.6
/** Muted tones for initials (the Messages list): each name always gets the same one, and white reads on every one. */
const MUTED = ['#6E5A7E', '#4F6E7E', '#7E604F', '#5A7556', '#7E4F64', '#55607E']

/** "Sam Okafor" → "SO"; one word → its first letter. */
const initialsOf = (name: string, count: 1 | 2): string => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = count === 2 && words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1)
  return letters
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
}
const mutedFor = (name: string) => {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return MUTED[hash % MUTED.length]
}

export interface ContactPhotoProps {
  photo: Known<string | undefined>
  /** The name shown beside the photo: its first letter stands in for a photo there is none of. */
  name?: string
  /** Another picture of them to fall back on (the connection's own image), when their card has no photo. */
  fallbackUrl?: string
  size: number
  /** Letters standing in for a photo: 2 for "SO" (the Messages list); 1, the default, for "S". */
  initials?: 1 | 2
  /** Initials in white on a muted tone of their own (the Messages list), instead of on the plain circle. */
  muted?: boolean
}

export const ContactPhoto: React.FC<ContactPhotoProps> = ({ photo, name, fallbackUrl, size, initials = 1, muted }) => {
  const { ColorPalette, ListItems } = useTheme()
  const own = photo.known ? photo.value : undefined
  const logo = photo.known && !own ? fallbackUrl : undefined
  const initial = name?.trim() ? initialsOf(name, initials) : undefined
  const tinted = Boolean(muted && photo.known && !own && !logo && initial)
  const circle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: ListItems.avatarCircle.borderColor,
  }
  return (
    <View
      style={[styles.circle, circle, tinted ? { backgroundColor: mutedFor(name ?? ''), borderWidth: 0 } : null]}
      testID={testIdWithKey('ContactPhoto')}
    >
      {!photo.known ? null : own ? (
        <Image
          source={{ uri: own }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          testID={testIdWithKey('ContactPhotoImage')}
        />
      ) : logo ? (
        <Image
          source={{ uri: logo }}
          style={{ width: size * LOGO_INSET, height: size * LOGO_INSET }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          testID={testIdWithKey('ContactPhotoLogo')}
        />
      ) : initial ? (
        <ThemedText
          // Decorative beside the name, which says who it is: a screen reader skips the letter.
          accessible={false}
          importantForAccessibility="no"
          allowFontScaling={false}
          style={{
            fontSize: size * (initial.length > 1 ? 0.36 : 0.42),
            fontWeight: '600',
            ...(tinted ? { color: '#FFFFFF' } : {}),
          }}
          testID={testIdWithKey('ContactPhotoInitial')}
        >
          {initial}
        </ThemedText>
      ) : (
        <Icon name="account-outline" size={size * 0.55} color={ColorPalette.grayscale.mediumGrey} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
})

export default ContactPhoto
