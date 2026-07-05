import { useAgent } from '@credo-ts/react-hooks'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, useWindowDimensions, View, StyleSheet, DeviceEventEmitter } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { AttachTourStep } from '../components/tour/AttachTourStep'
import { EventTypes } from '../constants'
import { TOKENS, useServices } from '../container-api'
import { useNetwork } from '../contexts/network'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { BifoldError } from '../types/error'
import { TabStackParams, TabStacks } from '../types/navigators'
import { connectFromScanOrDeepLink } from '../utils/helpers'
import { testIdWithKey } from '../utils/testable'

import { useUnreadMessages } from '../hooks/useUnreadMessages'
import InAppMessageNotifier from '../components/InAppMessageNotifier'
import ContactStack from './ContactStack'
import CredentialStack from './CredentialStack'
import MessageStack from './MessageStack'
import SettingStack from './SettingStack'
import { BaseTourID } from '../types/tour'
import QRCodeExchangeSlider from '../modules/vrc/components/QRCodeExchangeSlider'

const TabStack: React.FC = () => {
  const [{ enableImplicitInvitations, enableReuseConnections }, logger] = useServices([
    TOKENS.CONFIG,
    TOKENS.UTIL_LOGGER,
  ])
  const { t } = useTranslation()
  const Tab = createBottomTabNavigator<TabStackParams>()
  const { assertNetworkConnected } = useNetwork()
  const { TabTheme, TextTheme, Assets, NavigationTheme, GradientTheme } = useTheme()
  const [store, dispatch] = useStore()
  const { agent } = useAgent()
  const navigation = useNavigation<StackNavigationProp<TabStackParams>>()
  const { fontScale } = useWindowDimensions()
  const showLabels = fontScale * TabTheme.tabBarTextStyle.fontSize < 18
  const [showQRCodeBottomSheet, setShowQRCodeBottomSheet] = React.useState(false)
  const { totalUnread } = useUnreadMessages()
  const styles = StyleSheet.create({
    tabBarIcon: {
      flex: 1,
    },
  })

  const handleDeepLink = useCallback(
    async (deepLink: string) => {
      logger.info(`Handling deeplink: ${deepLink}`)

      // If it's just the general link with no params, set link inactive and do nothing
      if (deepLink.search(/oob=|c_i=|d_m=|url=/) < 0) {
        dispatch({
          type: DispatchAction.ACTIVE_DEEP_LINK,
          payload: [undefined],
        })
        return
      }

      try {
        await connectFromScanOrDeepLink(
          deepLink,
          agent,
          logger,
          navigation,
          true, // isDeepLink
          enableImplicitInvitations,
          enableReuseConnections
        )
      } catch (err: unknown) {
        const error = new BifoldError(
          t('Error.Title1039'),
          t('Error.Message1039'),
          (err as Error)?.message ?? err,
          1039
        )
        DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
      } finally {
        dispatch({
          type: DispatchAction.ACTIVE_DEEP_LINK,
          payload: [undefined],
        })
      }
    },
    [agent, enableImplicitInvitations, enableReuseConnections, logger, navigation, t, dispatch]
  )

  useEffect(() => {
    if (store.deepLink && agent && store.authentication.didAuthenticate) {
      handleDeepLink(store.deepLink)
    }
  }, [store.deepLink, agent, store.authentication.didAuthenticate, handleDeepLink])

  const GradientBg = GradientTheme?.HeaderBackground

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: GradientBg ? 'transparent' : NavigationTheme.colors.primary }} edges={['left', 'right', 'top']}>
      {GradientBg && <GradientBg style={StyleSheet.absoluteFillObject} />}
      <Tab.Navigator
        initialRouteName={TabStacks.ContactStack}
        screenOptions={{
          unmountOnBlur: true,
          tabBarStyle: {
            ...TabTheme.tabBarStyle,
          },
          tabBarActiveTintColor: TabTheme.tabBarActiveTintColor,
          tabBarInactiveTintColor: TabTheme.tabBarInactiveTintColor,
          header: () => null,
        }}
      >
        <Tab.Screen
          name={TabStacks.ContactStack}
          component={ContactStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <View style={{ ...TabTheme.tabBarContainerStyle, justifyContent: showLabels ? 'flex-end' : 'center' }}>
                {focused ? (
                  <Assets.svg.contactsIconFocused height={20} width={20} fill={color} />
                ) : (
                  <Assets.svg.contactsIconOutline height={20} width={20} fill={color} />
                )}
                {showLabels && (
                  <Text
                    style={{
                      ...TabTheme.tabBarTextStyle,
                      color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                      fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                    }}
                  >
                    {t('TabStack.Contacts')}
                  </Text>
                )}
              </View>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('TabStack.Contacts'),
            tabBarTestID: testIdWithKey('Contacts'),
          }}
        />
        <Tab.Screen
          name={TabStacks.MessageStack}
          component={MessageStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
            tabBarBadgeStyle: {
              backgroundColor: '#D21E30',
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: '600',
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              lineHeight: 17,
            },
            tabBarIcon: ({ color, focused }) => (
              <AttachTourStep tourID={BaseTourID.HomeTour} index={0}>
                <View style={{ ...TabTheme.tabBarContainerStyle, justifyContent: showLabels ? 'flex-end' : 'center' }}>
                  {focused ? (
                    <Assets.svg.tabFourFocusedIcon height={20} width={20} fill={color} />
                  ) : (
                    <Assets.svg.tabFourIcon height={20} width={20} fill={color} />
                  )}
                  {showLabels && (
                    <Text
                      style={{
                        ...TabTheme.tabBarTextStyle,
                        color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                        fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                      }}
                    >
                      {t('TabStack.Messages')}
                    </Text>
                  )}
                </View>
              </AttachTourStep>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: totalUnread > 0
              ? `${t('TabStack.Messages')}, ${totalUnread} unread`
              : t('TabStack.Messages'),
            tabBarTestID: testIdWithKey(t('TabStack.Messages')),
          }}
        />
        <Tab.Screen
          name={TabStacks.ConnectStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <AttachTourStep tourID={BaseTourID.HomeTour} index={2}>
                <View style={{ ...TabTheme.tabBarContainerStyle, justifyContent: showLabels ? 'flex-end' : 'center' }}>
                  <Assets.svg.tabTwoIcon height={20} width={20} fill={color} />
                  {showLabels && (
                    <Text
                      style={{
                        ...TabTheme.tabBarTextStyle,
                        color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                        fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                      }}
                    >
                      {t('TabStack.QRCode')}
                    </Text>
                  )}
                </View>
              </AttachTourStep>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('TabStack.QRCode'),
            tabBarTestID: testIdWithKey(t('TabStack.QRCode')),
          }}
          listeners={() => ({
            tabPress: (e) => {
              e.preventDefault()
              if (!assertNetworkConnected()) {
                return
              }
              setShowQRCodeBottomSheet(true)
            },
          })}
        >
          {() => <View />}
        </Tab.Screen>
        <Tab.Screen
          name={TabStacks.CredentialStack}
          component={CredentialStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <AttachTourStep tourID={BaseTourID.HomeTour} index={1}>
                <View style={{ ...TabTheme.tabBarContainerStyle, justifyContent: showLabels ? 'flex-end' : 'center' }}>
                  {focused ? (
                    <Assets.svg.tabThreeFocusedIcon height={20} width={20} fill={color} />
                  ) : (
                    <Assets.svg.tabThreeIcon height={20} width={20} fill={color} />
                  )}
                  {showLabels && (
                    <Text
                      style={{
                        ...TabTheme.tabBarTextStyle,
                        color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                        fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                      }}
                    >
                      {t('TabStack.Wallet')}
                    </Text>
                  )}
                </View>
              </AttachTourStep>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('TabStack.Wallet'),
            tabBarTestID: testIdWithKey(t('TabStack.Wallet')),
          }}
        />
        <Tab.Screen
          name={TabStacks.SettingStack}
          component={SettingStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <View style={{ ...TabTheme.tabBarContainerStyle, justifyContent: showLabels ? 'flex-end' : 'center' }}>
                {Assets.svg.tabMenuIcon ? (
                  <Assets.svg.tabMenuIcon height={26} width={26} fill={color} />
                ) : (
                  <Icon name="menu" size={26} color={color} />
                )}
                {showLabels && (
                  <Text
                    style={{
                      ...TabTheme.tabBarTextStyle,
                      color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                      fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                    }}
                  >
                    {t('Screens.Settings')}
                  </Text>
                )}
              </View>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('Screens.Settings'),
            tabBarTestID: testIdWithKey('Settings'),
          }}
        />
      </Tab.Navigator>
      <SafeAreaView style={{ backgroundColor: TabTheme.tabBarSecondaryBackgroundColor }} edges={['bottom']} />
      <QRCodeExchangeSlider
        visible={showQRCodeBottomSheet}
        onDismiss={() => setShowQRCodeBottomSheet(false)}
        navigation={navigation}
      />
      <InAppMessageNotifier />
    </SafeAreaView>
  )
}

export default TabStack
