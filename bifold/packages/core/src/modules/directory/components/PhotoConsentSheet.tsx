/**
 * What putting the profile photo on the member's card means, asked before anything is sent: the photo, who will see
 * it (a choice, bounded by the most the community allows for pictures), and three lines that stay right above Send:
 * who sees it now and, where the choice reaches further than who saw a photo here until now, who that was, that the community's host keeps its own smaller copy
 * without the photo's hidden details (`images/upload` re-encodes it, VTI-DIR-051), and that administrators always see
 * it. Send uploads it and puts it on the card; Not now closes the sheet and sends nothing.
 *
 * The sheet scrolls, and Send and Not now are its last lines: at any text size they are reached only past the words,
 * and nothing can scroll the words away while the buttons stay (the sign-in consent fix, bifold #880).
 *
 * Never offers "anyone": Keyring publishes no card outside the community, so a public picture would reach nobody more
 * and promise something it doesn't do.
 *
 * @module directory/components/PhotoConsentSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { DIRECTORY_AUDIENCES, type DirectoryAudience, type PhotoAudience } from '../types'

import { audienceText } from './directoryWords'

export interface PhotoConsentSheetProps {
  visible: boolean
  /** The community, as the screens name it. */
  community: string
  /** The profile photo that would go, as a `data:` URI. */
  photo: string
  /** Who may see it, as the community allows: members first where allowed. */
  choices: readonly PhotoAudience[]
  chosen: PhotoAudience
  /** Who sees a photo on this card now: the member's choice, else the community's default. Any audience: one set
   * elsewhere (the portal) may be groups or connections, narrower than all members. */
  current?: DirectoryAudience
  saving: boolean
  onChoose: (audience: PhotoAudience) => void
  onSend: () => void
  onClose: () => void
}

export const PhotoConsentSheet: React.FC<PhotoConsentSheetProps> = ({
  visible,
  community,
  photo,
  choices,
  chosen,
  current,
  saving,
  onChoose,
  onSend,
  onClose,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const opts = { community, interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
    sheet: {
      maxHeight: '92%',
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, gap: 12 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    photo: { width: 56, height: 56, borderRadius: 28 },
    title: { ...TextTheme.headingFour, fontSize: 22, color: ColorPalette.brand.text, flex: 1 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    choices: { borderRadius: 10, borderWidth: 1, borderColor: ColorPalette.grayscale.lightGrey },
    choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: ColorPalette.grayscale.lightGrey },
    // Wraps inside the row at large text, rather than running past the box's edge.
    choiceLabel: { flex: 1 },
  })
  const label = (audience: PhotoAudience) =>
    t(audience === 'members' ? 'Directory.PhotoAudienceMembers' : 'Directory.PhotoAudienceAdmins')
  // Widens by the audiences' order (admins … public), not by name: groups and connections are narrower than members.
  const widens = !!current && DIRECTORY_AUDIENCES.indexOf(chosen) > DIRECTORY_AUDIENCES.indexOf(current)
  const seen = [
    t(chosen === 'members' ? 'Directory.PhotoSeenByMembers' : 'Directory.PhotoSeenByAdmins', opts),
    widens && current ? t('Directory.PhotoWidens', { ...opts, who: audienceText(t, current, community) }) : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <SafeAreaModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={saving ? undefined : onClose}
        accessibilityRole="button"
        accessibilityLabel={t('Global.Close') as string}
        testID={testIdWithKey('PhotoConsentBackdrop')}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testIdWithKey('PhotoConsent')}>
        <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('PhotoConsentScroll')}>
          <View style={styles.head}>
            <Image source={{ uri: photo }} style={styles.photo} accessibilityIgnoresInvertColors />
            <ThemedText style={styles.title} accessibilityRole="header">
              {t('Directory.PhotoConsentTitle', opts)}
            </ThemedText>
          </View>
          <ThemedText variant="caption" style={styles.muted}>
            {t('Directory.PhotoWhoSees')}
          </ThemedText>
          <View style={styles.choices} accessibilityRole="radiogroup" testID={testIdWithKey('PhotoConsentChoices')}>
            {choices.map((audience, i) => (
              <React.Fragment key={audience}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  style={styles.choice}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: audience === chosen, disabled: saving }}
                  accessibilityLabel={label(audience)}
                  onPress={saving ? undefined : () => onChoose(audience)}
                  testID={testIdWithKey(`PhotoConsentChoice_${audience}`)}
                >
                  <Icon
                    name={audience === chosen ? 'radiobox-marked' : 'radiobox-blank'}
                    size={24}
                    color={audience === chosen ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
                  />
                  <ThemedText variant={audience === chosen ? 'bold' : 'normal'} style={styles.choiceLabel}>
                    {label(audience)}
                  </ThemedText>
                </Pressable>
              </React.Fragment>
            ))}
          </View>
          {choices.length === 1 && choices[0] === 'admins' ? (
            <ThemedText testID={testIdWithKey('PhotoConsentOnlyAdmins')}>
              {t('Directory.PhotoOnlyAdminsAllowed', opts)}
            </ThemedText>
          ) : null}
          <ThemedText testID={testIdWithKey('PhotoConsentSeen')}>{seen}</ThemedText>
          <ThemedText testID={testIdWithKey('PhotoConsentHostCopy')}>{t('Directory.PhotoHostCopy')}</ThemedText>
          <ThemedText testID={testIdWithKey('PhotoConsentAdmins')}>{t('Directory.PhotoAdminsAlways')}</ThemedText>
          <Button
            title={t('Directory.ConsentSend')}
            buttonType={ButtonType.Primary}
            onPress={onSend}
            disabled={saving}
            testID={testIdWithKey('PhotoConsentSend')}
          >
            {saving ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
          <Button
            title={t('Directory.ConsentNotNow')}
            buttonType={ButtonType.Secondary}
            onPress={onClose}
            disabled={saving}
            testID={testIdWithKey('PhotoConsentNotNow')}
          />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default PhotoConsentSheet
