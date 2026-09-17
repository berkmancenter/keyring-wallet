import { useAgent } from '@bifold/react-hooks'
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
import { GenericRecordsCommunityStore } from '../modules/trust-tasks/module/VtiCommunityStore'
import { isVtiInvitationLink, parseVtiInvitationLink } from '../modules/trust-tasks/module/vtiInvitation'

import { useUnreadMessages } from '../hooks/useUnreadMessages'
import InAppMessageNotifier from '../components/InAppMessageNotifier'
import ContactStack from './ContactStack'
import CredentialStack from './CredentialStack'
import MessageStack from './MessageStack'
import MyAgentStack from './MyAgentStack'
import SettingStack from './SettingStack'
import { BaseTourID } from '../types/tour'
import QRCodeExchangeSlider from '../modules/vrc/components/QRCodeExchangeSlider'

const TabStack: React.FC = () => {
  const [{ enableImplicitInvitations, enableReuseConnections }, logger, GlobalListener] = useServices([
    TOKENS.CONFIG,
    TOKENS.UTIL_LOGGER,
    TOKENS.COMPONENT_APP_GLOBAL_LISTENER,
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

      // A community invitation (keyring://vti/invitation?c=…) is kept as a
      // pending invitation and shown on My Agent; it is not a DIDComm OOB link.
      if (isVtiInvitationLink(deepLink)) {
        try {
          if (agent) {
            const invitation = parseVtiInvitationLink(deepLink)
            await new GenericRecordsCommunityStore(agent).saveInvitation(invitation)
            navigation.navigate(TabStacks.MyAgentStack as never)
          }
        } catch (err: unknown) {
          logger.error(`invitation link rejected: ${(err as Error)?.message ?? err}`)
        } finally {
          dispatch({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [undefined] })
        }
        return
      }

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
          enableReuseConnections,
          store.preferences.walletName
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
    [
      agent,
      enableImplicitInvitations,
      enableReuseConnections,
      logger,
      navigation,
      store.preferences.walletName,
      t,
      dispatch,
    ]
  )

  useEffect(() => {
    if (store.deepLink && agent && store.authentication.didAuthenticate) {
      handleDeepLink(store.deepLink)
    }
  }, [store.deepLink, agent, store.authentication.didAuthenticate, handleDeepLink])

  const GradientBg = GradientTheme?.HeaderBackground

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: GradientBg ? 'transparent' : NavigationTheme.colors.primary }}
      edges={['left', 'right', 'top']}
    >
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
            tabBarAccessibilityLabel:
              totalUnread > 0 ? `${t('TabStack.Messages')}, ${totalUnread} unread` : t('TabStack.Messages'),
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
          name={TabStacks.MyAgentStack}
          component={MyAgentStack}
          options={{
            tabBarIconStyle: styles.tabBarIcon,
            tabBarIcon: ({ color, focused }) => (
              <View style={{ ...TabTheme.tabBarContainerStyle, justifyContent: showLabels ? 'flex-end' : 'center' }}>
                <Icon name={focused ? 'shield-account' : 'shield-account-outline'} size={24} color={color} />
                {showLabels && (
                  <Text
                    style={{
                      ...TabTheme.tabBarTextStyle,
                      color: focused ? TabTheme.tabBarActiveTintColor : TabTheme.tabBarInactiveTintColor,
                      fontWeight: focused ? TextTheme.bold.fontWeight : TextTheme.normal.fontWeight,
                    }}
                  >
                    {t('TabStack.MyAgent')}
                  </Text>
                )}
              </View>
            ),
            tabBarShowLabel: false,
            tabBarAccessibilityLabel: t('TabStack.MyAgent'),
            // A literal key, not the translated label: the tabs that pass a
            // translated string into testIdWithKey have locale-dependent
            // testIDs, which the e2e harness already works around.
            tabBarTestID: testIdWithKey('MyAgent'),
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
      <GlobalListener />
    </SafeAreaView>
  )
}

export default TabStack
