import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Image, StyleSheet, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StackScreenProps } from '@react-navigation/stack'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import PopupModal from '../../../components/modals/PopupModal'
import { InfoBoxType } from '../../../components/misc/InfoBox'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens, SettingStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { useRCardCredential } from '../hooks/useRCardCredential'
import { formInputFromTemplate, RCardTemplate } from '../types/rcard'

type MyProfilesProps = StackScreenProps<SettingStackParams, Screens.MyProfiles>

const MyProfiles: React.FC<MyProfilesProps> = ({ navigation }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { profiles, activeProfileId, setActive, remove } = useRCardCredential()
  const [blockedDeleteReason, setBlockedDeleteReason] = useState<'LastProfile' | 'ActiveProfile' | undefined>(
    undefined
  )

  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 20,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginRight: 12,
    },
    avatarImage: {
      width: 48,
      height: 48,
    },
    rowText: {
      flex: 1,
      flexShrink: 1,
      overflow: 'hidden',
      marginRight: 8,
    },
    setActiveButton: {
      flexShrink: 0,
      marginRight: 12,
    },
    itemSeparator: {
      borderBottomWidth: 1,
      borderBottomColor: ColorPalette.brand.primaryBackground,
      marginHorizontal: 20,
    },
    footer: {
      padding: 20,
    },
  })

  const handleDelete = async (profileId: string) => {
    const result = await remove(profileId)
    if (!result.ok && result.reason !== 'NoAgent') {
      setBlockedDeleteReason(result.reason)
    }
  }

  const renderProfile = ({ item: profile }: { item: RCardTemplate }) => {
    const { firstName, lastName, photo } = formInputFromTemplate(profile)
    const name = [firstName, lastName].filter(Boolean).join(' ')
    const isActive = profile.id === activeProfileId

    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', flex: 1, flexShrink: 1, minWidth: 0 }}
          onPress={() => navigation.navigate(Screens.EditRCard, { profileId: profile.id })}
          accessibilityRole="button"
          accessibilityLabel={profile.label}
          testID={testIdWithKey(`MyProfilesRow-${profile.id}`)}
        >
          <View style={styles.avatar}>
            {photo ? (
              <Image style={styles.avatarImage} source={{ uri: photo }} />
            ) : (
              <Icon name="account-outline" size={28} color={ColorPalette.grayscale.mediumGrey} />
            )}
          </View>
          <View style={styles.rowText}>
            <ThemedText variant="headingThree" numberOfLines={1}>
              {profile.label}
            </ThemedText>
            <ThemedText numberOfLines={1} style={{ color: ColorPalette.grayscale.mediumGrey }}>
              {name}
            </ThemedText>
            {isActive && (
              <ThemedText style={{ color: ColorPalette.brand.link }}>{t('MyProfiles.Active')}</ThemedText>
            )}
          </View>
        </TouchableOpacity>
        {!isActive && (
          <TouchableOpacity
            onPress={() => setActive(profile.id)}
            accessibilityRole="button"
            accessibilityLabel={t('MyProfiles.SetActive')}
            testID={testIdWithKey(`SetActiveProfile-${profile.id}`)}
            style={styles.setActiveButton}
          >
            <ThemedText style={{ color: ColorPalette.brand.link }}>{t('MyProfiles.SetActive')}</ThemedText>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => handleDelete(profile.id)}
          accessibilityRole="button"
          accessibilityLabel={t('MyProfiles.Delete')}
          testID={testIdWithKey(`DeleteProfile-${profile.id}`)}
        >
          <Icon name="trash-can-outline" size={22} color={ColorPalette.grayscale.mediumGrey} />
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <FlatList
        data={profiles}
        keyExtractor={(profile) => profile.id}
        renderItem={renderProfile}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
        ListFooterComponent={() => (
          <View style={styles.footer}>
            <Button
              title={t('MyProfiles.AddProfile')}
              buttonType={ButtonType.Secondary}
              accessibilityLabel={t('MyProfiles.AddProfile')}
              testID={testIdWithKey('AddProfile')}
              onPress={() => navigation.navigate(Screens.EditRCard, undefined)}
            />
          </View>
        )}
      />
      {blockedDeleteReason && (
        <PopupModal
          title={t(
            blockedDeleteReason === 'LastProfile'
              ? 'MyProfiles.DeleteLastProfileTitle'
              : 'MyProfiles.DeleteActiveProfileTitle'
          )}
          description={t(
            blockedDeleteReason === 'LastProfile'
              ? 'MyProfiles.DeleteLastProfileDescription'
              : 'MyProfiles.DeleteActiveProfileDescription'
          )}
          notificationType={InfoBoxType.Info}
          onCallToActionLabel={t('Global.Okay')}
          onCallToActionPressed={() => setBlockedDeleteReason(undefined)}
        />
      )}
    </SafeAreaView>
  )
}

export default MyProfiles
