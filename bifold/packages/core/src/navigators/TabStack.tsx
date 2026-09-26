import { useAgent } from '@bifold/react-hooks'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AppState, Text, useWindowDimensions, View, StyleSheet, DeviceEventEmitter } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ToastType } from '../components/toast/BaseToast'
import { AttachTourStep } from '../components/tour/AttachTourStep'
import { EventTypes } from '../constants'
import { TOKENS, useServices } from '../container-api'
import { useNetwork } from '../contexts/network'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { BifoldError } from '../types/error'
import { Stacks, TabStackParams, TabStacks } from '../types/navigators'
import { connectFromScanOrDeepLink } from '../utils/helpers'
import { testIdWithKey } from '../utils/testable'
import { vtaAgent } from '../modules/trust-tasks/module/vtaAgent'
import { VtaOfflineBanner } from '../modules/trust-tasks/screens/VtaStatus'
import { MY_AGENT_SCREEN, keyringAgentLinkKind } from '../modules/trust-tasks/module/vtiLinks'
import { openKeyringLink, type KeyringLinkNotice } from '../modules/trust-tasks/module/keyringLinkOpen'
import { useVtiPersonaInbox } from '../modules/trust-tasks/module/vtiPersonaInbox'
import { communityTarget } from '../modules/trust-tasks/module/vtiCommunityLink'
import { useChosenCommunityDid } from '../modules/trust-tasks/screens/useCommunity'

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
  const [{ enableImplicitInvitations, enableReuseConnections, vti }, logger, GlobalListener] = useServices([
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
  // What a community sends this phone's persona — a vetter grant, a membership —
  // is collected from unlock, not only while Vetting is open.
  const onInboxError = useCallback(
    (e: unknown) => logger.warn(`persona inbox: ${(e as Error)?.message ?? e}`),
    [logger]
  )
  // The community chosen by a link before this launch comes back first.
  useEffect(() => {
    void communityTarget.restore()
  }, [])
  // The community a link chose (else the build's suggestion) gets the inbox.
  const inboxCommunityDid = useChosenCommunityDid(vti?.communityDid)
  useVtiPersonaInbox(agent, { mediatorDid: vti?.mediatorDid, communityDid: inboxCommunityDid, onError: onInboxError })
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

      // An agent enrolment offer (keyring://vta/enrol?o=…), a community
      // invitation (keyring://vti/invitation?c=…), a vetter's ticket
      // (vetting-ticket:?…) or a bare DID the phone's camera opened through
      // the `did` scheme — ours, not DIDComm OOB links. The same routing the
      // scanner and the paste screen use, and the person is told what
      // happened: nothing on screen used to say a link had failed.
      if (keyringAgentLinkKind(deepLink)) {
        try {
          if (agent) {
            await openKeyringLink(
              deepLink,
              agent,
              // Through the main stack, as the scanner does: navigating to the
              // tabs pops whatever sits above them, so the screen a link opens
              // comes to the top. Navigating the tabs alone left it underneath
              // an open modal, where the person could not see it had worked.
              (destination) =>
                (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate(
                  Stacks.TabStack,
                  { screen: TabStacks.MyAgentStack, params: { screen: MY_AGENT_SCREEN[destination] } }
                ),
              (notice: KeyringLinkNotice) => {
                if (notice.kind === 'reading') {
                  Toast.show({
                    type: ToastType.Info,
                    text1: t('Scan.ReadingCode'),
                    visibilityTime: 15000,
                    position: 'bottom',
                  })
                } else if (notice.kind === 'opened') {
                  Toast.hide()
                } else {
                  logger.warn(`agent link not usable: ${notice.message ?? 'unreadable'}`)
                  Toast.show({
                    type: ToastType.Warn,
                    text1: t('Scan.CodeNotUsable'),
                    text2: notice.message ?? t('Scan.CodeNotRead'),
                    visibilityTime: 8000,
                    position: 'bottom',
                  })
                }
              }
            )
          }
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

  // A linked phone reconnects to its agent from start-up, and again whenever
  // the app returns to the foreground (plan §4.2) — not only when a screen
  // that needs the agent happens to be open.
  useEffect(() => {
    if (!agent || !store.authentication.didAuthenticate) return
    void vtaAgent.restore(agent)
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void vtaAgent.ensureOnline(agent)
    })
    return () => subscription.remove()
  }, [agent, store.authentication.didAuthenticate])

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
      <VtaOfflineBanner />
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
                <Icon name={focused ? 'account-circle' : 'account-circle-outline'} size={26} color={color} />
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
