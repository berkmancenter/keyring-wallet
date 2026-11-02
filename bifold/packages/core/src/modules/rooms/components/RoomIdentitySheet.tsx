/**
 * Who someone is in a room, opened from their name: the name when one is known, where it comes from, the identity
 * they act as here with Copy, and for the member themselves, their profile. The raw identifier lives only here,
 * never as a label: the room's words for a person are a name, "You", or "Member …saddle".
 *
 * The member's own name is their Keyring profile's, shown on this phone only: the sheet says that the room's
 * members see the identity, not the name. Another member can be given a name of the member's own ("Name them"), kept
 * on this phone and always shown as theirs; a name can be given or changed here, not left blank.
 *
 * @module rooms/components/RoomIdentitySheet
 */
import Clipboard from '@react-native-clipboard/clipboard'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { initialsOf } from '../../../utils/initials'
import { testIdWithKey } from '../../../utils/testable'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import type { Identity } from '../types'
import { PETNAME_MAX } from '../petnames'
import type { MyName } from '../useMyName'
import { usePetname } from '../usePetname'

import { useDirectoryName } from './memberWords'
import { memberText } from './roomWords'

/** Up to two letters for a name's circle; "?" when there is no name. */
export { initialsOf }

export interface RoomIdentitySheetProps {
  /** Whose sheet; none closes it. */
  identity?: Identity
  /** The room's community: another member's name of the member's own is kept for it. None offers no naming. */
  communityDid?: string
  /** Whether it is the member's own identity in this room. */
  mine: boolean
  me: MyName
  onClose: () => void
  /** Opens the member's profile to see or edit it, or to add a name when it has none. */
  onOpenProfile: (profileId?: string) => void
  /**
   * Opens another member's card in the community's directory, for one who shows their identity to members; `standIn`
   * is what the room calls them. Without it, the sheet offers no card.
   */
  onViewCard?: (did: string, standIn: string) => void
}

export const RoomIdentitySheet: React.FC<RoomIdentitySheetProps> = ({
  identity,
  communityDid,
  mine,
  me,
  onClose,
  onOpenProfile,
  onViewCard,
}) => (
  <SafeAreaModal visible={!!identity} transparent animationType="slide" onRequestClose={onClose}>
    {identity ? (
      <SheetBody
        identity={identity}
        communityDid={communityDid}
        mine={mine}
        me={me}
        onClose={onClose}
        onOpenProfile={onOpenProfile}
        onViewCard={onViewCard}
      />
    ) : null}
  </SafeAreaModal>
)

const SheetBody: React.FC<Omit<RoomIdentitySheetProps, 'identity'> & { identity: Identity }> = ({
  identity,
  communityDid,
  mine,
  me,
  onClose,
  onOpenProfile,
  onViewCard,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const [copied, setCopied] = useState(false)
  // Another member's name of the member's own: given or changed here, never left blank.
  const naming = !mine && !!communityDid
  const petname = usePetname(naming ? communityDid : undefined, naming ? identity.did : undefined)
  const theirOwn = useDirectoryName(mine ? undefined : identity.did)
  const [draft, setDraft] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const name = mine ? me.name : (petname.name ?? theirOwn ?? identity.identityWords)
  const title = mine ? (me.name ?? (t('Rooms.You') as string)) : (petname.name ?? theirOwn ?? memberText(t, identity))
  const source = mine
    ? me.name
      ? t('Rooms.NameFromProfile')
      : t('Rooms.NameNotSet')
    : petname.name
      ? t('Rooms.PetnameSource')
      : theirOwn
        ? t('Rooms.NameTheirOwn', {
            community: communityDid ? communityLabelOf(communityDid, t) : '',
            interpolation: { escapeValue: false },
          })
        : identity.identityWords
          ? t('Rooms.NameFromCommunity')
          : t('Rooms.NameNotKnown')
  const canSave = !!draft?.trim() && !saving
  const save = async () => {
    if (!draft?.trim()) return
    setSaving(true)
    setSaveFailed(false)
    try {
      await petname.set(draft)
      setDraft(undefined)
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }
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
    input: {
      ...TextTheme.normal,
      borderWidth: 1,
      borderRadius: 8,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    error: { color: ColorPalette.semantic.error },
  })
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
            {!mine && (petname.name || theirOwn) ? (
              <ThemedText style={styles.muted} testID={testIdWithKey('RoomIdentityStandIn')}>
                {memberText(t, identity)}
              </ThemedText>
            ) : null}
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomIdentitySource')}>
              {source}
            </ThemedText>
            {/* Their card is reachable only where they show their identity to members; most members don't. */}
            {!mine && communityDid && !theirOwn ? (
              <ThemedText variant="caption" style={styles.muted} testID={testIdWithKey('RoomIdentityNoCard')}>
                {t('Directory.NoCardToShow', {
                  member: title,
                  community: communityLabelOf(communityDid, t),
                  interpolation: { escapeValue: false },
                })}
              </ThemedText>
            ) : null}
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
        {!mine && theirOwn && onViewCard ? (
          <Button
            title={t('Directory.ViewCard')}
            buttonType={ButtonType.Secondary}
            onPress={() => onViewCard(identity.did, memberText(t, identity))}
            testID={testIdWithKey('RoomIdentityViewCard')}
          />
        ) : null}
        {naming && petname.loaded ? (
          draft === undefined ? (
            <Button
              title={petname.name ? t('Rooms.Rename') : t('Rooms.NameThem')}
              buttonType={ButtonType.Secondary}
              onPress={() => setDraft(petname.name ?? '')}
              testID={testIdWithKey(petname.name ? 'RoomIdentityRename' : 'RoomIdentityNameThem')}
            />
          ) : (
            <View style={{ gap: 10 }}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                maxLength={PETNAME_MAX}
                autoFocus
                placeholder={t('Rooms.PetnamePlaceholder') as string}
                placeholderTextColor={ColorPalette.grayscale.mediumGrey}
                accessibilityLabel={t('Rooms.NameThem') as string}
                returnKeyType="done"
                onSubmitEditing={canSave ? save : undefined}
                testID={testIdWithKey('RoomIdentityNameInput')}
              />
              {saveFailed ? (
                <ThemedText style={styles.error} accessibilityLiveRegion="polite">
                  {t('Rooms.PetnameSaveFailed')}
                </ThemedText>
              ) : null}
              <Button
                title={t('Global.Save')}
                buttonType={ButtonType.Primary}
                onPress={save}
                disabled={!canSave}
                testID={testIdWithKey('RoomIdentityNameSave')}
              />
              <Button
                title={t('Global.Cancel')}
                buttonType={ButtonType.Secondary}
                onPress={() => setDraft(undefined)}
                testID={testIdWithKey('RoomIdentityNameCancel')}
              />
            </View>
          )
        ) : null}
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
    </KeyboardAvoidingView>
  )
}

export default RoomIdentitySheet
