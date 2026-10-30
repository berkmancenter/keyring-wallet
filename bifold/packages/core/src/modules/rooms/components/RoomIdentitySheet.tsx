/**
 * Who someone is in a room, opened from their name: the name when one is known, where it comes from, the identity
 * they act as here with Copy, and for the member themselves, their profile. The raw identifier lives only here,
 * never as a label: the room's words for a person are a name, "You", or "Member …saddle".
 *
 * The member's own name is their Keyring profile's, shown on this phone only: the sheet says that the room's
 * members see the identity, not the name. Another member's name is not known yet, so the sheet says that plainly.
 *
 * @module rooms/components/RoomIdentitySheet
 */
import Clipboard from '@react-native-clipboard/clipboard'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { Identity } from '../types'
import type { MyName } from '../useMyName'

import { memberText } from './roomWords'

/** Up to two letters for a name's circle; "?" when there is no name. */
export const initialsOf = (name?: string): string => {
  const letters = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
  return letters || '?'
}

export interface RoomIdentitySheetProps {
  /** Whose sheet; none closes it. */
  identity?: Identity
  /** Whether it is the member's own identity in this room. */
  mine: boolean
  me: MyName
  onClose: () => void
  /** Opens the member's profile to see or edit it, or to add a name when it has none. */
  onOpenProfile: (profileId?: string) => void
}

export const RoomIdentitySheet: React.FC<RoomIdentitySheetProps> = ({ identity, mine, me, onClose, onOpenProfile }) => (
  <SafeAreaModal visible={!!identity} transparent animationType="slide" onRequestClose={onClose}>
    {identity ? (
      <SheetBody identity={identity} mine={mine} me={me} onClose={onClose} onOpenProfile={onOpenProfile} />
    ) : null}
  </SafeAreaModal>
)

const SheetBody: React.FC<Omit<RoomIdentitySheetProps, 'identity'> & { identity: Identity }> = ({
  identity,
  mine,
  me,
  onClose,
  onOpenProfile,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const [copied, setCopied] = useState(false)
  const name = mine ? me.name : identity.identityWords
  const title = mine ? (me.name ?? (t('Rooms.You') as string)) : memberText(t, identity)
  const source = mine
    ? me.name
      ? t('Rooms.NameFromProfile')
      : t('Rooms.NameNotSet')
    : identity.identityWords
      ? t('Rooms.NameFromCommunity')
      : t('Rooms.NameNotKnown')
  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
    sheet: {
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 20,
      gap: 14,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    circle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: name ? ColorPalette.brand.primary : 'transparent',
      borderWidth: name ? 0 : 1.5,
      borderStyle: 'dashed',
      borderColor: ColorPalette.grayscale.mediumGrey,
    },
    initials: { color: name ? ColorPalette.grayscale.white : ColorPalette.grayscale.mediumGrey, fontSize: 20 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    idBox: { gap: 4, padding: 12, borderRadius: 10, backgroundColor: ColorPalette.brand.secondaryBackground },
    id: {
      ...TextTheme.normal,
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      fontSize: 13,
    },
    copy: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  })
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('Global.Close') as string}
        testID={testIdWithKey('RoomIdentityBackdrop')}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testIdWithKey('RoomIdentitySheet')}>
        <View style={styles.head}>
          <View style={styles.circle}>
            <ThemedText variant="bold" style={styles.initials}>
              {initialsOf(name)}
            </ThemedText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText variant="headingFour" accessibilityRole="header" testID={testIdWithKey('RoomIdentityName')}>
              {title}
            </ThemedText>
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomIdentitySource')}>
              {source}
            </ThemedText>
          </View>
        </View>
        <View style={styles.idBox}>
          <ThemedText variant="caption" style={styles.muted}>
            {t('Rooms.InThisRoomAs')}
          </ThemedText>
          <ThemedText style={styles.id} selectable testID={testIdWithKey('RoomIdentityDid')}>
            {identity.did}
          </ThemedText>
          <Pressable
            style={styles.copy}
            onPress={() => {
              Clipboard.setString(identity.did)
              setCopied(true)
            }}
            accessibilityRole="button"
            testID={testIdWithKey('RoomIdentityCopy')}
          >
            <Icon name={copied ? 'check' : 'content-copy'} size={18} color={ColorPalette.brand.primary} />
            <ThemedText variant="bold" style={{ color: ColorPalette.brand.primary }}>
              {copied ? t('Rooms.IdCopied') : t('Rooms.CopyId')}
            </ThemedText>
          </Pressable>
          {mine ? (
            <ThemedText variant="caption" style={styles.muted} testID={testIdWithKey('RoomIdentityOthersSee')}>
              {t('Rooms.OthersSeeId')}
            </ThemedText>
          ) : null}
        </View>
        {mine ? (
          <Button
            title={me.name ? t('Rooms.OpenProfile') : t('Rooms.AddYourName')}
            buttonType={ButtonType.Primary}
            onPress={() => {
              onClose()
              onOpenProfile(me.profileId)
            }}
            testID={testIdWithKey(me.name ? 'RoomIdentityOpenProfile' : 'RoomIdentityAddName')}
          />
        ) : null}
        <Button
          title={t('Global.Close')}
          buttonType={ButtonType.Secondary}
          onPress={onClose}
          testID={testIdWithKey('RoomIdentityClose')}
        />
      </SafeAreaView>
    </View>
  )
}

export default RoomIdentitySheet
