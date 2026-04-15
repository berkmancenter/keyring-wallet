import { StackScreenProps } from '@react-navigation/stack'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LockoutReason, useAuth } from '../contexts/auth'
import {
  Animated,
  SectionList,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native'
import { getBuildNumber, getVersion } from 'react-native-device-info'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'

import IconButton, { ButtonLocation } from '../components/buttons/IconButton'
import { ThemedText } from '../components/texts/ThemedText'
import { TOKENS, useServices } from '../container-api'
import { AutoLockTime } from '../contexts/activity'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { useDeveloperMode } from '../hooks/developer-mode'
import { Locales, storeLanguage } from '../localization'
import { GenericFn } from '../types/fn'
import { Screens, SettingStackParams, Stacks } from '../types/navigators'
import { SettingIcon, SettingSection } from '../types/settings'
import { testIdWithKey } from '../utils/testable'

type SettingsProps = StackScreenProps<SettingStackParams>

const Settings: React.FC<SettingsProps> = ({ navigation }) => {
  const { t, i18n } = useTranslation()
  const [store, dispatch] = useStore()
  const { lockOutUser } = useAuth()
  const onDevModeTriggered = () => {
    Vibration.vibrate()
    navigation.navigate(Screens.Developer)
  }
  const { incrementDeveloperMenuCounter } = useDeveloperMode(onDevModeTriggered)
  const { SettingsTheme, TextTheme, ColorPalette, Assets, maxFontSizeMultiplier } = useTheme()
  const [
    { settings, enableTours, /* enablePushNotifications, */ disableContactsInSettings, supportedLanguages },
    historyEnabled,
  ] = useServices([TOKENS.CONFIG, TOKENS.HISTORY_ENABLED])
  const [expandedDropdown, setExpandedDropdown] = useState<'language' | 'autolock' | null>(null)
  const { fontScale } = useWindowDimensions()
  const fontIsGreaterThanCap = fontScale >= maxFontSizeMultiplier
  const defaultIconSize = 24
  const styles = StyleSheet.create({
    container: {
      backgroundColor: ColorPalette.brand.primaryBackground,
      width: '100%',
    },
    section: {
      backgroundColor: SettingsTheme.groupBackground,
      paddingVertical: 24,
      flexGrow: 1,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 0,
      marginBottom: -11,
      paddingHorizontal: 25,
    },
    sectionSeparator: {
      marginBottom: 10,
    },
    sectionRow: {
      flexDirection: fontIsGreaterThanCap ? 'column' : 'row',
      alignItems: fontIsGreaterThanCap ? 'flex-start' : 'center',
      justifyContent: 'space-between',
      flexGrow: 1,
      paddingHorizontal: 25,
    },
    itemSeparator: {
      borderBottomWidth: 1,
      borderBottomColor: ColorPalette.brand.primaryBackground,
      marginHorizontal: 25,
    },
    footer: {
      marginVertical: 25,
      alignItems: 'center',
    },
  })

  const currentLanguage = i18n.t('Language.code', { context: i18n.language as Locales })

  const settingsSections: SettingSection[] = [
    // DISABLED: Notifications section — no server backend yet
    // {
    //   header: {
    //     icon: { name: 'notifications' },
    //     title: t('Screens.Notifications'),
    //   },
    //   data: [
    //     {
    //       title: t('Screens.Notifications'),
    //       accessibilityLabel: t('Screens.Notifications'),
    //       testID: testIdWithKey('Notifications'),
    //       onPress: () => navigation.getParent()?.navigate(Stacks.NotificationStack, { screen: Screens.Home }),
    //       badge: notifications.length || undefined,
    //     },
    //   ],
    // },
    {
      header: {
        icon: { name: 'settings' },
        title: t('Settings.AppSettings'),
      },
      data: [
        {
          title: t('Global.Biometrics'),
          subtitle: t('Settings.BiometricUnlockSubtitle'),
          accessibilityLabel: t('Global.Biometrics'),
          testID: testIdWithKey('Biometrics'),
          toggle: {
            value: store.preferences.useBiometry,
            onValueChange: () => navigation.navigate(Screens.ToggleBiometry),
            activeColor: '#A349A4',
          },
        },
        {
          title: t('Settings.HardwareAttestation'),
          subtitle: t('Settings.SecureExchangesSubtitle'),
          accessibilityLabel: t('Settings.ToggleHardwareAttestation'),
          testID: testIdWithKey('HardwareAttestation'),
          toggle: {
            value: store.preferences.useHardwareAttestation,
            onValueChange: () => navigation.navigate(Screens.ToggleHardwareAttestation),
            activeColor: '#A349A4',
          },
        },
        // TODO: Re-add witness toggle — users manage witnessing from the witness connection screen icon section
        // {
        //   title: t('Settings.Witnessing'),
        //   subtitle: t('Settings.WitnessingSubtitle'),
        //   accessibilityLabel: t('Settings.ToggleWitnessing'),
        //   testID: testIdWithKey('Witnessing'),
        //   toggle: {
        //     value: store.preferences.useWitnessing ?? true,
        //     onValueChange: () => {
        //       dispatch({
        //         type: DispatchAction.USE_WITNESSING,
        //         payload: [!(store.preferences.useWitnessing ?? true)],
        //       })
        //     },
        //     activeColor: '#A349A4',
        //   },
        // },
        {
          title: t('Settings.WitnessReporting'),
          subtitle: t('Settings.ReportingSubtitle'),
          accessibilityLabel: t('Settings.ToggleWitnessReporting'),
          testID: testIdWithKey('WitnessReporting'),
          toggle: {
            value: store.witness.enableReporting,
            onValueChange: () => navigation.navigate(Screens.ToggleWitnessReporting),
            activeColor: '#A349A4',
          },
        },
        {
          title: t('Settings.ChangePin'),
          value: undefined,
          accessibilityLabel: t('Settings.ChangePin'),
          testID: testIdWithKey('Change Pin'),
          onPress: () => navigation.navigate(Screens.ChangePIN),
        },
        {
          title: t('Settings.Language'),
          value: currentLanguage,
          accessibilityLabel: t('Settings.Language'),
          testID: testIdWithKey('Language'),
          onPress: () => setExpandedDropdown(expandedDropdown === 'language' ? null : 'language'),
        },
        {
          title: t('Settings.AutoLockTime'),
          value:
            store.preferences.autoLockTime !== AutoLockTime.Never ? `${store.preferences.autoLockTime} min` : 'Never',
          accessibilityLabel: t('Settings.AutoLockTime'),
          testID: testIdWithKey('Lockout'),
          onPress: () => setExpandedDropdown(expandedDropdown === 'autolock' ? null : 'autolock'),
        },
      ],
    },
    ...(settings || []),
  ]

  // Remove the Contact section from Setting per TOKENS.CONFIG
  if (disableContactsInSettings) {
    settingsSections.shift()
  }

  // DISABLED: Push notifications toggle in settings — no server backend yet
  // if (enablePushNotifications) {
  //   settingsSections
  //     .find((item) => item.header.title === t('Settings.AppSettings'))
  //     ?.data.push({
  //       title: t('Settings.Notifications'),
  //       value: undefined,
  //       accessibilityLabel: t('Settings.Notifications'),
  //       testID: testIdWithKey('Notifications'),
  //       onPress: () => navigation.navigate(Screens.TogglePushNotifications),
  //     })
  // }

  // add optional history menu to settings
  if (historyEnabled) {
    settingsSections
      .find((item) => item.header.title === t('Settings.AppSettings'))
      ?.data.push({
        title: t('Global.History'),
        value: undefined,
        accessibilityLabel: t('Global.History'),
        testID: testIdWithKey('History'),
        onPress: () => navigation.navigate(Screens.HistorySettings),
      })
  }

  if (enableTours) {
    const section = settingsSections.find((item) => item.header.title === t('Settings.AppSettings'))
    if (section) {
      section.data = [
        ...section.data,
        {
          title: t('Settings.AppGuides'),
          accessibilityLabel: t('Settings.AppGuides'),
          testID: testIdWithKey('AppGuides'),
          toggle: {
            value: store.tours.enableTours,
            onValueChange: () => {
              dispatch({
                type: DispatchAction.ENABLE_TOURS,
                payload: [!store.tours.enableTours],
              })
            },
            activeColor: '#A349A4',
          },
        },
      ]
    }
  }

  if (store.preferences.developerModeEnabled) {
    const section = settingsSections.find((item) => item.header.title === t('Settings.AppSettings'))
    if (section) {
      section.data = [
        ...section.data,
        {
          title: t('Settings.Developer'),
          accessibilityLabel: t('Settings.Developer'),
          testID: testIdWithKey('DeveloperOptions'),
          onPress: () => navigation.navigate(Screens.Developer),
        },
        {
          title: t('Settings.ConfigureMediator'),
          value: store.preferences.selectedMediator,
          accessibilityLabel: t('Settings.ConfigureMediator'),
          testID: testIdWithKey('ConfigureMediator'),
          onPress: () => navigation.navigate(Screens.ConfigureMediator),
        },
        {
          title: t('Settings.Logout'),
          accessibilityLabel: t('Settings.Logout'),
          testID: testIdWithKey('Logout'),
          onPress: () => lockOutUser(LockoutReason.Logout),
        },
      ]
    }
  }

  if (store.preferences.useVerifierCapability) {
    settingsSections.splice(1, 0, {
      header: {
        icon: { name: 'send' },
        title: t('Screens.ProofRequests'),
      },
      data: [
        {
          title: t('Screens.SendProofRequest'),
          accessibilityLabel: t('Screens.ProofRequests'),
          testID: testIdWithKey('ProofRequests'),
          onPress: () =>
            navigation.getParent()?.navigate(Stacks.ProofRequestsStack, {
              screen: Screens.ProofRequests,
            }),
        },
      ],
    })
    if (!store.preferences.disableDataRetentionOption) {
      const section = settingsSections.find((item) => item.header.title === t('Settings.AppSettings'))
      if (section) {
        section.data.splice(3, 0, {
          title: t('Settings.DataRetention'),
          value: store.preferences.useDataRetention ? t('Global.On') : t('Global.Off'),
          accessibilityLabel: t('Settings.DataRetention'),
          testID: testIdWithKey('DataRetention'),
          onPress: () => navigation.navigate(Screens.DataRetention),
        })
      }
    }
  }

  // Always add wallet backup section (not gated behind useVerifierCapability)
  settingsSections.push({
    header: {
      icon: { name: 'backup' },
      title: t('Settings.WalletBackup'),
    },
    data: [
      {
        title: t('Settings.ExportWallet'),
        accessibilityLabel: t('Settings.ExportWallet'),
        testID: testIdWithKey('ExportWallet'),
        onPress: () => navigation.navigate(Screens.ExportWallet),
      },
      {
        title: t('Settings.ImportWallet'),
        accessibilityLabel: t('Settings.ImportWallet'),
        testID: testIdWithKey('ImportWallet'),
        onPress: () => navigation.navigate(Screens.ImportWallet),
      },
    ],
  })

  if (store.preferences.useConnectionInviterCapability) {
    const section = settingsSections.find((item) => item.header.title === store.preferences.walletName)
    if (section) {
      section.data.splice(1, 0, {
        title: t('Settings.ScanMyQR'),
        accessibilityLabel: t('Settings.ScanMyQR'),
        testID: testIdWithKey('ScanMyQR'),
        onPress: () =>
          navigation.getParent()?.navigate(Stacks.ConnectStack, {
            screen: Screens.Scan,
            params: { defaultToConnect: true },
          }),
      })
    }
  }

  const SectionHeader: React.FC<{
    icon: SettingIcon
    iconRight?: SettingIcon
    title: string
    titleTestID?: string
  }> = ({ icon, iconRight, title, titleTestID }) =>
    // gate keep behind developer mode
    store.preferences.useConnectionInviterCapability ? (
      <View style={[styles.section, styles.sectionHeader, { justifyContent: iconRight ? 'space-between' : undefined }]}>
        <View style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          <Icon
            importantForAccessibility={'no-hide-descendants'}
            accessible={false}
            name={icon.name}
            size={icon.size ?? defaultIconSize}
            style={[{ marginRight: 10, color: SettingsTheme.iconColor }, icon.style]}
          />
          <ThemedText
            variant="headingThree"
            testID={titleTestID}
            numberOfLines={1}
            accessibilityRole={'header'}
            style={{ flexShrink: 1 }}
          >
            {title}
          </ThemedText>
        </View>
        {iconRight && (
          <IconButton
            buttonLocation={ButtonLocation.Right}
            accessibilityLabel={iconRight.accessibilityLabel!}
            testID={iconRight.testID!}
            onPress={iconRight.action!}
            icon={'pencil'}
            iconTintColor={TextTheme.headingThree.color}
          />
        )}
      </View>
    ) : (
      <View style={[styles.section, styles.sectionHeader]}>
        <Icon
          importantForAccessibility={'no-hide-descendants'}
          accessible={false}
          name={icon.name}
          size={24}
          style={{ marginRight: 10, color: SettingsTheme.iconColor }}
        />
        <ThemedText
          maxFontSizeMultiplier={1.8}
          variant="headingThree"
          accessibilityRole={'header'}
          style={{ flexShrink: 1 }}
        >
          {title}
        </ThemedText>
      </View>
    )

  // TODO: Custom GradientToggle replaces native Switch to match Figma design.
  // If toggle still appears as native Switch, clear Metro cache and reload app.
  const GradientToggle: React.FC<{
    value: boolean
    onValueChange: (v: boolean) => void
    testID?: string
  }> = ({ value, onValueChange, testID }) => {
    const animVal = React.useRef(new Animated.Value(value ? 1 : 0)).current

    React.useEffect(() => {
      Animated.timing(animVal, {
        toValue: value ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }).start()
    }, [value, animVal])

    const TRACK_W = 52
    const TRACK_H = 28
    const THUMB_SIZE = 20
    const TRACK_PADDING = 4

    const thumbTranslateX = animVal.interpolate({
      inputRange: [0, 1],
      outputRange: [TRACK_PADDING, TRACK_W - THUMB_SIZE - TRACK_PADDING],
    })

    const trackBg = animVal.interpolate({
      inputRange: [0, 1],
      outputRange: ['#AAAAAA', '#622C62'],
    })

    return (
      <TouchableOpacity
        testID={testID}
        activeOpacity={0.8}
        onPress={() => onValueChange(!value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      >
        <Animated.View
          style={{
            width: TRACK_W,
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            backgroundColor: trackBg,
            justifyContent: 'center',
          }}
        >
          <Animated.View
            style={{
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: '#FFFFFF',
              transform: [{ translateX: thumbTranslateX }],
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.22,
              shadowRadius: 2.22,
              elevation: 3,
            }}
          />
        </Animated.View>
      </TouchableOpacity>
    )
  }

  const SectionRow: React.FC<{
    title: string
    subtitle?: string
    value?: string
    accessibilityLabel?: string
    testID?: string
    onPress?: GenericFn
    badge?: number
    toggle?: { value: boolean; onValueChange: (v: boolean) => void; activeColor?: string }
    expanded?: boolean
  }> = ({ title, subtitle, value, accessibilityLabel, testID, onPress, badge, toggle, expanded }) => (
    <View style={styles.section}>
      <TouchableOpacity
        accessible={true}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={toggle ? 'switch' : 'button'}
        testID={testID}
        style={styles.sectionRow}
        onPress={toggle ? undefined : onPress}
        activeOpacity={toggle ? 1 : 0.2}
      >
        <View style={{ flexShrink: 1, flex: 1, marginRight: 14 }}>
          <ThemedText
            style={[TextTheme.settingsText, { maxWidth: fontIsGreaterThanCap ? '95%' : '100%' }]}
          >
            {title}
          </ThemedText>
          {subtitle && (
            <ThemedText
              style={{
                fontSize: 12,
                color: ColorPalette.grayscale.mediumGrey,
                marginTop: 2,
              }}
              numberOfLines={2}
            >
              {subtitle}
            </ThemedText>
          )}
        </View>
        {badge && badge > 0 && (
          <View
            style={{
              backgroundColor: ColorPalette.semantic.error,
              borderRadius: 10,
              minWidth: 20,
              height: 20,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: 8,
            }}
          >
            <ThemedText style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>
              {badge > 99 ? '99+' : badge.toString()}
            </ThemedText>
          </View>
        )}
        {toggle ? (
          <GradientToggle
            testID={testID ? `${testID}-toggle` : undefined}
            value={toggle.value}
            onValueChange={toggle.onValueChange}
          />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {value !== undefined && (
              <ThemedText style={[TextTheme.settingsText, { color: ColorPalette.brand.link }]}>{value}</ThemedText>
            )}
            {onPress && (
              <Icon
                name={expanded !== undefined ? (expanded ? 'expand-less' : 'expand-more') : 'chevron-right'}
                size={24}
                color={ColorPalette.grayscale.mediumGrey}
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
        )}
      </TouchableOpacity>
    </View>
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <SectionList
        renderItem={({ item: { title, subtitle, value, accessibilityLabel, testID, onPress, badge, toggle } }) => {
          const isLanguageRow = testID === testIdWithKey('Language')
          const isAutoLockRow = testID === testIdWithKey('Lockout')
          const isDropdownRow = isLanguageRow || isAutoLockRow
          const isExpanded = (isLanguageRow && expandedDropdown === 'language') ||
                             (isAutoLockRow && expandedDropdown === 'autolock')

          return (
            <View>
              <SectionRow
                title={title}
                subtitle={subtitle}
                accessibilityLabel={accessibilityLabel}
                testID={testID ?? 'NoTestIdFound'}
                value={value}
                onPress={onPress}
                badge={badge}
                toggle={toggle}
                expanded={isDropdownRow ? isExpanded : undefined}
              />
              {isLanguageRow && expandedDropdown === 'language' && (
                <View style={{ backgroundColor: SettingsTheme.groupBackground, paddingHorizontal: 25 }}>
                  {(supportedLanguages ?? []).map((lang: Locales) => {
                    const langLabel = i18n.t('Language.code', { context: lang })
                    const isSelected = lang === i18n.language
                    return (
                      <TouchableOpacity
                        key={lang}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingVertical: 12,
                          paddingHorizontal: 8,
                          borderTopWidth: 1,
                          borderTopColor: ColorPalette.brand.primaryBackground,
                        }}
                        onPress={async () => {
                          await i18n.changeLanguage(lang)
                          await storeLanguage(lang)
                          setExpandedDropdown(null)
                        }}
                      >
                        <ThemedText style={[TextTheme.settingsText, isSelected && { fontWeight: '700' }]}>
                          {langLabel}
                        </ThemedText>
                        {isSelected && (
                          <Icon name="check" size={20} color={ColorPalette.brand.primary} />
                        )}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}
              {isAutoLockRow && expandedDropdown === 'autolock' && (
                <View style={{ backgroundColor: SettingsTheme.groupBackground, paddingHorizontal: 25 }}>
                  {[
                    { label: t('AutoLockTimes.OneHour'), value: AutoLockTime.OneHour },
                    { label: t('AutoLockTimes.FiveMinutes'), value: AutoLockTime.FiveMinutes },
                    { label: t('AutoLockTimes.ThreeMinutes'), value: AutoLockTime.ThreeMinutes },
                    { label: t('AutoLockTimes.OneMinute'), value: AutoLockTime.OneMinute },
                    { label: t('AutoLockTimes.Never'), value: AutoLockTime.Never },
                  ].map((option) => {
                    const isSelected = (store.preferences.autoLockTime ?? AutoLockTime.FiveMinutes) === option.value
                    return (
                      <TouchableOpacity
                        key={String(option.value)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingVertical: 12,
                          paddingHorizontal: 8,
                          borderTopWidth: 1,
                          borderTopColor: ColorPalette.brand.primaryBackground,
                        }}
                        onPress={() => {
                          dispatch({
                            type: DispatchAction.AUTO_LOCK_TIME,
                            payload: [option.value],
                          })
                          setExpandedDropdown(null)
                        }}
                      >
                        <ThemedText style={[TextTheme.settingsText, isSelected && { fontWeight: '700' }]}>
                          {option.label}
                        </ThemedText>
                        {isSelected && (
                          <Icon name="check" size={20} color={ColorPalette.brand.primary} />
                        )}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}
            </View>
          )
        }}
        renderSectionHeader={({
          section: {
            header: { title, icon, iconRight, titleTestID },
          },
        }) => <SectionHeader icon={icon} iconRight={iconRight} title={title} titleTestID={titleTestID} />}
        ItemSeparatorComponent={() => (
          <View style={{ backgroundColor: SettingsTheme.groupBackground }}>
            <View style={styles.itemSeparator}></View>
          </View>
        )}
        SectionSeparatorComponent={() => <View style={styles.sectionSeparator}></View>}
        ListFooterComponent={() => (
          <View style={styles.footer}>
            <TouchableWithoutFeedback
              onPress={incrementDeveloperMenuCounter}
              disabled={store.preferences.developerModeEnabled}
            >
              <View>
                <ThemedText testID={testIdWithKey('Version')}>
                  {`${t('Settings.Version')} ${getVersion()} ${t('Settings.Build')} (${getBuildNumber()})`}
                </ThemedText>
                <Assets.svg.logo style={{ alignSelf: 'center' }} width={150} height={75} />
              </View>
            </TouchableWithoutFeedback>
          </View>
        )}
        sections={settingsSections}
        stickySectionHeadersEnabled={false}
      ></SectionList>
    </SafeAreaView>
  )
}

export default Settings